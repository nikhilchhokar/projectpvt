/**
 * SatQuery orchestrator.
 *
 * The whole product in one function:
 *
 *   interpret -> validate -> plan -> run specialists -> cross-check -> simplify
 *
 * Every stage is observable, and every stage can decline. The engine holds no
 * knowledge of how any specialist works and no knowledge of which language
 * provider is active -- it composes interfaces. That is what makes the claim
 * "swap the mocks for real models without a redesign" true rather than
 * aspirational.
 */

import type { AgentContext } from "./agents/context";
import { opticalPair, sceneOf } from "./agents/context";
import { assessEvidence } from "./evidence";
import { classifyCached, harmonizeThresholds, type LandCoverThresholds } from "./landcover";
import { languageProvider } from "./llm";
import { availableSpecialists, getSpecialist } from "./registry";
import { unionBbox } from "./raster";
import { SCENE_SIZE } from "./scene";
import type {
  AgentId,
  AgentResult,
  AnalysisFailure,
  AnalysisRequest,
  AnalysisResult,
  ImageAsset,
  Intent,
  QueryInterpretation,
  TraceStep,
  VizLayer,
  VizOverlay,
  Visualization,
} from "./types";
import { validateInputs } from "./validator";

/**
 * Interpretation confidence below which the engine declines to answer.
 *
 * The deterministic interpreter scores 0.42 when nothing in the query matched
 * any known signal, and its fallback intent is a general scene description --
 * so without this gate, 300 characters of gibberish returns a fully-formed
 * land-cover result marked "Evidence consistent". Answering a question nobody
 * asked is a louder dishonesty than any wrong percentage.
 */
const MIN_INTERPRETATION_CONFIDENCE = 0.5;

const LAYER_LANGUAGE = "Local language layer";
const LAYER_ROUTER = "Task router";
const LAYER_VALIDATOR = "Input validator";
const LAYER_SPECIALIST = "Specialist";
const LAYER_EVIDENCE = "Evidence engine";

/** Which specialist's finding becomes the headline, given the intent. */
function primaryAgentFor(intent: Intent, agents: AgentResult[]): AgentResult | undefined {
  const ok = agents.filter((a) => a.status === "ok");
  const pick = (id: AgentId) => ok.find((a) => a.agent === id);
  switch (intent) {
    case "grounding":
      return pick("grounding") ?? pick("vision");
    case "change_analysis":
    case "quantitative_change_analysis":
      return pick("change") ?? pick("sar") ?? pick("vision");
    case "cross_modal_analysis":
      return pick("change") ?? pick("sar") ?? pick("vision");
    default:
      return pick("vision") ?? ok[0];
  }
}

function buildLayers(images: ImageAsset[]): { layers: VizLayer[]; primary: string } {
  const layers: VizLayer[] = [];
  const optical = images.filter((i) => i.modality === "optical");
  const sar = images.filter((i) => i.modality === "sar");

  for (const image of optical) {
    const label =
      image.role === "before" ? "Before" : image.role === "after" ? "After" : "Optical";
    layers.push({
      id: `optical-${image.id}`,
      label,
      kind: "optical",
      sceneKey: image.sceneKey,
      caption: `${image.name} · ${image.acquired}`,
    });
  }

  for (const image of sar) {
    const label = sar.length > 1 ? `SAR ${image.role === "before" ? "before" : "after"}` : "SAR";
    layers.push({
      id: `sar-${image.id}`,
      label,
      kind: "sar",
      sceneKey: image.sceneKey,
      caption: `${image.name} · VV backscatter · ${image.acquired}`,
    });
  }

  // A difference layer only means something when there are two epochs to difference.
  const before = optical.find((i) => i.role === "before");
  const after = optical.find((i) => i.role === "after");
  if (before && after) {
    layers.push({
      id: "difference",
      label: "Difference",
      kind: "difference",
      sceneKey: `${before.sceneKey}|${after.sceneKey}`,
      caption: "Per-pixel spectral change between the two acquisitions",
    });
  }

  const primary =
    layers.find((l) => l.label === "After")?.id ??
    layers.find((l) => l.kind === "optical")?.id ??
    layers[0]?.id ??
    "";

  return { layers, primary };
}

