import { runAnalysis } from "../src/lib/satquery/engine";
import { DEMO_SCENARIOS } from "../src/lib/satquery/scenarios";
import { renderLayerPNG } from "../src/lib/satquery/render";

async function main() {
  for (const s of DEMO_SCENARIOS) {
    const r = await runAnalysis({ query: s.query, images: s.images });
    const json = JSON.stringify(r);
    const maskBytes = r.visualization.overlays.reduce(
      (sum, o) => sum + JSON.stringify(o.mask ?? {}).length, 0);
    console.log(`${s.index} ${s.title.padEnd(28)} total ${(json.length/1024).toFixed(0).padStart(5)} KB   masks ${(maskBytes/1024).toFixed(0).padStart(5)} KB   overlays ${r.visualization.overlays.length}`);
  }
  const png = renderLayerPNG("valley-optical-t2", "optical");
  const sar = renderLayerPNG("valley-sar-t2", "sar");
  const diff = renderLayerPNG("valley-optical-t2", "difference", "valley-optical-t1");
  console.log(`\nPNG optical ${(png.length/1024).toFixed(0)} KB · sar ${(sar.length/1024).toFixed(0)} KB · difference ${(diff.length/1024).toFixed(0)} KB`);
}
main();
