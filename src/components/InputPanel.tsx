"use client";

/**
 * Inputs and their compatibility.
 *
 * Shows what SatQuery is working from and whether it can be worked from. The
 * validation list is small on purpose -- present enough to be reassuring when
 * everything passes, prominent enough to explain itself when something does not.
 */

import { rasterUrl } from "@/lib/satquery/client";
import type { ImageAsset, ValidationCheck, ValidationReport } from "@/lib/satquery/types";
import { SectionLabel } from "./primitives";

const CHECK_MARK: Record<ValidationCheck["level"], { glyph: string; tone: string }> = {
  pass: { glyph: "✓", tone: "text-good" },
  warn: { glyph: "!", tone: "text-warn" },
  fail: { glyph: "✕", tone: "text-bad" },
};

const ROLE_LABEL: Record<string, string> = {
  before: "Before",
  after: "After",
  single: "Single",
};

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function ImageCard({ image }: { image: ImageAsset }) {
  const isSar = image.modality === "sar";
  return (
    <div className="border-ink-700 bg-ink-800/60 hover:border-ink-600 rounded-lg border p-2.5 transition-colors">
      <div className="flex gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={rasterUrl(image.sceneKey, isSar ? "sar" : "optical")}
          alt=""
          className="border-ink-700 size-14 shrink-0 rounded-md border object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                isSar ? "bg-sarpink/15 text-sarpink" : "bg-water/15 text-water"
              }`}
            >
              {isSar ? "SAR" : "Optical"}
            </span>
            {image.role !== "single" && (
              <span className="bg-ink-700 text-mist-300 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                {ROLE_LABEL[image.role]}
              </span>
            )}
          </div>
          <p className="text-mist-200 mt-1 truncate font-mono text-[11px]" title={image.name}>
            {image.name}
          </p>
          <p className="text-mist-500 tabular mt-0.5 font-mono text-[11px]">
            {image.width}×{image.height} · {image.acquired}
          </p>
          <p className="text-mist-500 tabular font-mono text-[11px]">
            {image.crs} · {formatBytes(image.sizeBytes)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function InputPanel({
  images,
  validation,
}: {
  images: ImageAsset[];
  validation?: ValidationReport;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Inputs</SectionLabel>
          <span className="text-mist-500 tabular font-mono text-[11px]">
            {images.length} image{images.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {images.map((image) => (
            <ImageCard key={image.id} image={image} />
          ))}
        </div>
      </div>

      {validation && (
        <div>
          <SectionLabel>Compatibility</SectionLabel>
          <ul className="mt-2 flex flex-col gap-1.5">
            {validation.checks.map((check) => {
              const mark = CHECK_MARK[check.level];
              return (
                <li key={check.id} className="flex gap-2">
                  <span className={`mt-px shrink-0 font-mono text-[11px] ${mark.tone}`}>
                    {mark.glyph}
                  </span>
                  <div className="min-w-0">
                    <p className="text-mist-300 text-[11px] font-medium">{check.label}</p>
                    <p className="text-mist-500 text-[11px] leading-relaxed">{check.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
