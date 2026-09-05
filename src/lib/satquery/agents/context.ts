/**
 * The context every specialist receives.
 *
 * Agents never reach for global state and never talk to each other. They get
 * resolved inputs plus the interpreted query, and return a uniform result. That
 * constraint is what allows the router to compose them freely and the evidence
 * engine to treat their outputs as genuinely independent observations.
 */

import type { LandCoverThresholds } from "../landcover";
import { generateScene, type Scene } from "../scene";
import type {
  AgentId,
  AgentResult,
  ExpertOptions,
  ImageAsset,
  QueryInterpretation,
} from "../types";

export interface AgentContext {
  images: ImageAsset[];
  interpretation: QueryInterpretation;
  options: ExpertOptions;
  /**
   * Threshold set shared across epochs of a bi-temporal pair. Present only when
   * two comparable optical images were supplied.
   */
  harmonised?: LandCoverThresholds;
}

export interface Specialist {
  id: AgentId;
  displayName: string;
  /** Short description of what this specialist answers, shown in Expert Mode. */
  question: string;
  /** Whether the supplied inputs let this specialist run at all. */
  canRun(ctx: AgentContext): boolean;
  run(ctx: AgentContext): AgentResult;
}

// --- input resolution -------------------------------------------------------

export function opticalImages(ctx: AgentContext): ImageAsset[] {
  return ctx.images.filter((i) => i.modality === "optical");
}

export function sarImages(ctx: AgentContext): ImageAsset[] {
  return ctx.images.filter((i) => i.modality === "sar");
}

function byRole(images: ImageAsset[], role: ImageAsset["role"]): ImageAsset | undefined {
  return images.find((i) => i.role === role);
}

/** The single image a non-temporal question should be answered from. */
export function primaryOptical(ctx: AgentContext): ImageAsset | undefined {
  const optical = opticalImages(ctx);
  return byRole(optical, "after") ?? byRole(optical, "single") ?? optical[0];
}

export function primarySar(ctx: AgentContext): ImageAsset | undefined {
  const sar = sarImages(ctx);
  return byRole(sar, "after") ?? byRole(sar, "single") ?? sar[0];
}

export interface TemporalPair {
  before: ImageAsset;
  after: ImageAsset;
}

function pairFrom(images: ImageAsset[]): TemporalPair | null {
  const before = byRole(images, "before");
  const after = byRole(images, "after");
  if (before && after) return { before, after };
  if (images.length >= 2) {
    // Fall back to acquisition order when roles were not assigned.
    const sorted = [...images].sort((a, b) => a.acquired.localeCompare(b.acquired));
    return { before: sorted[0], after: sorted[sorted.length - 1] };
  }
  return null;
}

export function opticalPair(ctx: AgentContext): TemporalPair | null {
  return pairFrom(opticalImages(ctx));
}

export function sarPair(ctx: AgentContext): TemporalPair | null {
  return pairFrom(sarImages(ctx));
}

export function sceneOf(image: ImageAsset): Scene {
  return generateScene(image.sceneKey);
}

// --- result helpers ---------------------------------------------------------

export function skipped(
  id: AgentId,
  displayName: string,
  method: string,
  note: string,
): AgentResult {
  return {
    agent: id,
    displayName,
    method,
    status: "skipped",
    claim: note,
    confidence: 0,
    metrics: [],
    regions: [],
    masks: [],
    durationMs: 0,
    note,
  };
}

/** Wall-clock timing so the execution trace reports real durations. */
export function timed<T>(fn: () => T): { value: T; durationMs: number } {
  const started = performance.now();
  const value = fn();
  return { value, durationMs: Math.round(performance.now() - started) };
}
