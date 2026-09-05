/**
 * Deterministic value noise.
 *
 * The whole prototype depends on scenes being byte-identical between the
 * server (which analyses them) and the browser (which draws them), so every
 * random quantity here comes from an integer hash of its coordinates -- never
 * from a stateful generator whose call order could drift.
 */

export function hash2(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinearly interpolated value noise in [0,1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * xf;
  const bot = c + (d - c) * xf;
  return top + (bot - top) * yf;
}

/** Fractal Brownian motion -- layered value noise, normalised to [0,1). */
export function fbm(
  x: number,
  y: number,
  seed: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Approximately standard-normal deviate from the hash, via Box-Muller. */
export function gauss(x: number, y: number, seed: number): number {
  const u1 = Math.max(1e-7, hash2(x, y, seed));
  const u2 = hash2(x, y, seed + 7919);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
