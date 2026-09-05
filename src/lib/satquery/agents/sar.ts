/**
 * SAR specialist -- "What does radar reveal?"
 *
 * Radar carries information optical sensors cannot: backscatter responds to
 * structure and surface roughness rather than colour, so it is largely immune
 * to the seasonal and illumination effects that mislead optical change
 * detection. That independence is precisely what makes it worth cross-checking
 * against, and it is why the evidence engine treats it as a separate witness.
 */

import { combine, fromOtsu, fromSeparability, pct } from "../confidence";
import { pixelsToKm2 } from "../geo";
import { EVIDENCE_COLORS } from "../palette";
import {
  andNotMask,
  cleanup,
  componentsToRegions,
  connectedComponents,
  countMask,
  difference,
  encodeRLE,
  maskedMean,
  otsu,
  robustSigma,
  separability,
  speckleFilterDb,
  threshold,
  type Mask,
} from "../raster";
import { generateScene, GSD_M } from "../scene";
import type { AgentMetric, AgentResult } from "../types";
import {
  primarySar,
  sarPair,
  skipped,
  timed,
  type AgentContext,
  type Specialist,
} from "./context";

const METHOD_TEMPORAL =
  "Multi-look speckle filtering with MAD-thresholded backscatter change detection";
const METHOD_SINGLE = "Multi-look speckle filtering with Otsu backscatter segmentation";

/** Below this, a backscatter difference is indistinguishable from speckle. */
const MIN_RISE_DB = 2.5;

export const sarAgent: Specialist = {
  id: "sar",
  displayName: "SAR Agent",
  question: "What does radar reveal?",

  canRun(ctx) {
    return Boolean(primarySar(ctx));
  },

  run(ctx: AgentContext): AgentResult {
    const pair = sarPair(ctx);
    if (pair) return runTemporal(pair.before.sceneKey, pair.after.sceneKey);

    const single = primarySar(ctx);
    if (single) return runSingle(single.sceneKey);

    return skipped("sar", "SAR Agent", METHOD_SINGLE, "No SAR image supplied");
  },
};

// --- bi-temporal ------------------------------------------------------------

function runTemporal(beforeKey: string, afterKey: string): AgentResult {
  const before = generateScene(beforeKey);
  const after = generateScene(afterKey);

  const { value, durationMs } = timed(() => {
    const fa = speckleFilterDb(before.sar, before.width, before.height, 2);
    const fb = speckleFilterDb(after.sar, after.width, after.height, 2);
    const delta = difference(fa, fb);

    // Set the decision threshold from the measured speckle floor, not a guess.
    const sigma = robustSigma(delta);
    const cut = Math.max(MIN_RISE_DB, 3 * sigma);

    const riseRaw = threshold(delta, cut, true);
    const dropRaw = threshold(delta, -cut, false);
    const rise = cleanup(riseRaw, before.width, before.height, 1);
    const drop = cleanup(dropRaw, before.width, before.height, 1);
    return { fa, fb, delta, sigma, cut, rise, drop };
  });

  const { fa, fb, delta, sigma, cut, rise, drop } = value;
  const riseCount = countMask(rise);
  const dropCount = countMask(drop);
  const total = before.width * before.height;

  const comps = connectedComponents(rise, before.width, before.height, 80);
  const notRise = andNotMask(new Uint8Array(total).fill(1), rise);
  const sep = riseCount > 0 ? separability(delta, rise, notRise) : 0;
  const meanRise = riseCount > 0 ? maskedMean(delta, rise) : 0;

  const detected = riseCount > 0 && comps.length > 0;
  const confidence = detected
    ? combine([
        { value: fromSeparability(sep), weight: 1.5 },
        { value: Math.min(1, Math.abs(meanRise) / 6), weight: 1.2 },
        { value: Math.min(1, riseCount / 400), weight: 0.6 },
      ])
    : combine([{ value: Math.min(1, 1.2 - riseCount / 200), weight: 1 }]) * 0.85;

  const riseKm2 = pixelsToKm2(riseCount, GSD_M);

  const claim = detected
    ? `Structural backscatter increased over ${riseKm2.toFixed(2)} km², consistent with new hard surfaces`
    : "No structural backscatter response above the speckle floor";

  const metrics: AgentMetric[] = [
    { label: "Speckle floor (MAD)", value: `${sigma.toFixed(2)} dB`, raw: sigma },
    { label: "Decision threshold", value: `${cut.toFixed(2)} dB`, raw: cut },
    { label: "Backscatter rise", value: `${riseKm2.toFixed(2)} km²`, raw: riseKm2 },
    { label: "Backscatter drop", value: `${pixelsToKm2(dropCount, GSD_M).toFixed(2)} km²` },
    {
      label: "Mean rise in response",
      value: `${meanRise >= 0 ? "+" : ""}${meanRise.toFixed(2)} dB`,
      raw: meanRise,
    },
    { label: "Scene mean before", value: `${maskedMean(fa, new Uint8Array(total).fill(1)).toFixed(2)} dB` },
    { label: "Scene mean after", value: `${maskedMean(fb, new Uint8Array(total).fill(1)).toFixed(2)} dB` },
    { label: "Response separation", value: `${sep.toFixed(2)} σ`, raw: sep },
    { label: "Response clusters", value: String(comps.length), raw: comps.length },
  ];

  const regionConfidence = Math.min(0.97, confidence);

  return {
    agent: "sar",
    displayName: "SAR Agent",
    method: METHOD_TEMPORAL,
    status: "ok",
    claim,
    confidence,
    metrics,
    regions: componentsToRegions(comps, after, "SAR structural response", () => regionConfidence, 6),
    signal: {
      key: "surface_change",
      detected,
      magnitude: detected ? Math.min(1, meanRise / 10) : 0,
      statement: detected
        ? `Backscatter rose ${meanRise.toFixed(1)} dB over ${riseKm2.toFixed(2)} km², indicating new structure`
        : "No backscatter response, so no new structure",
    },
    masks: [
      {
        id: "sar-rise",
        label: "Backscatter increase",
        color: EVIDENCE_COLORS.sar,
        mask: encodeRLE(rise, before.width, before.height),
        sceneKey: after.key,
      },
    ],
    durationMs,
    note: detected
      ? undefined
      : "Radar sees no new structure here. A large optical change without a radar response usually means surface reflectance changed, not the surface itself.",
  };
}

