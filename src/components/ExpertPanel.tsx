"use client";

/**
 * Expert Mode.
 *
 * Default mode asks "tell SatQuery what you want to know". This asks "control
 * how SatQuery gets the answer". Every control here is wired to a real
 * parameter of the run -- deselecting a specialist removes it from the plan,
 * moving a threshold changes what the classifier calls built-up, and turning
 * off cross-model agreement genuinely stops the evidence engine looking for it.
 * A control that only looked like it did something would undermine the panel
 * it sits in.
 */

import type { AgentId, ExpertOptions } from "@/lib/satquery/types";
import { Button, SectionDivider, SegmentedControl, Toggle } from "./primitives";

interface ExpertPanelProps {
  specialists: { id: AgentId; displayName: string; question: string }[];
  languageLayer: { name: string; kind: string };
  options: ExpertOptions;
  onChange: (options: ExpertOptions) => void;
  onRun: () => void;
  busy: boolean;
}

/** Styled range slider with a filled track and floating value badge. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="px-3 py-2.5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-mist-300 text-[11px]">{label}</span>
        <span className="bg-ink-700 text-accent tabular rounded px-1.5 py-0.5 font-mono text-[11px]">
          {format(value)}
        </span>
      </div>
      <div className="relative">
        <div className="bg-ink-700 h-1.5 w-full rounded-full">
          <div
            className="bg-accent/70 h-full rounded-full transition-all duration-100"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-1.5 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125 [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent"
        />
      </div>
    </div>
  );
}

export default function ExpertPanel({
  specialists,
  languageLayer,
  options,
  onChange,
  onRun,
  busy,
}: ExpertPanelProps) {
  const enabled = options.enabledAgents ?? specialists.map((s) => s.id);

  /** Resting values, so the panel can say which knobs have actually been turned. */
  const modifiedCount = [
    options.confidenceThreshold !== undefined && options.confidenceThreshold !== 0.6,
    options.spatialToleranceM !== undefined && options.spatialToleranceM !== 50,
    options.waterThreshold !== undefined && options.waterThreshold !== 0.05,
    options.builtUpThreshold !== undefined && options.builtUpThreshold !== 0.13,
  ].filter(Boolean).length;
  const set = (patch: Partial<ExpertOptions>) => onChange({ ...options, ...patch });

  const toggleAgent = (id: AgentId, on: boolean) => {
    const next = on ? [...new Set([...enabled, id])] : enabled.filter((a) => a !== id);
    set({ enabledAgents: next });
  };

  return (
    <div className="animate-slide-in flex h-full flex-col">
      <div className="border-ink-700 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="text-mist-100 text-sm font-medium">Analysis Control</span>
        </div>
        <p className="text-mist-400 mt-1.5 text-xs leading-relaxed">
          Choose the specialists, the decision thresholds and the validation rules. The router
          still refuses anything the inputs cannot support.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {/* --- Specialists as toggle cards --- */}
        <SectionDivider>Specialists</SectionDivider>
        <div className="mt-1 mb-4 grid grid-cols-1 gap-1.5 px-1">
          {specialists.map((specialist) => {
            const isOn = enabled.includes(specialist.id);
            return (
              <button
                key={specialist.id}
                onClick={() => toggleAgent(specialist.id, !isOn)}
                className={`group relative flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
                  isOn
                    ? "border-accent/30 bg-accent/5"
                    : "border-ink-700 bg-ink-800/40 hover:border-ink-600 hover:bg-ink-800/70 opacity-60"
                }`}
              >
                {/* check badge */}
                <span
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[11px] transition-colors ${
                    isOn
                      ? "bg-accent text-ink-950"
                      : "bg-ink-700 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-mist-200 block text-xs font-medium">{specialist.displayName}</span>
                  <span className="text-mist-500 mt-0.5 block text-[11px] leading-snug">{specialist.question}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* --- Language layer --- */}
        <SectionDivider>Language Layer</SectionDivider>
        <div className="border-ink-700 bg-ink-800/40 mx-1 mt-1 mb-4 rounded-lg border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="bg-good absolute inline-flex size-full animate-ping rounded-full opacity-40" />
              <span className="bg-good relative inline-flex size-2 rounded-full" />
            </span>
            <span className="text-mist-200 text-xs font-medium">{languageLayer.name}</span>
          </div>
          <p className="text-mist-500 mt-1.5 text-[11px] leading-snug">
            {languageLayer.kind === "local-model"
              ? "On-device model handling interpretation and phrasing"
              : "Rule-based interpreter. Configure SATQUERY_LOCAL_LLM_URL to route this through PocketLLM."}
          </p>
        </div>

        {/* --- Fusion --- */}
        <SectionDivider>Fusion</SectionDivider>
        <div className="mx-1 mt-1 mb-4">
          <SegmentedControl
            segments={[
              { id: "automatic" as const, label: "Automatic" },
              { id: "manual" as const, label: "Manual" },
            ]}
            value={(options.fusion ?? "automatic") as "automatic" | "manual"}
            onChange={(v) => set({ fusion: v })}
          />
        </div>

        {/* --- Evidence validation --- */}
        <SectionDivider>Evidence Validation</SectionDivider>
        <div className="mt-1 mb-4">
          <Toggle
            checked={options.crossModelAgreement !== false}
            onChange={(v) => set({ crossModelAgreement: v })}
            label="Cross-model agreement"
            hint="Compare what independent specialists concluded"
          />
          <Toggle
            checked={options.spatialAgreement !== false}
            onChange={(v) => set({ spatialAgreement: v })}
            label="Spatial agreement"
            hint="Require detections to overlap on the ground"
          />
          <Toggle
            checked={options.confidenceScoring !== false}
            onChange={(v) => set({ confidenceScoring: v })}
            label="Weighted confidence scoring"
            hint="Let one weak signal pull the result down"
          />
        </div>

        {/*
          Parameters collapse by default.
          Expert Mode presented fourteen simultaneous decisions in a 336px
          column with nothing marking which were still at their defaults. The
          four specialists and Run are what this panel is for; the thresholds
          are for the run after the first one.
        */}
        <details className="group mt-4">
          <summary className="text-mist-400 hover:text-mist-200 marker:content-none flex min-h-9 cursor-pointer items-center justify-between rounded-md px-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase transition-colors">
            <span className="flex items-center gap-2">
              Parameters
              {modifiedCount > 0 && (
                <span className="bg-accent/15 text-accent rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-normal normal-case">
                  {modifiedCount} changed
                </span>
              )}
            </span>
            <span className="text-mist-500 transition-transform group-open:rotate-180" aria-hidden>
              ⌄
            </span>
          </summary>
          <div className="mt-1">
          <Slider
            label="Confidence threshold"
            value={options.confidenceThreshold ?? 0.6}
            min={0.3}
            max={0.95}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ confidenceThreshold: v })}
          />
          <Slider
            label="Spatial tolerance"
            value={options.spatialToleranceM ?? 50}
            min={10}
            max={500}
            step={10}
            format={(v) => `${v} m`}
            onChange={(v) => set({ spatialToleranceM: v })}
          />
          <Slider
            label="NDWI water cut"
            value={options.waterThreshold ?? 0.05}
            min={0.0}
            max={0.45}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set({ waterThreshold: v })}
          />
          <Slider
            label="Built-up brightness cut"
            value={options.builtUpThreshold ?? 0.13}
            min={0.08}
            max={0.22}
            step={0.005}
            format={(v) => v.toFixed(3)}
            onChange={(v) => set({ builtUpThreshold: v })}
          />
            {modifiedCount > 0 && (
              <button
                onClick={() =>
                  set({
                    confidenceThreshold: undefined,
                    spatialToleranceM: undefined,
                    waterThreshold: undefined,
                    builtUpThreshold: undefined,
                  })
                }
                className="text-mist-500 hover:text-mist-200 mt-1 min-h-8 px-1.5 text-[11px] font-medium transition-colors"
              >
                Reset to defaults
              </button>
            )}
          </div>
        </details>
      </div>

      <div className="border-ink-700 bg-ink-900/70 border-t p-3">
        <Button variant="primary" onClick={onRun} disabled={busy} className="w-full">
          {busy ? "Running…" : "Run analysis"}
        </Button>
      </div>
    </div>
  );
}
