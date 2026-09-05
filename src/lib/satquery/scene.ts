/**
 * Procedural scene layer.
 *
 * The prototype ships no real satellite tiles, so scenes are synthesised from a
 * seeded landscape description. This is deliberate rather than a shortcut: the
 * generator produces physically plausible band values, which means the
 * specialist agents downstream run *real* algorithms (spectral indices,
 * thresholding, connected components, backscatter statistics) against them
 * instead of returning canned answers. Replacing this module with a GeoTIFF
 * reader is the only change needed to point the same agents at real imagery.
 */

import { GSD_M, SCENE_SIZE } from "./constants";
import { boundsFromCenter } from "./geo";
import { fbm, gauss, hash2, valueNoise } from "./noise";
import type { GeoBounds, Modality } from "./types";

export { GSD_M, SCENE_SIZE } from "./constants";

export const WATER = 0;
export const CROPLAND = 1;
export const FALLOW = 2;
export const BUILT = 3;
export const TREES = 4;
export const ROAD = 5;

export const CLASS_NAMES = [
  "Water",
  "Cropland",
  "Bare / fallow",
  "Built-up",
  "Tree cover",
  "Road",
] as const;

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}

interface Cluster {
  cx: number;
  cy: number;
  r: number;
  density: number;
  seed: number;
}

interface Polyline {
  points: [number, number][];
  width: number;
}

interface Landscape {
  seed: number;
  lakes: Ellipse[];
  rivers: Polyline[];
  built: Cluster[];
  trees: Ellipse[];
  roads: Polyline[];
  /** Seasonal crop vigour multiplier. Varies between epochs -- a real confounder. */
  vigor: number;
  soilBias: number;
  parcelSize: number;
  parcelRot: number;
}

export interface SceneSpec {
  key: string;
  landscape: Landscape;
  modality: Modality;
  acquired: string;
  speckleSeed: number;
  centerLat: number;
  centerLon: number;
}

export interface Scene {
  key: string;
  width: number;
  height: number;
  modality: Modality;
  acquired: string;
  bounds: GeoBounds;
  classes: Uint8Array;
  red: Float32Array;
  green: Float32Array;
  blue: Float32Array;
  nir: Float32Array;
  /** VV backscatter in dB. */
  sar: Float32Array;
}

// --- landscapes -------------------------------------------------------------

const VALLEY_BASE_BUILT: Cluster[] = [
  { cx: 0.24, cy: 0.7, r: 0.184, density: 0.72, seed: 41 },
  { cx: 0.62, cy: 0.28, r: 0.135, density: 0.66, seed: 57 },
  { cx: 0.78, cy: 0.63, r: 0.111, density: 0.6, seed: 73 },
];

const VALLEY_WATER: Ellipse[] = [
  { cx: 0.42, cy: 0.82, rx: 0.13, ry: 0.075, rot: 0.35 },
];

const VALLEY_RIVERS: Polyline[] = [
  {
    points: [
      [0.02, 0.46],
      [0.22, 0.52],
      [0.4, 0.62],
      [0.52, 0.76],
      [0.62, 0.95],
    ],
    width: 0.018,
  },
];

const VALLEY_ROADS: Polyline[] = [
  { points: [[0.24, 0.7], [0.45, 0.5], [0.62, 0.28]], width: 0.006 },
  { points: [[0.62, 0.28], [0.72, 0.45], [0.78, 0.63]], width: 0.005 },
  { points: [[0.05, 0.18], [0.5, 0.22], [0.97, 0.15]], width: 0.005 },
];

const VALLEY_TREES: Ellipse[] = [
  { cx: 0.12, cy: 0.34, rx: 0.1, ry: 0.075, rot: 0.2 },
  { cx: 0.88, cy: 0.85, rx: 0.09, ry: 0.07, rot: -0.4 },
];

