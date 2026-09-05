/**
 * Analysis endpoint.
 *
 * A real network boundary between the interface and the reasoning system, not
 * a convenience. The browser sends a question and a list of inputs; everything
 * else -- interpretation, routing, the specialists, the evidence engine --
 * happens behind this line. Moving that work to a Python service later is a
 * change of base URL, because the contract is already the wire format.
 */

import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/satquery/engine";
import type { AnalysisRequest } from "@/lib/satquery/types";
import { warmScenes } from "@/lib/satquery/warmup";

warmScenes();

export async function POST(request: Request) {
  let body: AnalysisRequest;
  try {
    body = (await request.json()) as AnalysisRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  if (typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json({ error: "A query is required" }, { status: 400 });
  }
  if (!Array.isArray(body.images)) {
    return NextResponse.json({ error: "images must be an array" }, { status: 400 });
  }

  try {
    const result = await runAnalysis({
      query: body.query.trim(),
      images: body.images,
      options: body.options,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[satquery] analysis failed", error);
    return NextResponse.json(
      {
        error: "Analysis failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
