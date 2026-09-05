/**
 * Shared land-cover classification.
 *
 * The vision, grounding and change specialists all need the same notion of
 * "what class is this pixel", so it lives here once. Sharing it is also what
 * makes cross-agent agreement meaningful rather than circular: the agents apply
 * this classifier to *different inputs* (different epochs, different
 * modalities) and the evidence engine compares the results.
 */

import {
  andMask,
  andNotMask,
  brightness,
  cleanup,
  countMask,
  localTexture,
  ndvi,
  ndwi,
  otsu,
  separability,
  threshold,
  type Mask,
} from "./raster";
import type { Scene } from "./scene";

export interface LandCoverThresholds {
  water: number;
  vegetation: number;
  brightness: number;
  texture: number;
}

export interface LandCover {
  water: Mask;
  vegetation: Mask;
  builtUp: Mask;
  bare: Mask;
  ndvi: Float32Array;
  ndwi: Float32Array;
  brightness: Float32Array;
  texture: Float32Array;
  thresholds: LandCoverThresholds;
  /** Otsu separability per decision, in [0,1]. */
  otsuQuality: { water: number; vegetation: number; brightness: number; texture: number };
  /** Normalised distance between class means, in pooled standard deviations. */
  margins: { water: number; vegetation: number; builtUp: number };
  fractions: { water: number; vegetation: number; builtUp: number; bare: number; other: number };
  pixelCount: number;
}

export interface ClassifyOptions {
  /** Expert override for the NDWI water cut. */
  waterThreshold?: number;
  /** Expert override for the built-up brightness cut. */
  builtUpThreshold?: number;
  /**
   * Fully specified thresholds, bypassing per-scene Otsu. Bi-temporal work must
   * pass these: letting each epoch pick its own cuts makes threshold drift
   * indistinguishable from ground change.
   */
  thresholds?: LandCoverThresholds;
}

/**
 * Otsu is unsupervised and will happily split the wrong pair of populations
 * when a class is nearly absent from the scene, so each automatic threshold is
 * constrained to a physically plausible band for its index.
 */
function constrainedOtsu(
  values: Float32Array,
  lo: number,
  hi: number,
): { threshold: number; quality: number } {
  const result = otsu(values);
  return {
    threshold: Math.max(lo, Math.min(hi, result.threshold)),
    quality: result.separability,
  };
}

