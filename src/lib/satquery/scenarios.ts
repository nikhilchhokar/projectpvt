/**
 * Demo scenarios.
 *
 * Fixed input sets, not fixed answers. Each scenario supplies imagery and a
 * question; the engine works out the rest at request time. That is the whole
 * reason these are safe to present live -- the scenes are deterministic, so the
 * analysis is reproducible, but nothing about the result is written down here.
 */

import { sceneMetadata } from "./scene";
import type { ImageAsset, ImageRole } from "./types";

function asset(
  sceneKey: string,
  role: ImageRole,
  name: string,
  bands: string[],
): ImageAsset {
  const meta = sceneMetadata(sceneKey);
  const bytesPerBand = meta.width * meta.height * 2;
  return {
    id: `${sceneKey}-${role}`,
    name,
    modality: meta.modality,
    format: "GeoTIFF",
    width: meta.width,
    height: meta.height,
    crs: meta.crs,
    bounds: meta.bounds,
    acquired: meta.acquired,
    bands,
    sceneKey,
    role,
    sizeBytes: bytesPerBand * bands.length,
  };
}

const OPTICAL_BANDS = ["B4 (Red)", "B3 (Green)", "B2 (Blue)", "B8 (NIR)"];
const SAR_BANDS = ["VV"];

export interface DemoScenario {
  id: string;
  index: string;
  title: string;
  subtitle: string;
  query: string;
  images: ImageAsset[];
  /** What this scenario is here to demonstrate. Shown in the demo picker. */
  demonstrates: string;
  /** Opens the workspace with Expert Mode already on. */
  expertMode?: boolean;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "vqa",
    index: "01",
    title: "Ask about an image",
    subtitle: "Single-image visual question answering",
    query: "Describe the land cover and major objects visible in this image.",
    demonstrates: "Natural-language question answered from one optical scene",
    images: [asset("delta-optical", "single", "delta_S2_20241108.tif", OPTICAL_BANDS)],
  },
  {
    id: "grounding",
    index: "02",
    title: "Find the water",
    subtitle: "Spatial grounding",
    query: "Highlight the water body.",
    demonstrates: "A textual answer tied to an exact region of the raster",
    images: [asset("delta-optical", "single", "delta_S2_20241108.tif", OPTICAL_BANDS)],
  },
  {
    id: "change",
    index: "03",
    title: "Detect change",
    subtitle: "Bi-temporal change analysis",
    query: "Has the built-up area increased?",
    demonstrates:
      "Quantified change between two dates. Nobody asked for radar -- SatQuery pulled it in because the question needed corroboration",
    images: [
      asset("valley-optical-t1", "before", "valley_S2_20210312.tif", OPTICAL_BANDS),
      asset("valley-optical-t2", "after", "valley_S2_20250220.tif", OPTICAL_BANDS),
      asset("valley-sar-t1", "before", "valley_S1_20210314.tif", SAR_BANDS),
      asset("valley-sar-t2", "after", "valley_S1_20250222.tif", SAR_BANDS),
    ],
  },
  {
    id: "cross-modal",
    index: "04",
    title: "Optical + SAR",
    subtitle: "Cross-modal analysis",
    query: "Use the optical and SAR images together to confirm what changed.",
    demonstrates: "Two independent sensors corroborating a single conclusion",
    images: [
      asset("valley-optical-t1", "before", "valley_S2_20210312.tif", OPTICAL_BANDS),
      asset("valley-optical-t2", "after", "valley_S2_20250220.tif", OPTICAL_BANDS),
      asset("valley-sar-t1", "before", "valley_S1_20210314.tif", SAR_BANDS),
      asset("valley-sar-t2", "after", "valley_S1_20250222.tif", SAR_BANDS),
    ],
  },
  {
    id: "low-confidence",
    index: "05",
    title: "When the sensors disagree",
    subtitle: "Low-confidence result",
    query: "Has the built-up area increased?",
    demonstrates:
      "Optical reports growth that radar will not confirm — SatQuery reports the doubt instead of the number",
    images: [
      asset("coast-optical-t1", "before", "coast_S2_20230118.tif", OPTICAL_BANDS),
      asset("coast-optical-t2", "after", "coast_S2_20250604.tif", OPTICAL_BANDS),
      asset("coast-sar-t1", "before", "coast_S1_20230120.tif", SAR_BANDS),
      asset("coast-sar-t2", "after", "coast_S1_20250606.tif", SAR_BANDS),
    ],
  },
  {
    id: "expert",
    index: "06",
    title: "Expert mode",
    subtitle: "Controlled orchestration",
    query: "Has the built-up area increased?",
    demonstrates: "Choose the specialists, the thresholds and the validation rules yourself",
    expertMode: true,
    images: [
      asset("valley-optical-t1", "before", "valley_S2_20210312.tif", OPTICAL_BANDS),
      asset("valley-optical-t2", "after", "valley_S2_20250220.tif", OPTICAL_BANDS),
      asset("valley-sar-t1", "before", "valley_S1_20210314.tif", SAR_BANDS),
      asset("valley-sar-t2", "after", "valley_S1_20250222.tif", SAR_BANDS),
    ],
  },
];

export function getScenario(id: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.id === id);
}

/** Suggested prompts on the home screen. Each one runs for real. */
export const SUGGESTED_PROMPTS: { text: string; scenarioId: string }[] = [
  { text: "What is visible here?", scenarioId: "vqa" },
  { text: "Where is the water?", scenarioId: "grounding" },
  { text: "What changed between these dates?", scenarioId: "change" },
  { text: "Use optical + SAR together.", scenarioId: "cross-modal" },
];
