/**
 * Band rendering.
 *
 * Turns physical measurements into something a person can look at. The stretch
 * matters more than it sounds: reflectance in these scenes lives between about
 * 0.01 and 0.26, so a naive 0-1 mapping would render every image as near-black.
 * A percentile stretch is what actual remote-sensing software does, and it is
 * why the output reads as satellite imagery rather than as a plot.
 */

import { encodePNG } from "./png";
import { spectralDistance } from "./raster";
import { generateScene, type Scene } from "./scene";

export type RenderLayer = "optical" | "sar" | "difference" | "ndvi";

interface Stretch {
  low: number;
  high: number;
}

/**
 * Percentile stretch computed from a histogram. Clipping the tails stops a
 * handful of bright roofs or a dark water body from flattening everything else.
 */
function percentileStretch(values: Float32Array, lowPct = 0.02, highPct = 0.98): Stretch {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  if (!isFinite(min) || max <= min) return { low: min, high: min + 1 };

  const bins = 512;
  const hist = new Uint32Array(bins);
  const scale = (bins - 1) / (max - min);
  for (let i = 0; i < values.length; i++) {
    hist[Math.round((values[i] - min) * scale)]++;
  }

  const total = values.length;
  const lowTarget = total * lowPct;
  const highTarget = total * highPct;
  let cumulative = 0;
  let low = min;
  let high = max;
  let foundLow = false;
  for (let b = 0; b < bins; b++) {
    cumulative += hist[b];
    if (!foundLow && cumulative >= lowTarget) {
      low = min + b / scale;
      foundLow = true;
    }
    if (cumulative >= highTarget) {
      high = min + b / scale;
      break;
    }
  }
  return { low, high: Math.max(high, low + 1e-6) };
}

function applyStretch(value: number, stretch: Stretch, gamma: number): number {
  const t = Math.max(0, Math.min(1, (value - stretch.low) / (stretch.high - stretch.low)));
  return Math.round(255 * Math.pow(t, 1 / gamma));
}

/**
 * Fixed reflectance range for true-colour rendering.
 *
 * Deliberately not a per-scene percentile stretch. Two things break under an
 * adaptive stretch, and both matter here:
 *
 *  - Comparability. A scene-adaptive stretch renders identical ground
 *    differently in each epoch, so toggling Before/After would show brightness
 *    changes that are artefacts of the display, not of the land. In a change
 *    detection product that is not a cosmetic problem -- it is the display
 *    telling the same lie the harmonised classifier thresholds exist to prevent.
 *  - Interpretability. With a fixed range, a given tone always means the same
 *    reflectance, so the imagery can be read rather than merely looked at.
 *
 * The range matches the convention for Sentinel-2 true-colour products. The
 * non-zero black point stands in for dark-object subtraction: some of the
 * signal over deep water is atmospheric path radiance rather than the surface,
 * and leaving it in renders water as pale grey.
 */
const OPTICAL_RANGE: Stretch = { low: 0.012, high: 0.34 };
const OPTICAL_GAMMA = 1.4;

/**
 * True-colour composite.
 *
 * One stretch shared across the three visible bands, not three independent
 * ones. Stretching each band to its own full range is the classic way to turn
 * a satellite scene into a false-colour poster: it discards the relationship
 * between bands, which is exactly the information that makes vegetation look
 * like vegetation and water look like water.
 */
function renderOptical(scene: Scene): Uint8Array {
  const n = scene.width * scene.height;
  const out = new Uint8Array(n * 3);
  const stretch = OPTICAL_RANGE;

  for (let i = 0; i < n; i++) {
    /**
     * A mild gamma only. Satellite true-colour products apply far less tone
     * lifting than a photograph does -- push it and cropland stops looking like
     * cropland, because vegetation genuinely is dark in the visible bands.
     */
    const r = applyStretch(scene.red[i], stretch, OPTICAL_GAMMA);
    const g = applyStretch(scene.green[i], stretch, OPTICAL_GAMMA);
    const b = applyStretch(scene.blue[i], stretch, OPTICAL_GAMMA);

    // Pull slightly toward luminance. Sensor and atmosphere both desaturate;
    // fully saturated colour is a tell that an image was synthesised.
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = 0.75;
    out[i * 3] = Math.round(luma + (r - luma) * sat);
    out[i * 3 + 1] = Math.round(luma + (g - luma) * sat);
    out[i * 3 + 2] = Math.round(luma + (b - luma) * sat);
  }
  return out;
}

