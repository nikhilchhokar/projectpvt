/**
 * Compares the deterministic language layer against the local model, and
 * verifies the guard that stops a model inventing a figure.
 */
import { DeterministicLanguageProvider } from "../src/lib/satquery/llm/deterministic";
import { PocketLLMProvider, readPocketLLMConfig } from "../src/lib/satquery/llm/pocketllm";
import { runAnalysis } from "../src/lib/satquery/engine";
import { DEMO_SCENARIOS } from "../src/lib/satquery/scenarios";

const numbersIn = (t: string) => new Set(t.match(/\d+(?:\.\d+)?/g) ?? []);

async function main() {
  const config = readPocketLLMConfig();
  if (!config) {
    console.log("No local model configured.");
    return;
  }
  const local = new PocketLLMProvider(config);
  console.log("available:", await local.isAvailable(), "|", config.model, "\n");

  const deterministic = new DeterministicLanguageProvider();

  for (const scenario of DEMO_SCENARIOS.slice(0, 5)) {
    const result = await runAnalysis({ query: scenario.query, images: scenario.images });
    const input = {
      interpretation: result.interpretation,
      agents: result.agents,
      evidence: result.evidence,
      images: result.images,
    };
    const base = await deterministic.simplifyResult(input);
    const rewritten = await local.simplifyResult(input);

    const allowed = numbersIn(base.headline);
    const introduced = [...numbersIn(rewritten.headline)].filter((n) => !allowed.has(n));

    console.log(`${scenario.index}  deterministic : ${base.headline}`);
    console.log(`    local model   : ${rewritten.headline}`);
    console.log(
      `    rewritten=${rewritten.headline !== base.headline}  invented-figures=${
        introduced.length ? introduced.join(",") : "none"
      }\n`,
    );
  }
}
main();
