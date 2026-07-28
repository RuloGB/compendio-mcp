# Archive Report: Index Progress Reporting

**Change**: `index-progress-reporting`  
**Archived**: 2026-07-28  
**Status**: COMPLETE with WARNINGS FIXED  
**Artifact Store**: openspec  

## Executive Summary

The `index-progress-reporting` change is archived and closed. This feature adds live progress reporting to `compendio index` via a redrawn bar in interactive terminals and append-only lines elsewhere. All 62 implementation tasks are complete (61 active + 1 deliberately skipped), the feature was validated end-to-end on a real cold download, and the two stale warning items flagged in `verify-report.md` have been corrected.

## Change Scope

### New Capability

- **`index-progress`**: live progress display for `compendio index` with three modes (`bar`/`plain`/`none`), automatic TTY detection, two design decisions revised after apply based on real measurements, and a known residual limitation documented.

### Modified Capabilities

- None. Existing indexing behavior is preserved by design.

### Key Decisions Finalized During Implementation

| Decision | Original | Final | Reason for Revision |
|---|---|---|---|
| **D1 — Download throttle** | — | 1% for bar, 5% for plain | Balanced liveness vs. CI log spam |
| **D2 — Bar refresh** | 100 ms coalescer only | Coalescer + 200 ms timer + elapsed indicator | Event-driven renderer produces 0 bytes during silent inference; timer-driven heartbeat fixes it |
| **D3 — Bar threshold** | 5 000 ms (original design) | 1 500 ms (revised apply) | 5s gate hid the bar from every ordinary warm-cache run; revised to actually show the feature |

## Artifacts Merged

### Main Specs Updated

- **`openspec/specs/index-progress/spec.md`** created (NEW)
  - 11 requirements covering progress events, two renderers, mode resolution, phase denominators, stderr/stdout separation, bar hygiene, denominators with zero, existing behavior preservation, flash prevention, repaint during long silences, and download throttling.
  - All requirements are in ADDED form (delta→main conversion per openspec convention).

### Delta Spec Conversion

- Source: `openspec/changes/index-progress-reporting/specs/index-progress/spec.md`
- Destination: `openspec/specs/index-progress/spec.md`
- Conversion: Delta form (`## ADDED Requirements`) copied as-is into standing-spec format (no modifications to other specs, so no MODIFIED/REMOVED/RENAMED sections needed).

## Completion Status

| Metric | Value | Notes |
|---|---|---|
| Implementation tasks | 62 total | 61 checked; 1 deliberately incomplete (3.28) by owner decision |
| Task 3.28 status | INCOMPLETE BY DESIGN | Large-corpus end-to-end bar proof test cost ~9.6s of 17.5s suite and would silently skip on faster hardware. Withdrawn. Bar threshold/frame logic covered deterministically by unit tests; end-to-end stderr write remains unproven by design. Comment in `test/cli-subprocess.test.ts` documents why. |
| Test suite | 306/306 passing | npm test: full suite green; npm run typecheck: clean |
| Code quality | Clean | Two design decisions reversed post-apply (D2/D3); corrections documented honestly in apply-progress.md and this report; no regressions |
| Build | Clean | npm run build: tsc passes; dist/ built successfully |

## Stale Warnings — RESOLVED

The `verify-report.md` flagged two user-facing documentation issues:

1. **CLAUDE.md stale threshold description** — FIXED in commit d3e96ee
   - Was: "bar appears once the run exceeds ~5s" and "warm cache: bar is silent below ~3-4s"
   - Now: "Warm cache: the run still crosses `BAR_MIN_ELAPSED_MS` (1 500 ms) and draws, but **few frames**..."
   - Status: Corrected, verified in codebase

2. **apply-progress.md stale test count** — FIXED in same commit
   - Was: "12 total in the file, 4 new"
   - Now: Accurate count "11 total" after large-corpus test withdrawn
   - Status: Corrected and final count (306/306) verified

## Implementation Facts (Honesty Record)

This section records the exact state of the implementation for audit traceability:

### Tasks

- **61 of 62 complete. Task 3.28 deliberately skipped.**
  - 3.28: "confirm bar is reachable end-to-end through the wiring from 3.24"
  - Rationale: End-to-end proof required a 4 000-file synthetic corpus, cost ~9.6s of a 17.5s suite, and would silently skip on faster hardware. Threshold and redraw logic covered deterministically by `progress-sink.test.ts` (fake clock tests). The wiring itself reaches the CLI but writing to real stderr is not asserted. Documented in `test/cli-subprocess.test.ts:212-228`.

### Design Revisions (Post-Apply)