// --- single image -----------------------------------------------------------

function runSingle(sceneKey: string): AgentResult {
  const scene = generateScene(sceneKey);

  const { value, durationMs } = timed(() => {
    const filtered = speckleFilterDb(scene.sar, scene.width, scene.height, 2);
    const highOtsu = otsu(filtered);
    const highCut = Math.max(-9, Math.min(-4, highOtsu.threshold));
    const strong = cleanup(threshold(filtered, highCut, true), scene.width, scene.height, 1);
    // Open water is a specular reflector: almost nothing comes back.
    const smooth = cleanup(threshold(filtered, -18, false), scene.width, scene.height, 1);
    return { filtered, highOtsu, highCut, strong, smooth };
  });

  const { filtered, highOtsu, highCut, strong, smooth } = value;
  const total = scene.width * scene.height;
  const strongCount = countMask(strong);
  const smoothCount = countMask(smooth);
  const notStrong: Mask = andNotMask(new Uint8Array(total).fill(1), strong);
  const sep = strongCount > 0 ? separability(filtered, strong, notStrong) : 0;

  const comps = connectedComponents(strong, scene.width, scene.height, 100);
  const confidence = combine([
    { value: fromSeparability(sep), weight: 1.5 },
    { value: fromOtsu(highOtsu.separability), weight: 1 },
  ]);

  const strongKm2 = pixelsToKm2(strongCount, GSD_M);
  const smoothKm2 = pixelsToKm2(smoothCount, GSD_M);

  const metrics: AgentMetric[] = [
    { label: "Strong-return threshold", value: `${highCut.toFixed(1)} dB`, raw: highCut },
    { label: "Strong return (structural)", value: `${strongKm2.toFixed(2)} km²`, raw: strongKm2 },
    { label: "Specular return (smooth/water)", value: `${smoothKm2.toFixed(2)} km²`, raw: smoothKm2 },
    { label: "Mean backscatter", value: `${maskedMean(filtered, new Uint8Array(total).fill(1)).toFixed(2)} dB` },
    { label: "Class separation", value: `${sep.toFixed(2)} σ`, raw: sep },
  ];

  const regionConfidence = Math.min(0.97, confidence);

  return {
    agent: "sar",
    displayName: "SAR Agent",
    method: METHOD_SINGLE,
    status: "ok",
    claim: `Strong double-bounce returns over ${strongKm2.toFixed(2)} km² and specular (water-like) returns over ${smoothKm2.toFixed(2)} km²`,
    confidence,
    metrics,
    regions: componentsToRegions(comps, scene, "Strong radar return", () => regionConfidence, 5),
    signal: {
      key: "structure_present",
      detected: strongCount > 0,
      magnitude: strongCount / total,
      statement: `Structural returns over ${pct(strongCount / total, 1)} of the scene`,
    },
    masks: [
      {
        id: "sar-structural",
        label: "Strong radar return",
        color: EVIDENCE_COLORS.sar,
        mask: encodeRLE(strong, scene.width, scene.height),
        sceneKey: scene.key,
      },
      {
        id: "sar-specular",
        label: "Specular (water-like)",
        color: EVIDENCE_COLORS.water,
        mask: encodeRLE(smooth, scene.width, scene.height),
        sceneKey: scene.key,
      },
    ],
    durationMs,
  };
}
