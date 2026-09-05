/**
 * Confidence model.
 *
 * Confidence in SatQuery is derived, never decorative. Every number here comes
 * from a measured property of the imagery -- how separable two populations are,
 * how stable a detection is under morphological cleanup, how well two
 * independent masks overlap. A weak signal must produce a low number, because
 * the low-confidence path is a feature of the product, not an error state.
 */

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Map a normalised distance between two class means (in pooled standard
 * deviations) onto a confidence. Saturating: beyond ~3 sigma extra separation
 * stops buying meaningful certainty.
 */
export function fromSeparability(d: number): number {
  return clamp01(1 - Math.exp(-Math.max(0, d) / 1.45));
}

/**
 * Otsu between-class variance ratio is already in [0,1] but is optimistic at
 * the low end, so it gets a gentle gamma before use.
 */
export function fromOtsu(sep: number): number {
  return clamp01(Math.pow(clamp01(sep), 0.65));
}

/** Overlap agreement: IoU is harsh for thin features, so it is eased upward. */
export function fromOverlap(value: number): number {
  return clamp01(Math.pow(clamp01(value), 0.55));
}

export interface ConfidenceFactor {
  value: number;
  weight: number;
}

/**
 * Weighted geometric mean. Chosen over an arithmetic mean deliberately: one
 * genuinely weak factor should drag the result down rather than be averaged
 * away by strong ones.
 */
export function combine(factors: ConfidenceFactor[]): number {
  const usable = factors.filter((f) => f.weight > 0);
  if (!usable.length) return 0;
  const totalWeight = usable.reduce((s, f) => s + f.weight, 0);
  let logSum = 0;
  for (const f of usable) {
    logSum += f.weight * Math.log(Math.max(0.02, clamp01(f.value)));
  }
  return clamp01(Math.exp(logSum / totalWeight));
}

/** Presentation banding used across the UI. */
export function strengthOf(confidence: number): "Strong" | "Moderate" | "Weak" {
  if (confidence >= 0.8) return "Strong";
  if (confidence >= 0.62) return "Moderate";
  return "Weak";
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}
