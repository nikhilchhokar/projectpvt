/**
 * Grounding specialist -- "Where is it?"
 *
 * Takes the concept the language layer extracted from the query and returns the
 * places in the raster that satisfy it, as georeferenced regions plus a mask.
 * This is the agent behind SHOW ME: its output is what the viewer highlights.
 */

import { combine, fromOtsu, fromSeparability, pct } from "../confidence";
import { classifyCached, type LandCover } from "../landcover";
import { EVIDENCE_COLORS } from "../palette";
import {
  componentsToRegions,
  connectedComponents,
  countMask,
  encodeRLE,
  type Mask,
} from "../raster";
import { GSD_M } from "../scene";
import { pixelsToKm2 } from "../geo";
import type { AgentMetric, AgentResult } from "../types";
import {
  primaryOptical,
  sceneOf,
  skipped,
  timed,
  type AgentContext,
  type Specialist,
} from "./context";

const METHOD = "Index thresholding, morphological cleanup, connected-component labelling";

type TargetKey = "water" | "vegetation" | "builtUp" | "bare";

interface TargetSpec {
  key: TargetKey;
  label: string;
  singular: string;
  color: string;
  select: (lc: LandCover) => Mask;
  margin: (lc: LandCover) => number;
  quality: (lc: LandCover) => number;
  index: string;
}

const TARGETS: Record<TargetKey, TargetSpec> = {
  water: {
    key: "water",
    label: "Water",
    singular: "water body",
    color: EVIDENCE_COLORS.water,
    select: (lc) => lc.water,
    margin: (lc) => lc.margins.water,
    quality: (lc) => lc.otsuQuality.water,
    index: "NDWI",
  },
  vegetation: {
    key: "vegetation",
    label: "Vegetation",
    singular: "vegetated area",
    color: EVIDENCE_COLORS.vegetation,
    select: (lc) => lc.vegetation,
    margin: (lc) => lc.margins.vegetation,
    quality: (lc) => lc.otsuQuality.vegetation,
    index: "NDVI",
  },
  builtUp: {
    key: "builtUp",
    label: "Built-up",
    singular: "built-up cluster",
    color: EVIDENCE_COLORS.builtUp,
    select: (lc) => lc.builtUp,
    margin: (lc) => lc.margins.builtUp,
    quality: (lc) => lc.otsuQuality.texture,
    index: "brightness-texture",
  },
  bare: {
    key: "bare",
    label: "Bare ground",
    singular: "bare or fallow patch",
    color: EVIDENCE_COLORS.bare,
    select: (lc) => lc.bare,
    margin: (lc) => lc.margins.builtUp,
    quality: (lc) => lc.otsuQuality.brightness,
    index: "brightness",
  },
};

const SIGNAL_FOR_TARGET: Record<TargetKey, "structure_present" | "water_present" | "vegetation_present"> = {
  water: "water_present",
  vegetation: "vegetation_present",
  builtUp: "structure_present",
  bare: "structure_present",
};

/** Map the concept the language layer extracted onto a detectable class. */
export function resolveTarget(target: string | null): TargetSpec {
  const t = (target ?? "").toLowerCase();
  if (/water|lake|river|reservoir|flood|wetland|pond|canal/.test(t)) return TARGETS.water;
  if (/veg|crop|farm|forest|tree|green|field|agri/.test(t)) return TARGETS.vegetation;
  if (/bare|soil|fallow|barren|sand/.test(t)) return TARGETS.bare;
  return TARGETS.builtUp;
}

export const groundingAgent: Specialist = {
  id: "grounding",
  displayName: "Grounding Agent",
  question: "Where is it?",

  canRun(ctx) {
    return Boolean(primaryOptical(ctx));
  },

  run(ctx: AgentContext): AgentResult {
    const image = primaryOptical(ctx);
    if (!image) {
      return skipped("grounding", "Grounding Agent", METHOD, "No optical image supplied");
    }

    const scene = sceneOf(image);
    const spec = resolveTarget(ctx.interpretation.target);

    const { value, durationMs } = timed(() => {
      const lc = classifyCached(scene, {
        thresholds: ctx.harmonised,
        waterThreshold: ctx.options.waterThreshold,
        builtUpThreshold: ctx.options.builtUpThreshold,
      });
      const mask = spec.select(lc);
      const comps = connectedComponents(mask, scene.width, scene.height, 100);
      return { lc, mask, comps };
    });

    const { lc, mask, comps } = value;
    const pixels = countMask(mask);
    const fraction = pixels / (scene.width * scene.height);

    if (!comps.length) {
      return {
        agent: "grounding",
        displayName: "Grounding Agent",
        method: METHOD,
        status: "ok",
        claim: `No ${spec.singular} large enough to localise was found in this scene`,
        confidence: combine([{ value: fromOtsu(spec.quality(lc)), weight: 1 }]) * 0.5,
        metrics: [
          { label: "Target", value: spec.label },
          { label: "Coverage", value: pct(fraction, 2), raw: fraction },
          { label: "Index used", value: spec.index },
        ],
        regions: [],
        masks: [],
        durationMs,
        note: "Detected pixels did not form a region above the minimum mappable unit.",
      };
    }

    const margin = spec.margin(lc);
    const baseConfidence = fromSeparability(margin);

    /**
     * Per-region confidence tapers with size: a component near the minimum
     * mappable unit is a weaker localisation than a large coherent one, even
     * when the spectral evidence behind both is identical.
     */
    const largest = comps[0].pixels;
    const regions = componentsToRegions(comps, scene, spec.label, (c) => {
      const sizeFactor = Math.min(1, 0.55 + 0.45 * Math.sqrt(c.pixels / largest));
      return Math.min(0.97, baseConfidence * sizeFactor);
    }, 6);

    const totalArea = pixelsToKm2(pixels, GSD_M);
    const claim =
      comps.length === 1
        ? `One ${spec.singular} located, covering ${totalArea.toFixed(2)} km²`
        : `${comps.length} ${spec.label.toLowerCase()} regions located, covering ${totalArea.toFixed(2)} km² in total`;

    const metrics: AgentMetric[] = [
      { label: "Target", value: spec.label },
      { label: "Index used", value: spec.index },
      { label: "Regions found", value: String(comps.length), raw: comps.length },
      { label: "Total area", value: `${totalArea.toFixed(2)} km²`, raw: totalArea },
      { label: "Scene coverage", value: pct(fraction, 1), raw: fraction },
      { label: "Class margin", value: `${margin.toFixed(2)} σ`, raw: margin },
    ];

    return {
      agent: "grounding",
      displayName: "Grounding Agent",
      method: METHOD,
      status: "ok",
      claim,
      confidence: combine([
        { value: baseConfidence, weight: 2 },
        { value: fromOtsu(spec.quality(lc)), weight: 1 },
      ]),
      metrics,
      regions,
      signal: {
        key: SIGNAL_FOR_TARGET[spec.key],
        detected: true,
        magnitude: fraction,
        statement: `${spec.label} present over ${pct(fraction, 1)} of the scene`,
      },
      masks: [
        {
          id: `grounding-${spec.key}`,
          label: spec.label,
          color: spec.color,
          mask: encodeRLE(mask, scene.width, scene.height),
          sceneKey: scene.key,
        },
      ],
      durationMs,
    };
  },
};