/** Epoch 1: three settlements around a reservoir. */
const VALLEY_T1: Landscape = {
  seed: 1201,
  lakes: VALLEY_WATER,
  rivers: VALLEY_RIVERS,
  built: VALLEY_BASE_BUILT,
  trees: VALLEY_TREES,
  roads: VALLEY_ROADS,
  vigor: 0.98,
  soilBias: 0,
  parcelSize: 34,
  parcelRot: 0.22,
};

/**
 * Epoch 2: the same landscape, with an industrial/residential belt grown along
 * the northern corridor, plus a seasonal dip in crop vigour. The vigour change
 * is the confounder that makes cross-modal evidence checking worth doing --
 * optical alone could mistake senescent cropland for surface change.
 */
const VALLEY_T2: Landscape = {
  ...VALLEY_T1,
  built: [
    ...VALLEY_BASE_BUILT,
    { cx: 0.41, cy: 0.37, r: 0.0562, density: 0.9, seed: 91 },
    { cx: 0.52, cy: 0.47, r: 0.0416, density: 0.86, seed: 113 },
  ],
  vigor: 0.83,
  soilBias: 0.015,
};

/** A delta scene dominated by water -- used for VQA and grounding demos. */
const DELTA: Landscape = {
  seed: 3307,
  lakes: [
    { cx: 0.7, cy: 0.66, rx: 0.155, ry: 0.105, rot: -0.25 },
    { cx: 0.2, cy: 0.24, rx: 0.06, ry: 0.045, rot: 0.6 },
  ],
  rivers: [
    {
      points: [
        [0.05, 0.12],
        [0.24, 0.3],
        [0.36, 0.48],
        [0.55, 0.6],
        [0.7, 0.66],
      ],
      width: 0.022,
    },
    {
      points: [
        [0.7, 0.66],
        [0.82, 0.78],
        [0.95, 0.96],
      ],
      width: 0.026,
    },
  ],
  built: [{ cx: 0.32, cy: 0.78, r: 0.085, density: 0.6, seed: 211 }],
  trees: [{ cx: 0.85, cy: 0.22, rx: 0.12, ry: 0.09, rot: 0.1 }],
  roads: [{ points: [[0.32, 0.78], [0.6, 0.86], [0.98, 0.82]], width: 0.006 }],
  vigor: 1.05,
  soilBias: -0.01,
  parcelSize: 28,
  parcelRot: -0.35,
};

/**
 * A coastal pair where almost nothing structural changes but the crop calendar
 * shifts hard. This is the honest "low confidence" case: optical sees a large
 * spectral delta, SAR sees no structural response, and the evidence engine
 * correctly refuses to call it built-up growth.
 */
const COAST_T1: Landscape = {
  seed: 5501,
  lakes: [{ cx: 0.5, cy: 0.88, rx: 0.42, ry: 0.16, rot: 0 }],
  rivers: [],
  built: [
    { cx: 0.28, cy: 0.5, r: 0.115, density: 0.63, seed: 307 },
    { cx: 0.68, cy: 0.42, r: 0.095, density: 0.58, seed: 331 },
  ],
  trees: [{ cx: 0.12, cy: 0.14, rx: 0.11, ry: 0.08, rot: 0 }],
  roads: [{ points: [[0.28, 0.5], [0.48, 0.46], [0.68, 0.42]], width: 0.005 }],
  vigor: 1.12,
  soilBias: -0.02,
  parcelSize: 30,
  parcelRot: 0.05,
};

const COAST_T2: Landscape = {
  ...COAST_T1,
  built: [
    ...COAST_T1.built,
    { cx: 0.6, cy: 0.62, r: 0.022, density: 0.5, seed: 349 },
  ],
  vigor: 0.58,
  soilBias: 0.034,
};

