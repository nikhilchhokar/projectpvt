import { writeFileSync } from "node:fs";
import { renderLayerPNG } from "../src/lib/satquery/render";

const jobs: [string, string, string | undefined, string][] = [
  ["valley-optical-t1", "optical", undefined, "preview-valley-before.png"],
  ["valley-optical-t2", "optical", undefined, "preview-valley-after.png"],
  ["valley-sar-t2", "sar", undefined, "preview-valley-sar.png"],
  ["delta-optical", "optical", undefined, "preview-delta.png"],
  ["valley-optical-t2", "difference", "valley-optical-t1", "preview-valley-diff.png"],
];
for (const [key, layer, against, out] of jobs) {
  writeFileSync(out, renderLayerPNG(key, layer as never, against));
  console.log("wrote", out);
}
