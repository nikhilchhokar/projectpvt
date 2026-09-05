/**
 * End-to-end scenario harness.
 *
 * Runs every demo scenario through the real engine and prints what a judge
 * would see. Run with: npm run scenarios
 */

import { runAnalysis } from "../src/lib/satquery/engine";
import { DEMO_SCENARIOS } from "../src/lib/satquery/scenarios";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const STATUS_MARK = { consistent: "[OK]", partial: "[~]", insufficient: "[!]" } as const;

async function main() {
 for (const scenario of DEMO_SCENARIOS) {
  const result = await runAnalysis({
    query: scenario.query,
    images: scenario.images,
    options: scenario.expertMode ? { confidenceThreshold: 0.7 } : undefined,
  });

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${scenario.index}  ${scenario.title}`);
  console.log(`Q: "${scenario.query}"`);
  console.log(`${"-".repeat(72)}`);
  console.log(`intent      ${result.interpretation.intent} (${pct(result.interpretation.confidence)})`);
  console.log(`signals     ${result.interpretation.signals.join(", ") || "-"}`);
  console.log(`plan        ${result.plan.tools.join(" -> ")}`);
  console.log(`provider    ${result.languageProvider}`);
  console.log("");
  console.log(`${result.icon}  ${result.headline}`);
  console.log(`    ${result.summary}`);
  console.log(`    confidence ${pct(result.confidence)}  ${STATUS_MARK[result.evidence.status]} ${result.evidence.status}`);
  if (result.failure) console.log(`    FAILURE: ${result.failure.code} - ${result.failure.title}`);
  console.log("");

  console.log("  evidence:");
  for (const item of result.evidence.items) {
    console.log(`    ${item.label.padEnd(20)} ${pct(item.confidence).padStart(4)}  ${item.strength.padEnd(8)} ${item.detail.slice(0, 70)}`);
  }
  if (result.evidence.spatialAgreement) {
    console.log(`    mean IoU ${result.evidence.spatialAgreement.iou.toFixed(3)}`);
  }
  console.log(`    verdict: ${result.evidence.verdict}`);
  if (result.evidence.recommendation) console.log(`    advice:  ${result.evidence.recommendation}`);

  console.log("");
  console.log("  trace:");
  for (const step of result.trace) {
    const mark = step.status === "complete" ? "v" : step.status === "failed" ? "x" : "-";
    console.log(`    ${mark} ${step.title.padEnd(24)} ${String(step.durationMs).padStart(4)}ms  ${step.detail.slice(0, 60)}`);
  }

  console.log("");
  console.log(`  layers   ${result.visualization.availableLayers.map((l) => l.label).join(", ")}`);
  console.log(`  overlays ${result.visualization.overlays.map((o) => o.id).join(", ") || "-"}`);
  console.log(`  showme   ${result.visualization.primaryOverlayIds.join(", ") || "-"}  focus=${result.visualization.focus ? result.visualization.focus.join(",") : "none"}`);
  console.log(`  total    ${result.totalDurationMs}ms`);
  }
}

main();