const SPECS: SceneSpec[] = [
  { key: "delta-optical", landscape: DELTA, modality: "optical", acquired: "2024-11-08", speckleSeed: 11, centerLat: 21.9021, centerLon: 88.1042 },
  { key: "delta-sar", landscape: DELTA, modality: "sar", acquired: "2024-11-09", speckleSeed: 12, centerLat: 21.9021, centerLon: 88.1042 },
  { key: "valley-optical-t1", landscape: VALLEY_T1, modality: "optical", acquired: "2021-03-12", speckleSeed: 21, centerLat: 21.1244, centerLon: 79.0512 },
  { key: "valley-optical-t2", landscape: VALLEY_T2, modality: "optical", acquired: "2025-02-20", speckleSeed: 22, centerLat: 21.1244, centerLon: 79.0512 },
  { key: "valley-sar-t1", landscape: VALLEY_T1, modality: "sar", acquired: "2021-03-14", speckleSeed: 23, centerLat: 21.1244, centerLon: 79.0512 },
  { key: "valley-sar-t2", landscape: VALLEY_T2, modality: "sar", acquired: "2025-02-22", speckleSeed: 24, centerLat: 21.1244, centerLon: 79.0512 },
  { key: "coast-optical-t1", landscape: COAST_T1, modality: "optical", acquired: "2023-01-18", speckleSeed: 31, centerLat: 15.4921, centerLon: 73.8188 },
  { key: "coast-optical-t2", landscape: COAST_T2, modality: "optical", acquired: "2025-06-04", speckleSeed: 32, centerLat: 15.4921, centerLon: 73.8188 },
  { key: "coast-sar-t1", landscape: COAST_T1, modality: "sar", acquired: "2023-01-20", speckleSeed: 34, centerLat: 15.4921, centerLon: 73.8188 },
  { key: "coast-sar-t2", landscape: COAST_T2, modality: "sar", acquired: "2025-06-06", speckleSeed: 33, centerLat: 15.4921, centerLon: 73.8188 },
];

const SPEC_BY_KEY = new Map(SPECS.map((s) => [s.key, s]));

