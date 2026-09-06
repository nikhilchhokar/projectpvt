"use client";

/**
 * Shared interface primitives.
 *
 * Small pieces used across every panel, kept together so a confidence bar looks
 * the same wherever it appears. Consistency here is what stops the workspace
 * reading as several tools bolted together.
 */

import { useEffect, useRef, useState } from "react";
import type { EvidenceStatus } from "@/lib/satquery/types";

// --- status -----------------------------------------------------------------

export const STATUS_META: Record<
  EvidenceStatus,
  { label: string; dot: string; text: string; bar: string }
> = {
  consistent: {
    label: "Evidence consistent",
    dot: "bg-good",
    text: "text-good",
    bar: "bg-good",
  },
  partial: {
    label: "Evidence partially consistent",
    dot: "bg-warn",
    text: "text-warn",
    bar: "bg-warn",
  },
  insufficient: {
    label: "Insufficient evidence",
    dot: "bg-bad",
    text: "text-bad",
    bar: "bg-bad",
  },
};

export function StatusPill({ status }: { status: EvidenceStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium ${meta.text}`}>
      <span className={`size-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

// --- confidence -------------------------------------------------------------

/**
 * Counts up to the measured value on arrival.
 *
 * The motion is not decoration: it draws the eye to the number that qualifies
 * the answer, at the moment the answer appears. A confidence that simply
 * materialised alongside the headline would be read as part of the headline
 * rather than as a caveat on it.
 */
function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    /**
     * Honour reduced motion, and never let the frame loop decide what number
     * the user sees.
     *
     * This drives the figure the whole product exists to justify. Animating it
     * purely from requestAnimationFrame meant a throttled or backgrounded tab
     * rendered a flat 0% next to a green "Evidence consistent" pill — a
     * contradiction on screen at the exact moment trust is being asked for. The
     * timer below settles on the measured value whatever the frames do.
     */
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!reduced) {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setValue(target * eased);
        if (t < 1) frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    }

    // Under reduced motion this fires immediately; otherwise it is the backstop.
    const settle = window.setTimeout(() => setValue(target), reduced ? 0 : duration + 150);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      window.clearTimeout(settle);
    };
  }, [target, duration]);

  return value;
}

export function ConfidenceMeter({
  value,
  status,
  size = "lg",
}: {
  value: number;
  status: EvidenceStatus;
  size?: "sm" | "lg";
}) {
  const animated = useCountUp(value);
  const meta = STATUS_META[status];

  if (size === "sm") {
    return (
      <div className="flex items-center gap-2">
        <div className="bg-ink-700 h-1 w-16 overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full ${meta.bar} transition-none`}
            style={{ width: `${animated * 100}%` }}
          />
        </div>
        <span className="text-mist-300 tabular font-mono text-[11px]">
          {Math.round(animated * 100)}%
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="bg-ink-700 h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full ${meta.bar}`}
          style={{
            width: `${animated * 100}%`,
            background: `linear-gradient(90deg, ${
              status === "consistent"
                ? "rgba(74,222,128,0.8), rgba(74,222,128,1)"
                : status === "partial"
                  ? "rgba(251,191,36,0.8), rgba(251,191,36,1)"
                  : "rgba(248,113,113,0.8), rgba(248,113,113,1)"
            })`,
          }}
        />
      </div>
      <span className="text-mist-100 tabular font-mono text-lg font-medium">
        {Math.round(animated * 100)}%
      </span>
    </div>
  );
}

// --- layout -----------------------------------------------------------------

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`border-ink-700 bg-ink-850 rounded-xl border ${className}`}>{children}</div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-mist-500 text-[11px] font-semibold tracking-[0.14em] uppercase">
      {children}
    </p>
  );
}

/** A labeled divider: thin line with a centered label, for grouping expert controls. */
export function SectionDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="from-ink-600 h-px flex-1 bg-gradient-to-r to-transparent" />
      <span className="text-mist-500 text-[11px] font-semibold tracking-[0.14em] uppercase">
        {children}
      </span>
      <div className="from-ink-600 h-px flex-1 bg-gradient-to-l to-transparent" />
    </div>
  );
}

export function MetricRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-mist-400 text-xs">{label}</span>
      <span
        className={`text-mist-200 text-right text-xs ${mono ? "tabular font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

// --- segmented control ------------------------------------------------------

interface Segment<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const activeIdx = segments.findIndex((s) => s.id === value);

  return (
    <div className="border-ink-700 bg-ink-850 relative flex rounded-lg border p-0.5">
      {/* sliding highlight */}
      <div
        className="bg-accent/15 border-accent/30 absolute top-0.5 bottom-0.5 rounded-md border transition-all duration-200 ease-out"
        style={{
          width: `${100 / segments.length}%`,
          left: `${(activeIdx / segments.length) * 100}%`,
        }}
      />
      {segments.map((seg) => (
        <button
          key={seg.id}
          onClick={() => onChange(seg.id)}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === seg.id ? "text-accent" : "text-mist-500 hover:text-mist-300"
          }`}
        >
          {seg.icon}
          {seg.label}
        </button>
      ))}
    </div>
  );
}

// --- toggle switch ----------------------------------------------------------

export function Toggle({
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
    <label className="hover:bg-ink-800/60 group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors">
      <span className="min-w-0">
        <span className="text-mist-200 block text-xs font-medium">{label}</span>
        {hint && <span className="text-mist-500 block text-[11px] leading-snug">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? "bg-accent" : "bg-ink-600"
        }`}
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
    </label>
  );
}

// --- buttons ----------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-mist-100 text-ink-950 hover:bg-white disabled:bg-ink-700 disabled:text-mist-500",
  secondary:
    "border border-ink-600 bg-ink-800 text-mist-200 hover:bg-ink-750 hover:border-ink-500 disabled:text-mist-500",
  ghost: "text-mist-400 hover:text-mist-100 hover:bg-ink-800",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}
