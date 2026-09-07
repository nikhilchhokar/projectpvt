/**
 * Measures whether a local model can be trusted with routing.
 *
 * Runs the demo queries through the real adapter -- including its validation and
 * fallback -- rather than a hand-rolled prompt, so the number produced is what
 * the product would actually do, and prints the rule-based interpreter on the
 * same cases so the comparison is like for like.
 *
 * Each case is repeated, because instability would disqualify a model just as
 * firmly as inaccuracy. Measured so far, both local models were perfectly
 * stable and simply wrong in different places:
 *
 *   rules        7/7   ~3ms for all seven
 *   llama3.2:1b  6/7   routes "describe the land cover and major objects" to grounding
 *   llama3.2:3b  5/7   routes both "highlight the water" and "where is the water"
 *                      to scene_description
 *
 * Bigger was worse. Until a model clears 7/7 twice, the rules stay primary.
 *
 *   SATQUERY_LOCAL_LLM_URL=... SATQUERY_LOCAL_LLM_MODEL=llama3.2:3b \
 *     npx tsx scripts/probe-intent.ts [repeats]
 */

import { DeterministicLanguageProvider } from "../src/lib/satquery/llm/deterministic";
import { PocketLLMProvider, readPocketLLMConfig } from "../src/lib/satquery/llm/pocketllm";
import type { InterpretContext } from "../src/lib/satquery/llm/provider";
import type { Intent } from "../src/lib/satquery/types";

interface Case {
  query: string;
  expected: Intent;
  context: InterpretContext;
}

const single: InterpretContext = {
  hasBitemporal: false,
  hasSar: false,
  hasOptical: true,
  imageCount: 1,
};
const pair: InterpretContext = {
  hasBitemporal: true,
  hasSar: true,
  hasOptical: true,
  imageCount: 4,
};

const CASES: Case[] = [
  { query: "Describe the land cover and major objects visible in this image.", expected: "scene_description", context: single },
  { query: "What is visible here?", expected: "scene_description", context: single },
  { query: "Highlight the water body.", expected: "grounding", context: single },
  { query: "Where is the water?", expected: "grounding", context: single },
  { query: "What changed between these dates?", expected: "change_analysis", context: pair },
  { query: "Has the built-up area increased?", expected: "quantitative_change_analysis", context: pair },
  { query: "Use the optical and SAR images together to confirm what changed.", expected: "cross_modal_analysis", context: pair },
];

/** The incumbent, measured on the same cases so the comparison is like for like. */
async function baseline() {
  const rules = new DeterministicLanguageProvider();
  let correct = 0;
  const started = performance.now();
  for (const testCase of CASES) {
    const result = await rules.interpretQuery(testCase.query, testCase.context);
    if (result.intent === testCase.expected) correct++;
    else console.log(`FAIL rules    ${result.intent.padEnd(34)} ${testCase.query.slice(0, 46)}`);
  }
  console.log(
    `rules    ${correct}/${CASES.length} correct in ${(performance.now() - started).toFixed(1)}ms total
`,
  );
}

async function main() {
  await baseline();
  const config = readPocketLLMConfig();
  if (!config) {
    console.log("No local model configured. Set SATQUERY_LOCAL_LLM_URL.");
    process.exit(1);
  }

  const repeats = Number(process.argv[2] ?? 3);
  const provider = new PocketLLMProvider(config);

  console.log(`model    ${config.model}`);
  console.log(`repeats  ${repeats} per query`);
  console.log(`probing  ${await provider.isAvailable()}\n`);

  let correct = 0;
  let stable = 0;

  for (const testCase of CASES) {
    const seen: string[] = [];
    for (let i = 0; i < repeats; i++) {
      const result = await provider.interpretQuery(testCase.query, testCase.context);
      seen.push(result.intent);
    }
    const allAgree = new Set(seen).size === 1;
    const allRight = seen.every((intent) => intent === testCase.expected);
    if (allRight) correct++;
    if (allAgree) stable++;

    const mark = allRight ? "ok  " : "FAIL";
    const stability = allAgree ? "stable  " : "UNSTABLE";
    console.log(
      `${mark} ${stability} ${[...new Set(seen)].join(" / ").padEnd(34)} ${testCase.query.slice(0, 46)}`,
    );
  }

  console.log(
    `\ncorrect ${correct}/${CASES.length}   stable ${stable}/${CASES.length}` +
      `\nverdict: ${correct === CASES.length && stable === CASES.length ? "TRUSTWORTHY for routing" : "NOT trustworthy for routing"}`,
  );
}

main();
