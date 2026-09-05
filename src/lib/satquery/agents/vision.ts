/**
 * Vision specialist -- "What is here?"
 *
 * Answers single-image questions about scene content by classifying land cover
 * from spectral indices and reporting the composition it measured.
 */

import { combine, fromOtsu, fromSeparability, pct } from "../confidence";
import { classifyCached } from "../landcover";
import { EVIDENCE_COLORS } from "../palette";
import {
  componentsToRegions,
  connectedComponents,
  encodeRLE,
  maskedMean,
} from "../raster";
import type { AgentMetric, AgentResult, Region } from "../types";
import {
  primaryOptical,
  sceneOf,
  skipped,
  timed,
  type AgentContext,
  type Specialist,
} from "./context";

const METHOD =
  "NDVI / NDWI / brightness-texture classification with Otsu thresholding";

interface CoverEntry {
  key: string;
  label: string;
  fraction: number;
}

/**
 * Turn measured class fractions into a sentence. Only classes with a
 * meaningful footprint are named -- listing a 0.4% class as though it
 * characterised the scene would misrepresent the measurement.
 */
function describeComposition(entries: CoverEntry[]): string {
  const notable = entries.filter((e) => e.fraction >= 0.03).sort((a, b) => b.fraction - a.fraction);
  if (!notable.length) return "No dominant land-cover class could be resolved";

  const [first, ...rest] = notable;
  const head = `Predominantly ${first.label} (${pct(first.fraction)})`;
  if (!rest.length) return head;
  const tail = rest
    .slice(0, 3)
    .map((e) => `${e.label} (${pct(e.fraction)})`);
  const joined =
    tail.length === 1 ? tail[0] : `${tail.slice(0, -1).join(", ")} and ${tail[tail.length - 1]}`;
  return `${head}, with ${joined}`;
}

export const visionAgent: Specialist = {
  id: "vision",
  displayName: "Vision Agent",
  question: "What is here?",

  canRun(ctx) {
    return Boolean(primaryOptical(ctx));
  },

  run(ctx: AgentContext): AgentResult {
    const image = primaryOptical(ctx);
    if (!image) {
      return skipped("vision", "Vision Agent", METHOD, "No optical image supplied");
    }

    const scene = sceneOf(image);
    const { value: lc, durationMs } = timed(() =>
      classifyCached(scene, {
        thresholds: ctx.harmonised,
        waterThreshold: ctx.options.waterThreshold,
        builtUpThreshold: ctx.options.builtUpThreshold,
      }),
    );

    const entries: CoverEntry[] = [
      { key: "vegetation", label: "vegetated cropland", fraction: lc.fractions.vegetation },
      { key: "bare", label: "bare and fallow ground", fraction: lc.fractions.bare },
      { key: "builtUp", label: "built-up land", fraction: lc.fractions.builtUp },
      { key: "water", label: "open water", fraction: lc.fractions.water },
    ];

    const builtComps = connectedComponents(lc.builtUp, scene.width, scene.height, 120);
    const waterComps = connectedComponents(lc.water, scene.width, scene.height, 120);

    const builtConfidence = fromSeparability(lc.margins.builtUp);
    const waterConfidence = fromSeparability(lc.margins.water);

    const regions: Region[] = [
      ...componentsToRegions(builtComps, scene, "Built-up cluster", () => builtConfidence, 4),
      ...componentsToRegions(waterComps, scene, "Water body", () => waterConfidence, 3),
    ];

    const confidence = combine([
      { value: fromOtsu(lc.otsuQuality.vegetation), weight: 1 },
      { value: fromSeparability(lc.margins.vegetation), weight: 1.4 },
      { value: builtConfidence, weight: 1 },
      { value: waterConfidence, weight: lc.fractions.water > 0.01 ? 1 : 0 },
    ]);

    const metrics: AgentMetric[] = [
      { label: "Vegetated cropland", value: pct(lc.fractions.vegetation, 1), raw: lc.fractions.vegetation },
      { label: "Bare / fallow", value: pct(lc.fractions.bare, 1), raw: lc.fractions.bare },
      { label: "Built-up", value: pct(lc.fractions.builtUp, 1), raw: lc.fractions.builtUp },
      { label: "Open water", value: pct(lc.fractions.water, 1), raw: lc.fractions.water },
      { label: "Mean NDVI", value: maskedMean(lc.ndvi, new Uint8Array(lc.ndvi.length).fill(1)).toFixed(3) },
      { label: "NDVI cut (Otsu)", value: lc.thresholds.vegetation.toFixed(3) },
      { label: "Discrete objects", value: String(builtComps.length + waterComps.length) },
    ];

    return {
      agent: "vision",
      displayName: "Vision Agent",
      method: METHOD,
      status: "ok",
      claim: describeComposition(entries),
      confidence,
      metrics,
      regions,
      signal: {
        key: "structure_present",
        detected: lc.fractions.builtUp >= 0.01,
        magnitude: lc.fractions.builtUp,
        statement:
          lc.fractions.builtUp >= 0.01
            ? `Built-up fabric covers ${pct(lc.fractions.builtUp, 1)} of the scene`
            : "No appreciable built-up fabric present",
      },
      masks: [
        {
          id: "vision-vegetation",
          label: "Vegetation",
          color: EVIDENCE_COLORS.vegetation,
          mask: encodeRLE(lc.vegetation, scene.width, scene.height),
          sceneKey: scene.key,
        },
        {
          id: "vision-built",
          label: "Built-up",
          color: EVIDENCE_COLORS.builtUp,
          mask: encodeRLE(lc.builtUp, scene.width, scene.height),
          sceneKey: scene.key,
        },
        {
          id: "vision-water",
          label: "Water",
          color: EVIDENCE_COLORS.water,
          mask: encodeRLE(lc.water, scene.width, scene.height),
          sceneKey: scene.key,
        },
      ],
      durationMs,
    };
  },
};