function buildVisualization(
  images: ImageAsset[],
  agents: AgentResult[],
  primary: AgentResult | undefined,
): Visualization {
  const { layers, primary: primaryLayer } = buildLayers(images);

  const overlays: VizOverlay[] = [];
  for (const agent of agents) {
    if (agent.status !== "ok") continue;
    for (const mask of agent.masks) {
      overlays.push({
        id: mask.id,
        label: mask.label,
        color: mask.color,
        mask: mask.mask,
        regions: agent.regions.filter(() => agent.agent === primary?.agent),
        sourceAgent: agent.agent,
        // Overlays start hidden. SHOW ME is what reveals them, and that reveal
        // is the moment the answer becomes a place.
        defaultVisible: false,
      });
    }
  }

  const primaryOverlayIds = primary
    ? overlays
        .filter((o) => o.sourceAgent === primary.agent)
        .slice(0, 1)
        .map((o) => o.id)
    : [];

  const focus = primary?.regions.length
    ? unionBbox(primary.regions, SCENE_SIZE, SCENE_SIZE, 40)
    : null;

  return { primaryLayer, availableLayers: layers, focus, overlays, primaryOverlayIds };
}

export async function runAnalysis(request: AnalysisRequest): Promise<AnalysisResult> {
  const startedAt = performance.now();
  const provider = await languageProvider();
  const options = request.options ?? {};
  const images = request.images;
  const trace: TraceStep[] = [];

  const step = (
    id: string,
    title: string,
    detail: string,
    layer: string,
    durationMs: number,
    status: TraceStep["status"] = "complete",
    providerName?: string,
  ): TraceStep => {
    const entry: TraceStep = {
      id,
      title,
      detail,
      layer,
      provider: providerName,
      status,
      durationMs,
    };
    trace.push(entry);
    return entry;
  };

  // --- 1. interpret ---------------------------------------------------------

  const optical = images.filter((i) => i.modality === "optical");
  const interpretStart = performance.now();
  const interpretation: QueryInterpretation = await provider.interpretQuery(request.query, {
    hasBitemporal: optical.length >= 2,
    hasSar: images.some((i) => i.modality === "sar"),
    hasOptical: optical.length > 0,
    imageCount: images.length,
  });
  step(
    "interpret",
    "Query interpreted",
    `Intent: ${interpretation.normalized.toLowerCase()}`,
    LAYER_LANGUAGE,
    Math.round(performance.now() - interpretStart),
    "complete",
    provider.name,
  );

  // --- 1b. decline questions that were not understood -----------------------

  if (interpretation.confidence < MIN_INTERPRETATION_CONFIDENCE) {
    const failure: AnalysisFailure = {
      code: "unclear_query",
      title: "I could not tell what you are asking",
      message: `Nothing in that question matched a capability I have, so I read it as a general scene description with only ${Math.round(
        interpretation.confidence * 100,
      )}% confidence. Rather than answer a question you did not ask, here is what I can be asked.`,
      nextSteps: [
        "Ask what is visible: \"Describe the land cover in this image\"",
        "Ask where something is: \"Highlight the water body\"",
        "Ask what changed: \"Has the built-up area increased?\"",
        "Ask for radar corroboration: \"Use optical and SAR together\"",
      ],
    };
    const evidence = assessEvidence([], [], options);
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      query: request.query,
      interpretation,
      plan: { intent: interpretation.intent, tools: [], rationale: "Halted: query not understood" },
      validation: { ok: true, checks: [] },
      agents: [],
      evidence: {
        ...evidence,
        status: "insufficient",
        overallConfidence: 0,
        verdict: failure.message,
        recommendation: undefined,
      },
      headline: failure.title,
      summary: failure.message,
      icon: "blocked",
      confidence: 0,
      visualization: buildVisualization(images, [], undefined),
      trace,
      languageProvider: provider.name,
      images,
      totalDurationMs: Math.round(performance.now() - startedAt),
      reportSummary: failure.message,
      failure,
    };
  }

  // --- 2. validate ----------------------------------------------------------

  const validateStart = performance.now();
  const validation = validateInputs(images, interpretation, options.spatialToleranceM ?? 50);
  const validationSummary = validation.ok
    ? validation.checks
        .filter((c) => c.level === "pass")
        .slice(0, 3)
        .map((c) => c.label)
        .join(" · ")
    : (validation.failure?.title ?? "Inputs rejected");
  step(
    "validate",
    "Inputs validated",
    validationSummary,
    LAYER_VALIDATOR,
    Math.round(performance.now() - validateStart),
    validation.ok ? "complete" : "failed",
  );

  if (!validation.ok && validation.failure) {
    const evidence = assessEvidence([], [], options);
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      query: request.query,
      interpretation,
      plan: { intent: interpretation.intent, tools: [], rationale: "Halted at input validation" },
      validation,
      agents: [],
      evidence: {
        ...evidence,
        status: "insufficient",
        overallConfidence: 0,
        verdict: validation.failure.message,
        // The failure carries specific next steps; the evidence engine's
        // generic advice would contradict them.
        recommendation: undefined,
      },
      headline: validation.failure.title,
      summary: validation.failure.message,
      icon: "blocked",
      confidence: 0,
      visualization: buildVisualization(images, [], undefined),
      trace,
      languageProvider: provider.name,
      images,
      totalDurationMs: Math.round(performance.now() - startedAt),
      reportSummary: validation.failure.message,
      failure: validation.failure,
    };
  }

  // --- 3. harmonise thresholds for bi-temporal work -------------------------

  const baseContext: AgentContext = { images, interpretation, options };
  let harmonised: LandCoverThresholds | undefined;
  const pair = opticalPair(baseContext);
  if (pair) {
    harmonised = harmonizeThresholds(
      classifyCached(sceneOf(pair.before)),
      classifyCached(sceneOf(pair.after)),
    );
  }
  const ctx: AgentContext = { ...baseContext, harmonised };

  // --- 4. plan --------------------------------------------------------------

  const planStart = performance.now();
  let available = availableSpecialists(ctx);
  if (options.enabledAgents?.length) {
    available = available.filter((id) => options.enabledAgents?.includes(id));
  }
  const plan = await provider.planWorkflow(interpretation, available);
  step(
    "plan",
    "Specialists selected",
    plan.rationale,
    LAYER_ROUTER,
    Math.round(performance.now() - planStart),
    "complete",
    provider.name,
  );

  // --- 5. run specialists ---------------------------------------------------

  const agents: AgentResult[] = [];
  for (const id of plan.tools) {
    if (id === "evidence") continue;
    const specialist = getSpecialist(id);
    if (!specialist) continue;

    const result = specialist.run(ctx);
    agents.push(result);
    step(
      `agent-${id}`,
      specialist.displayName,
      result.status === "ok" ? result.claim : (result.note ?? "Skipped"),
      LAYER_SPECIALIST,
      result.durationMs,
      result.status === "ok" ? "complete" : "skipped",
      specialist.displayName,
    );
  }

  // --- 6. cross-check -------------------------------------------------------

  const evidenceStart = performance.now();
  const items = await provider.summarizeEvidence(agents);
  const evidence = assessEvidence(agents, items, options);
  step(
    "evidence",
    "Evidence cross-checked",
    evidence.verdict,
    LAYER_EVIDENCE,
    Math.round(performance.now() - evidenceStart),
    "complete",
  );

  // --- 7. simplify ----------------------------------------------------------

  const simplifyStart = performance.now();
  const answer = await provider.simplifyResult({ interpretation, agents, evidence, images });
  step(
    "synthesis",
    "Response synthesised",
    "Plain-language answer generated from the structured findings",
    LAYER_LANGUAGE,
    Math.round(performance.now() - simplifyStart),
    "complete",
    provider.name,
  );

  const primary = primaryAgentFor(interpretation.intent, agents);
  const visualization = buildVisualization(images, agents, primary);

  const failure =
    evidence.status === "insufficient"
      ? {
          code: "insufficient_evidence" as const,
          title: "Insufficient evidence for a reliable conclusion",
          message: evidence.verdict,
          nextSteps: [
            evidence.recommendation ?? "Add another modality and run the analysis again",
            "Or open Expert Mode and relax the confidence threshold",
          ],
        }
      : undefined;

  const result: AnalysisResult = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    query: request.query,
    interpretation,
    plan,
    validation,
    agents,
    evidence,
    headline: answer.headline,
    summary: answer.summary,
    icon: answer.icon,
    confidence: evidence.overallConfidence,
    visualization,
    trace,
    languageProvider: provider.name,
    images,
    totalDurationMs: Math.round(performance.now() - startedAt),
    failure,
    reportSummary: "",
  };

  // Composed last, because the summary is a statement about the finished result.
  result.reportSummary = await provider.generateReportSummary(result);
  return result;
}
