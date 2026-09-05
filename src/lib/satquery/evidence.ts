/**
 * Evidence engine.
 *
 * The specialists are deliberately kept ignorant of each other, so their
 * outputs are independent observations. This is where those observations are
 * confronted with one another and asked two questions:
 *
 *   1. Do they agree that something happened?      (polarity)
 *   2. Do they agree about where?                  (spatial overlap)
 *
 * A confident answer requires both. An optical sensor and a radar sensor
 * failing to corroborate each other is the single most useful thing this system
 * can tell a user, because it is exactly the case where a single-model pipeline
 * would return a wrong answer with a high score.
 */

import { clamp01, combine, strengthOf } from "./confidence";
import { containment, countMask, decodeRLE, iou, type Mask } from "./raster";
import type {
  AgentResult,
  EvidenceAssessment,
  EvidenceItem,
  EvidenceStatus,
  ExpertOptions,
  NamedMask,
} from "./types";

/**
 * Saturation scales for the two agreement statistics. These are soft: agreement
 * approaches 1 but never reaches it, because two independent sensors are never
 * literally in perfect accord and a displayed "100%" would be a lie about how
 * much this system can know.
 */
const OVERLAP_SCALE = 0.35;
const COVERAGE_SCALE = 0.25;

const saturate = (value: number, scale: number) => 1 - Math.exp(-Math.max(0, value) / scale);
/** Agreement score assigned when two agents flatly contradict each other. */
const CONTRADICTION_SCORE = 0.3;

/**
 * The mask that carries an agent's headline claim. Agents publish several --
 * vision alone publishes three -- and comparing the wrong pair would produce a
 * meaningless agreement number.
 */
function primaryMaskFor(agent: AgentResult): NamedMask | undefined {
  const key = agent.signal?.key;
  const pick = (re: RegExp) => agent.masks.find((m) => re.test(m.id));
  switch (key) {
    case "surface_change":
      return pick(/gained|rise/) ?? agent.masks[0];
    case "structure_present":
      return pick(/built|structural/) ?? agent.masks[0];
    case "water_present":
      return pick(/water|specular/) ?? agent.masks[0];
    case "vegetation_present":
      return pick(/vegetation/) ?? agent.masks[0];
    default:
      return agent.masks[0];
  }
}

const SIGNAL_LABEL: Record<string, string> = {
  surface_change: "surface change",
  structure_present: "built structure",
  water_present: "surface water",
  vegetation_present: "vegetation",
};

interface PairAssessment {
  a: string;
  b: string;
  iou: number;
  overlap: number;
  coverage: number;
  contradiction: boolean;
  score: number;
  detail: string;
}

function assessPair(
  left: AgentResult,
  right: AgentResult,
  checkSpatial: boolean,
): PairAssessment | null {
  const leftSignal = left.signal;
  const rightSignal = right.signal;
  if (!leftSignal || !rightSignal) return null;

  const label = SIGNAL_LABEL[leftSignal.key] ?? "the observed phenomenon";

  // Polarity first: if one witness says yes and the other says no, no amount of
  // spatial overlap rescues the conclusion.
  if (leftSignal.detected !== rightSignal.detected) {
    const yes = leftSignal.detected ? left : right;
    const no = leftSignal.detected ? right : left;
    return {
      a: left.displayName,
      b: right.displayName,
      iou: 0,
      overlap: 0,
      coverage: 0,
      contradiction: true,
      score: CONTRADICTION_SCORE,
      detail: `${yes.displayName} reports ${label}; ${no.displayName} does not corroborate it`,
    };
  }

  // Both agree nothing happened. That is agreement, and a useful one.
  if (!leftSignal.detected && !rightSignal.detected) {
    return {
      a: left.displayName,
      b: right.displayName,
      iou: 1,
      overlap: 1,
      coverage: 1,
      contradiction: false,
      score: 0.85,
      detail: `${left.displayName} and ${right.displayName} both find no ${label}`,
    };
  }

  const maskA = primaryMaskFor(left);
  const maskB = primaryMaskFor(right);
  if (!checkSpatial || !maskA || !maskB) {
    return {
      a: left.displayName,
      b: right.displayName,
      iou: 0,
      overlap: 0,
      coverage: 0,
      contradiction: false,
      score: 0.7,
      detail: `${left.displayName} and ${right.displayName} both report ${label}`,
    };
  }

  const decodedA: Mask = decodeRLE(maskA.mask);
  const decodedB: Mask = decodeRLE(maskB.mask);
  const countA = countMask(decodedA);
  const countB = countMask(decodedB);
  if (!countA || !countB) return null;

  /**
   * Two statistics, because IoU alone is misleading across sensors. Radar fires
   * only on the densest new construction, so its footprint is legitimately
   * smaller than the optical one -- IoU punishes that, containment does not.
   *
   *   overlap  -- is the smaller detection inside the larger one? (same place?)
   *   coverage -- how much of the larger claim did the second sensor confirm?
   */
  const smallerFirst = countA <= countB;
  const overlap = smallerFirst
    ? containment(decodedA, decodedB)
    : containment(decodedB, decodedA);
  const coverage = Math.min(countA, countB) / Math.max(countA, countB);
  const overlapScore = saturate(overlap, OVERLAP_SCALE);
  const coverageScore = saturate(coverage, COVERAGE_SCALE);
  const score = clamp01(Math.sqrt(overlapScore * coverageScore));

  return {
    a: left.displayName,
    b: right.displayName,
    iou: iou(decodedA, decodedB),
    overlap,
    coverage,
    contradiction: false,
    score,
    detail: `${Math.round(overlap * 100)}% of the smaller detection falls inside the larger; ${Math.round(coverage * 100)}% of the claim is corroborated`,
  };
}