export function getSceneSpec(key: string): SceneSpec {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown scene key: ${key}`);
  return spec;
}

export function listSceneKeys(): string[] {
  return SPECS.map((s) => s.key);
}

export interface SceneMetadata {
  key: string;
  width: number;
  height: number;
  modality: Modality;
  acquired: string;
  bounds: GeoBounds;
  /** UTM zone appropriate to the scene centre. */
  crs: string;
}

/**
 * Scene facts without generating any pixels. The upload panel and the
 * validator both need metadata long before anyone needs imagery, and
 * synthesising half a million samples to read a date would be absurd.
 */
export function sceneMetadata(key: string): SceneMetadata {
  const spec = getSceneSpec(key);
  const zone = Math.floor((spec.centerLon + 180) / 6) + 1;
  const epsg = spec.centerLat >= 0 ? 32600 + zone : 32700 + zone;
  return {
    key: spec.key,
    width: SCENE_SIZE,
    height: SCENE_SIZE,
    modality: spec.modality,
    acquired: spec.acquired,
    bounds: boundsFromCenter(spec.centerLat, spec.centerLon, SCENE_SIZE, SCENE_SIZE, GSD_M),
    crs: `EPSG:${epsg}`,
  };
}

// --- geometry helpers -------------------------------------------------------

function distToPolyline(px: number, py: number, line: Polyline): number {
  let best = Infinity;
  for (let i = 0; i < line.points.length - 1; i++) {
    const [x1, y1] = line.points[i];
    const [x2, y2] = line.points[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

function ellipseDist(px: number, py: number, e: Ellipse): number {
  const dx = px - e.cx;
  const dy = py - e.cy;
  const c = Math.cos(e.rot);
  const s = Math.sin(e.rot);
  const u = (dx * c + dy * s) / e.rx;
  const v = (-dx * s + dy * c) / e.ry;
  return Math.hypot(u, v);
}

/**
 * Separable 3-tap [1 2 1] blur, in place. Approximates a sensor point spread
 * function narrow enough to preserve building-block texture while removing the
 * unnaturally hard class boundaries a per-pixel classifier would otherwise paint.
 */
function blur3(band: Float32Array, width: number, height: number): void {
  const tmp = new Float32Array(band.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = band[row + (x > 0 ? x - 1 : 0)];
      const mid = band[row + x];
      const right = band[row + (x < width - 1 ? x + 1 : width - 1)];
      tmp[row + x] = (left + 2 * mid + right) / 4;
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const up = tmp[(y > 0 ? y - 1 : 0) * width + x];
      const mid = tmp[y * width + x];
      const down = tmp[(y < height - 1 ? y + 1 : height - 1) * width + x];
      band[y * width + x] = (up + 2 * mid + down) / 4;
    }
  }
}

// --- generation -------------------------------------------------------------

const CACHE = new Map<string, Scene>();

export function generateScene(key: string): Scene {
  const cached = CACHE.get(key);
  if (cached) return cached;
  const scene = buildScene(getSceneSpec(key));
  CACHE.set(key, scene);
  return scene;
}

function buildScene(spec: SceneSpec): Scene {
  const size = SCENE_SIZE;
  const n = size * size;
  const L = spec.landscape;
  const classes = new Uint8Array(n);
  const red = new Float32Array(n);
  const green = new Float32Array(n);
  const blue = new Float32Array(n);
  const nir = new Float32Array(n);
  const sar = new Float32Array(n);

  const pc = Math.cos(L.parcelRot);
  const ps = Math.sin(L.parcelRot);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const v = y / size;

      // Warp sampling coordinates so every boundary in the scene is organic.
      const warp = 0.012;
      const wu = u + warp * (fbm(x * 0.012, y * 0.012, L.seed + 5) - 0.5);
      const wv = v + warp * (fbm(x * 0.012, y * 0.012, L.seed + 9) - 0.5);

      let cls = -1;

      // Water: lakes and river channels, with noisy shorelines.
      const shore = 0.22 * (fbm(x * 0.02, y * 0.02, L.seed + 13) - 0.5);
      for (const lake of L.lakes) {
        if (ellipseDist(wu, wv, lake) * (1 + shore) < 1) {
          cls = WATER;
          break;
        }
      }
      if (cls < 0) {
        for (const river of L.rivers) {
          const d = distToPolyline(wu, wv, river);
          if (d * (1 + shore * 1.4) < river.width) {
            cls = WATER;
            break;
          }
        }
      }

      // Built-up: cluster envelope modulated by block-scale urban texture.
      if (cls < 0) {
        for (const c of L.built) {
          /**
           * Settlements are not discs.
           *
           * The radius is modulated as a function of *bearing* from the centre,
           * which pulls the outline into lobes -- the shape a town takes as it
           * grows along roads and terrain. Modulating by position instead only
           * rescales the disc, because noise sampled over a span much smaller
           * than its own wavelength is very nearly constant.
           */
          const ex = wu - c.cx;
          const ey = wv - c.cy;
          const bearing = Math.atan2(ey, ex);
          const lobe =
            0.46 * (fbm(2.6 * Math.cos(bearing) + 8, 2.6 * Math.sin(bearing) + 8, c.seed + 3) - 0.5) * 2;
          const fringe = 0.18 * (fbm(x * 0.05, y * 0.05, c.seed) - 0.5) * 2;
          const d = Math.hypot(ex, ey) / (c.r * Math.max(0.35, 1 + lobe + fringe));
          if (d < 1) {
            const block = hash2(Math.floor(x / 3), Math.floor(y / 3), c.seed + 1);
            const threshold = (1 - c.density) + 0.62 * Math.pow(d, 1.6);
            if (block > threshold) {
              cls = BUILT;
            } else if (hash2(Math.floor(x / 2), Math.floor(y / 2), c.seed + 2) > 0.88) {
              cls = ROAD;
            } else {
              cls = FALLOW;
            }
            break;
          }
        }
      }

      // Tree cover: patchy interior so canopies do not read as solid blocks.
      if (cls < 0) {
        for (const t of L.trees) {
          const d =
            ellipseDist(wu, wv, t) *
            (1 +
              0.85 * (fbm(x * 0.004, y * 0.004, L.seed + 71) - 0.5) +
              0.3 * (fbm(x * 0.026, y * 0.026, L.seed + 17) - 0.5));
          if (d < 1 && fbm(x * 0.075, y * 0.075, L.seed + 19) > 0.3 + 0.4 * d) {
            cls = TREES;
            break;
          }
        }
      }

      if (cls < 0) {
        for (const r of L.roads) {
          if (distToPolyline(wu, wv, r) < r.width) {
            cls = ROAD;
            break;
          }
        }
      }

      // Everything else is farmland, parcelled on a rotated jittered grid.
      let parcelVigor = 0;
      if (cls < 0) {
        const rx = u * pc + v * ps;
        const ry = -u * ps + v * pc;
        const jitter = 0.02 * (valueNoise(x * 0.03, y * 0.03, L.seed + 23) - 0.5);
        /**
         * Field size varies by district. A single parcel size across the whole
         * scene produces a uniform checkerboard, which no real agricultural
         * landscape has -- holdings differ between owners, terrain and crop.
         */
        const district = hash2(Math.floor(rx * 3.5), Math.floor(ry * 3.5), L.seed + 83);
        const parcel = L.parcelSize * (district < 0.34 ? 0.6 : district < 0.72 ? 1 : 1.55);
        const px = Math.floor(((rx + jitter) * size) / parcel);
        const py = Math.floor(((ry + jitter) * size) / parcel);
        parcelVigor = hash2(px, py, L.seed + 29);
        cls = parcelVigor < 0.26 ? FALLOW : CROPLAND;
      }

      classes[i] = cls;

      // --- reflectance ----------------------------------------------------
      const grain = 0.5 + 0.5 * fbm(x * 0.07, y * 0.07, L.seed + 31);
      /**
       * Variation within a class, at two spatial scales. Real fields are not
       * flat: soil moisture, drainage and sowing density vary across and within
       * a parcel, and without that the scene renders as blocks of solid colour.
       */
      const ground =
        0.80 +
        0.26 * fbm(x * 0.014, y * 0.014, L.seed + 61) +
        0.14 * fbm(x * 0.055, y * 0.055, L.seed + 67);

      let r = 0;
      let g = 0;
      let b = 0;
      let ir = 0;

      switch (cls) {
        case WATER: {
          const depth = 0.55 + 0.45 * grain;
          r = 0.017 * depth;
          g = 0.031 * depth;
          b = 0.044 * depth;
          ir = 0.009 * depth;
          break;
        }
        case CROPLAND: {
          const vig = Math.min(1.15, (0.55 + 0.6 * parcelVigor) * L.vigor);
          r = (0.050 - 0.017 * vig) * ground;
          g = (0.079 - 0.011 * vig) * ground;
          b = (0.038 - 0.008 * vig) * ground;
          ir = (0.14 + 0.30 * vig) * ground;
          break;
        }
        case FALLOW: {
          const dry = (0.85 + 0.3 * grain + L.soilBias * 4) * ground;
          r = 0.166 * dry;
          g = 0.150 * dry;
          b = 0.121 * dry;
          ir = 0.226 * dry;
          break;
        }
        case BUILT: {
          /**
           * Urban fabric is a mixture, not a surface. At 10 m every pixel is
           * some blend of roof, road and gap, so the class is modelled as three
           * materials drawn per building-block. This is what gives built-up its
           * high local variance -- the property the classifier keys on -- and
           * it is why settlements read as textured grey rather than as the
           * solid white a single bright albedo would produce.
           */
          const material = hash2(Math.floor(x / 2), Math.floor(y / 2), L.seed + 37);
          const tone = 0.88 + 0.24 * hash2(Math.floor(x / 2), Math.floor(y / 2), L.seed + 39);
          if (material > 0.68) {
            r = 0.232 * tone;
            g = 0.230 * tone;
            b = 0.228 * tone;
            ir = 0.262 * tone;
          } else if (material > 0.30) {
            r = 0.150 * tone;
            g = 0.150 * tone;
            b = 0.154 * tone;
            ir = 0.172 * tone;
          } else {
            r = 0.070 * tone;
            g = 0.072 * tone;
            b = 0.080 * tone;
            ir = 0.082 * tone;
          }
          break;
        }
        case TREES: {
          const canopy = 0.82 + 0.34 * fbm(x * 0.11, y * 0.11, L.seed + 73);
          r = 0.025 * canopy;
          g = 0.043 * canopy;
          b = 0.025 * canopy;
          ir = (0.27 + 0.07 * grain) * canopy;
          break;
        }
        default: {
          const wear = 0.85 + 0.3 * grain;
          r = 0.103 * wear;
          g = 0.104 * wear;
          b = 0.110 * wear;
          ir = 0.118 * wear;
        }
      }

      red[i] = r;
      green[i] = g;
      blue[i] = b;
      nir[i] = ir;

      // --- SAR backscatter -------------------------------------------------
      let db: number;
      switch (cls) {
        case WATER:
          db = -22.5; // specular, almost no return
          break;
        case CROPLAND:
          db = -11.2 - 2.4 * (1 - L.vigor); // volume scattering
          break;
        case FALLOW:
          db = -14.0; // rough bare surface
          break;
        case BUILT:
          db = -5.2; // double-bounce off structures
          break;
        case TREES:
          db = -8.6;
          break;
        default:
          db = -17.5; // smooth paved surface
      }
      // Clean backscatter. Speckle is multiplicative and belongs after the
      // sensor response, so it is applied in the post-processing pass.
      sar[i] = db;
    }
  }

  /**
   * Sensor response.
   *
   * A real instrument does not sample the ground with infinitely sharp pixels:
   * its point spread function mixes light from neighbouring ground, which is
   * why every edge in a satellite image is a gradient a pixel or two wide.
   * Without this step the scene renders with vector-crisp boundaries and reads
   * as an illustration rather than as imagery.
   */
  blur3(red, size, size);
  blur3(green, size, size);
  blur3(blue, size, size);
  blur3(nir, size, size);
  blur3(sar, size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const L2 = spec.landscape;

      /**
       * Atmospheric path radiance, then sensor noise.
       *
       * Rayleigh scattering falls off steeply with wavelength, so the blue band
       * picks up far more additive haze than the red and the NIR almost none.
       * This is why real optical imagery is so much less saturated than surface
       * reflectance alone suggests. Noise is added after the blur because the
       * detector adds it after the optics, not before.
       */
      const haze = 0.5 + fbm(x * 0.004, y * 0.004, L2.seed + 41);
      const jit = (n: number) => 0.0032 * gauss(x, y, L2.seed + n);
      red[i] = Math.max(0, red[i] + 0.0135 * haze + jit(43));
      green[i] = Math.max(0, green[i] + 0.0195 * haze + jit(47));
      blue[i] = Math.max(0, blue[i] + 0.0305 * haze + jit(53));
      nir[i] = Math.max(0, nir[i] + 0.004 * haze + jit(59));

      // Multiplicative speckle, applied in linear power then returned to dB.
      const lin = Math.pow(10, sar[i] / 10);
      const speckle = Math.max(0.06, 1 + 0.42 * gauss(x, y, spec.speckleSeed * 977 + 3));
      sar[i] = 10 * Math.log10(lin * speckle);
    }
  }

  const bounds = boundsFromCenter(spec.centerLat, spec.centerLon, size, size, GSD_M);

  return {
    key: spec.key,
    width: size,
    height: size,
    modality: spec.modality,
    acquired: spec.acquired,
    bounds,
    classes,
    red,
    green,
    blue,
    nir,
    sar,
  };
}
