/** Measures the local model's intent classification against known-correct labels. */
const ENDPOINT = process.env.SATQUERY_LOCAL_LLM_URL!;
const MODEL = process.env.SATQUERY_LOCAL_LLM_MODEL!;

const INTENTS = ["scene_description","grounding","change_analysis","quantitative_change_analysis","cross_modal_analysis"];

const CASES: [string, string, { bi: boolean; sar: boolean }][] = [
  ["Describe the land cover and major objects visible in this image.", "scene_description", { bi: false, sar: false }],
  ["What is visible here?", "scene_description", { bi: false, sar: false }],
  ["Highlight the water body.", "grounding", { bi: false, sar: false }],
  ["Has the built-up area increased?", "quantitative_change_analysis", { bi: true, sar: true }],
  ["Use the optical and SAR images together to confirm what changed.", "cross_modal_analysis", { bi: true, sar: true }],
];

function bare(q: string, c: { bi: boolean; sar: boolean }) {
  return [
    "Classify a remote-sensing question. Reply with JSON only.",
    `Allowed intent values: ${INTENTS.join(", ")}.`,
    `Available inputs: bi-temporal=${c.bi}, SAR=${c.sar}.`,
    'Schema: {"intent": string, "target": string|null}',
    `Question: ${q}`,
  ].join("\n");
}

function fewShot(q: string, c: { bi: boolean; sar: boolean }) {
  return [
    "You label remote-sensing questions with one intent. Reply with JSON only, no prose.",
    "",
    "Definitions:",
    "- scene_description: asks what is present or visible overall. Describing, listing, summarising content.",
    "- grounding: asks WHERE one named feature is. Locating, highlighting, pointing to a specific thing.",
    "- change_analysis: asks what changed between two dates, without asking how much.",
    "- quantitative_change_analysis: asks how much something changed, increased or decreased.",
    "- cross_modal_analysis: explicitly asks to use radar/SAR, or to combine two sensors.",
    "",
    "Examples:",
    'Q: "Describe what is in this image" -> {"intent":"scene_description","target":null}',
    'Q: "What land cover is visible?" -> {"intent":"scene_description","target":null}',
    'Q: "Where is the water?" -> {"intent":"grounding","target":"water"}',
    'Q: "Highlight the built-up areas" -> {"intent":"grounding","target":"built-up"}',
    'Q: "What changed between these dates?" -> {"intent":"change_analysis","target":null}',
    'Q: "How much has the city grown?" -> {"intent":"quantitative_change_analysis","target":"built-up"}',
    'Q: "Use radar and optical together" -> {"intent":"cross_modal_analysis","target":null}',
    "",
    `Available inputs: bi-temporal=${c.bi}, SAR=${c.sar}.`,
    `Q: "${q}" ->`,
  ].join("\n");
}

async function classify(prompt: string): Promise<string> {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 96, temperature: 0 }),
    signal: AbortSignal.timeout(60_000),
  });
  const d = await r.json();
  const raw: string = d.choices?.[0]?.message?.content ?? "";
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return "NO_JSON";
  try { return JSON.parse(m[0]).intent ?? "NO_INTENT"; } catch { return "BAD_JSON"; }
}

async function main() {
  for (const [q, expected, ctx] of CASES) {
    const a = await classify(bare(q, ctx));
    const b = await classify(fewShot(q, ctx));
    console.log(
      `${(a === expected ? "ok  " : "FAIL")} bare=${a.padEnd(30)} ` +
      `${(b === expected ? "ok  " : "FAIL")} fewshot=${b.padEnd(30)} ${q.slice(0, 44)}`,
    );
  }
}
main();
