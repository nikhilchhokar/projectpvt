/**
 * Deterministic language provider.
 *
 * A rule-based implementation of the local language layer. It is the provider
 * that actually ships and runs: query interpretation, workflow planning and
 * response simplification are all handled by explicit, inspectable rules over
 * the structured findings the specialists return.
 *
 * It is deliberately the default rather than a placeholder. Every sentence it
 * produces is assembled from a measured quantity, so the product cannot claim
 * something the analysis did not find -- a property a generative model would
 * have to be constrained back into.
 */

import { describeDirection } from "../geo";
import { strengthOf } from "../confidence";
import type {
  AgentId,
  AgentResult,
  AnalysisResult,
  EvidenceAssessment,
  EvidenceItem,
  ImageAsset,
  Intent,
  QueryInterpretation,
  WorkflowPlan,
} from "../types";
import type {
  InterpretContext,
  LocalLLMProvider,
  ProviderKind,
  SimplifiedAnswer,
  SimplifyInput,
} from "./provider";

// --- lexicon ----------------------------------------------------------------

const SAR_TERMS = /\b(sar|radar|backscatter|microwave|sentinel-?1|polarimetric)\b/;
const FUSION_TERMS = /\b(both|together|combine[sd]?|fuse[sd]?|fusion|cross-?modal|multi-?modal|as well as)\b/;
const CHANGE_TERMS =
  /\b(chang\w*|differ\w*|before|after|between|since|new|develop\w*|urbani\w*|increas\w*|decreas\w*|grow\w*|grew|expand\w*|shrink\w*|construct\w*)\b/;
const QUANTITY_TERMS =
  /\b(how much|how many|percent\w*|%|quantif\w*|by how|extent|increas\w*|decreas\w*|grow\w*|grew|expand\w*|shrink\w*|rate|area)\b/;
const GROUNDING_TERMS =
  /\b(where|highlight|locate|find|show me|mark|point out|which part|pinpoint|outline)\b/;
