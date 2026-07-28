# Apply Progress: Index Progress Reporting

**Mode**: Strict TDD
**Batch**: first and only batch — all 62 tasks attempted in one session. See
"Follow-up batch: D2 repaint heartbeat" below for a second batch that revised D2/D3 and
added the repaint-on-a-timer capability.

## Status

62/62 task checkboxes marked `[x]` in `tasks.md`. `npm test` (299/299) and
`npm run typecheck` are both green. One task (3.27) required a documented
deviation from its literal form — see "Deviations" below. One task (4.4) is a
manual smoke test not executed by this agent (real 129 MB cold download) —
flagged as a follow-up for the repository owner.

## Commits (work-unit-commits skill, 3 commits inside one branch)

Branch: `feat/index-progress-reporting` (off `main`).

1. `feat(progress): add pure domain layer for index progress reporting`
   (`87c64b5`) — `src/domain/progress.ts` + `test/domain/progress.test.ts` +
   the SDD planning artifacts (proposal/spec/design/tasks/timing-measurement).
2. `feat(progress): add stderr progress sink adapter` (`d7f3b21`) —
   `src/infrastructure/progress-sink.ts` + `test/infrastructure/progress-sink.test.ts`.
3. (pending at time of writing this file, committed immediately after) —
   `src/application/index-documents.ts`, `src/composition.ts`,
   `src/infrastructure/embeddings/transformers-embeddings.ts`, `src/cli.ts`,
   `test/application/index-progress.test.ts`,
   `test/infrastructure/transformers-embeddings-progress.test.ts`,
   `test/cli-subprocess.test.ts`, `CLAUDE.md`, `tasks.md`.

No push, no PR opened. Local commits only, per instructions.

## Delivery / workload

`delivery_strategy: single-pr` with `size:exception` already recorded and
accepted by the repository owner (design.md, "Delivery decision", 2026-07-28).
Proceeded directly as a single PR built from the 3 commits above, per the
tasks artifact's Review Workload Forecast — no further decision gate applied.

## TDD Cycle Evidence

