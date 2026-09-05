/**
 * Diagnostic harness for the raster + classification layer.
 *
 * Run with: npm run diagnose
 * Prints the quantities the specialists will report, so scene parameters can be
 * tuned against measured output rather than guessed.
 */

import { classify, harmonizeThresholds } from "../src/lib/satquery/landcover";
import { andNotMask, cleanup, connectedComponents, countMask, iou, maskedMean, separability, speckleFilterDb } from "../src/lib/satquery/raster";
import { generateScene, listSceneKeys, SCENE_SIZE } from "../src/lib/satquery/scene";

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

for (const key of listSceneKeys()) {
  const scene = generateScene(key);
  const lc = classify(scene);
  console.log(`\n=== ${key} (${scene.modality}, ${scene.acquired}) ===`);
  line("water", pct(lc.fractions.water));
  line("vegetation", pct(lc.fractions.vegetation));
  line("built-up", pct(lc.fractions.builtUp));
  line("bare", pct(lc.fractions.bare));
  line("other", pct(lc.fractions.other));
  line("thresholds ndwi/ndvi/bri/tex", `${lc.thresholds.water.toFixed(3)} / ${lc.thresholds.vegetation.toFixed(3)} / ${lc.thresholds.brightness.toFixed(3)} / ${lc.thresholds.texture.toFixed(4)}`);
  line("margins water/veg/built", `${lc.margins.water.toFixed(2)} / ${lc.margins.vegetation.toFixed(2)} / ${lc.margins.builtUp.toFixed(2)}`);
  line("SAR mean (dB)", maskedMean(scene.sar, new Uint8Array(scene.sar.length).fill(1)).toFixed(2));
  line("SAR built vs rest sep", separability(scene.sar, lc.builtUp, andNotMask(new Uint8Array(lc.builtUp.length).fill(1), lc.builtUp)).toFixed(2));
}

// --- bi-temporal pairs ------------------------------------------------------

function changeReport(aKey: string, bKey: string, sarAKey?: string, sarBKey?: string) {
  const a = generateScene(aKey);
  const b = generateScene(bKey);
  const harmonised = harmonizeThresholds(classify(a), classify(b));
  const la = classify(a, { thresholds: harmonised });
  const lb = classify(b, { thresholds: harmonised });
  const beforeCount = countMask(la.builtUp);
  const afterCount = countMask(lb.builtUp);
  const relative = beforeCount ? (afterCount - beforeCount) / beforeCount : 0;
  const gained = cleanup(andNotMask(lb.builtUp, la.builtUp), a.width, a.height, 1);
  const lost = cleanup(andNotMask(la.builtUp, lb.builtUp), a.width, a.height, 1);
  const comps = connectedComponents(gained, a.width, a.height, 80);

  console.log(`\n### CHANGE ${aKey} -> ${bKey}`);
  line("built-up before", `${pct(beforeCount / (SCENE_SIZE * SCENE_SIZE))} (${beforeCount}px)`);
  line("built-up after", `${pct(afterCount / (SCENE_SIZE * SCENE_SIZE))} (${afterCount}px)`);
  line("relative change", `${relative >= 0 ? "+" : ""}${(relative * 100).toFixed(1)}%`);
  line("gained px (cleaned)", String(countMask(gained)));
  line("lost px (cleaned)", String(countMask(lost)));
  line("gained components", String(comps.length));
  line("veg fraction shift", `${pct(la.fractions.vegetation)} -> ${pct(lb.fractions.vegetation)}`);

  if (sarAKey && sarBKey) {
    const sa = generateScene(sarAKey);
    const sb = generateScene(sarBKey);
    const fa = speckleFilterDb(sa.sar, sa.width, sa.height, 2);
    const fb = speckleFilterDb(sb.sar, sb.width, sb.height, 2);
    const delta = new Float32Array(fa.length);
    for (let i = 0; i < delta.length; i++) delta[i] = fb[i] - fa[i];
    const rise = cleanup(
      (() => {
        const m = new Uint8Array(delta.length);
        for (let i = 0; i < delta.length; i++) m[i] = delta[i] > 3 ? 1 : 0;
        return m;
      })(),
      sa.width,
      sa.height,
      1,
    );
    line("SAR rise px (>3dB)", String(countMask(rise)));
    line("SAR/optical IoU", iou(rise, gained).toFixed(3));
    line("mean dB in gained", `${maskedMean(fa, gained).toFixed(2)} -> ${maskedMean(fb, gained).toFixed(2)}`);
    line("SAR rise sep vs rest", separability(delta, rise, andNotMask(new Uint8Array(delta.length).fill(1), rise)).toFixed(2));
  }
}

changeReport("valley-optical-t1", "valley-optical-t2", "valley-sar-t1", "valley-sar-t2");
changeReport("coast-optical-t1", "coast-optical-t2", "coast-sar-t1", "coast-sar-t2");
