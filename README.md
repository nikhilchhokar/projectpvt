# SatQuery AI

**An interactive vision-language assistant for multimodal remote-sensing analysis through text queries.**
Problem statement 26167 — internal selection prototype.

You ask a question in ordinary language. SatQuery works out what analysis the
question needs, runs the specialists that can answer it, checks whether their
independent findings actually agree, and then shows you both the answer and the
place on the ground it came from.

```
UPLOAD → ASK → ANALYSE → RESULT → WHY? → SHOW ME → TRACE → EXPERT
```

---

## What is real here

This is a prototype, so it is worth being precise about which parts are real,
because more of it is than you might expect.

**Real.** Every number the interface displays is measured at request time by an
algorithm running over raster data. The specialists compute normalised
difference indices (NDVI, NDWI), Otsu thresholds, local texture, morphological
cleanup, connected-component labelling, multi-look speckle filtering and
MAD-derived change thresholds. Confidence is derived from measured class
separability, mask stability and cross-sensor overlap — never assigned. The
router, the input validator, the evidence engine and the language-layer
abstraction are all working code, not diagrams.

**Synthetic.** The imagery. The prototype ships no satellite tiles; scenes are
generated procedurally from a seeded landscape description, with physically
plausible band reflectances, atmospheric path radiance, a sensor point-spread
function and multiplicative SAR speckle. This is what makes the analysis honest
rather than staged: the agents genuinely do not know what the answer is, and
neither the percentages nor the confidences are written down anywhere.

**Not claimed.** No benchmark scores, no accuracy figures against real data, no
validation by any agency, no trained models. Swapping `scene.ts` for a GeoTIFF
reader is the change that would point these same agents at real imagery.

---

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run scenarios` | Runs all six demo scenarios through the engine and prints what a judge would see |
| `npm run diagnose` | Per-scene class fractions, thresholds, separability and change statistics |
| `npm run smoke` | End-to-end check against a running server |

`npm run scenarios` is the fastest way to see that the engine is doing real
work: it prints intent classification, the routing decision, every specialist's
claim and confidence, the evidence cross-check and the full execution trace.

---

## Architecture

```
                         USER QUERY
                             │
                   Local language layer          interpretQuery
                    (LocalLLMProvider)           planWorkflow
                             │
                        Task router
                             │
                      Input validator            format · CRS · dimensions
                             │                   alignment · temporal · modality
                       Tool registry
                             │
          ┌──────────────┬───┴────────┬──────────────┐
          ▼              ▼            ▼              ▼
       Vision        Grounding     Change          SAR
    what is here?   where is it?  what changed?  what does radar reveal?
          │              │            │              │
          └──────────────┴─────┬──────┴──────────────┘
                               ▼
                        Evidence engine            polarity agreement
                               │                   spatial containment
                        Result synthesis           corroborated coverage
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
                  WHY?                 SHOW ME
             textual evidence      visual/spatial proof
