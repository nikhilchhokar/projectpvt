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
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
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
          style={{ width: `${animated * 100}%` }}
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
    <p className="text-mist-500 text-[10px] font-semibold tracking-[0.14em] uppercase">
      {children}
    </p>
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
