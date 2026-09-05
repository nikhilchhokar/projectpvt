"use client";

/**
 * Analysis report.
 *
 * Everything an analyst would need to defend or reproduce the result: what was
 * asked, what it was asked of, how the request was classified, which
 * specialists ran, what each measured, and how they agreed. It prints, because
 * the person who needs it is often not the person at the keyboard.
 */

import { useEffect } from "react";
import { rasterUrl } from "@/lib/satquery/client";
import type { AnalysisResult } from "@/lib/satquery/types";
import { Button, SectionLabel, StatusPill } from "./primitives";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-ink-700 border-t py-3">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-mist-200 mt-1.5 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export default function ReportModal({
  result,
  onClose,
}: {
  result: AnalysisResult;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const primaryImage = result.images.find((i) => i.modality === "optical") ?? result.images[0];

  return (
    <div
      className="bg-ink-950/80 animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        id="satquery-report"
        onClick={(e) => e.stopPropagation()}
        className="border-ink-700 bg-ink-850 animate-fade-up w-full max-w-3xl rounded-xl border p-6 sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionLabel>SatQuery analysis report</SectionLabel>
            <h2 className="text-mist-100 mt-1.5 text-lg font-medium">{result.headline}</h2>
            <p className="text-mist-500 tabular mt-1 font-mono text-[11px]">
              {new Date(result.createdAt).toLocaleString()} · id {result.id.slice(0, 8)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="ghost" onClick={onClose} aria-label="Close report">
              ✕
            </Button>
          </div>
        </div>

        <div className="mt-5">
          <Field label="Query">
            <span className="italic">&ldquo;{result.query}&rdquo;</span>
          </Field>

          <Field label="Summary">{result.reportSummary}</Field>

          <Field label="Task classification">
            {result.interpretation.intent.replace(/_/g, " ")} ·{" "}
            {Math.round(result.interpretation.confidence * 100)}% ·{" "}
            <span className="text-mist-400">{result.plan.rationale}</span>
          </Field>

          <Field label="Inputs">
            <ul className="flex flex-col gap-1">
              {result.images.map((image) => (
                <li key={image.id} className="tabular font-mono text-xs">
                  {image.name} — {image.modality} · {image.width}×{image.height} · {image.crs} ·{" "}
                  {image.acquired} · {image.role}
                </li>
              ))}
            </ul>
          </Field>

          <Field label="Specialists used">
            <ul className="flex flex-col gap-2">
              {result.agents.map((agent) => (
                <li key={agent.agent}>
                  <p className="text-mist-100 text-xs font-medium">
                    {agent.displayName}
                    {agent.status === "ok" && (
                      <span className="text-mist-500 tabular ml-2 font-mono">
                        {Math.round(agent.confidence * 100)}%
                      </span>
                    )}
                  </p>
                  <p className="text-mist-400 text-xs">{agent.claim}</p>
                  <p className="text-mist-500 text-[11px] italic">{agent.method}</p>
                </li>
              ))}
            </ul>
          </Field>

          <Field label="Conclusion and confidence">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-mist-100 tabular font-mono text-2xl">
                {Math.round(result.confidence * 100)}%
              </span>
              <StatusPill status={result.evidence.status} />
            </div>
            <p className="text-mist-400 mt-2 text-xs">{result.evidence.verdict}</p>
            {result.evidence.recommendation && (
              <p className="text-warn/90 mt-1 text-xs">{result.evidence.recommendation}</p>
            )}
          </Field>

          <Field label="Evidence">
            <table className="w-full text-left text-xs">
              <thead className="text-mist-500">
                <tr>
                  <th className="pb-1 font-medium">Source</th>
                  <th className="pb-1 font-medium">Finding</th>
                  <th className="pb-1 text-right font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-ink-700 divide-y">
                {result.evidence.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1.5 pr-3 align-top whitespace-nowrap">{item.label}</td>
                    <td className="text-mist-400 py-1.5 pr-3 align-top">{item.detail}</td>
                    <td className="tabular py-1.5 text-right align-top font-mono">
                      {Math.round(item.confidence * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Field>

          {primaryImage && (
            <Field label="Visual evidence">
              <div className="flex flex-wrap gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={rasterUrl(
                    primaryImage.sceneKey,
                    primaryImage.modality === "sar" ? "sar" : "optical",
                  )}
                  alt="Analysed scene"
                  className="border-ink-700 w-48 rounded-lg border"
                />
                <div className="text-mist-400 flex-1 text-xs">
                  <p>
                    {result.visualization.overlays.length} evidence overlay
                    {result.visualization.overlays.length === 1 ? "" : "s"} available in the
                    workspace.
                  </p>
                  {result.agents
                    .flatMap((a) => a.regions)
                    .slice(0, 5)
                    .map((region) => (
                      <p key={region.id} className="tabular mt-1 font-mono text-[11px]">
                        {region.label} · {region.areaKm2.toFixed(2)} km² ·{" "}
                        {region.centroid[1].toFixed(4)}, {region.centroid[0].toFixed(4)}
                      </p>
                    ))}
                </div>
              </div>
            </Field>
          )}

          <Field label="Execution trace">
            <ol className="flex flex-col gap-1">
              {result.trace.map((step) => (
                <li key={step.id} className="tabular font-mono text-[11px]">
                  <span className="text-mist-500">
                    {step.status === "complete" ? "✓" : step.status === "failed" ? "✕" : "–"}
                  </span>{" "}
                  {step.title} — {step.layer}
                  {step.provider ? ` (${step.provider})` : ""} · {step.durationMs} ms
                </li>
              ))}
            </ol>
          </Field>

          <p className="text-mist-500 border-ink-700 mt-4 border-t pt-3 text-[11px] leading-relaxed">
            Prototype output. Scenes are procedurally generated for demonstration; the analysis
            methods, thresholds and confidence figures above were computed from those rasters.
          </p>
        </div>
      </div>
    </div>
  );
}
