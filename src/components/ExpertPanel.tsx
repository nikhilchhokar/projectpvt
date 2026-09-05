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
import { Button, SectionLabel } from "./primitives";

interface ExpertPanelProps {
  specialists: { id: AgentId; displayName: string; question: string }[];
  languageLayer: { name: string; kind: string };
  options: ExpertOptions;
  onChange: (options: ExpertOptions) => void;
  onRun: () => void;
  busy: boolean;
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="hover:bg-ink-800/60 group flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 transition-colors">
      <span
        className={`mt-px flex size-4 shrink-0 items-center justify-center rounded border text-[10px] transition-colors ${
          checked
            ? "border-accent bg-accent text-ink-950"
            : "border-ink-500 bg-ink-800 text-transparent"
        }`}
      >
        ✓
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span className="min-w-0">
        <span className="text-mist-200 block text-xs font-medium">{label}</span>
        {hint && <span className="text-mist-500 block text-[10px] leading-snug">{hint}</span>}
      </span>
    </label>
  );
}

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
  return (
    <div className="px-1.5 py-1.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-mist-300 text-[11px]">{label}</span>
        <span className="text-mist-200 tabular font-mono text-[11px]">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-accent bg-ink-700 h-1 w-full cursor-pointer appearance-none rounded-full"
      />
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
  const set = (patch: Partial<ExpertOptions>) => onChange({ ...options, ...patch });

  const toggleAgent = (id: AgentId, on: boolean) => {
    const next = on ? [...new Set([...enabled, id])] : enabled.filter((a) => a !== id);
    set({ enabledAgents: next });
  };

  return (
    <div className="animate-slide-in flex h-full flex-col">
      <div className="border-ink-700 border-b px-4 py-3">
        <SectionLabel>Analysis control</SectionLabel>
        <p className="text-mist-400 mt-1.5 text-xs leading-relaxed">
          Choose the specialists, the decision thresholds and the validation rules. The router
          still refuses anything the inputs cannot support.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        <div className="px-1.5">
          <SectionLabel>Specialists</SectionLabel>
        </div>
        <div className="mt-1.5 mb-4">
          {specialists.map((specialist) => (
            <Check
              key={specialist.id}
              checked={enabled.includes(specialist.id)}
              onChange={(v) => toggleAgent(specialist.id, v)}
              label={specialist.displayName}
              hint={specialist.question}
            />
          ))}
        </div>

        <div className="px-1.5">
          <SectionLabel>Language layer</SectionLabel>
        </div>
        <div className="border-ink-700 bg-ink-800/60 mx-1.5 mt-1.5 mb-4 rounded-lg border px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="bg-good size-1.5 rounded-full" />
            <span className="text-mist-200 text-xs font-medium">{languageLayer.name}</span>
          </div>
          <p className="text-mist-500 mt-1 text-[10px] leading-snug">
            {languageLayer.kind === "local-model"
              ? "On-device model handling interpretation and phrasing"
              : "Rule-based interpreter. Configure SATQUERY_LOCAL_LLM_URL to route this through PocketLLM."}
          </p>
        </div>

        <div className="px-1.5">
          <SectionLabel>Fusion</SectionLabel>
        </div>
        <div className="mx-1.5 mt-1.5 mb-4 flex gap-1">
          {(["automatic", "manual"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => set({ fusion: mode })}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium capitalize transition-colors ${
                (options.fusion ?? "automatic") === mode
                  ? "bg-ink-700 text-mist-100"
                  : "text-mist-500 hover:text-mist-300 hover:bg-ink-800"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="px-1.5">
          <SectionLabel>Evidence validation</SectionLabel>
        </div>
        <div className="mt-1.5 mb-4">
          <Check
            checked={options.crossModelAgreement !== false}
            onChange={(v) => set({ crossModelAgreement: v })}
            label="Cross-model agreement"
            hint="Compare what independent specialists concluded"
          />
          <Check
            checked={options.spatialAgreement !== false}
            onChange={(v) => set({ spatialAgreement: v })}
            label="Spatial agreement"
            hint="Require detections to overlap on the ground"
          />
          <Check
            checked={options.confidenceScoring !== false}
            onChange={(v) => set({ confidenceScoring: v })}
            label="Weighted confidence scoring"
            hint="Let one weak signal pull the result down"
          />
        </div>

        <div className="px-1.5">
          <SectionLabel>Parameters</SectionLabel>
        </div>
        <div className="mt-1.5">
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
        </div>
      </div>

      <div className="border-ink-700 bg-ink-900/70 border-t p-3">
        <Button variant="primary" onClick={onRun} disabled={busy} className="w-full">
          {busy ? "Running…" : "Run analysis"}
        </Button>
      </div>
    </div>
  );
}
