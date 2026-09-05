/**
 * Live end-to-end smoke test against a running server.
 * Run with: npm run smoke  (server must be up on :3000)
 */
import { DEMO_SCENARIOS } from "../src/lib/satquery/scenarios";
import type { AnalysisResult } from "../src/lib/satquery/types";

const BASE = process.env.SATQUERY_BASE ?? "http://localhost:3000";

async function main() {
  let failures = 0;
  for (const scenario of DEMO_SCENARIOS) {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: scenario.query, images: scenario.images }),
    });
    if (!res.ok) {
      console.log(`${scenario.index} FAILED http ${res.status}`);
      failures++;
      continue;
    }
    const r = (await res.json()) as AnalysisResult;
    const overlaysOn = r.visualization.overlays.filter((o) => o.defaultVisible).length;
    console.log(
      `${scenario.index} ${String(Math.round(r.confidence * 100)).padStart(3)}% ` +
        `${r.evidence.status.padEnd(12)} showme=${r.visualization.primaryOverlayIds.join(",") || "-"} ` +
        `onByDefault=${overlaysOn}  ${r.headline}`,
    );
    if (!r.headline || !r.trace.length) failures++;
  }

  // The raster service must answer for every layer the viewer can request.
  const layers: [string, string, string?][] = [
    ["valley-optical-t2", "optical"],
    ["valley-sar-t2", "sar"],
    ["valley-optical-t2", "difference", "valley-optical-t1"],
  ];
  for (const [key, layer, against] of layers) {
    const url = `${BASE}/api/raster/${key}?layer=${layer}${against ? `&against=${against}` : ""}`;
    const res = await fetch(url);
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
    console.log(`raster ${layer.padEnd(11)} ${res.status} ${(bytes / 1024).toFixed(0)} KB etag=${res.headers.get("etag")?.slice(0, 10)}`);
    if (!res.ok) failures++;
  }

  console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main();
