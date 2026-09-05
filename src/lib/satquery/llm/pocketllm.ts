/**
 * PocketLLM adapter.
 *
 * Wires the local language layer to an on-device model server speaking the
 * OpenAI-compatible chat completions shape, which is what PocketLLM and the
 * other local runtimes expose. Configure with:
 *
 *   SATQUERY_LOCAL_LLM_URL    http://127.0.0.1:8080/v1/chat/completions
 *   SATQUERY_LOCAL_LLM_MODEL  pocketllm
 *   SATQUERY_LOCAL_LLM_NAME   PocketLLM
 *
 * When no endpoint is configured or reachable, the resolver falls back to the
 * deterministic provider and the UI reports that provider by name. The product
 * never claims a model is running that is not.
 *
 * Division of labour is deliberate. The model handles interpretation and
 * phrasing -- language tasks, where a mistake is visible and recoverable. It is
 * never given the job of producing a measurement: every number in the final
 * answer comes from the specialists, and `simplifyResult` rejects any rewrite
 * that introduces a figure the analysis did not produce.
 */

import type {
  AgentId,
  AgentResult,
  AnalysisResult,
  EvidenceItem,
  Intent,
  QueryInterpretation,
  WorkflowPlan,
} from "../types";
import { DeterministicLanguageProvider } from "./deterministic";
import type {
  InterpretContext,
  LocalLLMProvider,
  ProviderKind,
  SimplifiedAnswer,
  SimplifyInput,
} from "./provider";

const VALID_INTENTS: Intent[] = [
  "scene_description",
  "grounding",
  "change_analysis",
  "quantitative_change_analysis",
  "cross_modal_analysis",
];

const REQUEST_TIMEOUT_MS = 4000;

export interface PocketLLMConfig {
  url: string;
  model: string;
  displayName: string;
}

export function readPocketLLMConfig(): PocketLLMConfig | null {
  const url = process.env.SATQUERY_LOCAL_LLM_URL;
  if (!url) return null;
  return {
    url,
    model: process.env.SATQUERY_LOCAL_LLM_MODEL ?? "pocketllm",
    displayName: process.env.SATQUERY_LOCAL_LLM_NAME ?? "PocketLLM",
  };
}

/** Numbers the model must not invent. */
function numbersIn(text: string): Set<string> {
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
}

export class PocketLLMProvider implements LocalLLMProvider {
  readonly kind: ProviderKind = "local-model";
  private readonly fallback = new DeterministicLanguageProvider();

  constructor(private readonly config: PocketLLMConfig) {}

  get name(): string {
    return this.config.displayName;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const reply = await this.complete("Reply with the single word: ready", 8);
      return typeof reply === "string" && reply.length > 0;
    } catch {
      return false;
    }
  }

  private async complete(prompt: string, maxTokens: number): Promise<string> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Local LLM returned ${response.status}`);
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  async interpretQuery(query: string, context: InterpretContext): Promise<QueryInterpretation> {
    const deterministic = await this.fallback.interpretQuery(query, context);
    try {
      const prompt = [
        "Classify a remote-sensing question. Reply with JSON only.",
        `Allowed intent values: ${VALID_INTENTS.join(", ")}.`,
        `Available inputs: ${context.imageCount} image(s), bi-temporal=${context.hasBitemporal}, SAR=${context.hasSar}.`,
        'Schema: {"intent": string, "target": string|null}',
        `Question: ${query}`,
      ].join("\n");

      const raw = await this.complete(prompt, 96);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return deterministic;

      const parsed = JSON.parse(match[0]) as { intent?: string; target?: string | null };
      if (!parsed.intent || !VALID_INTENTS.includes(parsed.intent as Intent)) {
        return deterministic;
      }

      // An intent the supplied inputs cannot support is rejected rather than
      // attempted -- the validator would fail it a step later anyway.
      const intent = parsed.intent as Intent;
      if (intent === "cross_modal_analysis" && !context.hasSar) return deterministic;
      if (
        (intent === "change_analysis" || intent === "quantitative_change_analysis") &&
        !context.hasBitemporal
      ) {
        return deterministic;
      }

      return {
        ...deterministic,
        intent,
        target: parsed.target ?? deterministic.target,
        requiresBitemporal:
          intent === "change_analysis" || intent === "quantitative_change_analysis",
        requiresSar: intent === "cross_modal_analysis",
      };
    } catch {
      return deterministic;
    }
  }

  async planWorkflow(
    interpretation: QueryInterpretation,
    available: AgentId[],
  ): Promise<WorkflowPlan> {
    // Tool selection stays deterministic: it is a routing decision with a
    // correct answer, not a language task.
    return this.fallback.planWorkflow(interpretation, available);
  }

  async summarizeEvidence(agents: AgentResult[]): Promise<EvidenceItem[]> {
    return this.fallback.summarizeEvidence(agents);
  }

  async simplifyResult(input: SimplifyInput): Promise<SimplifiedAnswer> {
    const base = await this.fallback.simplifyResult(input);
    try {
      const prompt = [
        "Rewrite this finding as one clear sentence for a non-expert.",
        "Do not add, remove or alter any number. Do not add new facts.",
        "Reply with the sentence only.",
        `Finding: ${base.headline}`,
      ].join("\n");

      const candidate = (await this.complete(prompt, 64)).replace(/^["']|["']$/g, "").trim();
      if (!candidate || candidate.length > 180) return base;

      // Reject any rewrite that introduces a figure the analysis did not report.
      const allowed = numbersIn(base.headline);
      for (const n of numbersIn(candidate)) {
        if (!allowed.has(n)) return base;
      }
      return { ...base, headline: candidate };
    } catch {
      return base;
    }
  }

  async generateReportSummary(result: AnalysisResult): Promise<string> {
    return this.fallback.generateReportSummary(result);
  }
}
