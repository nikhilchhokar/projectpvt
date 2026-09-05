/**
 * Raster tile endpoint.
 *
 * Serves a rendered view of one scene. Layers are addressed by name rather than
 * by band maths in the client, which is the same shape a COG tile server would
 * expose -- the viewer does not know or care that these pixels are synthesised.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { renderLayerPNG, type RenderLayer } from "@/lib/satquery/render";
import { listSceneKeys } from "@/lib/satquery/scene";

const LAYERS: RenderLayer[] = ["optical", "sar", "difference", "ndvi"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const url = new URL(request.url);
  const layer = (url.searchParams.get("layer") ?? "optical") as RenderLayer;
  const against = url.searchParams.get("against") ?? undefined;

  if (!listSceneKeys().includes(key)) {
    return NextResponse.json({ error: `Unknown scene: ${key}` }, { status: 404 });
  }
  if (!LAYERS.includes(layer)) {
    return NextResponse.json({ error: `Unknown layer: ${layer}` }, { status: 400 });
  }
  if (layer === "difference" && (!against || !listSceneKeys().includes(against))) {
    return NextResponse.json(
      { error: "difference layer requires a valid ?against= scene" },
      { status: 400 },
    );
  }

  const png = renderLayerPNG(key, layer, against);

  /**
   * Strong ETag over the rendered bytes rather than `immutable`.
   *
   * A scene is deterministic for a given build, but not across builds: change
   * the generator or the tone curve and the same URL must return different
   * pixels. Marking these immutable for a year would leave every existing
   * browser showing imagery from an older version of the renderer -- with no
   * way to tell, since the analysis numbers would have moved on without it.
   */
  const etag = `"${createHash("sha1").update(png).digest("base64url")}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      ETag: etag,
      // Safe to cache hard: the URL carries a version stamp, so a new build
      // asks for a different URL rather than hoping for a revalidation.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
