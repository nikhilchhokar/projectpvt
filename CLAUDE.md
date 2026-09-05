# SatQuery AI — working notes

Read `README.md` first; it explains the architecture and the reasoning behind
the load-bearing design decisions.

## The one rule

Nothing above `src/lib/satquery/types.ts` may know which implementation produced
a result. Agents receive resolved inputs and return `AgentResult`. They never
call each other, never reach for global state, and never learn which language
provider is active. Breaking this is what would turn "swap the mocks for real
models" from true into aspirational.

## Never fabricate a number

Every figure the interface shows must be computed from raster data at request
time. If a change is needed that would make a displayed value hardcoded,
seeded, or otherwise disconnected from a measurement, that is the wrong change.
Confidence in particular is derived from measured separability, mask stability
and cross-sensor overlap — a low signal must produce a low number, because the
low-confidence path is a feature.

Equally: never claim a capability that is not running. The execution trace
reports the language provider that actually answered, by name.

## Verifying changes

Anything touching `scene.ts`, `landcover.ts`, `raster.ts` or the agents changes
the numbers. After such a change:

```bash
npm run diagnose      # class fractions, thresholds, separability, change stats
npm run scenarios     # all six demo scenarios end to end
npm run smoke         # against a running server
```

The valley pair should land near +14% at roughly 90% confidence with strong
spatial agreement, and the coastal pair should stay a contradiction that the
evidence engine refuses to endorse. If those move, retune the scene rather than
the reporting.

## Caches

`generateScene`, `classifyCached` and the PNG cache are all module-level and
keyed by scene key. That is correct for a build, where scenes are immutable, but
it means a dev server that hot-reloaded `scene.ts` can hold classifications of
the previous generator. Restart the server after changing scene generation
rather than trusting hot reload.

Raster URLs carry `RASTER_VERSION`, so a restart invalidates browser caches too.
