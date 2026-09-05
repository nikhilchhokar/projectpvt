/**
 * Tool registry.
 *
 * The single place that knows which specialists exist. The router asks it what
 * can run against the current inputs; the engine asks it to fetch one by id.
 * Adding a real model means registering it here -- nothing else changes.
 */

import { changeAgent } from "./agents/change";
import type { AgentContext, Specialist } from "./agents/context";
import { groundingAgent } from "./agents/grounding";
import { sarAgent } from "./agents/sar";
import { visionAgent } from "./agents/vision";
import type { AgentId } from "./types";

const SPECIALISTS: Specialist[] = [visionAgent, groundingAgent, changeAgent, sarAgent];

const BY_ID = new Map<AgentId, Specialist>(SPECIALISTS.map((s) => [s.id, s]));

export function getSpecialist(id: AgentId): Specialist | undefined {
  return BY_ID.get(id);
}

export function allSpecialists(): Specialist[] {
  return [...SPECIALISTS];
}

/** Which specialists the supplied inputs actually permit. */
export function availableSpecialists(ctx: AgentContext): AgentId[] {
  return SPECIALISTS.filter((s) => s.canRun(ctx)).map((s) => s.id);
}

/** Catalogue for Expert Mode, so the UI never hardcodes the specialist list. */
export function specialistCatalogue(): {
  id: AgentId;
  displayName: string;
  question: string;
}[] {
  return SPECIALISTS.map((s) => ({
    id: s.id,
    displayName: s.displayName,
    question: s.question,
  }));
}
