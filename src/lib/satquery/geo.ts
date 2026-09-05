import type { GeoBounds } from "./types";

const METERS_PER_DEG_LAT = 111_320;

export function boundsFromCenter(
  lat: number,
  lon: number,
  width: number,
  height: number,
  metersPerPixel: number,
): GeoBounds {
  const halfNS = (height * metersPerPixel) / 2 / METERS_PER_DEG_LAT;
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const halfEW = (width * metersPerPixel) / 2 / metersPerDegLon;
  return {
    west: lon - halfEW,
    south: lat - halfNS,
    east: lon + halfEW,
    north: lat + halfNS,
  };
}

/** Pixel (x from left, y from top) to [lon, lat]. */
export function pixelToGeo(
  bounds: GeoBounds,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number] {
  const lon = bounds.west + ((bounds.east - bounds.west) * x) / width;
  const lat = bounds.north - ((bounds.north - bounds.south) * y) / height;
  return [lon, lat];
}

export function bboxToGeoBbox(
  bounds: GeoBounds,
  width: number,
  height: number,
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [west, north] = pixelToGeo(bounds, width, height, bbox[0], bbox[1]);
  const [east, south] = pixelToGeo(bounds, width, height, bbox[2], bbox[3]);
  return [west, south, east, north];
}

/** Area of a pixel count in km², given ground sample distance in metres. */
export function pixelsToKm2(pixels: number, metersPerPixel: number): number {
  return (pixels * metersPerPixel * metersPerPixel) / 1_000_000;
}

/**
 * Where a point sits inside a scene, in words. The answer "in the north-east of
 * the scene" is what lets someone find a region by eye before the overlay
 * loads, so it is worth stating rather than leaving to coordinates.
 */
export function describeDirection(
  lon: number,
  lat: number,
  bounds: GeoBounds,
): string {
  const u = (lon - bounds.west) / (bounds.east - bounds.west);
  const v = (bounds.north - lat) / (bounds.north - bounds.south);
  const band = (t: number, low: string, high: string) =>
    t < 0.36 ? low : t > 0.64 ? high : "";
  const ns = band(v, "northern", "southern");
  const ew = band(u, "western", "eastern");
  if (!ns && !ew) return "centre of the scene";
  if (ns && ew) return `${ns.replace("ern", "")}-${ew} part of the scene`;
  return `${ns || ew} part of the scene`;
}

export function formatLatLon(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lon).toFixed(4)}°${ew}`;
}