/**
 * SAR is conventionally shown as greyscale amplitude. A very slight warm tint
 * in the highlights keeps it visually distinct from a desaturated optical view
 * when both are on screen, without pretending the sensor has colour.
 */
function renderSar(scene: Scene): Uint8Array {
  const n = scene.width * scene.height;
  const out = new Uint8Array(n * 3);
  // Fixed dB window, for the same comparability reason as the optical range.
  const stretch: Stretch = { low: -24, high: -2 };
  for (let i = 0; i < n; i++) {
    const v = applyStretch(scene.sar[i], stretch, 1.15);
    out[i * 3] = v;
    out[i * 3 + 1] = Math.round(v * 0.985);
    out[i * 3 + 2] = Math.round(v * 0.95);
  }
  return out;
}

/** Spectral change magnitude on a dark-to-amber ramp. */
function renderDifference(before: Scene, after: Scene): Uint8Array {
  const n = before.width * before.height;
  const out = new Uint8Array(n * 3);
  const distance = spectralDistance(before, after);
  const stretch = percentileStretch(distance, 0.02, 0.995);
  for (let i = 0; i < n; i++) {
    const t = Math.max(
      0,
      Math.min(1, (distance[i] - stretch.low) / (stretch.high - stretch.low)),
    );
    const eased = Math.pow(t, 0.85);
    out[i * 3] = Math.round(18 + 233 * eased);
    out[i * 3 + 1] = Math.round(20 + 127 * eased);
    out[i * 3 + 2] = Math.round(28 + 30 * eased);
  }
  return out;
}

/** NDVI on a brown-to-green ramp, for the expert layer stack. */
function renderNdvi(scene: Scene): Uint8Array {
  const n = scene.width * scene.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const denom = scene.nir[i] + scene.red[i];
    const value = denom === 0 ? 0 : (scene.nir[i] - scene.red[i]) / denom;
    const t = Math.max(0, Math.min(1, (value + 0.2) / 1.2));
    out[i * 3] = Math.round(150 - 120 * t);
    out[i * 3 + 1] = Math.round(90 + 130 * t);
    out[i * 3 + 2] = Math.round(60 - 20 * t);
  }
  return out;
}

/** Rendered 8-bit samples, before PNG containerisation. Exposed for testing. */
export function renderLayerRGB(
  sceneKey: string,
  layer: RenderLayer,
  againstKey?: string,
): { rgb: Uint8Array; width: number; height: number } {
  const scene = generateScene(sceneKey);
  let rgb: Uint8Array;
  switch (layer) {
    case "sar":
      rgb = renderSar(scene);
      break;
    case "ndvi":
      rgb = renderNdvi(scene);
      break;
    case "difference": {
      if (!againstKey) throw new Error("difference layer requires a second scene");
      rgb = renderDifference(generateScene(againstKey), scene);
      break;
    }
    default:
      rgb = renderOptical(scene);
  }
  return { rgb, width: scene.width, height: scene.height };
}

const CACHE = new Map<string, Buffer>();

/**
 * Render a layer to PNG, memoised. Scenes are immutable and deterministic, so a
 * rendered layer is valid for the life of the process.
 */
export function renderLayerPNG(
  sceneKey: string,
  layer: RenderLayer,
  againstKey?: string,
): Buffer {
  const cacheKey = `${sceneKey}|${layer}|${againstKey ?? ""}`;
  const hit = CACHE.get(cacheKey);
  if (hit) return hit;

  const { rgb, width, height } = renderLayerRGB(sceneKey, layer, againstKey);
  const png = encodePNG(rgb, width, height);
  CACHE.set(cacheKey, png);
  return png;
}