```

Source layout:

| Path | Responsibility |
| --- | --- |
| `src/lib/satquery/types.ts` | Every contract that crosses a boundary |
| `src/lib/satquery/engine.ts` | The orchestrator: interpret → validate → plan → run → cross-check → simplify |
| `src/lib/satquery/scene.ts` | Procedural scene generation (replace this with a GeoTIFF reader) |
| `src/lib/satquery/raster.ts` | Indices, thresholding, morphology, components, agreement |
| `src/lib/satquery/landcover.ts` | Shared land-cover classifier and threshold harmonisation |
| `src/lib/satquery/agents/` | The four specialists, all returning one uniform result shape |
| `src/lib/satquery/evidence.ts` | Cross-checks independent findings |
| `src/lib/satquery/llm/` | `LocalLLMProvider` interface + deterministic and PocketLLM implementations |
| `src/lib/satquery/validator.ts` | Input compatibility, before any specialist runs |
| `src/app/api/` | The service boundary: `analyze`, `scenarios`, `raster` |

### The rule that makes it extensible

Nothing above `types.ts` knows which implementation produced a result. Agents
receive resolved inputs and return `AgentResult`; they never call each other and
never reach for global state. Registering a real model in `registry.ts` is the
only change required to replace a specialist — the router, the evidence engine
and the entire interface are unaffected.

---

## The local language layer

SatQuery draws a hard line between two kinds of intelligence:

- **Language and workflow** — interpreting the question, classifying intent,
  planning the workflow, phrasing the answer. This is the `LocalLLMProvider`.
- **Perception** — everything involving pixels. This is the specialists.

The language layer never looks at imagery. That separation is what makes a
small on-device model a sensible choice for this role rather than a gimmick:
the hard perception work is not being asked of it.

Two implementations ship:

- `DeterministicLanguageProvider` — the default. Explicit, inspectable rules.
  Every sentence is assembled from a measured quantity, so it cannot claim
  something the analysis did not find.
- `PocketLLMProvider` — an adapter for an on-device model server speaking the
  OpenAI-compatible chat-completions shape. Enable it with:

  ```bash
  SATQUERY_LOCAL_LLM_URL=http://127.0.0.1:8080/v1/chat/completions
  SATQUERY_LOCAL_LLM_MODEL=pocketllm
  SATQUERY_LOCAL_LLM_NAME=PocketLLM
  ```

  It handles interpretation and phrasing, and delegates measurement entirely.
  `simplifyResult` rejects any rewrite that introduces a figure the analysis did
  not produce.

The interface reports whichever provider is **actually active**, by name, in the
execution trace and in Expert Mode. If PocketLLM is not reachable the app falls
back and says so rather than claiming a model that is not running.

---

## Design decisions worth knowing about

A few choices in here are load-bearing, and each exists because the obvious
alternative produces a confident wrong answer.

**Harmonised thresholds across epochs.** Otsu is scene-adaptive, which is
exactly wrong for change detection: a brighter dry season shifts the threshold,
and the shift alone registers as change. Both epochs are classified with one
threshold set pooled across them.

**Fixed reflectance range for rendering.** A per-scene percentile stretch makes
identical ground render differently in each epoch, so toggling Before/After
would show brightness changes that are artefacts of the display. Optical uses a
fixed 0.012–0.34 reflectance window; SAR a fixed −24 to −2 dB window.

**Minimum mappable unit before quantifying.** Scattered surviving pixels are
classifier noise, not land that changed. Area is measured only over mapped
patches, so the headline percentage refers to the same regions the map draws.

**Containment and coverage, not just IoU.** Radar fires only on the densest new
construction, so its footprint is legitimately smaller than the optical one. IoU
punishes that; containment does not. Agreement uses both — *are they pointing at
the same place*, and *how much of the claim was corroborated*.

**Agreement never reads 100%.** The agreement statistics saturate rather than
clamp. Two independent sensors are never in literally perfect accord, and
displaying "100%" would be a claim about certainty this system cannot support.

**Contradiction outranks the number.** When optical reports growth and radar
refuses to confirm it, the headline leads with the doubt and demotes the
measurement to a qualifier. Demo scenario 05 exercises this path.

---

## Demo scenarios

All six run against the real engine. The inputs are fixed; the answers are not
written down anywhere.

| | Scenario | Demonstrates |
| --- | --- | --- |
| 01 | Ask about an image | Single-image VQA from one optical scene |
| 02 | Find the water | Grounding — a textual answer tied to an exact region |
| 03 | Detect change | Quantified bi-temporal change. Nobody asked for radar; the router pulled it in because the question needed corroboration |
| 04 | Optical + SAR | Explicit cross-modal analysis, two sensors corroborating one conclusion |
| 05 | When the sensors disagree | Optical reports growth radar will not confirm. SatQuery reports the doubt instead of the number |
| 06 | Expert mode | Choose the specialists, thresholds and validation rules yourself |

---

## Interface

**Default mode** — *tell SatQuery what you want to know.* Upload, ask, read the
answer, click WHY for the evidence, click SHOW ME to see where it came from.

**Expert mode** — *control how SatQuery gets the answer.* Every control is wired
to a real parameter: deselecting a specialist removes it from the plan, moving a
threshold changes what the classifier calls built-up, and turning off
cross-model agreement genuinely stops the evidence engine looking for it.

---

## Known limits

- Ingest accepts the seeded scenes only; arbitrary GeoTIFF upload is the next
  piece of work. The interface says so rather than offering a control that would
  quietly do nothing.
- Built-up classification runs at roughly 73% recall and 60% precision against
  the generator's own labels — realistic for index-based mapping, and the reason
  cross-modal corroboration matters.
- History is per-session and in memory.
- `RASTER_VERSION` is per process, so a multi-instance deployment would see
  cache misses across instances (not incorrect results).
