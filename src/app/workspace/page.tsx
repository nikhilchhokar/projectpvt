"use client";

/**
 * The analysis workspace.
 *
 * Layout follows the hierarchy the product is judged on: imagery is the largest
 * thing on screen, the answer sits directly beneath the question that produced
 * it, and evidence lives one click away rather than one page away. Expert
 * controls share the right rail rather than displacing anything, so turning
 * them on never costs the user their view of the map.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ExpertPanel from "@/components/ExpertPanel";
import InputPanel from "@/components/InputPanel";
import ReportModal from "@/components/ReportModal";
import ResultCard from "@/components/ResultCard";
import Viewer from "@/components/Viewer";
import { HistoryList, QueryBar, TopBar, UploadHint } from "@/components/chrome";
import { EvidencePanel, TracePanel } from "@/components/panels";
import { SectionLabel } from "@/components/primitives";
import { analyze, fetchCatalogue, type Catalogue } from "@/lib/satquery/client";
import { SCENE_SIZE } from "@/lib/satquery/constants";
import type { DemoScenario } from "@/lib/satquery/scenarios";
import type { AgentId, AnalysisResult, ExpertOptions, Region } from "@/lib/satquery/types";

type RightTab = "evidence" | "trace" | "control";

/** Padded union of a set of regions, in raster pixel space. */
function regionBounds(regions: Region[]): [number, number, number, number] | null {
  if (!regions.length) return null;
  let x0 = SCENE_SIZE;
  let y0 = SCENE_SIZE;
  let x1 = 0;
  let y1 = 0;
  for (const region of regions) {
    x0 = Math.min(x0, region.bbox[0]);
    y0 = Math.min(y0, region.bbox[1]);
    x1 = Math.max(x1, region.bbox[2]);
    y1 = Math.max(y1, region.bbox[3]);
  }
  const pad = 40;
  return [
    Math.max(0, x0 - pad),
    Math.max(0, y0 - pad),
    Math.min(SCENE_SIZE, x1 + pad),
    Math.min(SCENE_SIZE, y1 + pad),
  ];
}

