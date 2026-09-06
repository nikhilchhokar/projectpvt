/**
 * Overlay rasterisation, shared by the viewer and the report.
 *
 * Both need to turn a run-length encoded evidence mask into something that can
 * be composited over imagery. Keeping one implementation means the orange the
 * report prints is the same orange the map drew.
 */

import type { MaskRLE } from "./types";

/** Decode an RLE mask into a tinted, semi-transparent canvas ready to composite. */
export function buildOverlayCanvas(
  mask: MaskRLE | undefined,
  color: string,
  alpha = 150,
): HTMLCanvasElement | null {
  if (!mask) return null;
  const { width, height, runs } = mask;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  let index = 0;
  let value = 0;
  for (const run of runs) {
    if (value) {
      for (let i = index; i < index + run; i++) {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = alpha;
      }
    }
    index += run;
    value ^= 1;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
