/**
 * The local language layer.
 *
 * SatQuery draws a hard line between two kinds of intelligence:
 *
 *   language + workflow  -> this provider
 *   remote-sensing analysis -> the specialist agents
 *
 * The language layer never looks at pixels. It reads the question, decides what
 * needs to happen, and turns structured findings back into a sentence a person
 * can act on. Keeping it on this side of the line is what makes a small local
 * model a sensible choice here: the hard perception work is not being asked of
 * it, so the model can be swapped -- deterministic today, PocketLLM or another
 * on-device runtime tomorrow -- without touching the analysis path.
 *
 * Nothing above this interface may depend on which implementation is active.
 */

import type {
  AgentId,
  AgentResult,
  AnalysisResult,
  EvidenceAssessment,
  EvidenceItem,
  ImageAsset,
  QueryInterpretation,
  WorkflowPlan,
} from "../types";

export type ProviderKind = "deterministic" | "local-model" | "remote-model";

export interface InterpretContext {
  /** What the supplied inputs make possible, so the layer cannot plan the impossible. */
  hasBitemporal: boolean;
  hasSar: boolean;
  hasOptical: boolean;
  imageCount: number;
}

export interface SimplifyInput {
  interpretation: QueryInterpretation;
  agents: AgentResult[];
  evidence: EvidenceAssessment;
  images: ImageAsset[];
}

export interface SimplifiedAnswer {
  headline: string;
  summary: string;
  icon: string;
}

export interface LocalLLMProvider {
  /** Shown verbatim in the execution trace and Expert Mode. Never aspirational. */
  readonly name: string;
  readonly kind: ProviderKind;
  /** Whether this provider is actually usable right now. */
  isAvailable(): Promise<boolean>;

  interpretQuery(query: string, context: InterpretContext): Promise<QueryInterpretation>;

  planWorkflow(
    interpretation: QueryInterpretation,
    available: AgentId[],
  ): Promise<WorkflowPlan>;

  /** Condense specialist output into the items shown in the WHY panel. */
  summarizeEvidence(agents: AgentResult[]): Promise<EvidenceItem[]>;

  /** Produce the headline and supporting line the user reads first. */
  simplifyResult(input: SimplifyInput): Promise<SimplifiedAnswer>;

  generateReportSummary(result: AnalysisResult): Promise<string>;
}