function WorkspaceInner() {
  const params = useSearchParams();

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [scenario, setScenario] = useState<DemoScenario | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"simple" | "expert">("simple");
  const [rightTab, setRightTab] = useState<RightTab>("evidence");
  const [options, setOptions] = useState<ExpertOptions>({});

  const [activeLayerId, setActiveLayerId] = useState("");
  const [visibleOverlayIds, setVisibleOverlayIds] = useState<string[]>([]);
  const [focus, setFocus] = useState<[number, number, number, number] | null>(null);
  const [showMeActive, setShowMeActive] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  // --- bootstrap ------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    fetchCatalogue()
      .then((data) => {
        if (cancelled) return;
        setCatalogue(data);
        const wanted = params.get("scenario");
        const chosen = data.scenarios.find((s) => s.id === wanted) ?? data.scenarios[0];
        setScenario(chosen);
        setQuery(params.get("q") ?? chosen.query);
        if (chosen.expertMode) {
          setMode("expert");
          setRightTab("control");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // Bootstrap once; later scenario changes go through loadScenario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- running --------------------------------------------------------------

  const run = useCallback(async () => {
    if (!scenario || !query.trim() || busy) return;
    setBusy(true);
    setError(null);
    setShowMeActive(false);
    setActiveAgent(null);
    setVisibleOverlayIds([]);
    setFocus(null);

    try {
      const next = await analyze({
        query: query.trim(),
        images: scenario.images,
        options: mode === "expert" ? options : undefined,
      });
      setResult(next);
      setHistory((prev) => [next, ...prev].slice(0, 8));
      setActiveLayerId(next.visualization.primaryLayer);
      setRightTab((tab) => (tab === "control" ? "control" : "evidence"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [scenario, query, busy, mode, options]);

  const loadScenario = (next: DemoScenario) => {
    setScenario(next);
    setQuery(next.query);
    setResult(null);
    setVisibleOverlayIds([]);
    setFocus(null);
    setShowMeActive(false);
    setActiveLayerId("");
    setError(null);
  };

  // --- SHOW ME --------------------------------------------------------------

  const onShowMe = () => {
    if (!result?.visualization.focus) return;
    setVisibleOverlayIds(result.visualization.primaryOverlayIds);
    setShowMeActive(true);
    const primaryAgent = result.visualization.overlays.find((o) =>
      result.visualization.primaryOverlayIds.includes(o.id),
    )?.sourceAgent;
    setActiveAgent(primaryAgent ?? null);
    // A fresh array so repeated presses re-run the flight.
    setFocus([...result.visualization.focus]);
  };

  /** Selecting a row in WHY reveals exactly the evidence that row is about. */
  const onFocusAgent = (agent: AgentId) => {
    if (!result) return;
    const agentResult = result.agents.find((a) => a.agent === agent);
    if (!agentResult) return;
    setActiveAgent(agent);
    setVisibleOverlayIds(agentResult.masks.slice(0, 1).map((m) => m.id));
    const box = regionBounds(agentResult.regions);
    if (box) {
      setShowMeActive(true);
      setFocus(box);
    }
  };

  const toggleOverlay = (id: string) => {
    setVisibleOverlayIds((prev) =>
      prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id],
    );
  };

  // --- derived --------------------------------------------------------------

  const overlays = result?.visualization.overlays ?? [];

  const visibleRegions = useMemo(() => {
    if (!result || !showMeActive) return [];
    return result.agents
      .filter((agent) => agent.masks.some((m) => visibleOverlayIds.includes(m.id)))
      .flatMap((agent) => agent.regions);
  }, [result, showMeActive, visibleOverlayIds]);

  const previewLayers = useMemo(() => {
    const analysed = result?.visualization.availableLayers ?? [];
    if (analysed.length) return analysed;
    if (!scenario) return [];
    // Before any analysis has run, the viewer still shows the supplied inputs.
    const sarCount = scenario.images.filter((i) => i.modality === "sar").length;
    return scenario.images.map((image) => ({
      id: `preview-${image.id}`,
      label:
        image.modality === "sar"
          ? sarCount > 1
            ? `SAR ${image.role === "before" ? "before" : "after"}`
            : "SAR"
          : image.role === "before"
            ? "Before"
            : image.role === "after"
              ? "After"
              : "Optical",
      kind: image.modality === "sar" ? ("sar" as const) : ("optical" as const),
      sceneKey: image.sceneKey,
      caption: `${image.name} · ${image.acquired}`,
    }));
  }, [result, scenario]);

  const effectiveLayerId = activeLayerId || previewLayers[0]?.id || "";
  const suggestions = useMemo(
    () => (result ? [] : (catalogue?.suggestions.map((s) => s.text) ?? [])),
    [result, catalogue],
  );

  if (error && !catalogue) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-bad text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          setRightTab(m === "expert" ? "control" : "evidence");
        }}
        scenarioTitle={scenario?.title}
        languageLayer={catalogue?.languageLayer.name}
        onReport={() => setReportOpen(true)}
        canReport={Boolean(result)}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[264px_minmax(0,1fr)_336px]">
        {/* left: inputs */}
        <aside className="border-ink-700 hidden min-h-0 flex-col gap-5 overflow-y-auto border-r p-4 lg:flex">
          {scenario && <InputPanel images={scenario.images} validation={result?.validation} />}

          {catalogue && scenario && (
            <div>
              <SectionLabel>Scenes</SectionLabel>
              <div className="mt-2 flex flex-col gap-1">
                {catalogue.scenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadScenario(s)}
                    className={`flex w-full items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                      s.id === scenario.id
                        ? "border-ink-600 bg-ink-800"
                        : "border-transparent hover:border-ink-700 hover:bg-ink-800/60"
                    }`}
                  >
                    <span className="text-mist-500 tabular font-mono text-[10px]">
                      {s.index}
                    </span>
                    <span className="text-mist-300 text-[11px]">{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <UploadHint onLoadDemo={() => catalogue && loadScenario(catalogue.scenarios[0])} />

          <HistoryList entries={history} activeId={result?.id} onSelect={setResult} />
        </aside>

        {/* centre: imagery, question, answer */}
        <main className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex min-h-[42vh] flex-col lg:min-h-[46vh]">
            <Viewer
              layers={previewLayers}
              activeLayerId={effectiveLayerId}
              onLayerChange={setActiveLayerId}
              overlays={overlays}
              visibleOverlayIds={visibleOverlayIds}
              onToggleOverlay={toggleOverlay}
              regions={visibleRegions}
              focus={focus}
              bounds={scenario?.images[0]?.bounds}
              busy={busy}
            />
          </div>

          <QueryBar
            value={query}
            onChange={setQuery}
            onSubmit={run}
            busy={busy}
            suggestions={suggestions}
          />

          {error && (
            <p className="border-bad/30 bg-bad/8 text-bad rounded-lg border px-3 py-2 text-xs">
              {error}
            </p>
          )}

          {result ? (
            <>
              <ResultCard
                result={result}
                onWhy={() => setRightTab("evidence")}
                onShowMe={onShowMe}
                whyActive={rightTab === "evidence"}
                showMeActive={showMeActive}
              />
              {result.failure && (
                <div className="border-ink-700 bg-ink-850 rounded-xl border p-4">
                  <SectionLabel>What to do next</SectionLabel>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {result.failure.nextSteps.map((step) => (
                      <li key={step} className="text-mist-300 flex gap-2 text-xs">
                        <span className="text-mist-500">→</span>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            !busy && (
              <div className="border-ink-700 bg-ink-850/50 rounded-xl border border-dashed p-5">
                <p className="text-mist-300 text-sm">
                  {scenario
                    ? `${scenario.images.length} image${scenario.images.length === 1 ? "" : "s"} loaded. Ask a question to begin.`
                    : "Loading imagery…"}
                </p>
                <p className="text-mist-500 mt-1 text-xs">
                  SatQuery will choose the specialists, run them, and show you what the answer
                  rests on.
                </p>
              </div>
            )
          )}
        </main>

        {/* right: evidence, trace, control */}
        <aside className="border-ink-700 hidden min-h-0 flex-col border-l lg:flex">
          <div className="border-ink-700 flex border-b">
            {(
              [
                { id: "evidence" as const, label: "Why" },
                { id: "trace" as const, label: "Trace" },
                ...(mode === "expert" ? [{ id: "control" as const, label: "Control" }] : []),
              ] satisfies { id: RightTab; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
                  rightTab === tab.id
                    ? "text-accent border-accent border-b-2"
                    : "text-mist-500 hover:text-mist-300 border-b-2 border-transparent"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {rightTab === "control" && catalogue ? (
              <ExpertPanel
                specialists={catalogue.specialists}
                languageLayer={catalogue.languageLayer}
                options={options}
                onChange={setOptions}
                onRun={run}
                busy={busy}
              />
            ) : result ? (
              rightTab === "evidence" ? (
                <EvidencePanel
                  result={result}
                  onFocusAgent={onFocusAgent}
                  activeAgent={activeAgent}
                />
              ) : (
                <TracePanel result={result} />
              )
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-mist-500 text-center text-xs leading-relaxed">
                  Evidence and the execution trace appear here once an analysis has run.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {reportOpen && result && (
        <ReportModal result={result} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-mist-500 text-sm">Loading workspace…</p>
        </div>
      }
    >
      <WorkspaceInner />
    </Suspense>
  );
}
