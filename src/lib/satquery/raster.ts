/**
 * Raster analysis primitives.
 *
 * Ordinary remote-sensing operations -- normalised difference indices, Otsu
 * thresholding, morphological cleanup, connected-component labelling, mask
 * agreement. The specialist agents are built out of these, so their outputs are
 * measured from the imagery rather than declared.
 */

import { bboxToGeoBbox, pixelsToKm2, pixelToGeo } from "./geo";
import { GSD_M, type Scene } from "./scene";
import type { MaskRLE, Region } from "./types";

export type Mask = Uint8Array;

// --- indices ----------------------------------------------------------------

function normalisedDifference(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const denom = a[i] + b[i];
    out[i] = denom === 0 ? 0 : (a[i] - b[i]) / denom;
  }
  return out;
}

/** Normalised Difference Vegetation Index: (NIR - Red) / (NIR + Red). */
export function ndvi(scene: Scene): Float32Array {
  return normalisedDifference(scene.nir, scene.red);
}

/** Normalised Difference Water Index (McFeeters): (Green - NIR) / (Green + NIR). */
export function ndwi(scene: Scene): Float32Array {
  return normalisedDifference(scene.green, scene.nir);
}

/** Visible-band brightness, a proxy for impervious albedo. */
export function brightness(scene: Scene): Float32Array {
  const out = new Float32Array(scene.red.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = (scene.red[i] + scene.green[i] + scene.blue[i]) / 3;
  }
  return out;
}

/**
 * Local standard deviation over a square window. Built-up fabric is spectrally
 * unremarkable but texturally busy, so this separates it from bare soil.
 */
export function localTexture(band: Float32Array, width: number, height: number, radius = 2): Float32Array {
  const out = new Float32Array(band.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const v = band[yy * width + xx];
          sum += v;
          sumSq += v * v;
          count++;
        }
      }
      const mean = sum / count;
      out[y * width + x] = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
    }
  }
  return out;
}

/**
 * Multi-look speckle filter for SAR.
 *
 * SAR speckle is multiplicative, so averaging has to happen in linear power,
 * not in dB -- averaging decibels biases the result low. A boxcar of radius r
 * reduces speckle standard deviation by roughly the window side length, which
 * is what makes a per-pixel backscatter difference usable at all.
 */
export function speckleFilterDb(
  db: Float32Array,
  width: number,
  height: number,
  radius = 2,
): Float32Array {
  const linear = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) linear[i] = Math.pow(10, db[i] / 10);

  const out = new Float32Array(db.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          sum += linear[yy * width + xx];
          count++;
        }
      }
      out[y * width + x] = 10 * Math.log10(sum / count);
    }
  }
  return out;
}

export function median(values: Float32Array): number {
  const copy = Float32Array.from(values);
  copy.sort();
  const mid = copy.length >> 1;
  return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

/**
 * Median-absolute-deviation estimate of the noise standard deviation.
 *
 * Used to set SAR change thresholds. A plain standard deviation would be
 * inflated by the very changes being looked for; MAD ignores the tails, so the
 * threshold is set by the speckle floor rather than by the signal.
 */
export function robustSigma(values: Float32Array): number {
  const med = median(values);
  const deviations = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) deviations[i] = Math.abs(values[i] - med);
  return 1.4826 * median(deviations);
}

/** Element-wise difference, b - a. */
export function difference(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = b[i] - a[i];
  return out;
}

/** Euclidean spectral distance between two scenes' visible + NIR bands. */
export function spectralDistance(
  a: { red: Float32Array; green: Float32Array; blue: Float32Array; nir: Float32Array },
  b: { red: Float32Array; green: Float32Array; blue: Float32Array; nir: Float32Array },
): Float32Array {
  const out = new Float32Array(a.red.length);
  for (let i = 0; i < out.length; i++) {
    const dr = b.red[i] - a.red[i];
    const dg = b.green[i] - a.green[i];
    const db = b.blue[i] - a.blue[i];
    const dn = b.nir[i] - a.nir[i];
    out[i] = Math.sqrt(dr * dr + dg * dg + db * db + dn * dn);
  }
  return out;
}

