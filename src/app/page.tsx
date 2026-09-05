import Link from "next/link";
import { Wordmark } from "@/components/chrome";
import { rasterUrl } from "@/lib/satquery/client";
import { DEMO_SCENARIOS, SUGGESTED_PROMPTS } from "@/lib/satquery/scenarios";
import { RASTER_VERSION } from "@/lib/satquery/version";

/**
 * Landing.
 *
 * One promise, one action, and a picture of the thing working. The preview on
 * the right is doing the heavy lifting: it shows an answer, a confidence and an
 * evidence state over real imagery, so the product explains itself before
 * anyone reads a word of the copy.
 */

const CAPABILITIES = [
  { name: "Vision", question: "What is here?" },
  { name: "Grounding", question: "Where is it?" },
  { name: "Change", question: "What changed?" },
  { name: "SAR", question: "What does radar reveal?" },
  { name: "Evidence", question: "Do the signals agree?" },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <Link
          href={{ pathname: "/workspace", query: { scenario: "change" } }}
          className="text-mist-400 hover:text-mist-100 text-sm transition-colors"
        >
          Open workspace →
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-6 pt-10 pb-20 sm:px-10">
        {/* hero */}
        <section className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <h1 className="text-mist-100 text-4xl leading-[1.08] font-medium tracking-[-0.03em] text-balance sm:text-5xl">
              Ask your satellite imagery anything.
            </h1>
            <p className="text-mist-400 mt-5 max-w-lg text-base leading-relaxed">
              SatQuery works out which analysis your question needs, runs the specialists that
              can answer it, and shows you the evidence behind the result.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={{ pathname: "/workspace", query: { scenario: "change" } }}
                className="bg-mist-100 text-ink-950 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors hover:bg-white"
              >
                Try a demo
              </Link>
              <Link
                href={{ pathname: "/workspace", query: { scenario: "vqa" } }}
                className="border-ink-600 bg-ink-850 text-mist-200 hover:bg-ink-800 hover:border-ink-500 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
              >
                Upload imagery
              </Link>
            </div>

            <div className="mt-9">
              <p className="text-mist-500 text-[10px] font-semibold tracking-[0.14em] uppercase">
                Try asking
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <Link
                    key={prompt.text}
                    href={{
                      pathname: "/workspace",
                      query: { scenario: prompt.scenarioId, q: prompt.text },
                    }}
                    className="border-ink-700 text-mist-300 hover:text-mist-100 hover:border-ink-600 hover:bg-ink-850 rounded-full border px-3.5 py-1.5 text-xs transition-colors"
                  >
                    {prompt.text}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* preview: the whole product in one frame */}
          <div className="relative">
            <div className="border-ink-700 bg-ink-900 overflow-hidden rounded-2xl border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={rasterUrl("valley-optical-t2", "optical", undefined, RASTER_VERSION)}
                alt="Optical satellite scene of a valley with settlements and a reservoir"
                className="aspect-square w-full object-cover"
              />
            </div>

            <div className="border-ink-600 bg-ink-850/95 absolute -bottom-5 -left-4 w-[min(20rem,88%)] rounded-xl border p-4 shadow-2xl shadow-black/50 backdrop-blur sm:-left-6">
              <p className="text-mist-500 text-[10px] font-semibold tracking-[0.14em] uppercase">
                SatQuery result
              </p>
              <p className="text-mist-100 mt-2 flex items-start gap-2 text-[15px] leading-snug font-medium">
                <span aria-hidden>🏗️</span>
                Built-up area increased by approximately 14%
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="bg-ink-700 h-1.5 flex-1 overflow-hidden rounded-full">
                  <div className="bg-good h-full rounded-full" style={{ width: "90%" }} />
                </div>
                <span className="text-mist-100 tabular font-mono text-sm">90%</span>
              </div>
              <p className="text-good mt-2.5 flex items-center gap-2 text-xs font-medium">
                <span className="bg-good size-1.5 rounded-full" />
                Evidence consistent
              </p>
            </div>
          </div>
        </section>

        {/* capabilities */}
        <section className="border-ink-700 border-t pt-10">
          <p className="text-mist-500 text-[10px] font-semibold tracking-[0.14em] uppercase">
            Five specialists, one interface
          </p>
          <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
            {CAPABILITIES.map((capability) => (
              <div key={capability.name}>
                <p className="text-mist-100 text-sm font-medium">{capability.name}</p>
                <p className="text-mist-500 mt-0.5 text-xs">{capability.question}</p>
              </div>
            ))}
          </div>
          <p className="text-mist-400 mt-6 max-w-2xl text-sm leading-relaxed">
            You never choose between them. A local language layer reads your question, the
            router picks the specialists that can answer it, and an evidence engine checks
            whether their independent findings actually agree before you are shown a number.
          </p>
        </section>

        {/* scenarios */}
        <section className="border-ink-700 border-t pt-10">
          <p className="text-mist-500 text-[10px] font-semibold tracking-[0.14em] uppercase">
            Demo scenarios
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_SCENARIOS.map((scenario) => (
              <Link
                key={scenario.id}
                href={{ pathname: "/workspace", query: { scenario: scenario.id } }}
                className="border-ink-700 bg-ink-850 hover:border-ink-600 hover:bg-ink-800 group rounded-xl border p-4 transition-colors"
              >
                <div className="flex items-baseline gap-2.5">
                  <span className="text-mist-500 tabular font-mono text-xs">
                    {scenario.index}
                  </span>
                  <span className="text-mist-100 text-sm font-medium">{scenario.title}</span>
                </div>
                <p className="text-mist-500 mt-1.5 text-xs">{scenario.subtitle}</p>
                <p className="text-mist-400 mt-2.5 text-xs leading-relaxed">
                  {scenario.demonstrates}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-ink-700 text-mist-500 border-t px-6 py-5 text-[11px] sm:px-10">
        Internal prototype · Problem statement 26167 · Scenes are procedurally generated;
        every figure shown is measured from them by the analysis described in the trace.
      </footer>
    </div>
  );
}