export function assessEvidence(
  agents: AgentResult[],
  items: EvidenceItem[],
  options: ExpertOptions = {},
): EvidenceAssessment {
  const active = agents.filter((a) => a.status === "ok");
  const checkAgreement = options.crossModelAgreement !== false;
  const checkSpatial = options.spatialAgreement !== false;
  const scoreConfidence = options.confidenceScoring !== false;

  // Group independent observations of the same phenomenon.
  const groups = new Map<string, AgentResult[]>();
  for (const agent of active) {
    if (!agent.signal) continue;
    const list = groups.get(agent.signal.key) ?? [];
    list.push(agent);
    groups.set(agent.signal.key, list);
  }

  const pairs: PairAssessment[] = [];
  if (checkAgreement) {
    for (const members of groups.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const pair = assessPair(members[i], members[j], checkSpatial);
          if (pair) pairs.push(pair);
        }
      }
    }
  }

  const evidenceItems = [...items];
  const contradiction = pairs.some((p) => p.contradiction);

  let agreementScore: number | null = null;
  if (pairs.length) {
    agreementScore = pairs.reduce((sum, p) => sum + p.score, 0) / pairs.length;
    evidenceItems.push({
      id: "evidence-agreement",
      label: checkSpatial ? "Spatial agreement" : "Cross-model agreement",
      source: checkSpatial
        ? "Mask containment and corroborated coverage between independent detections"
        : "Polarity comparison between independent detections",
      detail: pairs.map((p) => p.detail).join(". "),
      confidence: agreementScore,
      strength: strengthOf(agreementScore),
    });
  }

  const confidenceFactors = active.map((a) => ({ value: a.confidence, weight: 1 }));
  if (agreementScore !== null) {
    confidenceFactors.push({ value: agreementScore, weight: 1.3 });
  }

  /**
   * Weighted geometric mean by default, so a single weak witness cannot be
   * averaged away. Turning confidence scoring off in Expert Mode falls back to
   * a plain mean, which is the naive aggregation this system exists to improve on.
   */
  const overallConfidence = scoreConfidence
    ? combine(confidenceFactors)
    : confidenceFactors.reduce((s, f) => s + f.value, 0) / Math.max(1, confidenceFactors.length);

  const threshold = options.confidenceThreshold ?? 0.6;

  let status: EvidenceStatus;
  if (contradiction) {
    status = overallConfidence >= 0.5 ? "partial" : "insufficient";
  } else if (overallConfidence >= 0.78 && (agreementScore ?? 1) >= 0.6) {
    status = "consistent";
  } else if (overallConfidence >= threshold) {
    status = "partial";
  } else {
    status = "insufficient";
  }

  const verdict = buildVerdict(status, contradiction, pairs, active.length);
  const recommendation = buildRecommendation(status, contradiction, overallConfidence, threshold);

  const spatialAgreement =
    checkSpatial && pairs.length
      ? {
          iou: pairs.reduce((sum, p) => sum + p.iou, 0) / pairs.length,
          pairs: pairs.map((p) => ({ a: p.a, b: p.b, iou: p.iou })),
        }
      : undefined;

  return {
    status,
    contradiction,
    overallConfidence,
    items: evidenceItems,
    verdict,
    recommendation,
    spatialAgreement,
  };
}

function buildVerdict(
  status: EvidenceStatus,
  contradiction: boolean,
  pairs: PairAssessment[],
  agentCount: number,
): string {
  if (contradiction) {
    const conflict = pairs.find((p) => p.contradiction);
    return conflict
      ? `${conflict.detail}. Independent sensors disagree, so this conclusion is not safe to rely on.`
      : "Independent analyses disagree about whether the phenomenon is present.";
  }

  /**
   * Two specialists running is not the same as two specialists agreeing. When
   * they measured different quantities there is no pair to compare, and saying
   * otherwise would overstate what was actually checked.
   */
  const uncorroborated =
    agentCount > 1
      ? `${agentCount} analyses ran, but they measure different quantities, so none independently corroborates the headline.`
      : "Only one analysis path could run, so this result has not been independently corroborated.";

  switch (status) {
    case "consistent":
      return pairs.length
        ? `Evidence is consistent across ${agentCount} independent analysis paths, and the detections overlap spatially.`
        : `The measurement passed its own internal checks. ${uncorroborated}`;
    case "partial":
      return pairs.length
        ? "The analyses point the same way, but agreement is not strong enough to treat the result as settled."
        : uncorroborated;
    default:
      return "The available signals were too weak to support a reliable conclusion.";
  }
}

function buildRecommendation(
  status: EvidenceStatus,
  contradiction: boolean,
  confidence: number,
  threshold: number,
): string | undefined {
  if (contradiction) {
    return "Review the SHOW ME overlays: a strong optical signal without a radar response usually means surface reflectance changed rather than the surface itself.";
  }
  if (status === "insufficient") {
    return "Add another modality, or widen the temporal window, before drawing a conclusion from this.";
  }
  if (status === "partial") {
    return confidence < threshold
      ? `Confidence is below the configured threshold of ${Math.round(threshold * 100)}%. Result should be reviewed before use.`
      : "Result should be reviewed before use.";
  }
  return undefined;
}
