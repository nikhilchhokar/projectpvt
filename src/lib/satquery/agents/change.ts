/**
 * Change specialist -- "What changed?"
 *
 * Bi-temporal built-up change detection. The critical detail is that both
 * epochs are classified with one harmonised threshold set: letting each epoch
 * pick its own Otsu cut would make a brighter dry season indistinguishable from
 * real construction, which is the classic way naive change detection lies.
 */

import { combine, fromOtsu, fromSeparability, pct } from "../confidence";
import { pixelsToKm2 } from "../geo";
import { classifyCached } from "../landcover";
import { EVIDENCE_COLORS } from "../palette";
import {
  andNotMask,
  cleanup,
  componentsToRegions,
  countMask,
  encodeRLE,
  filterByMinArea,
  maskedMean,
  separability,
  spectralDistance,
} from "../raster";
import { GSD_M } from "../scene";
import type { AgentMetric, AgentResult } from "../types";
import {
  opticalPair,
  sceneOf,
  skipped,
  timed,
  type AgentContext,
  type Specialist,
} from "./context";

const METHOD =
  "Harmonised bi-temporal built-up classification with post-classification comparison";

/**
 * Minimum mappable unit, in pixels. At 10 m ground sample distance this is
 * roughly 1.2 hectares -- below that, a "new built-up area" is not a place.
 */
const MIN_MAPPABLE_PIXELS = 120;

export type ChangeDirection = "expansion" | "reduction" | "stable";

export interface ChangeFinding {
  direction: ChangeDirection;
  relative: number;
  beforeFraction: number;
  afterFraction: number;
  gainedKm2: number;
  lostKm2: number;
  fronts: number;
}

