/** Verifies the engine declines questions it did not understand. */
import { runAnalysis } from "../src/lib/satquery/engine";
import { DEMO_SCENARIOS } from "../src/lib/satquery/scenarios";

async function main() {
  const scenario = DEMO_SCENARIOS.find((s) => s.id === "change")!;
  const cases: [string, string][] = [
    ["gibberish", "zzz qqq wubbalubba " + "x".repeat(200)],
    ["valid change", "Has the built-up area increased?"],
    ["valid grounding", "Highlight the water body."],
    ["valid vqa", "Describe the land cover in this image."],
  ];
  for (const [label, query] of cases) {
    const r = await runAnalysis({ query, images: scenario.images });
    console.log(
      `${label.padEnd(16)} intent=${String(Math.round(r.interpretation.confidence * 100)).padStart(3)}%  ` +
        `agents=${r.agents.length}  failure=${r.failure?.code ?? "-"}  ${r.headline.slice(0, 52)}`,
    );
  }
}
main();
