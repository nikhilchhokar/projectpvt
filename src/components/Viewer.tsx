"use client";

/**
 * Raster viewer.
 *
 * A georeferenced canvas: base layer, evidence overlays, region annotations,
 * scale bar, live coordinates. It is deliberately not a GIS workstation -- it
 * does the four things this product needs (look, compare, reveal, zoom) and
 * nothing else, so the imagery keeps the screen.
 *
 * The animated flight to a focus box is the mechanical heart of SHOW ME: the
 * answer stays on screen while the map travels to the evidence behind it, which
 * is what makes the connection between sentence and place feel causal.
 *
 * Drawing is driven imperatively rather than through React state. Panning at
 * 60fps through a state setter would re-render the tree on every frame for a
 * picture React does not own; instead the view lives in a ref and a coalesced
 * rAF repaints the canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rasterUrl } from "@/lib/satquery/client";
import { GSD_M, SCENE_SIZE } from "@/lib/satquery/constants";
import { formatLatLon, pixelToGeo } from "@/lib/satquery/geo";
import { buildOverlayCanvas } from "@/lib/satquery/overlay";
import type { GeoBounds, Region, VizLayer, VizOverlay } from "@/lib/satquery/types";

interface View {
  scale: number;
  x: number;
  y: number;
}

interface ViewerProps {
  layers: VizLayer[];
  activeLayerId: string;
  onLayerChange: (id: string) => void;
  overlays: VizOverlay[];
  visibleOverlayIds: string[];
  onToggleOverlay: (id: string) => void;
  regions: Region[];
  focus: [number, number, number, number] | null;
  bounds: GeoBounds | undefined;
  busy?: boolean;
}

const EASE = (t: number) => 1 - Math.pow(1 - t, 3);
const FLIGHT_MS = 700;
const MIN_SCALE = 0.2;
const MAX_SCALE = 14;

export default function Viewer({
  layers,
  activeLayerId,
  onLayerChange,
  overlays,
  visibleOverlayIds,
  onToggleOverlay,
  regions,
  focus,
  bounds,
  busy,
}: ViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const framedRef = useRef(false);
  const pendingRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  /** Sources whose decode failed, so the canvas can say so instead of waiting forever. */
  const failedSrcRef = useRef(new Set<string>());
  const overlayCanvasRef = useRef(new Map<string, HTMLCanvasElement>());
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];

  /**
   * Group the legend by the specialist that produced each mask.
   *
   * Seven ungrouped chips sat in a row where "Built-up at baseline" and
   * "Built-up" were indistinguishable without reading source -- and this is
   * precisely the control someone uses to check the answer. Attributing each
   * overlay to its source turns a flat list into three short ones.
   */
  const overlayGroups = useMemo(() => {
    const order: { agent: string; label: string }[] = [
      { agent: "change", label: "Change" },
      { agent: "vision", label: "Optical" },
      { agent: "grounding", label: "Grounding" },
      { agent: "sar", label: "SAR" },
    ];
    return order
      .map((g) => ({ ...g, overlays: overlays.filter((o) => o.sourceAgent === g.agent) }))
      .filter((g) => g.overlays.length > 0);
  }, [overlays]);

  const layerSrc = useMemo(() => {
    if (!activeLayer) return null;
    if (activeLayer.kind === "difference") {
      const [before, after] = activeLayer.sceneKey.split("|");
      return rasterUrl(after, "difference", before);
    }
    return rasterUrl(activeLayer.sceneKey, activeLayer.kind === "sar" ? "sar" : "optical");
  }, [activeLayer]);

  /** Everything draw() needs that comes from props, kept out of the render path. */
  const propsRef = useRef({ layerSrc, visibleOverlayIds, regions });

  // --- drawing --------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || !w || !h) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const view = viewRef.current;
    const { layerSrc: src, visibleOverlayIds: visible, regions: annotations } = propsRef.current;

    ctx.clearRect(0, 0, w, h);
    // Keep pixels crisp once past 1:1 -- this is imagery, not a photograph.
    ctx.imageSmoothingEnabled = view.scale < 2;

    const drawW = SCENE_SIZE * view.scale;
    const drawH = SCENE_SIZE * view.scale;
    const base = src ? imagesRef.current.get(src) : undefined;

    if (base) {
      ctx.drawImage(base, view.x, view.y, drawW, drawH);
    } else {
      /**
       * No decoded raster yet. Paint the footprint and say which state it is in.
       * An untouched canvas is transparent, and a large transparent rectangle
       * beside four rendered thumbnails reads as a failure rather than a wait.
       */
      const failed = failedSrcRef.current.has(src ?? "");
      ctx.fillStyle = "#0e1219";
      ctx.fillRect(view.x, view.y, drawW, drawH);
      ctx.strokeStyle = failed ? "rgba(248,113,113,0.45)" : "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.setLineDash(failed ? [] : [6, 5]);
      ctx.strokeRect(view.x + 0.5, view.y + 0.5, drawW - 1, drawH - 1);
      ctx.setLineDash([]);

      ctx.font = '500 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = failed ? "rgba(248,113,113,0.9)" : "rgba(155,166,182,0.75)";
      ctx.textAlign = "center";
      ctx.fillText(
        failed ? "Imagery could not be loaded" : "Loading imagery…",
        view.x + drawW / 2,
        view.y + drawH / 2,
      );
      ctx.textAlign = "left";
    }

    for (const id of visible) {
      const overlayCanvas = overlayCanvasRef.current.get(id);
      if (overlayCanvas) ctx.drawImage(overlayCanvas, view.x, view.y, drawW, drawH);
    }

    // Region annotations, drawn in screen space so strokes stay hairline.
    ctx.lineWidth = 1.5;
    ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
    // Boxes are always drawn; labels are dropped where they would collide, so
    // a cluster of detections stays readable instead of becoming a pile of text.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const region of annotations) {
      const [rx0, ry0, rx1, ry1] = region.bbox;
      const x = view.x + rx0 * view.scale;
      const y = view.y + ry0 * view.scale;
      const boxW = (rx1 - rx0) * view.scale;
      const boxH = (ry1 - ry0) * view.scale;

      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x, y, boxW, boxH);
      ctx.setLineDash([]);

      const label = `${region.label} · ${Math.round(region.confidence * 100)}%`;
      const textWidth = ctx.measureText(label).width;
      const padding = 6;
      const chipW = textWidth + padding * 2;
      const chipH = 19;
      const chipY = y - chipH - 4 < 0 ? y + boxH + 4 : y - chipH - 4;
      // Keep the chip inside the viewport; an annotation cut off by the frame
      // edge names a detection the user cannot read.
      const chipX = Math.max(4, Math.min(x, w - chipW - 4));

      const collides = placed.some(
        (p) =>
          chipX < p.x + p.w + 4 &&
          chipX + chipW + 4 > p.x &&
          chipY < p.y + p.h + 2 &&
          chipY + chipH + 2 > p.y,
      );
      if (collides) continue;
      placed.push({ x: chipX, y: chipY, w: chipW, h: chipH });

      ctx.fillStyle = "rgba(6,8,11,0.88)";
      ctx.beginPath();
      ctx.roundRect(chipX, chipY, chipW, chipH, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.stroke();

      ctx.fillStyle = "#e8ecf2";
      ctx.fillText(label, chipX + padding, chipY + 13);
    }

    // Scale bar: choose a round ground distance that fits a sensible width.
    const metresPerScreenPx = GSD_M / view.scale;
    const targets = [100, 200, 500, 1000, 2000, 5000, 10000];
    const target = targets.find((t) => t / metresPerScreenPx < 140) ?? targets[targets.length - 1];
    const barPx = target / metresPerScreenPx;
    const barX = 16;
    const barY = h - 22;

    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(barX, barY - 4);
    ctx.lineTo(barX, barY);
    ctx.lineTo(barX + barPx, barY);
    ctx.lineTo(barX + barPx, barY - 4);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = '500 10px ui-monospace, monospace';
    ctx.fillText(target >= 1000 ? `${target / 1000} km` : `${target} m`, barX, barY - 8);
  }, []);

  /**
   * Coalesce repaints, racing a frame against a timer.
   *
   * Relying on requestAnimationFrame alone strands the canvas blank. A hidden
   * document never fires one at all, but the worse case is a *visible* document
   * whose first frame is throttled or dropped: nothing else wakes the viewer --
   * no resize follows, no state changes -- so the largest element on screen
   * stays empty permanently while the thumbnails beside it render fine. That
   * reads as broken, not as loading. Whichever of the two fires first wins.
   */
  const requestDraw = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      pendingRef.current = false;
      draw();
    };
    window.setTimeout(run, 32);
    if (typeof document !== "undefined" && document.visibilityState !== "hidden") {
      requestAnimationFrame(run);
    }
  }, [draw]);

  // --- view helpers ---------------------------------------------------------

  const fitView = useCallback((): View => {
    const { w, h } = sizeRef.current;
    const scale = Math.min(w / SCENE_SIZE, h / SCENE_SIZE) * 0.94;
    return {
      scale,
      x: (w - SCENE_SIZE * scale) / 2,
      y: (h - SCENE_SIZE * scale) / 2,
    };
  }, []);

  const animateTo = useCallback(
    (target: View) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);

      // Nothing to animate for an audience that cannot see it, and the frame
      // loop would not run anyway.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        viewRef.current = target;
        requestDraw();
        return;
      }

      const from = { ...viewRef.current };
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / FLIGHT_MS);
        const e = EASE(t);
        viewRef.current = {
          scale: from.scale + (target.scale - from.scale) * e,
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
        };
        draw();
        animRef.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      animRef.current = requestAnimationFrame(tick);
    },
    [draw, requestDraw],
  );

  const flyTo = useCallback(
    (box: [number, number, number, number]) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const [x0, y0, x1, y1] = box;
      const boxW = Math.max(1, x1 - x0);
      const boxH = Math.max(1, y1 - y0);
      // Cap the zoom so a small region does not slam the view into a few pixels.
      const scale = Math.min(Math.min(w / boxW, h / boxH) * 0.82, 6);
      animateTo({
        scale,
        x: w / 2 - ((x0 + x1) / 2) * scale,
        y: h / 2 - ((y0 + y1) / 2) * scale,
      });
    },
    [animateTo],
  );

  // --- sizing ---------------------------------------------------------------

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;

    // Measure once directly. ResizeObserver's first callback is delivered on a
    // frame, which a hidden document will not produce.
    const initial = element.getBoundingClientRect();
    if (initial.width && initial.height) {
      sizeRef.current = { w: initial.width, h: initial.height };
      if (!framedRef.current) {
        framedRef.current = true;
        viewRef.current = fitView();
      }
      requestDraw();
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      sizeRef.current = { w: rect.width, h: rect.height };
      if (!framedRef.current && rect.width && rect.height) {
        framedRef.current = true;
        viewRef.current = fitView();
      }
      requestDraw();
    });
    observer.observe(element);

    // Repaint on return to the foreground, in case the first paint was skipped.
    const onVisible = () => {
      if (document.visibilityState === "visible") requestDraw();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fitView, requestDraw]);

  // --- assets ---------------------------------------------------------------

  useEffect(() => {
    if (!layerSrc) return;
    if (imagesRef.current.has(layerSrc)) {
      requestDraw();
      return;
    }
    const image = new Image();
    image.onload = () => {
      failedSrcRef.current.delete(layerSrc);
      imagesRef.current.set(layerSrc, image);
      requestDraw();
    };
    image.onerror = () => {
      // Record and repaint. Without this the viewer waits on a load event that
      // is never coming and shows an empty frame with no explanation.
      failedSrcRef.current.add(layerSrc);
      requestDraw();
    };
    image.src = layerSrc;
  }, [layerSrc, requestDraw]);

  useEffect(() => {
    for (const overlay of overlays) {
      if (overlayCanvasRef.current.has(overlay.id)) continue;
      const canvas = buildOverlayCanvas(overlay.mask, overlay.color);
      if (canvas) overlayCanvasRef.current.set(overlay.id, canvas);
    }
    requestDraw();
  }, [overlays, requestDraw]);

  // Publish the latest props to the draw path, then repaint. Doing this in an
  // effect rather than during render keeps the ref write out of the render pass.
  useEffect(() => {
    propsRef.current = { layerSrc, visibleOverlayIds, regions };
    requestDraw();
  }, [layerSrc, visibleOverlayIds, regions, requestDraw]);

  // SHOW ME: a new focus box means travel to it.
  useEffect(() => {
    if (focus) flyTo(focus);
  }, [focus, flyTo]);

  useEffect(
    () => () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    },
    [],
  );

  // --- interaction ----------------------------------------------------------

  const onWheel = (event: React.WheelEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const view = viewRef.current;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    // Zoom about the cursor rather than the centre.
    viewRef.current = {
      scale,
      x: px - ((px - view.x) / view.scale) * scale,
      y: py - ((py - view.y) / view.scale) * scale,
    };
    requestDraw();
  };

  const onPointerDown = (event: React.PointerEvent) => {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const view = viewRef.current;

    if (dragRef.current) {
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current = { x: event.clientX, y: event.clientY };
      viewRef.current = { ...view, x: view.x + dx, y: view.y + dy };
      requestDraw();
    }

    if (bounds) {
      const sx = (event.clientX - rect.left - viewRef.current.x) / viewRef.current.scale;
      const sy = (event.clientY - rect.top - viewRef.current.y) / viewRef.current.scale;
      if (sx >= 0 && sy >= 0 && sx < SCENE_SIZE && sy < SCENE_SIZE) {
        const [lon, lat] = pixelToGeo(bounds, SCENE_SIZE, SCENE_SIZE, sx, sy);
        setCursor(formatLatLon(lon, lat));
      } else {
        setCursor(null);
      }
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const zoomBy = (factor: number) => {
    const { w, h } = sizeRef.current;
    const view = viewRef.current;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    animateTo({
      scale,
      x: w / 2 - ((w / 2 - view.x) / view.scale) * scale,
      y: h / 2 - ((h / 2 - view.y) / view.scale) * scale,
    });
  };

  const controlClass =
    "border-ink-700 bg-ink-900/90 text-mist-300 hover:text-mist-100 hover:bg-ink-800 size-8 rounded-lg border text-sm backdrop-blur transition-colors";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={wrapRef}
        className="border-ink-700 bg-ink-950 relative min-h-0 flex-1 overflow-hidden rounded-xl border"
      >
      {/* layer switcher */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-2 p-3">
        <div className="border-ink-700/80 bg-ink-900/85 pointer-events-auto flex flex-wrap gap-0.5 rounded-lg border p-0.5 backdrop-blur">
          {layers.map((layer) => (
            <button
              key={layer.id}
              onClick={() => onLayerChange(layer.id)}
              title={layer.caption}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                layer.id === activeLayerId
                  ? "bg-ink-700 text-mist-100"
                  : "text-mist-400 hover:text-mist-200 hover:bg-ink-800"
              }`}
            >
              {layer.label}
            </button>
          ))}
        </div>

      </div>

      {/*
        SHOW ME is the product's proof, and to a screen reader a <canvas> is
        nothing at all. The region labels, areas and centroids already exist as
        text in the result, so they are published here rather than left locked
        inside the bitmap.
      */}
      <p className="sr-only" aria-live="polite">
        {activeLayer ? `${activeLayer.label} imagery, ${activeLayer.caption}.` : "No imagery loaded."}
        {regions.length > 0 &&
          ` ${regions.length} detected region${regions.length === 1 ? "" : "s"} highlighted: ` +
            regions
              .map(
                (r) =>
                  `${r.label}, ${r.areaKm2.toFixed(2)} square kilometres, ${Math.round(
                    r.confidence * 100,
                  )}% confidence`,
              )
              .join("; ") +
            "."}
      </p>

      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          activeLayer
            ? `${activeLayer.label} satellite imagery, ${SCENE_SIZE} by ${SCENE_SIZE} pixels`
            : "Satellite imagery viewer"
        }
        className="block size-full cursor-grab touch-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={() => {
          endDrag();
          setCursor(null);
        }}
      />

      <div className="absolute right-3 bottom-3 z-10 flex flex-col gap-1">
        <button onClick={() => zoomBy(1.6)} title="Zoom in" className={controlClass}>
          +
        </button>
        <button onClick={() => zoomBy(1 / 1.6)} title="Zoom out" className={controlClass}>
          −
        </button>
        <button
          onClick={() => animateTo(fitView())}
          title="Fit to scene"
          className={controlClass}
        >
          ⤢
        </button>
      </div>

      {cursor && (
        <div className="border-ink-700/80 bg-ink-900/85 text-mist-400 tabular absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border px-2.5 py-1 font-mono text-[11px] backdrop-blur">
          {cursor}
        </div>
      )}

        {busy && (
          <div className="bg-ink-950/45 absolute inset-0 z-20 flex items-center justify-center backdrop-blur-[2px]">
            <div className="border-ink-700 bg-ink-900/90 relative overflow-hidden rounded-lg border px-4 py-2.5">
              <span className="text-mist-300 relative z-10 text-xs font-medium">
                Analysing imagery…
              </span>
              <span className="animate-sweep absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          </div>
        )}
      </div>

      {/*
        Evidence legend, below the canvas rather than floating over it. Seven
        overlays in a panel on top of the imagery covered a third of the scene,
        which inverts the hierarchy this product depends on: the picture is the
        argument, and the controls for it are not.
      */}
      {overlays.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {overlayGroups.map((group) => (
            <div key={group.agent} className="flex flex-wrap items-center gap-1">
              <span className="text-mist-500 mr-0.5 text-[11px] font-semibold tracking-[0.1em] uppercase">
                {group.label}
              </span>
              {group.overlays.map((overlay) => {
                const on = visibleOverlayIds.includes(overlay.id);
                return (
                  <button
                    key={overlay.id}
                    onClick={() => onToggleOverlay(overlay.id)}
                    aria-pressed={on}
                    className={`flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                      on
                        ? "border-ink-600 bg-ink-800 text-mist-100"
                        : "border-transparent text-mist-500 hover:text-mist-300 hover:bg-ink-850"
                    }`}
                  >
                    <span
                      className="size-2 rounded-[3px] transition-opacity"
                      style={{ background: overlay.color, opacity: on ? 1 : 0.45 }}
                    />
                    {overlay.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
