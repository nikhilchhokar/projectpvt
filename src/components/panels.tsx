"use client";

/**
 * WHY and the execution trace.
 *
 * WHY exists to answer "why should I believe this?", so it shows what each
 * specialist measured and how well independent paths agreed -- observable
 * facts only. The trace answers a different question, "how was this produced?",
 * and is deliberately quieter: it supports the architecture claim without
 * competing with the evidence for attention.
 */

import { useState } from "react";
import type { AgentId, AgentResult, AnalysisResult, TraceStep } from "@/lib/satquery/types";
import { ConfidenceMeter, MetricRow, SectionLabel } from "./primitives";

// --- WHY --------------------------------------------------------------------

const STRENGTH_TONE: Record<string, { text: string; dot: string }> = {
  Strong: { text: "text-good", dot: "bg-good" },
  Moderate: { text: "text-warn", dot: "bg-warn" },
  Weak: { text: "text-bad", dot: "bg-bad" },
};

function agentIdFromEvidence(id: string): AgentId | null {
  const match = id.match(/^evidence-(vision|grounding|change|sar|caption)$/);
  return match ? (match[1] as AgentId) : null;
}

export function EvidencePanel({
  result,
  onFocusAgent,
  activeAgent,
}: {
  result: AnalysisResult;
  onFocusAgent: (agent: AgentId) => void;
  activeAgent: AgentId | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="animate-slide-in flex h-full flex-col">
      <div className="border-ink-700 border-b px-4 py-3">
        <SectionLabel>Why this conclusion?</SectionLabel>
        <p className="text-mist-400 mt-1.5 text-xs leading-relaxed">
          Each row is an independent measurement. Select one to see what it measured, or to
          highlight it on the map.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {result.evidence.items.map((item) => {
          const agentId = agentIdFromEvidence(item.id);
          const agent: AgentResult | undefined = agentId
            ? result.agents.find((a) => a.agent === agentId)
            : undefined;
          const isOpen = expanded === item.id;
          const isActive = agentId !== null && agentId === activeAgent;
          const strength = STRENGTH_TONE[item.strength] ?? { text: "text-mist-400", dot: "bg-mist-500" };

          return (
            <div
              key={item.id}
              className={`border-ink-700/70 border-b transition-colors ${
                isActive ? "bg-accent/5" : ""
              }`}
            >
              <button
                onClick={() => {
                  setExpanded(isOpen ? null : item.id);
                  if (agentId) onFocusAgent(agentId);
                }}
                className="hover:bg-ink-800/60 w-full px-4 py-3 text-left transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  {/* Colored strength dot */}
                  <span className={`size-2 shrink-0 rounded-full ${strength.dot}`} />
                  <div className="flex flex-1 items-baseline justify-between gap-3">
                    <span className="text-mist-100 text-sm font-medium">{item.label}</span>
                    <span className={`text-[11px] font-medium ${strength.text}`}>
                      {item.strength}
                    </span>
                  </div>
                </div>

                <p className="text-mist-400 mt-1 pl-[18px] text-xs leading-relaxed">{item.detail}</p>

                <div className="mt-2.5 pl-[18px]">
                  <ConfidenceMeter
                    value={item.confidence}
                    status={
                      item.confidence >= 0.8
                        ? "consistent"
                        : item.confidence >= 0.62
                          ? "partial"
                          : "insufficient"
                    }
                    size="sm"
                  />
                </div>
              </button>

              {isOpen && (
                <div className="animate-fade-in bg-ink-900/60 px-4 pt-1 pb-3">
                  <p className="text-mist-500 mb-2 pl-[18px] text-[11px] leading-relaxed italic">
                    {item.source}
                  </p>
                  {agent && (
                    <div className="divide-ink-700/60 divide-y pl-[18px]">
                      {agent.metrics.map((metric) => (
                        <MetricRow
                          key={metric.label}
                          label={metric.label}
                          value={metric.value}
                        />
                      ))}
                    </div>
                  )}
                  {agent?.note && (
                    <p className="text-mist-400 border-accent/30 mt-2 border-l-2 pl-2.5 text-[11px] leading-relaxed">
                      {agent.note}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-ink-700 bg-ink-900/70 border-t px-4 py-3.5">
        <SectionLabel>Final assessment</SectionLabel>
        <p className="text-mist-200 mt-2 text-xs leading-relaxed">{result.evidence.verdict}</p>
        {result.evidence.spatialAgreement && (
          <p
            className="text-mist-500 mt-2 text-[11px]"
            title={`Intersection over union: ${result.evidence.spatialAgreement.iou.toFixed(3)}`}
          >
            Detections from independent analyses overlap by{" "}
            <span className="tabular font-mono">
              {Math.round(result.evidence.spatialAgreement.iou * 100)}%
            </span>{" "}
            across {result.evidence.spatialAgreement.pairs.length} comparison
            {result.evidence.spatialAgreement.pairs.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </div>
  );
}

// --- execution trace --------------------------------------------------------

const STEP_MARK: Record<TraceStep["status"], { glyph: string; tone: string }> = {
  complete: { glyph: "✓", tone: "text-good border-good/40 bg-good/10" },
  failed: { glyph: "✕", tone: "text-bad border-bad/40 bg-bad/10" },
  skipped: { glyph: "–", tone: "text-mist-500 border-ink-600 bg-ink-800" },
  running: { glyph: "•", tone: "text-accent border-accent/40 bg-accent/10" },
  pending: { glyph: "", tone: "text-mist-500 border-ink-600 bg-ink-800" },
};

export function TracePanel({ result }: { result: AnalysisResult }) {
  return (
    <div className="animate-slide-in flex h-full flex-col">
      <div className="border-ink-700 border-b px-4 py-3">
        <SectionLabel>Execution trace</SectionLabel>
        <p className="text-mist-400 mt-1.5 text-xs leading-relaxed">
          What ran, in order, and how long each stage took.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ol className="relative">
          {result.trace.map((step, index) => {
            const mark = STEP_MARK[step.status];
            const last = index === result.trace.length - 1;
            const isLatest = index === result.trace.length - 1 && step.status === "complete";
            return (
              <li key={step.id} className="relative flex gap-3 pb-4">
                {!last && (
                  <span className="bg-ink-700 absolute top-6 bottom-0 left-[11px] w-px" />
                )}
                <span
                  className={`mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full border text-[11px] ${mark.tone} ${
                    isLatest ? "animate-pulse-ring" : ""
                  }`}
                >
                  {mark.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-mist-100 text-sm font-medium">{step.title}</span>
                    <span className="text-mist-500 tabular shrink-0 font-mono text-[11px]">
                      {step.durationMs < 1 ? "<1" : step.durationMs} ms
                    </span>
                  </div>
                  <p className="text-mist-400 mt-0.5 text-xs leading-relaxed">{step.detail}</p>
                  <p className="text-mist-500 mt-1 text-[11px] tracking-wide">
                    {step.layer}
                    {step.provider && step.provider !== step.title && (
                      <span className="text-mist-400"> · {step.provider}</span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="border-ink-700 bg-ink-900/70 border-t px-4 py-3">
        <div className="divide-ink-700/60 divide-y">
          <MetricRow label="Intent" value={result.interpretation.intent.replace(/_/g, " ")} mono={false} />
          <MetricRow
            label="Intent confidence"
            value={`${Math.round(result.interpretation.confidence * 100)}%`}
          />
          <MetricRow
            label="Query signals"
            value={result.interpretation.signals.join(", ") || "—"}
            mono={false}
          />
          <MetricRow label="Language layer" value={result.languageProvider} mono={false} />
          <MetricRow label="Total" value={`${result.totalDurationMs} ms`} />
        </div>
      </div>
    </div>
  );
}