**D2: Bar refresh strategy** — REVISED from "coalescer only" to "coalescer + heartbeat timer"
- Why: Running the built CLI against this repo's own `docs/` produced 0 bytes on stderr — event-driven renderer cannot detect time-based threshold crossing when no events arrive after it. Fixed by arming `setInterval` unconditionally at sink construction (bar mode only), so the repaint timer fires independent of event arrival.
- Verification: Reproduced with a unit test matching the exact production event shape (all events at `clock=0`, only timer afterward). Confirmed against real CLI.

**D3: Bar threshold** — REVISED from "5 000 ms" to "1 500 ms"
- Why: 5s gate suppressed the bar from every ordinary warm-cache run (~3.2-3.9s on real machines). A gate that hides its own feature in common cases is tuned wrong.
- Updated: `BAR_MIN_ELAPSED_MS = 1_500` in source. Tests rewritten to derive from the constant instead of hardcoding `5_000`, so retuning no longer breaks them.

### Residual Limitation (Documented, Not Hidden)

`onnxruntime-node` blocks Node's main thread during inference (0 timer fires during a 1 132 ms `embed()` call on Windows 10). Consequence: for a corpus whose *entire* duration is one blocking `create()` + `embed()` call, stderr stays empty even past the threshold. This repo's current `docs/` (1 indexable file) is in this degenerate case. Larger corpora (e.g. `ejemplos/`, multi-batch) work as designed — observed directly: 241 bytes, 3 frames with elapsed advancing `3.7s` → `3.8s`. Root cause is structural to ONNX inference, not to progress reporting. Moving inference to `worker_threads` would fix it, but is out of scope. Documented in `design.md` D2 "Known residual limitation" and `timing-measurement.md` Addendum A.

## Verification Summary

Per `verify-report.md` (PASS WITH WARNINGS, 0 CRITICAL):

| Requirement | Evidence | Result |
|---|---|---|
| Build & tests | `npm test` 306/306, `npm run typecheck` clean, `npm run build` clean | PASS |
| Tasks complete | 61/62 checked; 1 deliberately incomplete (3.28) | PASS (with documented reason) |
| Binary execution | Real `ejemplos/` run in three modes produces correct stderr/stdout | PASS |
| Spec compliance | 8 of 11 requirements fully end-to-end; 3 rest on unit + code inspection | PASS (gaps honestly disclosed pre-verification) |
| Dependencies | `package.json` unchanged | PASS |
| Design coherence | D1/D2 (revised)/D3 (revised) all followed | PASS |
| TDD compliance | Full RED/GREEN/TRIANGULATE/REFACTOR tables; 306 tests passing | PASS |

### Known Verification Gaps (Pre-Disclosed, Not Hidden)

1. **Zero-Configuration Bar in TTY** — resolver logic unit-proven; the literal "bar appears in an interactive terminal" claim rests on code inspection of one wiring line + resolver unit test, never an actual TTY observation.
2. **Bar Hygiene Before embeddingsWarning** — structurally sound (finally-block ordering + isolated erase unit test); the specific "failure mid-run in bar mode" combination is not covered by a single test or observation.
3. **Indexed content identical across modes** — sound by construction (report calls have no side effect) + count-level proxy (stdout identical), but not an explicit DB-level equality assertion.

All three gaps were explicitly disclosed in proposal.md and apply-progress.md before verification, not hidden.

## Archive Contents

```
openspec/changes/archive/2026-07-28-index-progress-reporting/
├── proposal.md                     — Change scope, approach, decisions
├── specs/
│   └── index-progress/
│       └── spec.md                — Delta spec (11 ADDED requirements)
├── design.md                       — D1/D2 (revised)/D3 (revised), contracts, seams
├── timing-measurement.md           — 105.8 ms/chunk, download-dominates conclusion
├── tasks.md                        — 62 tasks (61 complete, 1 deliberately skipped)
├── apply-progress.md               — TDD evidence, deviations, follow-up batch (D2 repaint)
├── verify-report.md                — PASS WITH WARNINGS (0 CRITICAL), gaps disclosed
├── exploration.md                  — Feasibility study, approach decision
└── archive-report.md              — This file
```

## Source of Truth Updated

- **`openspec/specs/index-progress/spec.md`** — Main spec created and synced
- **No modifications to existing specs** — `indexing`, `configuration`, `search`, `index-md`, `mcp-contract` unchanged

## SDD Cycle Complete

This change has been fully planned (explore → propose), designed, implemented (apply), verified, and archived. The feature is ready for deployment:

- All required capabilities implemented and tested.
- Design decisions documented with rationale and post-apply corrections.
- Known limitations (residual: ONNX event-loop starvation) documented and flagged for future work.
- Rollback: setting `COMPENDIO_PROGRESS=none` restores today's exact output at runtime. Hard rollback: revert the commits.

## Recommendations

No follow-up work is required to close this change. The one residual limitation (event-loop starvation during ONNX inference on single-call corpora) is documented and flagged for the repository owner to prioritize separately if desired, but does not affect normal multi-batch use cases (validated against `ejemplos/`).
