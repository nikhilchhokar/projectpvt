/**
 * Input compatibility validation.
 *
 * Runs before any specialist does work, because most of the ways a
 * remote-sensing answer goes wrong are decided at this point: mismatched grids,
 * images of different places, a temporal pair in the wrong order, or a question
 * that needs a modality nobody supplied. Catching those here means a specialist
 * never produces a confident number from incomparable inputs.
 */

import type {
  AnalysisFailure,
  GeoBounds,
  ImageAsset,
  QueryInterpretation,
  ValidationCheck,
  ValidationReport,
} from "./types";

const SUPPORTED_FORMATS = ["geotiff", "tiff", "cog"];
const METERS_PER_DEG_LAT = 111_320;

function boundsOffsetMeters(a: GeoBounds, b: GeoBounds): number {
  const latRad = ((a.north + a.south) / 2) * (Math.PI / 180);
  const mPerDegLon = METERS_PER_DEG_LAT * Math.cos(latRad);
  const dx = Math.abs(a.west - b.west) * mPerDegLon;
  const dy = Math.abs(a.north - b.north) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

export interface ValidationOutcome extends ValidationReport {
  failure?: AnalysisFailure;
}

export function validateInputs(
  images: ImageAsset[],
  interpretation: QueryInterpretation,
  spatialToleranceM = 50,
): ValidationOutcome {
  const checks: ValidationCheck[] = [];
  const push = (
    id: string,
    label: string,
    level: ValidationCheck["level"],
    detail: string,
  ) => checks.push({ id, label, level, detail });

  if (!images.length) {
    push("inputs", "Imagery supplied", "fail", "No image was provided");
    return {
      ok: false,
      checks,
      failure: {
        code: "no_images",
        title: "No imagery to analyse",
        message: "SatQuery needs at least one image before it can answer a question about a place.",
        nextSteps: ["Upload a GeoTIFF, or load one of the demo scenarios"],
      },
    };
  }

  // --- per-image checks -----------------------------------------------------

  const badFormat = images.filter((i) => !SUPPORTED_FORMATS.includes(i.format.toLowerCase()));
  if (badFormat.length) {
    push(
      "format",
      "Format supported",
      "fail",
      `${badFormat.map((i) => i.name).join(", ")} is not a supported raster format`,
    );
  } else {
    push(
      "format",
      "Format supported",
      "pass",
      `${images.length} GeoTIFF${images.length === 1 ? "" : "s"} detected`,
    );
  }

  const missingCrs = images.filter((i) => !i.crs);
  if (missingCrs.length) {
    push("crs", "CRS detected", "fail", `${missingCrs.map((i) => i.name).join(", ")} has no coordinate reference system`);
  } else {
    const distinct = [...new Set(images.map((i) => i.crs))];
    push(
      "crs",
      "CRS detected",
      distinct.length === 1 ? "pass" : "warn",
      distinct.length === 1
        ? `All inputs in ${distinct[0]}`
        : `Inputs span ${distinct.join(" and ")}; reprojection would be required`,
    );
  }

  // --- cross-image checks ---------------------------------------------------

  if (images.length > 1) {
    const [first, ...rest] = images;
    const mismatched = rest.filter(
      (i) => i.width !== first.width || i.height !== first.height,
    );
    push(
      "dimensions",
      "Dimensions compatible",
      mismatched.length ? "fail" : "pass",
      mismatched.length
        ? `${mismatched.map((i) => i.name).join(", ")} does not match ${first.width}×${first.height}`
        : `All inputs ${first.width}×${first.height}`,
    );

    const offsets = rest.map((i) => boundsOffsetMeters(first.bounds, i.bounds));
    const worst = Math.max(...offsets);
    push(
      "alignment",
      "Spatial alignment confirmed",
      worst <= spatialToleranceM ? "pass" : "fail",
      worst <= spatialToleranceM
        ? `Footprints agree to within ${worst.toFixed(1)} m`
        : `Footprints differ by ${(worst / 1000).toFixed(1)} km — these images do not cover the same area`,
    );
  }

  const optical = images.filter((i) => i.modality === "optical");
  const sar = images.filter((i) => i.modality === "sar");

  if (optical.length >= 2) {
    const sorted = [...optical].sort((a, b) => a.acquired.localeCompare(b.acquired));
    const gapDays = Math.round(
      (Date.parse(sorted[sorted.length - 1].acquired) - Date.parse(sorted[0].acquired)) / 86_400_000,
    );
    push(
      "temporal",
      "Temporal pairing valid",
      gapDays > 0 ? "pass" : "warn",
      gapDays > 0
        ? `${gapDays} days between acquisitions (${sorted[0].acquired} → ${sorted[sorted.length - 1].acquired})`
        : "Both acquisitions carry the same date",
    );
  }

  if (sar.length) {
    push(
      "modality",
      "Modalities present",
      "pass",
      `${optical.length} optical, ${sar.length} SAR — cross-modal analysis available`,
    );
  }

  // --- requirement checks ---------------------------------------------------

  const hasFail = checks.some((c) => c.level === "fail");
  if (hasFail) {
    const alignment = checks.find((c) => c.id === "alignment" && c.level === "fail");
    return {
      ok: false,
      checks,
      failure: alignment
        ? {
            code: "incompatible_inputs",
            title: "Images do not cover the same area",
            message: alignment.detail,
            nextSteps: [
              "Supply two acquisitions of the same footprint",
              "Or ask a question about a single image instead",
            ],
          }
        : {
            code: "incompatible_inputs",
            title: "Inputs could not be validated",
            message: checks.find((c) => c.level === "fail")?.detail ?? "One or more inputs failed validation.",
            nextSteps: ["Check the input list and supply georeferenced GeoTIFFs"],
          },
    };
  }

  if (interpretation.requiresBitemporal && optical.length < 2) {
    push("temporal", "Temporal pairing valid", "fail", "Change analysis needs two acquisitions");
    return {
      ok: false,
      checks,
      failure: {
        code: "incompatible_inputs",
        title: "Change analysis needs two dates",
        message:
          "This question asks what changed, but only one acquisition was supplied. There is nothing to compare it against.",
        nextSteps: [
          "Add a second image of the same area from a different date",
          "Or ask what is visible in the image you have",
        ],
      },
    };
  }

  if (interpretation.requiresSar && !sar.length) {
    push("modality", "Modalities present", "fail", "The question asks for radar, but no SAR image was supplied");
    return {
      ok: false,
      checks,
      failure: {
        code: "missing_modality",
        title: "No radar imagery supplied",
        message:
          "This question asks SatQuery to use SAR, but only optical imagery is available.",
        nextSteps: [
          "Add a SAR acquisition of the same area",
          "Or ask the question without requesting radar",
        ],
      },
    };
  }

  return { ok: true, checks };
}
