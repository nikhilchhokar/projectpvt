/** Checks the pitch USP claims against actual engine behaviour. */
import { runAnalysis } from "../src/lib/satquery/engine";
import { DEMO_SCENARIOS } from "../src/lib/satquery/scenarios";
import type { AgentId } from "../src/lib/satquery/types";

async function main() {
  const change = DEMO_SCENARIOS.find((s) => s.id === "change")!;
  const vqa = DEMO_SCENARIOS.find((s) => s.id === "vqa")!;

  const cases: [string, typeof change, string, AgentId[] | undefined][] = [
    ["DEFAULT · change Q", change, "Has the built-up area increased?", undefined],
    ["DEFAULT · single-image Q", vqa, "What is visible here?", undefined],
    ["EXPERT · SAR only", change, "Has the built-up area increased?", ["sar"]],
    ["EXPERT · vision only", change, "Has the built-up area increased?", ["vision"]],
    ["EXPERT · change+SAR", change, "Has the built-up area increased?", ["change", "sar"]],
  ];

  for (const [label, scenario, query, enabledAgents] of cases) {
    const r = await runAnalysis({
      query,
      images: scenario.images,
      options: enabledAgents ? { enabledAgents } : undefined,
    });
    console.log(
      `${label.padEnd(26)} ran=[${r.agents.map((a) => a.agent).join(",") || "-"}]`.padEnd(60) +
        `${String(Math.round(r.confidence * 100)).padStart(3)}%  ${r.evidence.status.padEnd(12)} ${r.headline.slice(0, 46)}`,
    );
  }
}
main();
