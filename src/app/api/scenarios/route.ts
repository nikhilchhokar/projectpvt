/**
 * Catalogue endpoint.
 *
 * The interface asks the backend what exists rather than hardcoding it, so
 * registering a new specialist or scenario shows up in the UI without a
 * frontend change.
 */

import { NextResponse } from "next/server";
import { languageProvider } from "@/lib/satquery/llm";
import { specialistCatalogue } from "@/lib/satquery/registry";
import { DEMO_SCENARIOS, SUGGESTED_PROMPTS } from "@/lib/satquery/scenarios";
import { RASTER_VERSION } from "@/lib/satquery/version";
import { warmScenes } from "@/lib/satquery/warmup";

warmScenes();

export async function GET() {
  const provider = await languageProvider();
  return NextResponse.json({
    scenarios: DEMO_SCENARIOS,
    suggestions: SUGGESTED_PROMPTS,
    specialists: specialistCatalogue(),
    languageLayer: { name: provider.name, kind: provider.kind },
    rasterVersion: RASTER_VERSION,
  });
}
