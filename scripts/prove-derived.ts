/**
 * Demonstrates that the headline figure is derived, not stored.
 *
 * Moves one decision threshold and shows every downstream quantity move with
 * it. A hardcoded answer cannot respond to a slider.
 */
import { runAnalysis } from "../src/lib/satquery/engine";
import { DEMO_SCENARIOS } from "../src/lib/satquery/scenarios";

async function main() {
  const scenario = DEMO_SCENARIOS.find((s) => s.id === "change")!;

  console.log("built-up brightness cut -> what the system reports\n");
  console.log("  cut     before     after    change   conf   agreement  headline");

  for (const cut of [undefined, 0.10, 0.12, 0.13, 0.15, 0.17]) {
    const r = await runAnalysis({
      query: scenario.query,
      images: scenario.images,
      options: cut === undefined ? undefined : { builtUpThreshold: cut },
    });
    const change = r.agents.find((a) => a.agent === "change");
    const get = (label: string) => change?.metrics.find((m) => m.label === label)?.value ?? "-";
    const iou = r.evidence.spatialAgreement?.iou;

    console.log(
      `  ${(cut === undefined ? "auto" : cut.toFixed(2)).padEnd(6)} ` +
        `${get("Built-up before").padStart(7)}  ${get("Built-up after").padStart(7)}  ` +
        `${get("Relative change").padStart(7)}  ${String(Math.round(r.confidence * 100)).padStart(3)}%  ` +
        `${(iou === undefined ? "-" : iou.toFixed(3)).padStart(8)}   ${r.headline.slice(0, 44)}`,
    );
  }
}
main();
