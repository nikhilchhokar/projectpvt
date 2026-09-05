/**
 * Values shared by the analysis layer and the browser.
 *
 * Kept apart from scene.ts so the client can know the raster geometry without
 * pulling the procedural generator into its bundle.
 */

/** Raster width and height in pixels. */
export const SCENE_SIZE = 512;

/** Ground sample distance in metres -- Sentinel-2 like. */
export const GSD_M = 10;
