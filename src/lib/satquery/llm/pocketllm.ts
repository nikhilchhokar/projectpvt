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
 * Division of labour is deliberate, and narrower than it first appears. The
 * model reads the question -- classifying intent, where a mistake is caught by
 * the validator a step later. It does not write the answer: the deterministic
 * composer does that, assembling sentences only out of measured quantities. It
 * is never given the job of producing a measurement.
 *
 * That split was decided by measurement, not taste. See `simplifyResult`.
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

/**
 * Per-request budget. A warm 1B model answers an intent classification in one
 * to two seconds; this leaves headroom without letting a stalled runtime hold
 * the analysis open long enough to look broken.
 */
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Availability probe budget, deliberately far longer.
 *
 * The first call to a cold local runtime pays for loading the weights into
 * memory -- twenty seconds or more. Probing with the per-request timeout meant
 * a freshly started server always timed out, silently fell back, and then
 * stayed fallen back, because provider resolution is memoised for the process.
 * The interface would have reported the deterministic interpreter all session
 * while a perfectly working model sat idle beside it.
 */
const AVAILABILITY_TIMEOUT_MS = 90_000;

export interface PocketLLMConfig {
  url: string;
  model: string;
  displayName: string;
  /** Opt in to model-written phrasing. Off by default; see simplifyResult. */
  allowPhrasing: boolean;
}

export function readPocketLLMConfig(): PocketLLMConfig | null {
  const url = process.env.SATQUERY_LOCAL_LLM_URL;
  if (!url) return null;
  return {
    url,
    model: process.env.SATQUERY_LOCAL_LLM_MODEL ?? "pocketllm",
    displayName: process.env.SATQUERY_LOCAL_LLM_NAME ?? "PocketLLM",
    allowPhrasing: process.env.SATQUERY_LOCAL_LLM_PHRASING === "1",
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
      const reply = await this.complete(
        "Reply with the single word: ready",
        8,
        AVAILABILITY_TIMEOUT_MS,
      );
      return typeof reply === "string" && reply.length > 0;
    } catch (error) {
      console.warn(
        `[satquery] ${this.config.displayName} probe failed:`,
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  private async complete(
    prompt: string,
    maxTokens: number,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<string> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
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

  /**
   * Phrasing stays deterministic unless explicitly opted into.
   *
   * The digit guard below is necessary but not sufficient, and measuring a 1B
   * model against the deterministic composer showed exactly why. It never
   * invented a figure -- but it dropped all three measurements from a
   * land-cover summary, added a "city" that no analysis had found, and
   * rewrote "a 9% built-up increase that radar does not confirm" into "a 9%
   * increase in optical signals", which is a different and false claim.
   *
   * Numbers survived; meaning did not. So the division of labour is narrower
   * than it first looks: the model reads the question, and the deterministic
   * composer -- which can only assemble sentences out of measured quantities --
   * writes the answer. Set SATQUERY_LOCAL_LLM_PHRASING=1 to experiment with
   * model-written phrasing, ideally against a larger model.
   */
  async simplifyResult(input: SimplifyInput): Promise<SimplifiedAnswer> {
    const base = await this.fallback.simplifyResult(input);
    if (!this.config.allowPhrasing) return base;
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