export function classify(scene: Scene, options: ClassifyOptions = {}): LandCover {
  const { width, height } = scene;
  const vNdvi = ndvi(scene);
  const vNdwi = ndwi(scene);
  const vBright = brightness(scene);
  /**
   * A 5x5 window. Wider windows raise recall by smearing settlement texture
   * outward, but they smear it onto the neighbouring fields too: at radius 3
   * precision fell from 60% to 37% against the generator's labels for four
   * points of recall.
   */
  const vTexture = localTexture(vBright, width, height, 2);

  const waterOtsu = constrainedOtsu(vNdwi, 0.05, 0.45);
  const vegOtsu = constrainedOtsu(vNdvi, 0.25, 0.6);
  const brightOtsu = constrainedOtsu(vBright, 0.1, 0.2);
  const texOtsu = constrainedOtsu(vTexture, 0.012, 0.022);

  const thresholds: LandCoverThresholds = options.thresholds ?? {
    water: options.waterThreshold ?? waterOtsu.threshold,
    vegetation: vegOtsu.threshold,
    brightness: options.builtUpThreshold ?? brightOtsu.threshold,
    texture: texOtsu.threshold,
  };

  // Water: high NDWI. Cleaned, because speckle-scale water is not water.
  const waterRaw = threshold(vNdwi, thresholds.water, true);
  const water = cleanup(waterRaw, width, height, 1);

  // Vegetation: high NDVI, excluding anything already called water.
  const vegetation = andNotMask(threshold(vNdvi, thresholds.vegetation, true), water);

  /**
   * Built-up: bright and non-vegetated is not enough -- dry bare soil looks the
   * same spectrally. What separates them is texture: urban fabric has high
   * local variance at building scale, bare fields are smooth.
   */
  const notVeg = threshold(vNdvi, 0.25, false);
  const bright = threshold(vBright, thresholds.brightness, true);
  const rough = threshold(vTexture, thresholds.texture, true);
  const builtRaw = andNotMask(andMask(andMask(notVeg, bright), rough), water);
  /**
   * Open then close at one pixel.
   *
   * A wider closing is tempting -- it would pull courtyards and car parks into
   * the settlement and raise recall -- but bright fallow fields sit directly
   * against these towns, and dilating far enough to bridge an urban gap also
   * bridges the field boundary. Measured against the generator's own labels
   * that trade costs roughly twice as much precision as it buys in recall.
   */
  const builtUp = cleanup(builtRaw, width, height, 1);

  // Bare: bright, non-vegetated, but smooth.
  const bare = andNotMask(andNotMask(andMask(notVeg, bright), builtUp), water);

  const total = width * height;
  const wc = countMask(water);
  const vc = countMask(vegetation);
  const bc = countMask(builtUp);
  const barec = countMask(bare);

  const notWater = andNotMask(new Uint8Array(total).fill(1), water);
  const notVegMask = andNotMask(new Uint8Array(total).fill(1), vegetation);
  const notBuilt = andNotMask(new Uint8Array(total).fill(1), builtUp);

  return {
    water,
    vegetation,
    builtUp,
    bare,
    ndvi: vNdvi,
    ndwi: vNdwi,
    brightness: vBright,
    texture: vTexture,
    thresholds,
    otsuQuality: {
      water: waterOtsu.quality,
      vegetation: vegOtsu.quality,
      brightness: brightOtsu.quality,
      texture: texOtsu.quality,
    },
    margins: {
      water: wc > 0 ? separability(vNdwi, water, notWater) : 0,
      vegetation: vc > 0 ? separability(vNdvi, vegetation, notVegMask) : 0,
      builtUp: bc > 0 ? separability(vTexture, builtUp, notBuilt) : 0,
    },
    fractions: {
      water: wc / total,
      vegetation: vc / total,
      builtUp: bc / total,
      bare: barec / total,
      other: Math.max(0, (total - wc - vc - bc - barec) / total),
    },
    pixelCount: total,
  };
}

function pool(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Derive one threshold set valid for both epochs of a bi-temporal pair.
 *
 * Otsu is scene-adaptive, which is exactly wrong for change detection: a
 * brighter dry season shifts the cut, and the shift alone would register as
 * built-up loss. Pooling both epochs before thresholding removes that artefact,
 * so a reported change is a change on the ground.
 */
export function harmonizeThresholds(a: LandCover, b: LandCover): LandCoverThresholds {
  return {
    water: constrainedOtsu(pool(a.ndwi, b.ndwi), 0.05, 0.45).threshold,
    vegetation: constrainedOtsu(pool(a.ndvi, b.ndvi), 0.25, 0.6).threshold,
    brightness: constrainedOtsu(pool(a.brightness, b.brightness), 0.1, 0.2).threshold,
    texture: constrainedOtsu(pool(a.texture, b.texture), 0.012, 0.022).threshold,
  };
}

const CACHE = new Map<string, LandCover>();

/** Classification is pure and expensive; memoise per scene + threshold set. */
export function classifyCached(scene: Scene, options: ClassifyOptions = {}): LandCover {
  const t = options.thresholds;
  const tKey = t ? `${t.water}:${t.vegetation}:${t.brightness}:${t.texture}` : "auto";
  const key = `${scene.key}|${options.waterThreshold ?? "auto"}|${options.builtUpThreshold ?? "auto"}|${tKey}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const result = classify(scene, options);
  CACHE.set(key, result);
  return result;
}

/** Human label for the dominant class, used in scene descriptions. */
export function dominantCover(lc: LandCover): string {
  const entries: [string, number][] = [
    ["vegetated cropland", lc.fractions.vegetation],
    ["bare and fallow ground", lc.fractions.bare],
    ["built-up land", lc.fractions.builtUp],
    ["open water", lc.fractions.water],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}