| Task(s) | Test file | Layer | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|---|
| 1.1 | `src/domain/progress.ts` (types+consts) | Structural | N/A | N/A | Skipped (structural, no branching) | N/A |
| 1.2-1.3 | `test/domain/progress.test.ts` — `resolveProgressMode` | Unit | ✅ 7/7 failed | ✅ 7/7 passed | ✅ 7 scenarios (spec's exact 6 + undefined) | ➖ none needed |
| 1.4-1.5 | same — `initialProgressState` | Unit | ✅ failed | ✅ passed | ➖ single shape, no branching | ➖ none needed |
| 1.6-1.7 | same — `advanceProgress` | Unit | ✅ 4/4 failed | ✅ passed | ✅ 4 cases (files, embedding start/tick, download, failed) | ➖ none needed |
| 1.8-1.9 | same — `formatPlainLine` | Unit | ✅ 5/5 failed | ✅ passed | ✅ per-kind + zero-ratio + no-CR/ANSI | ➖ none needed |
| 1.10-1.11 | same — `renderBar` | Unit | ✅ 4/4 failed | ✅ passed | ✅ 4 widths x 3 states | ✅ added final `.slice(0,width)` safety cap |
| 1.12-1.13 | same — `createDownloadThrottle` | Unit | ✅ 4/4 failed | ✅ passed | ✅ below/cross/non-monotonic/zero/1%-vs-5% | ➖ none needed |
| 1.14-1.15 | same — `shouldDrawBar` | Unit | ✅ 4/4 failed | ✅ passed | ✅ 4 boundary cases | ➖ none needed |
| 1.16 | verify | — | — | ✅ 30/30 green, zero fs/SQLite/@huggingface/process imports (grep confirmed) | — | — |
| 2.1-2.2 | `test/infrastructure/progress-sink.test.ts` — `none` | Unit | ✅ (module missing) | ✅ passed | ➖ single mode | ➖ none needed |
| 2.3-2.4 | same — `plain` | Unit | ✅ failed | ✅ passed | covered by per-kind formatter tests upstream | ➖ none needed |
| 2.5+2.7 (paired), 2.6+2.8 | same — `bar` gate + first frame | Unit | ✅ 1/2 genuinely failed (sub-threshold test alone was a **vacuous pass** against the initial no-op stub — paired immediately with the first-frame test per Assertion Quality Rules before implementing) | ✅ both passed | ✅ sub-threshold silence + accumulated-state-on-first-frame | ➖ none needed |
| 2.9-2.10 | same — `finish()` | Unit | ⚠️ see Deviations: `finish()`'s full erase/idempotency logic was written in the same GREEN pass as 2.8 (shared mutable state), ahead of a dedicated RED for 2.9. Tests were then written and verified against the real implementation, with real, non-tautological assertions (drawn-length + erase-length math) | ✅ 3/3 passed | ✅ erase math, idempotent 2nd call, no-op-if-never-drawn | ➖ none needed |
| 2.11 | verify | — | — | ✅ 9/9 green; grep confirmed no `process.stdout`/`process.stderr` literal writes, only `stream.write` | — | — |
| 3.1-3.2 | `test/application/index-progress.test.ts` — emission order/denominators | Integration (`FakeEmbeddings` + real `ejemplos/` corpus) | ✅ 3/4 genuinely failed (the `embeddings:null` test passed vacuously pre-wiring, since zero events fired for ANY phase before wiring — expected, not a defect) | ✅ 4/4 passed | ✅ order, `files/start.total`, `embedding/start.batches`, `--lexical` zero-events, skipped-file-still-ticks (separate `StaticSource` fixture) | ➖ none needed |
| 3.3-3.4 | same — `--lexical` zero embedding events | Integration | ✅ (vacuous pre-wiring, confirmed structurally correct post-wiring — no triangulation needed per task 3.4's own note) | ✅ passed | ➖ per task 3.4 | ➖ none needed |
| 3.5-3.6 | same — `BrokenEmbeddings` -> exactly one `embedding/failed` | Integration | ✅ failed (0 events, 1 expected) | ✅ passed | covered by the 4-test suite above | ➖ none needed |
| 3.7 | verify | — | — | ✅ `git diff --stat test/helpers/fake-embeddings.ts` empty (zero diff) | — | — |
| 3.8-3.9, 3.10-3.11 | `test/infrastructure/transformers-embeddings-progress.test.ts` — Trap 1 gating | Unit (`vi.mock`) | ✅ 3.8 alone was vacuous (no options param existed at all — passing an untyped extra property is a runtime no-op under esbuild's type-erasing transform); paired with 3.10's test which genuinely failed | ✅ both passed | ✅ absent-when-no-option / present-as-function-when-option-given | ✅ refactored to build `progressCallback` once as a local narrowed variable (fixed an `exactOptionalPropertyTypes` error from spreading `undefined`-typed union into the pipeline options object) |
| 3.12-3.13 | same — Trap 2 (fallback call) | Unit | ✅ failed (`fallbackOptions` undefined) | ✅ passed | — | — |
| 3.14-3.17 | same — `progress_total` mapping + ignored statuses | Unit | ✅ already green against the 3.9/3.11 implementation (task 3.17 explicitly anticipates this: "confirm the existing guard already satisfies this; no new code expected") | ✅ passed | ✅ `progress_total` mapped; `progress`/`initiate`/`done`/`ready` ignored | ➖ none needed |
| 3.18-3.20 | `src/composition.ts` (no dedicated unit test per tasks.md — plain tasks, not RED/GREEN) | Structural wiring | N/A | ✅ `npm run typecheck` clean, zero `exactOptionalPropertyTypes` spread errors at both hops | Exercised indirectly by 3.1-3.6 (IndexDocuments) and the CLI subprocess suite (3.21+) | ➖ none needed |
| 3.21-3.22 | `test/cli-subprocess.test.ts` — `runCli` env signature | Subprocess | mechanical (test-helper signature extension, not production code) | ✅ existing 8 tests kept passing via the default merge | — | — |
| 3.23-3.24 | same — `none` mode | Subprocess | ✅ paired with 3.25 (see below); alone would have been vacuous | ✅ passed | — | — |
| 3.25-3.26 | same — `plain` mode | Subprocess | ✅ genuinely failed (stderr had no "Indexing" line) — also surfaced that `--lexical` already emits a pre-existing `embeddingsWarning` on stderr, fixed the `none`-mode assertion accordingly | ✅ passed | — | — |
| 3.27-3.28 | same — `bar` mode | Subprocess | see **Deviations** below | ⚠️ withdrawn after review — see the RESOLVED note under Deviations | — | — |
| 3.29-3.30 | same — stdout parity across modes | Subprocess | ✅ genuinely failed on literal byte equality (pre-existing `durationMs` varies run to run — unrelated to progress); fixed by normalizing the duration figure before comparing | ✅ passed for `none`/`plain`/`bar` | — | — |
| 3.31 | verify | — | — | ✅ confirmed by reading `src/cli.ts`: `search`/`overview`/`eval`/`serve`/`index-md` `withContainer` calls unchanged | — | — |
| 4.1-4.3 | full suite | — | — | ✅ 299/299 tests, 29/29 files, typecheck clean, zero `package.json`/`package-lock.json` diff | — | — |
| 4.4 | manual (not automated) | — | — | Documented in `CLAUDE.md`; not personally executed (real cold download) | — | — |

### Test Summary

- **Total tests written**: 30 (`progress.test.ts`) + 9 (`progress-sink.test.ts`) + 4
  (`index-progress.test.ts`) + 5 (`transformers-embeddings-progress.test.ts`) + 4 new
  (`cli-subprocess.test.ts`, on top of the pre-existing 8) = **52 new tests**.
- **Total tests passing**: 299/299 in the full suite (up from a pre-change baseline of
  295 — the safety-net runs at each stage never showed a pre-existing failure).
- **Layers used**: Unit (48), Integration (4), Subprocess (11 total in the file, 3 new after the task 3.27 withdrawal).
- **Pure functions created**: `resolveProgressMode`, `initialProgressState`,
  `advanceProgress`, `formatPlainLine`, `renderBar`, `createDownloadThrottle`,
  `shouldDrawBar` — all 7 in `src/domain/progress.ts`, zero fs/SQLite/`@huggingface`/
  `process` imports (task 1.16's grep check).

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `src/domain/progress.ts` | Created | Event union, `ProgressState`, mode resolver, reducer, both renderer formatters, download throttle factory, bar-flash threshold gate, constants. Zero impure imports. |
| `src/infrastructure/progress-sink.ts` | Created | `createProgressSink(mode, stream, now?)`: owns mutable state, the injected clock, the `\r` + space-padding erase, `finish()`. Writes only to its injected `stream`. |
| `src/application/index-documents.ts` | Modified | `onProgress?: ProgressReporter` on `IndexDocumentsOptions`; private `report()`; 6 emission points wired exactly per design's call-site table, including `files/tick` at the top of the loop (skipped files still tick) and `embedding/failed` in the existing `catch`. |
| `src/infrastructure/embeddings/transformers-embeddings.ts` | Modified | `TransformersEmbeddingsOptions { onDownloadProgress? }`; `progress_callback` built once, conditionally, and passed to **both** the q8 and fallback `pipeline(...)` calls (Traps 1 and 2); maps only `status === "progress_total"`. |
| `src/composition.ts` | Modified | `ContainerOptions.onProgress?`; conditional `IndexDocumentsOptions` build (hop 1); `buildEmbeddingsOptions()` helper for the `LazyEmbeddings` factory closure (hop 2), never spreading `ProgressReporter \| undefined`. `SyncIndex` construction untouched. |
| `src/cli.ts` | Modified | Mode resolution (`resolveProgressMode(process.env[...], process.stderr.isTTY === true)`), sink construction, `onProgress` threaded through `withContainer`, `try { execute() } finally { progress.finish() }`. Only the `index` action changed — `search`/`overview`/`eval`/`serve`/`index-md` untouched. |
| `test/domain/progress.test.ts` | Created | 30 unit tests for the pure domain layer. |
| `test/infrastructure/progress-sink.test.ts` | Created | 9 unit tests for the sink, fake stream + fake clock, no real stdio. |
| `test/application/index-progress.test.ts` | Created | 4 integration tests: emission order/denominators against real `ejemplos/`, `--lexical` zero-events, `BrokenEmbeddings` failed-event, skipped-file-still-ticks. |
| `test/infrastructure/transformers-embeddings-progress.test.ts` | Created | 5 unit tests, `vi.mock("@huggingface/transformers")`, no network. |
| `test/cli-subprocess.test.ts` | Modified | `runCli` gains a `env` parameter (spreads `process.env`); new `describe("CLI subprocess: index progress reporting")` block: `none`, `plain`, `bar` (large-corpus, see Deviations), stdout parity across all three modes. |
| `CLAUDE.md` | Modified | Documented the `COMPENDIO_PROGRESS`-related manual smoke test alongside the existing ones (task 4.4). |
| `test/helpers/fake-embeddings.ts` | **Unchanged** | Verified zero diff (task 3.7's explicit constraint). |
| `src/server.ts`, `src/application/sync-index.ts`, `src/application/sync-scheduler.ts` | **Unchanged** | Confirmed by inspection — out of scope per proposal decision. |

## Deviations from Design

**1. Task 3.27 — the `bar` mode subprocess test needed a large synthetic corpus, not the
5-document fixture, and gained an honest `ctx.skip()` fallback.**

The design's task 3.27 assumed forcing `COMPENDIO_PROGRESS=bar` via the child's `env`
made the bar reachable end-to-end through `spawnSync` — true for *mode selection*
(the proposal's own stated fix for the exploration's TTY-detection gap), but the bar
is *additionally* gated by `BAR_MIN_ELAPSED_MS` (5 s of real elapsed run time,
design decision D3), which is orthogonal to mode selection.

Measured empirically before implementing a workaround: the existing 5-document
`test/fixtures/strict` corpus, indexed with `--lexical`, completes in ~29 ms of
internal `IndexDocuments.execute()` time and ~630 ms of total subprocess wall time
(`node` startup + module loading + SQLite open + everything) — nowhere near 5 000 ms.
No wiring change could make this fixture cross the threshold; it is a property of the
corpus size, not a defect. The proposal itself anticipated this class of gap: "The
only line left uncovered is the single wiring line in `cli.ts` that reads
`process.env` and `process.stderr.isTTY`" — task 3.27 asked for more than that single
line's worth of end-to-end proof.

Resolution implemented: a dedicated test generates a synthetic corpus of 4 000 tiny
files (measured: per-file overhead in `IndexDocuments`'s discovery/parse/chunk/persist
loop dominates over chunk count — increasing chunk count per file with fewer files did
**not** reproduce the same cost, so file *count* is what the test needs to control) and
asserts `\r` appears in stderr **only if** the real run's reported `durationMs` crossed
5 000 ms; otherwise it calls `ctx.skip(...)` with an explanatory message, exactly the
pattern this same test file already uses for the "invoked through a link" tests when
symlink creation is unavailable on the platform. Verified genuinely green (not
skipped) on the reporting machine (Windows 10): 4 000 files indexed in ~7-11 s real
time, `\r` present. This adds ~7-15 s to `test/cli-subprocess.test.ts`'s total runtime
(file went from ~2 s to ~15-16 s) — a real, disclosed cost, not hidden in the summary.

The exact same `bar`-branch logic (threshold gate, first-frame-shows-accumulated-state,
erase math) is *also* covered deterministically, with zero timing dependency, by
`test/infrastructure/progress-sink.test.ts`'s fake-clock unit tests (Commit 2) — those
are the tests that would actually catch a regression in the threshold/redraw logic
itself; the subprocess test's job is narrower: proving the real wiring reaches that
code path at all.

**Flagging for the repository owner**: if this large-corpus test's runtime or
occasional-skip behavior across CI hardware becomes a problem, the alternative is
adding a testing-only override for `BAR_MIN_ELAPSED_MS` (e.g. an env var), which is a
real design decision this agent did not make unilaterally, since it wasn't in
`design.md`'s contracts.

> **RESOLVED — the large-corpus test was removed.** Reviewed with the repository owner
> after apply completed, and deleted: it cost ~9.6 s of a 17.5 s suite (measured before
> and after — the suite now runs in 7.85 s), and on faster hardware its assertion would
> degrade to a silent `ctx.skip()`. Coverage that can vanish unnoticed reads as green,
> which is worse than declaring the gap. The threshold, first-frame-accumulated-state and
> erase logic remain covered deterministically by `progress-sink.test.ts`'s fake-clock
> tests; what is now knowingly unproven end to end is only that the wired sink writes to
> the real stderr stream. Task 3.27 is therefore **not** satisfied end to end, by
> decision rather than omission, and `test/cli-subprocess.test.ts` carries a comment
> explaining why so the test is not reintroduced by reflex. Test count: 299 → 298.

**2. `finish()`'s full implementation (task 2.10) was written in the same GREEN pass as
task 2.8 (bar draw logic), ahead of task 2.9's dedicated RED test.**

Both share the same mutable `lastLineLength` closure variable, and writing the draw
path without also handling `finish()`'s erase would have left `lastLineLength` dangling
with no consumer. Task 2.9's tests were then written and run against the real
implementation with real, falsifiable assertions (erase length = drawn length + 2,
second-call idempotency, no-op-if-never-drawn) rather than being backfilled as
tautologies. Noted here per the "don't silently deviate" instruction, even though the
net result matches the design's contract exactly.

**3. Task 3.9's `TransformersEmbeddingsOptions` wiring needed an extra refactor pass**
not anticipated by the task list: the first implementation attempt (conditionally
building one shared `pipelineOptions` object and reusing its `.progress_callback`
property in the fallback branch) failed `exactOptionalPropertyTypes: true` — TypeScript
correctly rejected assigning a `(...) => void | undefined`-typed property read back out
of an object literal, even inside a branch where it was known non-`undefined` by
runtime construction. Fixed by building `progressCallback` once as a locally narrowed
`const`, referenced directly (not round-tripped through an object property) at both
call sites. This is exactly the class of trap Trap 3 warned about, just one hop deeper
than the two hops the design named.

## Issues Found

None beyond the deviations above. No pre-existing test failures were encountered at
any Safety Net checkpoint.

## Workload / PR Boundary

- Mode: single PR, `size:exception` accepted (recorded in `design.md` and `tasks.md`).
- Work units: 3 commits, exactly the layer boundaries from `design.md`'s Review budget
  section (pure domain / infrastructure adapter / application+composition+CLI seams).
- Estimated review budget impact: over the 400-line default budget by design (estimated
  ~840 lines); the 3-commit structure is the reviewability mechanism inside the single
  PR, as agreed.

## Status (batch 1)

62/62 tasks complete. Ready for `sdd-verify`.

---

## Follow-up batch: D2 repaint heartbeat (bar repaints during long silences)

**Mode**: Strict TDD. **Artifact store**: openspec (Engram not connected — no `mem_*` calls made).
**Branch**: `feat/index-progress-reporting` (same branch, no new branch created). Continues directly
from batch 1's 4 existing commits; this batch adds one more commit.

### Context inherited (already present, uncommitted, before this batch started)

D3's revision (`BAR_MIN_ELAPSED_MS` 5 000 → 1 500 ms) had already been applied to
`src/domain/progress.ts` and its dependent tests (deriving from the exported constants instead of
hardcoding `5_000`/`5_100`) by a prior design-revision pass, uncommitted in the working tree at the
start of this batch. Verified via `npm test`/`npm run typecheck` as the safety-net baseline before
starting (298/298 passing, typecheck clean) and left untouched by this batch except where this
batch's own edits intersect the same files.

### What this batch implemented (design D2, revised)

1. `BAR_REPAINT_MS = 200` exported from `src/domain/progress.ts`, structural constant with a
   doc comment explaining the rationale (Task-equivalent: structural, triangulation skipped per
   strict-tdd rules for a no-branching constant addition).
2. `renderBar` gained a required third parameter, `elapsedMs: number`, rendered as a one-decimal
   seconds indicator (e.g. `3.2s`), positioned right after the percent segment. Included in the
   width-overhead calculation so the `length <= width` invariant still holds with the indicator
   present.
3. `src/infrastructure/progress-sink.ts`'s `bar` branch: a `setInterval(draw, BAR_REPAINT_MS)`,
   `unref()`'d, cleared by `finish()`, never created in `plain`/`none` mode (only the `bar` branch
   constructs it at all). Both event-driven draws and timer-driven repaints call the same `draw()`
   function, which is the one place `shouldDrawBar` is consulted — the 100 ms coalescing floor and
   the elapsed-threshold gate both still apply uniformly.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| `BAR_REPAINT_MS` constant | `src/domain/progress.ts` | Structural | ✅ 298/298 (baseline) | N/A (structural, no branching) | N/A | Triangulation skipped: purely structural, single possible output | N/A |
| `renderBar` elapsed indicator | `test/domain/progress.test.ts` | Unit | ✅ 298/298 (baseline) | ✅ 2/2 new tests genuinely failed (`toContain("3.2s")` against the un-implemented 2-arg `renderBar`; `not.toBe` between two elapsed values) | ✅ 33/33 passed after implementing `formatElapsed` + widening `overhead` | ✅ two different elapsed values produce different strings; width cap re-verified across widths 20/40/80/200 with the indicator present; existing 2-arg call sites updated to pass `0` (mechanical, not new behavior) | ➖ none needed — the change composes cleanly with the existing `overhead`/`detail`/`.slice(0,width)` structure |
| Sink repaint timer (event-lazy, first attempt) | `test/infrastructure/progress-sink.test.ts` | Unit | ✅ 298/298 (baseline) | ✅ 1/2 genuinely failed ("repaints on a timer..." failed for real; "finish() stops the repaint timer..." passed *vacuously* — no timer existed yet under the still-lazy implementation, so nothing to stop — flagged per Assertion Quality Rules, not treated as a real GREEN signal) | ✅ 13/13 passed after implementing lazy timer arming inside `draw()` | Deferred — see next row: this implementation was found insufficient before triangulating further | — |
| Sink repaint timer (construction-eager, corrected) | same, plus a new dedicated test reproducing the exact production bug shape | Unit | ✅ 13/13 (from the row above) | ✅ new test genuinely failed (`toHaveLength(1)` vs actual `0` — proving the event-lazy implementation could not detect a threshold crossing with zero events afterward) | ✅ 14/14 passed after re-arming the timer unconditionally at sink construction (bar mode only) | ✅ triangulated against: sub-threshold silence (now also advancing the fake timer in lockstep, not just the injected clock, to prove the *timer itself* stays silent, not merely unexercised); first-event-driven draw; timer-only repaint with no further event (3 consecutive frames, elapsed strictly increasing); `finish()` genuinely stopping a *real* armed timer (re-verified — no longer vacuous); zero timer in `plain`/`none` via `vi.getTimerCount() === 0` | ✅ removed the now-dead `repaintTimer === null` branch and the null-guard in `finish()`, since the timer always exists once constructed in `bar` mode |
| Full suite / typecheck | — | — | — | — | ✅ 306/306 (`npm test`), typecheck clean (`npm run typecheck`) | — | — |

### Test Summary

- **Total tests written this batch**: 3 in `test/domain/progress.test.ts` (30 → 33) + 5 in
  `test/infrastructure/progress-sink.test.ts` (9 → 14) = **8 new tests**.
- **Total tests passing**: 306/306 (up from the 298/298 baseline at the start of this batch).
- **Layers used**: Unit (8).
- **Pure functions changed**: `renderBar` (signature + one new private helper, `formatElapsed`).
- **A genuinely important finding from triangulation**: the *first* implementation of the sink
  timer (armed lazily inside `draw()`, matching the literal text of D2 as originally written —
  "created only on the first draw, never before the threshold") passed all its own unit tests but
  was empirically proven, against the real built CLI, to **not fix the bug it exists to fix**. See
  "Deviation from design" below — this is the single most important result of this batch and is
  documented in full there and in `design.md`.

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `src/domain/progress.ts` | Modified | Added `BAR_REPAINT_MS = 200` (with rationale doc comment); `renderBar` gained a required `elapsedMs: number` third parameter, rendered as a one-decimal-seconds indicator, factored into the width-overhead calculation. |
| `src/infrastructure/progress-sink.ts` | Modified | `bar` branch: `setInterval(draw, BAR_REPAINT_MS)` armed unconditionally at sink construction (not lazily on first draw — see Deviations), `unref()`'d, cleared unconditionally by `finish()`. `draw()` extracted as the single function called by both event-driven progress and the timer, so `shouldDrawBar` is consulted from exactly one place. |
| `test/domain/progress.test.ts` | Modified | Updated all pre-existing 2-arg `renderBar` calls to pass an explicit `elapsedMs` (usually `0`, not semantically meaningful for those pre-existing assertions); added 3 new tests for the elapsed indicator (renders to one decimal; two different elapsed values differ; width cap holds with the indicator present). |
| `test/infrastructure/progress-sink.test.ts` | Modified | Added `beforeEach`/`afterEach` fake-timer setup around the `bar`-mode describe block (`vi.useFakeTimers()`/`vi.useRealTimers()`), advanced in lockstep with the already-injected `now()` clock per test — the subtle part the task called out explicitly. Strengthened the sub-threshold test to also advance the fake timer, not just the clock. Added: a test reproducing the exact production bug shape (all events at `clock=0`, only the timer advances afterward — this is the test that caught the event-lazy implementation's defect); a test for 3+ consecutive timer-only repaints with strictly-advancing elapsed text; a test that `finish()` genuinely stops a real armed timer (`vi.getTimerCount() === 0` plus no further writes on advance); a new describe block asserting zero pending timers in `plain`/`none` mode across a repaint-interval-sized gap. |
| `openspec/changes/index-progress-reporting/design.md` | Modified | Synced the stale "Contracts" code block (`renderBar` signature, `BAR_MIN_ELAPSED_MS` value, added `BAR_REPAINT_MS`) and the "Testing strategy" table rows for `renderBar`/`shouldDrawBar`/`createProgressSink` to the current implementation. Added an "Implementation correction" note under D2 documenting the event-lazy → construction-eager timer-arming fix, and a "Known residual limitation" note documenting the event-loop-starvation finding (see Deviations below) with the concrete measurements. |
| `openspec/changes/index-progress-reporting/specs/index-progress/spec.md` | **Unchanged this batch** | Already carried the 3 new scenarios for this requirement from the prior design-revision pass; all 3 are satisfied by this batch's tests (see "Spec scenario coverage" below). Left as-is: the normative "MUST NOT start before the elapsed-time threshold is crossed" wording is satisfied under the reading "must not repaint/write a frame before crossing" — the reading this batch's tests enforce — so no correction was needed there, only in `design.md`'s more implementation-level prose. |
| `src/server.ts`, `src/application/sync-index.ts`, `src/application/sync-scheduler.ts`, `src/application/index-documents.ts`, `test/helpers/fake-embeddings.ts`, `package.json` | **Unchanged** | Confirmed via `git diff --stat` — none of these appear in the diff. |

### Spec scenario coverage ("The Bar Repaints During Long Silences")

- **"The bar advances while no event arrives"** — covered by
  `test/infrastructure/progress-sink.test.ts`'s "repaints on a timer while no new event arrives, and
  consecutive frames differ in elapsed" (3 frames, strictly different) and by the new "draws its
  first frame purely from the repaint timer..." test (the stricter form: *zero* events after the
  burst, not just no *new* events).
- **"The repeat timer never outlives the run"** — covered by "finish() stops the repaint timer: no
  further frame is written after it fires", asserting both `vi.getTimerCount() === 0` after
  `finish()` and no further writes on a subsequent timer advance.
- **"No repaint timer in plain or none mode"** — covered by the new
  `describe("createProgressSink — no repaint timer outside bar mode")` block, asserting
  `vi.getTimerCount() === 0` in both `plain` and `none` across a repaint-interval-sized gap.

### Deviations from Design

**1. (Load-bearing) The literal "created only on the first draw" arming strategy does not fix the
reported bug — corrected to construction-eager arming, discovered via TDD triangulation and confirmed
against the real built CLI.**

D2's revised text (both as written in `design.md` before this batch, and as restated verbatim in the
task prompt) says the repaint timer is "created only on the first actual draw (never before the
elapsed threshold is crossed)." The first implementation followed this literally: `draw()` armed
`setInterval` only after its own first successful write. All 13 sink tests passed under this
implementation — but one of them ("finish() stops the repaint timer...") passed **vacuously**: no
timer had ever been created in that test's flow, so there was nothing for `finish()` to actually stop.
Per the strict-TDD Assertion Quality Rules, a vacuous pass is not evidence, so this was not treated as
done. A dedicated test was written to reproduce the *exact* production event shape named in D2's own
prose — every event fires while `clock === 0` (before the threshold), then *no further event ever
arrives*, only the fake timer advances — and it genuinely failed: `stream.writes` stayed empty, because
an event-lazy timer that is only armed *by* a draw can never detect a *time-based* threshold crossing
when there is no later event to trigger that draw in the first place. This is not a hypothetical edge
case; it is restated verbatim in D2's own root-cause paragraph as the motivating bug.

This was then verified against the real, built CLI before accepting it as a defect (not just a unit
test artifact): running `COMPENDIO_PROGRESS=bar node dist/cli.js --root <this repo's docs/> index
2>frames.txt` under the event-lazy implementation produced **0 bytes**, identical to the pre-D2
baseline — proving the fix, as literally specified, does not fix the bug it exists to fix.

Fixed by arming the `setInterval` unconditionally at sink construction (`bar` mode only), still
`unref()`'d, still cleared by `finish()`. Every tick — whether from an event or from the timer —
still funnels through the same `draw()` → `shouldDrawBar` gate, so the *observable* guarantee ("no
frame written before the threshold") still holds; only the underlying timer *object's* existence
moved earlier. `design.md`'s D2 section now carries an "Implementation correction" paragraph
documenting this precisely, since the original text was normative-sounding but insufficient.

**2. (Informational, not fixed — flagged for the repository owner) A residual event-loop-starvation
gap remains for corpora small enough that their entire duration is one blocking `embed()` call.**

After the correction above, re-running the same verification command against this repo's own current
`docs/` (now down to a single indexable file — `INDEX.md` is excluded by default `config.exclude`)
still produced **0 bytes**. This was not accepted at face value; it was investigated with three
independent instrumented tests before writing this up:

- An **unrelated** `setInterval(50ms)`, running alongside the real `IndexDocuments.execute()` (no
  progress sink involved at all), fired only **2 times** over a ~4 s run, and only **4 times** over a
  ~5.4 s two-batch run against `ejemplos/` — with a visible gap of **zero** fires during either
  batch's own inference window, and a handful of fires clustered only in the brief windows between
  batches and during model-file loading.
- A **fake-stream-instrumented real sink** (the actual production sink, wired into the actual
  `createContainer`, only the destination stream swapped for a logging fake) against the same corpus:
  **0 write attempts**, confirming this is not an I/O/flushing artifact — the write call itself never
  happens, because the timer callback never gets a turn.
- The **exact same real sink, writing to real `process.stderr`**, redirected to a file, run against
  `ejemplos/` (11 documents, 27 chunks, 2 batches — large enough that model loading and the first
  batch's inference don't consume the *entire* run): produced 241 bytes, 3 distinct frames, including
  two real frames with the elapsed indicator advancing `3.7s` → `3.8s` — direct, positive proof the
  mechanism works correctly whenever the event loop gets any turn at all.

Root cause: `onnxruntime-node`'s CPU inference call (used internally by `@huggingface/transformers`)
blocks the JS main thread synchronously for its full duration — it does not yield to the event loop
at any point while running, regardless of how it is wrapped in a `Promise`/`await` at the JS level.
Node is single-threaded; no JS-level timer, however it is armed, can run while a synchronous native
call occupies that one thread. This is a genuine, previously-undocumented characteristic of the
embeddings pipeline, not a defect in this batch's implementation — the same construction-eager timer
was proven, moments earlier against `ejemplos/`, to work exactly as designed the instant the event
loop has any opportunity to run.

**Not fixed in this batch, and not fixed unilaterally**, because the only real fix (moving embedding
inference off the main thread, e.g. `worker_threads`) is a materially larger architectural change,
outside D2's scope, and outside the file list this task authorized
(`src/domain/progress.ts` + `src/infrastructure/progress-sink.ts`). Documented in `design.md` under
D2 as a "Known residual limitation," and flagged here for the repository owner to prioritize
separately if desired. This does not invalidate the fix for the class of run D2's own text describes
as *the reported bug* on a **realistically sized** corpus (`ejemplos/`, multi-batch) — only for the
degenerate case where an entire run is a single blocking native call from start to finish, which this
repository's current `docs/` (1 indexable file) happens to be.

### Verification actually run

```
npm run build            # tsc, clean
COMPENDIO_PROGRESS=bar node dist/cli.js --root <temp copy of this repo's docs/> index 2>frames.txt
```

- **Byte count of `frames.txt`**: **0 bytes.** Confirmed empty, not fudged. See Deviation #2 above
  for the full root-cause investigation and evidence that the mechanism itself is correct.
- **Supporting run** (same build, same sink, `--root ejemplos`, not `--lexical`): **241 bytes**, 3
  distinct frames (2 real content frames + 1 blank erase frame from `finish()`), with the elapsed
  indicator visibly advancing between the two content frames (`3.7s` → `3.8s`). This is direct,
  positive evidence that the repaint-timer fix is functioning as designed; the 0-byte result on this
  repo's own thin `docs/` is a corpus-size edge case, not a broken implementation.

### Issues Found

The one substantive issue found is documented in full under "Deviations" above (both the corrected
defect and the residual, unfixed limitation). No other pre-existing test failures were encountered at
any Safety Net checkpoint in this batch.

### Workload / PR Boundary

- Mode: continues the existing single PR (`size:exception`, already accepted) — this batch is a
  follow-up fix inside the same PR/branch, not a new PR.
- This batch: 1 additional commit (`fix(progress): repaint the bar on a timer during long
  silences`), on top of the 4 pre-existing commits.
- Estimated review budget impact: small relative to the original ~840-line estimate — this batch's
  diff is ~410 changed lines total (design.md/spec.md docs + source + tests), most of it test
  coverage and design-doc corrections; the production code change itself is under 100 lines across
  the two source files.

## Status (overall, after this follow-up batch)

Both batches complete. `npm test`: 306/306. `npm run typecheck`: clean. `npm run build`: clean. The
repaint-heartbeat capability is implemented, unit-tested (including a test that reproduces and would
catch a regression to the exact reported production bug), and verified end to end against a real
corpus (`ejemplos/`) with a positive, non-empty result. One residual, previously-unknown limitation
(event-loop starvation during synchronous ONNX inference on corpora whose entire run is one blocking
call) is documented and flagged, not silently hidden or fixed unilaterally. Ready for `sdd-verify`.
