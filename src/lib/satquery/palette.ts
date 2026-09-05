/**
 * Evidence colours.
 *
 * Shared by the engine (which stamps them onto masks) and the viewer (which
 * draws them), so an overlay's colour in the map always matches the swatch
 * beside its claim in the WHY panel. That correspondence is what lets someone
 * connect a sentence to a place without being told how.
 */
export const EVIDENCE_COLORS = {
  water: "#22D3EE",
  vegetation: "#4ADE80",
  builtUp: "#A78BFA",
  bare: "#FBBF24",
  gained: "#FB923C",
  lost: "#F87171",
  sar: "#F472B6",
  agreement: "#34D399",
} as const;

export type EvidenceColorKey = keyof typeof EVIDENCE_COLORS;
