"use client";

/**
 * Analysis report.
 *
 * Everything an analyst would need to defend or reproduce the result: what was
 * asked, what it was asked of, how the request was classified, which
 * specialists ran, what each measured, and how they agreed. It prints, because
 * the person who needs it is often not the person at the keyboard.
 */

import { useCallback, useEffect, useState } from "react";
import { rasterUrl } from "@/lib/satquery/client";
import type { AnalysisResult } from "@/lib/satquery/types";
import { Button, SectionLabel, StatusPill } from "./primitives";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-ink-700 border-t py-4">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-mist-200 mt-2 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

/** Inline mini confidence bar used in the evidence table. */
function MiniBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="bg-ink-700 h-1 w-12 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full ${
            value >= 0.8 ? "bg-good" : value >= 0.6 ? "bg-warn" : "bg-bad"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular font-mono text-[11px]">{pct}%</span>
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
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const primaryImage = result.images.find((i) => i.modality === "optical") ?? result.images[0];

  const downloadPdf = useCallback(async () => {
    setPdfBusy(true);
    try {
      const [html2canvasModule, jsPDFModule] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const html2canvas = html2canvasModule.default;
      const { jsPDF } = jsPDFModule;

      const el = document.getElementById("satquery-report");
      if (!el) return;

      const canvas = await html2canvas(el, {
        backgroundColor: "#14161c",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgW = pdfW - 20;
      const imgH = (canvas.height * imgW) / canvas.width;

      let yOffset = 0;
      const pageContentH = pdfH - 20;

      // First page
      pdf.addImage(imgData, "PNG", 10, 10, imgW, imgH, undefined, "FAST", 0);
      yOffset += pageContentH;

      // Additional pages if needed
      while (yOffset < imgH) {
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 10, 10 - yOffset, imgW, imgH, undefined, "FAST", 0);
        yOffset += pageContentH;
      }

      pdf.save(`satquery-report-${result.id.slice(0, 8)}.pdf`);
    } catch (e) {
      console.error("PDF generation failed:", e);
    } finally {
      setPdfBusy(false);
    }
  }, [result.id]);

  return (
    <div
      className="bg-ink-950/80 animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        id="satquery-report"
        onClick={(e) => e.stopPropagation()}
        className="border-ink-700 bg-ink-850 animate-scale-in w-full max-w-3xl overflow-hidden rounded-2xl border shadow-2xl shadow-black/40"
      >
        {/* Accent stripe */}
        <div className="from-accent via-accent-dim to-accent-glow h-1 bg-gradient-to-r" />

        <div className="p-6 sm:p-8">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <SectionLabel>SatQuery analysis report</SectionLabel>
              <h2 className="text-mist-100 mt-2 text-xl font-semibold tracking-[-0.01em]">
                {result.headline}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <StatusPill status={result.evidence.status} />
                <span className="text-mist-500 tabular font-mono text-[11px]">
                  {new Date(result.createdAt).toLocaleString()} · id {result.id.slice(0, 8)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 print:hidden">
              <Button
                variant="secondary"
                onClick={downloadPdf}
                disabled={pdfBusy}
                className="gap-1.5"
              >
                {pdfBusy ? (
                  <>
                    <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    PDF
                  </>
                )}
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Print
              </Button>
              <Button variant="ghost" onClick={onClose} aria-label="Close report">
                ✕
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="mt-5">
            <Field label="Query">
              <span className="italic">&ldquo;{result.query}&rdquo;</span>
            </Field>

            {/* Summary card */}
            <Field label="Summary">
              <div className="bg-ink-800/60 border-ink-700 -mx-1 rounded-lg border px-4 py-3">
                {result.reportSummary}
              </div>
            </Field>

            <Field label="Task classification">
              <div className="flex flex-wrap items-center gap-2">
                <span className="bg-accent/10 text-accent rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {result.interpretation.intent.replace(/_/g, " ")}
                </span>
                <span className="tabular font-mono text-xs">
                  {Math.round(result.interpretation.confidence * 100)}%
                </span>
                <span className="text-mist-400 text-xs">·</span>
                <span className="text-mist-400 text-xs">{result.plan.rationale}</span>
              </div>
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

            {/* Specialists — card grid */}
            <Field label="Specialists used">
              <div className="grid gap-2 sm:grid-cols-2">
                {result.agents.map((agent) => (
                  <div
                    key={agent.agent}
                    className={`border-ink-700 bg-ink-800/40 rounded-lg border-l-2 p-3 ${
                      agent.status === "ok"
                        ? "border-l-accent"
                        : agent.status === "failed"
                          ? "border-l-bad"
                          : "border-l-ink-600"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-mist-100 text-xs font-semibold">{agent.displayName}</p>
                      {agent.status === "ok" && (
                        <MiniBar value={agent.confidence} />
                      )}
                    </div>
                    <p className="text-mist-400 mt-1 text-xs">{agent.claim}</p>
                    <p className="text-mist-500 mt-1 text-[10px] italic">{agent.method}</p>
                  </div>
                ))}
              </div>
            </Field>

            {/* Conclusion */}
            <Field label="Conclusion and confidence">
              <div className="bg-ink-800/40 border-ink-700 -mx-1 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-mist-100 tabular font-mono text-3xl font-bold">
                    {Math.round(result.confidence * 100)}%
                  </span>
                  <StatusPill status={result.evidence.status} />
                </div>
                <p className="text-mist-400 mt-3 text-xs leading-relaxed">{result.evidence.verdict}</p>
                {result.evidence.recommendation && (
                  <p className="text-warn/90 border-warn/20 mt-3 border-t pt-2 text-xs">
                    {result.evidence.recommendation}
                  </p>
                )}
              </div>
            </Field>

            {/* Evidence table */}
            <Field label="Evidence">
              <div className="overflow-hidden rounded-lg border border-ink-700">
                <table className="w-full text-left text-xs">
                  <thead className="bg-ink-800/60 text-mist-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Finding</th>
                      <th className="px-3 py-2 text-right font-medium">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.evidence.items.map((item, idx) => (
                      <tr
                        key={item.id}
                        className={idx % 2 === 0 ? "bg-ink-850" : "bg-ink-800/30"}
                      >
                        <td className="px-3 py-2 align-top whitespace-nowrap">{item.label}</td>
                        <td className="text-mist-400 px-3 py-2 align-top">{item.detail}</td>
                        <td className="px-3 py-2 text-right align-top">
                          <MiniBar value={item.confidence} className="justify-end" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

            {/* Execution trace — horizontal timeline */}
            <Field label="Execution trace">
              <div className="relative flex items-start gap-0 overflow-x-auto pb-2">
                {result.trace.map((step, i) => {
                  const isOk = step.status === "complete";
                  const isFail = step.status === "failed";
                  return (
                    <div key={step.id} className="flex shrink-0 items-start">
                      <div className="flex flex-col items-center">
                        {/* node */}
                        <span
                          className={`flex size-6 items-center justify-center rounded-full border text-[10px] font-medium ${
                            isOk
                              ? "border-good/40 bg-good/10 text-good"
                              : isFail
                                ? "border-bad/40 bg-bad/10 text-bad"
                                : "border-ink-600 bg-ink-800 text-mist-500"
                          }`}
                        >
                          {isOk ? "✓" : isFail ? "✕" : "–"}
                        </span>
                        {/* label */}
                        <div className="mt-1.5 w-20 text-center">
                          <p className="text-mist-200 truncate text-[10px] font-medium">{step.title}</p>
                          <p className="text-mist-500 tabular font-mono text-[9px]">{step.durationMs} ms</p>
                        </div>
                      </div>
                      {/* connector line */}
                      {i < result.trace.length - 1 && (
                        <div className="bg-ink-600 mt-3 h-px w-6 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </Field>

            {/* Footer */}
            <div className="text-mist-500 border-ink-700 mt-4 flex items-start gap-2 border-t pt-4 text-[11px] leading-relaxed">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 opacity-50">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <p>
                Prototype output. Scenes are procedurally generated for demonstration; the analysis
                methods, thresholds and confidence figures above were computed from those rasters.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