// --- thresholding -----------------------------------------------------------

export interface OtsuResult {
  threshold: number;
  /** Between-class variance at the chosen threshold, normalised by total
   *  variance. Near 1 means the two populations are cleanly separable. */
  separability: number;
}

/** Otsu's method: pick the threshold maximising between-class variance. */
export function otsu(values: Float32Array, bins = 256): OtsuResult {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  if (!isFinite(min) || max <= min) return { threshold: min, separability: 0 };

  const hist = new Float64Array(bins);
  const scale = (bins - 1) / (max - min);
  for (let i = 0; i < values.length; i++) {
    hist[Math.round((values[i] - min) * scale)]++;
  }

  const total = values.length;
  let sumAll = 0;
  for (let b = 0; b < bins; b++) sumAll += b * hist[b];

  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestBin = 0;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestBin = b;
    }
  }

  // Normalise between-class variance by total variance to get separability.
  const mean = sumAll / total;
  let variance = 0;
  for (let b = 0; b < bins; b++) variance += hist[b] * (b - mean) * (b - mean);
  const separability = variance > 0 ? best / (total * variance) : 0;

  return { threshold: min + bestBin / scale, separability: Math.min(1, separability) };
}

export function threshold(values: Float32Array, t: number, above = true): Mask {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = (above ? values[i] >= t : values[i] <= t) ? 1 : 0;
  }
  return out;
}

export function andMask(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && b[i] ? 1 : 0;
  return out;
}

export function andNotMask(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && !b[i] ? 1 : 0;
  return out;
}

