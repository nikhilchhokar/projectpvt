"use client";

/**
 * Workspace chrome: identity bar, the question field, and history.
 *
 * The question field is the product's front door, so it stays visually
 * prominent whether or not an answer is on screen. Everything else in this file
 * is intentionally quiet.
 */

import Link from "next/link";
import { useState } from "react";
import type { AnalysisResult } from "@/lib/satquery/types";
import { Button, SectionLabel, SegmentedControl, STATUS_META } from "./primitives";

// --- identity ---------------------------------------------------------------

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="border-ink-600 from-ink-700 to-ink-850 flex size-6 items-center justify-center rounded-md border bg-gradient-to-br">
        <span className="bg-accent size-1.5 rounded-full" />
      </span>
      <span
        className={`text-mist-100 font-semibold tracking-[-0.02em] ${compact ? "text-sm" : "text-base"}`}
      >
        SatQuery
      </span>
    </span>
  );
}

export function TopBar({
  mode,
  onModeChange,
  scenarioTitle,
  languageLayer,
  onReport,
  canReport,
}: {
  mode: "simple" | "expert";
  onModeChange: (mode: "simple" | "expert") => void;
  scenarioTitle?: string;
  languageLayer?: string;
  onReport: () => void;
  canReport: boolean;
}) {
  return (
    <header className="border-ink-700 bg-ink-900/80 flex items-center justify-between gap-4 border-b px-4 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="shrink-0">
          <Wordmark compact />
        </Link>
        {scenarioTitle && (
          <>
            <span className="text-ink-600" aria-hidden>
              /
            </span>
            <span className="text-mist-400 truncate text-sm">{scenarioTitle}</span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {languageLayer && (
          <span
            className="text-mist-500 hidden items-center gap-1.5 text-[11px] lg:flex"
            title="Active local language layer"
          >
            <span className="bg-good size-1.5 rounded-full" />
            {languageLayer}
          </span>
        )}

        {canReport && (
          <Button variant="ghost" onClick={onReport} className="px-2.5 py-1.5 text-xs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Report
          </Button>
        )}

        <SegmentedControl
          segments={[
            {
              id: "simple" as const,
              label: "Simple",
              icon: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              ),
            },
            {
              id: "expert" as const,
              label: "Expert",
              icon: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              ),
            },
          ]}
          value={mode}
          onChange={(m) => onModeChange(m)}
        />
      </div>
    </header>
  );
}

// --- question ---------------------------------------------------------------

export function QueryBar({
  value,
  onChange,
  onSubmit,
  busy,
  suggestions,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  suggestions: string[];
}) {
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !busy) onSubmit();
        }}
        className="border-ink-600 bg-ink-850 focus-within:border-accent/40 flex items-center gap-2 rounded-xl border p-1.5 pl-3.5 transition-colors"
      >
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Tell SatQuery what you want to know…"
          className="text-mist-100 placeholder:text-mist-500 min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          aria-label="Ask a question about this imagery"
        />
        <Button variant="primary" type="submit" disabled={!value.trim() || busy}>
          {busy ? "Analysing…" : "Ask"}
        </Button>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => onChange(suggestion)}
              className="border-ink-700 text-mist-400 hover:text-accent hover:border-accent/30 hover:bg-accent/5 rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- history ----------------------------------------------------------------

export function HistoryList({
  entries,
  activeId,
  onSelect,
}: {
  entries: AnalysisResult[];
  activeId?: string;
  onSelect: (result: AnalysisResult) => void;
}) {
  if (!entries.length) return null;

  return (
    <div>
      <SectionLabel>History</SectionLabel>
      <div className="mt-2 flex flex-col gap-1">
        {entries.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onSelect(entry)}
            className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
              entry.id === activeId
                ? "border-accent/30 bg-accent/5"
                : "border-transparent hover:border-ink-700 hover:bg-ink-800/60"
            }`}
          >
            <p className="text-mist-200 line-clamp-2 text-[11px] leading-snug font-medium">
              {entry.headline}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${STATUS_META[entry.evidence.status].dot}`} />
              <span className="text-mist-500 tabular font-mono text-[11px]">
                {Math.round(entry.confidence * 100)}%
              </span>
              <span className="text-mist-500 truncate text-[11px]">
                {entry.interpretation.intent.replace(/_/g, " ")}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- upload -----------------------------------------------------------------

/**
 * Upload affordance.
 *
 * The prototype analyses seeded scenes rather than arbitrary uploads, and says
 * so plainly instead of presenting a control that would silently do nothing.
 * Pretending to accept a file and then ignoring it would be the one dishonest
 * moment in the product.
 */
export function UploadHint({ onLoadDemo }: { onLoadDemo: () => void }) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      className={`rounded-lg border border-dashed p-3 text-center transition-colors ${
        dragging ? "border-accent bg-accent/5" : "border-ink-600"
      }`}
    >
      <p className="text-mist-400 text-[11px] leading-relaxed">
        This prototype analyses seeded GeoTIFF scenes. Ingest for arbitrary uploads is the
        next piece of work.
      </p>
      <button
        onClick={onLoadDemo}
        className="text-accent hover:text-mist-100 mt-1.5 text-[11px] font-medium transition-colors"
      >
        Load another scene
      </button>
    </div>
  );
}