const DESCRIPTION_TERMS =
  /\b(what is|what'?s|describe|visible|land.?cover|see|contains?|overview|summar\w*|caption)\b/;

const TARGETS: { re: RegExp; concept: string }[] = [
  { re: /\b(water|lake|river|reservoir|pond|flood\w*|wetland|canal|coast\w*)\b/, concept: "water" },
  {
    re: /\b(built.?up|urban|building|settlement|construct\w*|city|town|industrial|infrastructure)\b/,
    concept: "built-up",
  },
  { re: /\b(veget\w*|crop\w*|farm\w*|forest|tree|green|field|agri\w*)\b/, concept: "vegetation" },
  { re: /\b(bare|soil|fallow|barren|sand|desert)\b/, concept: "bare ground" },
];

/** Which specialists each intent wants, before availability is considered. */
const INTENT_TOOLS: Record<Intent, AgentId[]> = {
  scene_description: ["vision"],
  grounding: ["vision", "grounding"],
  change_analysis: ["change", "vision"],
  quantitative_change_analysis: ["change", "vision", "sar"],
  cross_modal_analysis: ["vision", "sar", "change"],
};

const INTENT_LABEL: Record<Intent, string> = {
  scene_description: "scene description",
  grounding: "spatial grounding",
  change_analysis: "change analysis",
  quantitative_change_analysis: "quantitative change analysis",
  cross_modal_analysis: "cross-modal analysis",
};

const AGENT_LABEL: Record<AgentId, string> = {
  vision: "Optical analysis",
  grounding: "Spatial grounding",
  caption: "Scene captioning",
  change: "Change detection",
  sar: "SAR analysis",
  evidence: "Evidence engine",
};

export function intentLabel(intent: Intent): string {
  return INTENT_LABEL[intent];
}

// --- provider ---------------------------------------------------------------

export class DeterministicLanguageProvider implements LocalLLMProvider {
  readonly name = "SatQuery Interpreter";
  readonly kind: ProviderKind = "deterministic";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async interpretQuery(query: string, context: InterpretContext): Promise<QueryInterpretation> {
    const q = query.toLowerCase().trim();
    const signals: string[] = [];

    const capture = (re: RegExp): boolean => {
      const m = q.match(re);
      if (!m) return false;
      const term = m[0].trim();
      if (term && !signals.includes(term)) signals.push(term);
      return true;
    };

    const mentionsSar = capture(SAR_TERMS);
    const mentionsFusion = capture(FUSION_TERMS);
    const mentionsChange = capture(CHANGE_TERMS);
    const wantsQuantity = capture(QUANTITY_TERMS);
    const mentionsGrounding = capture(GROUNDING_TERMS);
    capture(DESCRIPTION_TERMS);

    let target: string | null = null;
    for (const t of TARGETS) {
      const m = q.match(t.re);
      if (m) {
        target = t.concept;
        if (!signals.includes(m[0])) signals.push(m[0]);
        break;
      }
    }

    /**
     * Intent resolution is ordered by specificity. An explicit request to use
     * radar outranks everything else, because it names a capability rather than
     * a question -- ignoring it would silently disobey the user.
     */
    let intent: Intent;
    if ((mentionsSar || mentionsFusion) && context.hasSar) {
      intent = "cross_modal_analysis";
    } else if (mentionsChange) {
      intent = wantsQuantity ? "quantitative_change_analysis" : "change_analysis";
    } else if (mentionsGrounding) {
      intent = "grounding";
    } else {
      intent = "scene_description";
    }

    // A grounding verb with no temporal language is a location question even
    // when a target noun also suggests change vocabulary.
    if (mentionsGrounding && !mentionsChange && !mentionsSar && intent !== "grounding") {
      intent = "grounding";
    }

    const matched = signals.length;
    const confidence = matched === 0 ? 0.42 : Math.min(0.96, 0.58 + 0.11 * matched);

    return {
      intent,
      normalized: this.normalize(intent, target),
      target,
      requiresBitemporal:
        intent === "change_analysis" || intent === "quantitative_change_analysis",
      requiresSar: intent === "cross_modal_analysis",
      wantsQuantity,
      confidence,
      signals,
    };
  }

  private normalize(intent: Intent, target: string | null): string {
    const t = target ?? "the dominant land-cover classes";
    switch (intent) {
      case "grounding":
        return `Locate ${t} and return its extent`;
      case "change_analysis":
        return `Compare the two acquisitions and report what changed`;
      case "quantitative_change_analysis":
        return `Quantify the change in ${target ?? "built-up"} area between the two acquisitions`;
      case "cross_modal_analysis":
        return `Combine optical and radar evidence to characterise ${t}`;
      default:
        return `Describe the land cover and notable objects present`;
    }
  }

  async planWorkflow(
    interpretation: QueryInterpretation,
    available: AgentId[],
  ): Promise<WorkflowPlan> {
    const wanted = INTENT_TOOLS[interpretation.intent];
    const tools = wanted.filter((t) => available.includes(t));

    // Never return an empty plan: fall back to whatever can actually run.
    if (!tools.length && available.length) tools.push(available[0]);

    const dropped = wanted.filter((t) => !available.includes(t));
    const parts = [
      `${INTENT_LABEL[interpretation.intent]} selected from the query`,
      `routed to ${tools.map((t) => AGENT_LABEL[t]).join(", ") || "no specialist"}`,
    ];
    if (dropped.length) {
      parts.push(
        `${dropped.map((t) => AGENT_LABEL[t]).join(" and ")} skipped -- required inputs not supplied`,
      );
    }

    return {
      intent: interpretation.intent,
      tools: tools.length > 1 ? [...tools, "evidence"] : tools,
      rationale: parts.join("; "),
    };
  }

  async summarizeEvidence(agents: AgentResult[]): Promise<EvidenceItem[]> {
    return agents
      .filter((a) => a.status === "ok")
      .map((a) => ({
        id: `evidence-${a.agent}`,
        label: AGENT_LABEL[a.agent],
        source: a.method,
        detail: a.claim,
        confidence: a.confidence,
        strength: strengthOf(a.confidence),
      }));
  }

  async simplifyResult(input: SimplifyInput): Promise<SimplifiedAnswer> {
    const { interpretation, agents, evidence, images } = input;
    const find = (id: AgentId) => agents.find((a) => a.agent === id && a.status === "ok");
    const change = find("change");
    const grounding = find("grounding");
    const vision = find("vision");
    const sar = find("sar");

    const headline = this.headlineFor({
      interpretation,
      change,
      grounding,
      vision,
      sar,
      images,
      evidence,
    });
    const summary = this.summaryFor(input, headline.usedModalities);

    return { headline: headline.text, summary, icon: headline.icon };
  }

  private headlineFor(args: {
    interpretation: QueryInterpretation;
    change?: AgentResult;
    grounding?: AgentResult;
    vision?: AgentResult;
    sar?: AgentResult;
    images: ImageAsset[];
    evidence: EvidenceAssessment;
  }): { text: string; icon: string; usedModalities: string[] } {
    const { interpretation, change, grounding, vision, sar, images, evidence } = args;

    /**
     * Modalities that actually contributed, not the ones that happened to be
     * uploaded. With the SAR specialist switched off in Expert Mode the radar
     * imagery is still sitting in the inputs, and saying it informed the answer
     * would be a plain misstatement of what ran.
     */
    const contributing = new Set<string>();
    if (vision || change || grounding) contributing.add("optical");
    if (sar) contributing.add("radar");
    const modalities = contributing.size
      ? [...contributing]
      : [...new Set(images.map((i) => (i.modality === "sar" ? "radar" : "optical")))];

    /**
     * When independent sensors contradict each other, the number is the least
     * useful thing to lead with. Stating it plainly as a headline would hand
     * the user a figure the system does not actually stand behind, so the
     * doubt is promoted and the measurement demoted to a qualifier.
     */
    if (evidence.contradiction && change?.signal?.detected) {
      const relative = change.metrics.find((m) => m.label === "Relative change")?.raw ?? 0;
      const magnitude = Math.abs(Math.round(relative * 100));
      const direction = relative >= 0 ? "increase" : "decrease";
      const dissenter = sar && !sar.signal?.detected ? "radar" : "the other analysis path";
      return {
        text: `Optical suggests a ${magnitude}% built-up ${direction}, but ${dissenter} does not confirm it`,
        icon: "contested",
        usedModalities: modalities,
      };
    }

    if (
      (interpretation.intent === "change_analysis" ||
        interpretation.intent === "quantitative_change_analysis" ||
        interpretation.intent === "cross_modal_analysis") &&
      change
    ) {
      const relative = change.metrics.find((m) => m.label === "Relative change")?.raw ?? 0;
      if (Math.abs(relative) < 0.03) {
        return {
          text: "No significant built-up change detected",
          icon: "stable",
          usedModalities: modalities,
        };
      }
      return { text: change.claim, icon: "expansion", usedModalities: modalities };
    }

    if (interpretation.intent === "grounding" && grounding) {
      if (!grounding.regions.length) {
        return { text: grounding.claim, icon: "scene", usedModalities: modalities };
      }
      const primary = grounding.regions[0];
      const image = images.find((i) => i.modality === "optical") ?? images[0];
      const where = describeDirection(primary.centroid[0], primary.centroid[1], image.bounds);
      const label = primary.label.toLowerCase();
      const text =
        grounding.regions.length === 1
          ? `${capitalise(label)} located in the ${where}`
          : `${grounding.regions.length} ${label} regions located, the largest in the ${where}`;
      return { text, icon: "located", usedModalities: modalities };
    }

    if (interpretation.intent === "cross_modal_analysis" && vision && sar) {
      return {
        text: `${vision.claim}, corroborated by radar backscatter`,
        icon: "cross-modal",
        usedModalities: modalities,
      };
    }

    if (vision) {
      return { text: vision.claim, icon: "scene", usedModalities: modalities };
    }

    const first = args.change ?? args.sar ?? args.grounding;
    return {
      text: first?.claim ?? "No specialist was able to answer this question",
      icon: "scene",
      usedModalities: modalities,
    };
  }

  private summaryFor(input: SimplifyInput, modalities: string[]): string {
    const { evidence, agents } = input;
    const contributing = agents.filter((a) => a.status === "ok").length;
    const sources =
      modalities.length > 1 ? `${modalities.join(" and ")} imagery` : `${modalities[0]} imagery`;

    switch (evidence.status) {
      case "consistent":
        return contributing === 1
          ? `Measured from ${sources} and checked against its own internal consistency.`
          : `${contributing} independent analyses of ${sources} agree on this result.`;
      case "partial":
        return `Analyses of ${sources} agree only in part. Treat this as indicative and review the evidence before acting on it.`;
      default:
        return `The available evidence from ${sources} was not strong enough to support a reliable conclusion.`;
    }
  }

  async generateReportSummary(result: AnalysisResult): Promise<string> {
    const agents = result.agents.filter((a) => a.status === "ok");
    const lines = [
      `In response to "${result.query}", SatQuery classified the request as ${INTENT_LABEL[result.interpretation.intent]} and ran ${agents.length} specialist${agents.length === 1 ? "" : "s"} over ${result.images.length} input image${result.images.length === 1 ? "" : "s"}.`,
      `${result.headline}. ${result.summary}`,
    ];
    if (result.evidence.spatialAgreement) {
      lines.push(
        `Independent detections overlap with an intersection-over-union of ${result.evidence.spatialAgreement.iou.toFixed(2)}.`,
      );
    }
    if (result.evidence.recommendation) lines.push(result.evidence.recommendation);
    return lines.join(" ");
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
