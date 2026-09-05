/**
 * SatQuery core contracts.
 *
 * Everything that crosses a boundary in this system is described here. The UI
 * depends only on these types -- never on which implementation produced them.
 * Swapping a mock specialist for a real remote-sensing model must not require
 * a single change above this file.
 */

export type Modality = "optical" | "sar";

export type ImageRole = "single" | "before" | "after";

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A raster input as the product sees it: metadata plus a key the raster layer resolves. */
export interface ImageAsset {
  id: string;
  name: string;
  modality: Modality;
  format: string;
  width: number;
  height: number;
  crs: string;
  bounds: GeoBounds;
  acquired: string;
  bands: string[];
  /** Resolves to a deterministic procedural scene. Replaced by a real URI later. */
  sceneKey: string;
  role: ImageRole;
  sizeBytes: number;
}

/** Run-length encoded binary mask. Row-major, alternating off/on run lengths, starting off. */
export interface MaskRLE {
  width: number;
  height: number;
  runs: number[];
}

export interface Region {
  id: string;
  label: string;
  /** Pixel-space bounding box [x0, y0, x1, y1], inclusive-exclusive. */
  bbox: [number, number, number, number];
  /** Geographic bounding box [west, south, east, north]. */
  geoBbox: [number, number, number, number];
  areaPx: number;
  areaKm2: number;
  confidence: number;
  centroid: [number, number];
}

export type AgentId =
  | "vision"
  | "grounding"
  | "caption"
  | "change"
  | "sar"
  | "evidence";

export type AgentStatus = "ok" | "skipped" | "failed";

/** Uniform specialist output. Every agent -- mock or real -- returns exactly this. */
export interface AgentResult {
  agent: AgentId;
  displayName: string;
  /** Honest, human-readable description of the algorithm that ran. */
  method: string;
  status: AgentStatus;
  /** One-line claim in plain language. */
  claim: string;
  confidence: number;
  /** Named quantities the agent actually measured. */
  metrics: AgentMetric[];
  regions: Region[];
  /** Evidence masks, in draw order. The first is the agent's primary finding. */
  masks: NamedMask[];
  /** Comparable finding, when this agent produced one. */
  signal?: AgentSignal;
  durationMs: number;
  note?: string;
}

/**
 * A finding expressed in a vocabulary shared across specialists.
 *
 * Two agents that looked at different inputs can only be cross-checked if they
 * are saying something about the same thing. This is that common ground: the
 * evidence engine groups agents by `key`, then asks whether they agree on
 * polarity and on location.
 */
export interface AgentSignal {
  key: "surface_change" | "structure_present" | "water_present" | "vegetation_present";
  detected: boolean;
  /** Signed, normalised strength of the finding. */
  magnitude: number;
  /** Human phrasing of what was or was not observed. */
  statement: string;
}

/** A named, colour-coded evidence mask an agent produced. */
export interface NamedMask {
  id: string;
  label: string;
  color: string;
  mask: MaskRLE;
  /** Which raster the mask is registered against. */
  sceneKey: string;
}

export interface AgentMetric {
  label: string;
  value: string;
  /** Raw numeric value when the metric is numeric, for downstream logic. */
  raw?: number;
}

export type Intent =
  | "scene_description"
  | "grounding"
  | "change_analysis"
  | "quantitative_change_analysis"
  | "cross_modal_analysis";

export interface QueryInterpretation {
  intent: Intent;
  /** Normalised restatement of what the user asked for. */
  normalized: string;
  /** Target concept the user cares about, when the query names one. */
  target: string | null;
  requiresBitemporal: boolean;
  requiresSar: boolean;
  wantsQuantity: boolean;
  confidence: number;
  /** Terms in the query that drove the classification. Observable, not hidden reasoning. */
  signals: string[];
}

export interface WorkflowPlan {
  intent: Intent;
  tools: AgentId[];
  rationale: string;
}

export type ValidationLevel = "pass" | "warn" | "fail";

export interface ValidationCheck {
  id: string;
  label: string;
  level: ValidationLevel;
  detail: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: ValidationCheck[];
}

export type EvidenceStatus = "consistent" | "partial" | "insufficient";

export interface EvidenceItem {
  id: string;
  label: string;
  source: string;
  detail: string;
  confidence: number;
  strength: "Strong" | "Moderate" | "Weak";
}

export interface EvidenceAssessment {
  status: EvidenceStatus;
  overallConfidence: number;
  /** True when two independent agents disagree on whether something is there. */
  contradiction: boolean;
  items: EvidenceItem[];
  /** Plain-language verdict shown at the bottom of the WHY panel. */
  verdict: string;
  recommendation?: string;
  /** Spatial agreement between independent masks, when two or more were produced. */
  spatialAgreement?: {
    iou: number;
    pairs: { a: string; b: string; iou: number }[];
  };
}

export type TraceStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface TraceStep {
  id: string;
  title: string;
  detail: string;
  /** Which layer performed this step -- shown as a small caption in the trace. */
  layer: string;
  provider?: string;
  status: TraceStepStatus;
  durationMs: number;
}

/** What the map viewer draws. Derived entirely from structured agent output. */
export interface Visualization {
  /** Primary raster to display. */
  primaryLayer: string;
  availableLayers: VizLayer[];
  /** Region the SHOW ME interaction focuses on. */
  focus: [number, number, number, number] | null;
  overlays: VizOverlay[];
  /**
   * Overlays SHOW ME reveals. Overlays start hidden so the imagery leads; this
   * is the subset that carries the evidence behind the headline.
   */
  primaryOverlayIds: string[];
}

export interface VizLayer {
  id: string;
  label: string;
  kind: "optical" | "sar" | "difference";
  sceneKey: string;
  caption: string;
}

export interface VizOverlay {
  id: string;
  label: string;
  color: string;
  mask?: MaskRLE;
  regions: Region[];
  /** Which agent produced this overlay -- powers the evidence/overlay linkage. */
  sourceAgent: AgentId;
  defaultVisible: boolean;
}

export interface AnalysisRequest {
  query: string;
  images: ImageAsset[];
  options?: ExpertOptions;
}

export interface ExpertOptions {
  /** Explicit specialist selection. When absent the router decides. */
  enabledAgents?: AgentId[];
  fusion?: "automatic" | "manual";
  crossModelAgreement?: boolean;
  spatialAgreement?: boolean;
  confidenceScoring?: boolean;
  confidenceThreshold?: number;
  spatialToleranceM?: number;
  /** NDWI / built-up decision thresholds, exposed to expert users. */
  waterThreshold?: number;
  builtUpThreshold?: number;
}

export interface AnalysisResult {
  id: string;
  createdAt: string;
  query: string;
  interpretation: QueryInterpretation;
  plan: WorkflowPlan;
  validation: ValidationReport;
  agents: AgentResult[];
  evidence: EvidenceAssessment;
  /** The headline the user reads first. */
  headline: string;
  /** Supporting sentence under the headline. */
  summary: string;
  icon: string;
  confidence: number;
  visualization: Visualization;
  trace: TraceStep[];
  languageProvider: string;
  images: ImageAsset[];
  totalDurationMs: number;
  /** Narrative summary from the language layer, used by the report. */
  reportSummary: string;
  /** Present when the analysis could not reach a usable conclusion. */
  failure?: AnalysisFailure;
}

export interface AnalysisFailure {
  code:
    | "no_images"
    | "incompatible_inputs"
    | "missing_modality"
    | "insufficient_evidence"
    | "no_change_detected";
  title: string;
  message: string;
  nextSteps: string[];
}
