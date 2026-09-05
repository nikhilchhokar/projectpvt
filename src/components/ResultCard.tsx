"use client";

/**
 * The answer.
 *
 * This is the component the product is judged on. It states one conclusion,
 * qualifies it with a confidence the engine measured, and offers exactly two
 * next moves: WHY (evidence) and SHOW ME (place). Everything else about the
 * analysis is reachable, but nothing else competes for attention here.
 */

import type { AnalysisResult } from "@/lib/satquery/types";
import { Button, ConfidenceMeter, SectionLabel, StatusPill } from "./primitives";

interface ResultCardProps {
  result: AnalysisResult;
  onWhy: () => void;
  onShowMe: () => void;
  whyActive: boolean;
  showMeActive: boolean;
}

export default function ResultCard({
  result,
  onWhy,
  onShowMe,
  whyActive,
  showMeActive,
}: ResultCardProps) {
  const evidenceCount = result.evidence.items.length;
  const hasPlace = Boolean(result.visualization.focus);

  return (
    <div className="border-ink-700 bg-ink-850 animate-fade-up rounded-xl border p-5">
      <div className="flex items-start justify-between gap-4">
        <SectionLabel>SatQuery result</SectionLabel>
        <span className="text-mist-500 tabular font-mono text-[11px]">
          {result.totalDurationMs} ms
        </span>
      </div>

      <div className="mt-3 flex items-start gap-3">
        <span className="text-2xl leading-none select-none" aria-hidden>
          {result.icon}
        </span>
        <h2 className="text-mist-100 text-xl leading-snug font-medium tracking-[-0.01em] sm:text-2xl">
          {result.headline}
        </h2>
      </div>

      <p className="text-mist-400 mt-2.5 text-sm leading-relaxed">{result.summary}</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>Confidence</SectionLabel>
          </div>
          <ConfidenceMeter value={result.confidence} status={result.evidence.status} />
        </div>
        <div className="sm:pb-0.5">
          <StatusPill status={result.evidence.status} />
        </div>
      </div>

      {result.evidence.recommendation && (
        <p className="border-warn/30 bg-warn/8 text-warn/90 mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed">
          {result.evidence.recommendation}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant={whyActive ? "primary" : "secondary"}
          onClick={onWhy}
          aria-pressed={whyActive}
        >
          <span aria-hidden>🔎</span> Why?
          <span className="text-mist-500 ml-0.5 text-xs font-normal">{evidenceCount}</span>
        </Button>
        <Button
          variant={showMeActive ? "primary" : "secondary"}
          onClick={onShowMe}
          disabled={!hasPlace}
          aria-pressed={showMeActive}
          title={
            hasPlace
              ? "Zoom to the evidence behind this answer"
              : "This answer is not tied to a specific region"
          }
        >
          <span aria-hidden>📍</span> Show me
        </Button>
      </div>
    </div>
  );
}