export function orMask(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

export function countMask(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

// --- morphology -------------------------------------------------------------

function morph(mask: Mask, width: number, height: number, dilate: boolean, radius: number): Mask {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = dilate ? 0 : 1;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      outer: for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const v = mask[yy * width + xx];
          if (dilate && v) {
            hit = 1;
            break outer;
          }
          if (!dilate && !v) {
            hit = 0;
            break outer;
          }
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

export const dilate = (m: Mask, w: number, h: number, r = 1) => morph(m, w, h, true, r);
export const erode = (m: Mask, w: number, h: number, r = 1) => morph(m, w, h, false, r);

/** Opening removes speckle-sized false positives; closing fills pinholes. */
export function open(mask: Mask, width: number, height: number, radius = 1): Mask {
  return dilate(erode(mask, width, height, radius), width, height, radius);
}

export function close(mask: Mask, width: number, height: number, radius = 1): Mask {
  return erode(dilate(mask, width, height, radius), width, height, radius);
}

/** Opening then closing -- the standard cleanup before component labelling. */
export function cleanup(mask: Mask, width: number, height: number, radius = 1): Mask {
  return close(open(mask, width, height, radius), width, height, radius);
}

// --- components -------------------------------------------------------------

export interface Component {
  pixels: number;
  bbox: [number, number, number, number];
  centroid: [number, number];
  mask: Mask;
}

/** 8-connected component labelling, largest first, filtered by minimum area. */
export function connectedComponents(
  mask: Mask,
  width: number,
  height: number,
  minPixels = 60,
): Component[] {
  const seen = new Uint8Array(mask.length);
  const comps: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const members: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    while (stack.length) {
      const idx = stack.pop() as number;
      members.push(idx);
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (mask[nIdx] && !seen[nIdx]) {
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }

    if (members.length < minPixels) continue;
    const compMask = new Uint8Array(mask.length);
    for (const idx of members) compMask[idx] = 1;
    comps.push({
      pixels: members.length,
      bbox: [minX, minY, maxX + 1, maxY + 1],
      centroid: [sumX / members.length, sumY / members.length],
      mask: compMask,
    });
  }

  comps.sort((a, b) => b.pixels - a.pixels);
  return comps;
}

/**
 * Drop everything below the minimum mappable unit.
 *
 * A change map is not a per-pixel opinion. Scattered pixels that survive
 * thresholding are almost always classifier noise rather than land that
 * changed, and counting them inflates the reported area, fragments the result
 * into meaningless components, and dilutes any agreement statistic computed
 * against a second sensor. Quantifying only mapped units is standard practice
 * and it is what makes the reported percentage defensible.
 */
export function filterByMinArea(
  mask: Mask,
  width: number,
  height: number,
  minPixels: number,
): { mask: Mask; components: Component[] } {
  const components = connectedComponents(mask, width, height, minPixels);
  const out = new Uint8Array(mask.length);
  for (const component of components) {
    for (let i = 0; i < out.length; i++) {
      if (component.mask[i]) out[i] = 1;
    }
  }
  return { mask: out, components };
}

/** Turn labelled components into georeferenced regions the UI can draw. */
export function componentsToRegions(
  comps: Component[],
  scene: Scene,
  label: string,
  confidenceFor: (c: Component) => number,
  limit = 6,
): Region[] {
  return comps.slice(0, limit).map((c, i) => {
    const [cx, cy] = c.centroid;
    return {
      id: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i + 1}`,
      label,
      bbox: c.bbox,
      geoBbox: bboxToGeoBbox(scene.bounds, scene.width, scene.height, c.bbox),
      areaPx: c.pixels,
      areaKm2: pixelsToKm2(c.pixels, GSD_M),
      confidence: confidenceFor(c),
      centroid: pixelToGeo(scene.bounds, scene.width, scene.height, cx, cy),
    };
  });
}

/** Union bounding box across regions, padded, clamped to the raster. */
export function unionBbox(
  regions: Region[],
  width: number,
  height: number,
  padding = 24,
): [number, number, number, number] | null {
  if (!regions.length) return null;
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (const r of regions) {
    x0 = Math.min(x0, r.bbox[0]);
    y0 = Math.min(y0, r.bbox[1]);
    x1 = Math.max(x1, r.bbox[2]);
    y1 = Math.max(y1, r.bbox[3]);
  }
  return [
    Math.max(0, x0 - padding),
    Math.max(0, y0 - padding),
    Math.min(width, x1 + padding),
    Math.min(height, y1 + padding),
  ];
}

// --- agreement --------------------------------------------------------------

/** Intersection over union of two binary masks. */
export function iou(a: Mask, b: Mask): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union === 0 ? 0 : inter / union;
}

/** Fraction of mask `a` that falls inside mask `b`. Asymmetric on purpose. */
export function containment(a: Mask, b: Mask): number {
  let inter = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]) {
      total++;
      if (b[i]) inter++;
    }
  }
  return total === 0 ? 0 : inter / total;
}

/** Mean of a band restricted to a mask. */
export function maskedMean(band: Float32Array, mask: Mask): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < band.length; i++) {
    if (mask[i]) {
      sum += band[i];
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

export function maskedStd(band: Float32Array, mask: Mask): number {
  const mean = maskedMean(band, mask);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < band.length; i++) {
    if (mask[i]) {
      const d = band[i] - mean;
      sum += d * d;
      n++;
    }
  }
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

/**
 * Separability of two masked populations, as a normalised distance between
 * their means. Feeds confidence: distributions that barely differ should not
 * produce a confident claim.
 */
export function separability(band: Float32Array, a: Mask, b: Mask): number {
  const ma = maskedMean(band, a);
  const mb = maskedMean(band, b);
  const sa = maskedStd(band, a);
  const sb = maskedStd(band, b);
  const pooled = Math.sqrt((sa * sa + sb * sb) / 2);
  if (pooled === 0) return 0;
  return Math.abs(ma - mb) / pooled;
}

// --- encoding ---------------------------------------------------------------

/** Run-length encode a mask for transport. Alternating off/on runs, starts off. */
export function encodeRLE(mask: Mask, width: number, height: number): MaskRLE {
  const runs: number[] = [];
  let current = 0;
  let run = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === current) {
      run++;
    } else {
      runs.push(run);
      current = v;
      run = 1;
    }
  }
  runs.push(run);
  return { width, height, runs };
}

export function decodeRLE(rle: MaskRLE): Mask {
  const out = new Uint8Array(rle.width * rle.height);
  let idx = 0;
  let value = 0;
  for (const run of rle.runs) {
    if (value) out.fill(1, idx, idx + run);
    idx += run;
    value ^= 1;
  }
  return out;
}