export const changeAgent: Specialist = {
  id: "change",
  displayName: "Change Agent",
  question: "What changed?",

  canRun(ctx) {
    return Boolean(opticalPair(ctx));
  },

  run(ctx: AgentContext): AgentResult {
    const pair = opticalPair(ctx);
    if (!pair) {
      return skipped(
        "change",
        "Change Agent",
        METHOD,
        "Change analysis needs two optical images of the same area",
      );
    }

    const before = sceneOf(pair.before);
    const after = sceneOf(pair.after);

    const { value, durationMs } = timed(() => {
      const opts = {
        thresholds: ctx.harmonised,
        waterThreshold: ctx.options.waterThreshold,
        builtUpThreshold: ctx.options.builtUpThreshold,
      };
      const lcBefore = classifyCached(before, opts);
      const lcAfter = classifyCached(after, opts);

      const gainedRaw = andNotMask(lcAfter.builtUp, lcBefore.builtUp);
      const lostRaw = andNotMask(lcBefore.builtUp, lcAfter.builtUp);

      // Clean, then keep only patches at or above the minimum mappable unit.
      const gainedClean = cleanup(gainedRaw, before.width, before.height, 1);
      const gainedResult = filterByMinArea(
        gainedClean,
        before.width,
        before.height,
        MIN_MAPPABLE_PIXELS,
      );
      const lostResult = filterByMinArea(
        cleanup(lostRaw, before.width, before.height, 1),
        before.width,
        before.height,
        MIN_MAPPABLE_PIXELS,
      );
      const spectral = spectralDistance(before, after);

      return {
        lcBefore,
        lcAfter,
        gainedRaw,
        gainedClean,
        gained: gainedResult.mask,
        comps: gainedResult.components,
        lost: lostResult.mask,
        spectral,
      };
    });

    const { lcBefore, lcAfter, gainedRaw, gainedClean, gained, comps, lost, spectral } = value;
    const total = before.width * before.height;
    const beforeCount = countMask(lcBefore.builtUp);
    const afterCount = countMask(lcAfter.builtUp);
    const gainedCount = countMask(gained);
    const lostCount = countMask(lost);
    /**
     * The reported change is the mapped change: gain and loss are measured from
     * the minimum-mappable-unit masks, not from the raw per-pixel difference,
     * so the headline percentage refers to the same patches the map shows.
     */
    const relative = beforeCount > 0 ? (gainedCount - lostCount) / beforeCount : 0;

    /**
     * Three independent reasons to trust or distrust this measurement:
     *  - stability: how much of the raw difference survives morphological
     *    cleanup. Real construction is spatially coherent; threshold noise is not.
     *  - asymmetry: gain and loss in equal measure is the signature of a
     *    classifier flickering, not of land changing.
     *  - magnitude: whether the changed pixels are spectrally distinct from
     *    everywhere else, measured in pooled standard deviations.
     */
    /**
     * Stability compares the morphologically cleaned difference against the raw
     * one -- how much of the per-pixel signal was spatially coherent. It is
     * measured before the minimum mappable unit is applied, because dropping
     * small patches is a reporting decision, not evidence that the detection
     * was unstable.
     */
    const rawGainedCount = countMask(gainedRaw);
    const stability = rawGainedCount > 0 ? countMask(gainedClean) / rawGainedCount : 0;
    const asymmetry =
      gainedCount + lostCount > 0
        ? Math.abs(gainedCount - lostCount) / (gainedCount + lostCount)
        : 0;
    const unchanged = andNotMask(
      new Uint8Array(total).fill(1),
      gained,
    );
    const magnitude = gainedCount > 0 ? separability(spectral, gained, unchanged) : 0;

    const significant = Math.abs(relative) >= 0.03 && asymmetry >= 0.35 && comps.length > 0;
    const direction: ChangeDirection = !significant
      ? "stable"
      : relative > 0
        ? "expansion"
        : "reduction";

    const confidence = significant
      ? combine([
          { value: Math.min(1, stability * 1.15), weight: 1.4 },
          { value: asymmetry, weight: 1 },
          { value: fromSeparability(magnitude), weight: 1.2 },
          { value: fromOtsu(lcAfter.otsuQuality.texture), weight: 0.8 },
        ])
      : combine([
          { value: 1 - asymmetry, weight: 1 },
          { value: fromOtsu(lcAfter.otsuQuality.texture), weight: 1 },
        ]);

    const gainedKm2 = pixelsToKm2(gainedCount, GSD_M);
    const lostKm2 = pixelsToKm2(lostCount, GSD_M);

    const claim =
      direction === "expansion"
        ? `Built-up area increased by approximately ${Math.round(relative * 100)}%`
        : direction === "reduction"
          ? `Built-up area decreased by approximately ${Math.round(Math.abs(relative) * 100)}%`
          : "No structurally significant built-up change detected";

    const metrics: AgentMetric[] = [
      { label: "Built-up before", value: pct(beforeCount / total, 2), raw: beforeCount / total },
      { label: "Built-up after", value: pct(afterCount / total, 2), raw: afterCount / total },
      {
        label: "Relative change",
        value: `${relative >= 0 ? "+" : ""}${(relative * 100).toFixed(1)}%`,
        raw: relative,
      },
      { label: "Area gained", value: `${gainedKm2.toFixed(2)} km²`, raw: gainedKm2 },
      { label: "Area lost", value: `${lostKm2.toFixed(2)} km²`, raw: lostKm2 },
      { label: "Expansion fronts", value: String(comps.length), raw: comps.length },
      { label: "Mask stability", value: pct(stability, 0), raw: stability },
      { label: "Gain/loss asymmetry", value: pct(asymmetry, 0), raw: asymmetry },
      { label: "Spectral separation", value: `${magnitude.toFixed(2)} σ`, raw: magnitude },
      {
        label: "Vegetation shift",
        value: `${pct(lcBefore.fractions.vegetation, 1)} → ${pct(lcAfter.fractions.vegetation, 1)}`,
      },
      {
        label: "Mean spectral delta",
        value: maskedMean(spectral, new Uint8Array(total).fill(1)).toFixed(4),
      },
    ];

    const regionConfidence = Math.min(0.97, confidence);
    const regions = componentsToRegions(
      comps,
      after,
      direction === "reduction" ? "Built-up loss" : "Built-up expansion",
      () => regionConfidence,
      6,
    );

    return {
      agent: "change",
      displayName: "Change Agent",
      method: METHOD,
      status: "ok",
      claim,
      confidence,
      metrics,
      regions,
      signal: {
        key: "surface_change",
        detected: significant,
        magnitude: relative,
        statement: significant
          ? `Built-up ${direction} of ${Math.abs(Math.round(relative * 100))}% across ${comps.length} front${comps.length === 1 ? "" : "s"}`
          : "No coherent built-up change above the noise floor",
      },
      masks: [
        {
          id: "change-gained",
          label: "New built-up",
          color: EVIDENCE_COLORS.gained,
          mask: encodeRLE(gained, before.width, before.height),
          sceneKey: after.key,
        },
        {
          id: "change-lost",
          label: "Removed built-up",
          color: EVIDENCE_COLORS.lost,
          mask: encodeRLE(lost, before.width, before.height),
          sceneKey: after.key,
        },
        {
          id: "change-baseline",
          label: "Built-up at baseline",
          color: EVIDENCE_COLORS.builtUp,
          mask: encodeRLE(lcBefore.builtUp, before.width, before.height),
          sceneKey: before.key,
        },
      ],
      durationMs,
      note:
        direction === "stable"
          ? "Gain and loss are close to balanced, which is the signature of classifier noise rather than construction."
          : undefined,
    };
  },
};
