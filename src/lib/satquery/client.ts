/**
 * Browser-side access to the analysis service.
 *
 * The only module in the client that knows a network exists. Every component
 * above it deals in the same types the engine produces, so pointing this at a
 * different backend is a one-file change.
 */

import type { AgentId, AnalysisRequest, AnalysisResult } from "./types";
import type { DemoScenario } from "./scenarios";
import type { RenderLayer } from "./render";

export interface Catalogue {
  scenarios: DemoScenario[];
  suggestions: { text: string; scenarioId: string }[];
  specialists: { id: AgentId; displayName: string; question: string }[];
  languageLayer: { name: string; kind: string };
  rasterVersion: string;
}

/**
 * Version stamp for raster URLs, supplied by the server with the catalogue.
 * Held in module scope so components can build URLs without threading it
 * through every prop chain.
 */
let rasterVersion = "0";

export function setRasterVersion(version: string): void {
  rasterVersion = version;
}

export async function analyze(request: AnalysisRequest): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `Analysis failed (${response.status})`);
  }
  return (await response.json()) as AnalysisResult;
}

export async function fetchCatalogue(): Promise<Catalogue> {
  const response = await fetch("/api/scenarios");
  if (!response.ok) throw new Error("Could not load the scenario catalogue");
  const catalogue = (await response.json()) as Catalogue;
  setRasterVersion(catalogue.rasterVersion);
  return catalogue;
}

/**
 * URL for a rendered raster layer.
 *
 * Version-stamped, so it is safe to cache hard and impossible to serve stale.
 * Pass `version` explicitly when building URLs on the server, where the module
 * value has not been set by a catalogue fetch.
 */
export function rasterUrl(
  sceneKey: string,
  layer: RenderLayer,
  against?: string,
  version?: string,
): string {
  const params = new URLSearchParams({ layer, v: version ?? rasterVersion });
  if (against) params.set("against", against);
  return `/api/raster/${encodeURIComponent(sceneKey)}?${params.toString()}`;
}
