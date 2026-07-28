# Verification Report

**Change**: index-progress-reporting
**Branch**: feat/index-progress-reporting (6 commits, off main, not pushed - confirmed; main untouched)
**Version**: N/A
**Mode**: Strict TDD

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 62 |
| Tasks complete | 61 |
| Tasks incomplete | 1 (3.28, deliberately unchecked, see below) |

Task 3.28 ("confirm bar is reachable end-to-end through the wiring") is unchecked by
decision, not omission. The literal proof that a carriage-return reaches real stderr through a genuine
subprocess required a 4,000-file synthetic corpus, cost about 9.6s of a 17.5s suite, and degraded to a
silent skip on fast hardware, so the repository owner withdrew it. The withdrawal is
recorded consistently in three places, all checked and all agree:
- tasks.md line 222, task left unchecked, with an explanatory note under 3.27/3.28.
- apply-progress.md's RESOLVED callout under Deviation 1 (test count 299 to 298 documented).
- A code comment in test/cli-subprocess.test.ts (lines 212-228) explaining exactly why no
  subprocess test asserts a carriage return on real stderr, and what remains covered deterministically
  (progress-sink.test.ts's fake-clock tests) versus what stays unproven end to end (only that
  the wired sink writes to the real stream, one line in cli.ts).

No artifact claims 3.28 is done. This is accurately recorded.

## Build & Tests Execution

**Build**: PASSED
```
npm run build   -> tsc, clean, no output
```

**Tests**: 306 passed / 0 failed / 0 skipped (29 files)
```
npm test
 Test Files  29 passed (29)
      Tests  306 passed (306)
   Duration  9.09s
```
Matches apply-progress.md's final claimed total exactly (298 after the batch-1 withdrawal, plus 8
from the D2 repaint-heartbeat follow-up batch equals 306).

**Typecheck**: PASSED
```
npm run typecheck   -> tsc --noEmit && tsc -p tsconfig.test.json, clean
```

**Coverage**: not available, no coverage tool configured in this project (consistent with
CLAUDE.md's note that there is no lint script configured either). Not a failure, per strict-TDD rules.

## Binary Execution (the mandatory, non-negotiable check)

Ran against a copy of ejemplos/ in a scratch directory outside the repo
(ejemplos/ itself was never indexed or modified).

### COMPENDIO_PROGRESS=plain
- stdout: "Indexed 11 documents (27 chunks) in 5276 ms [mode hybrid]" -- summary only.
- stderr: 19 lines -- "Discovering documents", "Indexing 11 documents", "[1/11]" through "[11/11]" per-file
  lines, "Embedding 27 chunks in 2 batches", "[1/2] embedding batch", three
  "downloading model: X/129.1 MB" lines, "[2/2] embedding batch". No carriage return anywhere.
- Confirms: progress lines land on stderr; stdout carries only the final summary; the download is
  nested inside the embedding phase, not a separate top-level phase (the per-file phase ran to
  completion before any embedding/download line appeared).

### COMPENDIO_PROGRESS=none
- stdout: "Indexed 11 documents (27 chunks) in 5441 ms [mode hybrid]".
- stderr: 0 bytes. Confirmed empty via wc -c.

### stdout parity across modes
Normalizing only the duration figure ("in N ms"), plain and none stdout are byte-identical:
"Indexed 11 documents (27 chunks) in N ms [mode hybrid]". Confirmed programmatically, not by eyeballing.

### COMPENDIO_PROGRESS=bar (2>frames.txt)
- frames.txt: 241 bytes, 4 carriage-return occurrences -- 2 real content frames plus 1 finish()
  erase write (which itself contains 2 carriage returns, not counted as a "frame").
- Content observed: "[==================================] 100% 3.6s downloading model
  128.6/129.1 MB" then "... 3.8s ..." then a blank erase.
- Interpretation: this run hit the model cache in a partially-warm state (download almost
  complete, still verifying/fetching the tail), so BAR_MIN_ELAPSED_MS (1,500 ms) was crossed and
  the bar drew twice before the run finished around 3.6-3.8s elapsed. This is not the
  degenerate "warm-cache single blocking embed() call, 0 bytes" case documented in design.md's
  D2 "Known residual limitation" (that case requires the model already fully cached with no
  network verification and a corpus small enough to be one blocking call), nor is it the fully
  cold ~4s/20-frame download the addendum recorded. It sits in between, and the observed byte
  count, frame count, and elapsed progression (3.6s to 3.8s) line up closely with
  apply-progress.md's own "Supporting run" measurement (241 bytes, elapsed 3.7s to 3.8s),
  independently reproduced here, not just repeated from the artifact.

## File Identity Checks

Ran: git diff main...HEAD --name-only -- src/server.ts src/application/sync-index.ts
src/application/sync-scheduler.ts test/helpers/fake-embeddings.ts package.json

Output: empty -- all 5 files are byte-identical to main. package.json gained no
dependency (confirmed via git diff main...HEAD -- package.json, also empty).

Code-only diff (excluding openspec docs and CLAUDE.md): 11 files, 1,410 insertions / 17 deletions,
consistent with the design's own "over the 400-line budget" forecast and the recorded size:exception.

## Spec Compliance Matrix

| Requirement | Scenario(s) | Evidence | Result |
|---|---|---|---|
| Zero-Configuration Bar in an Interactive Terminal | Bar appears with nothing configured / env var is optional not required | Unit: resolveProgressMode(undefined, true) returns "bar" (progress.test.ts). CLI wiring inspected: resolveProgressMode(process.env["COMPENDIO_PROGRESS"], process.stderr.isTTY === true). No test anywhere sets a real isTTY: true and observes actual bar rendering -- grepped all test files, confirmed absent. This verification shell also has no real TTY (process.stderr.isTTY is undefined even for a direct, non-piped invocation), so it could not be observed live either. | PARTIAL -- resolver logic is unit-proven; the literal "bar appears in an interactive terminal" claim rests on code inspection of one wiring line plus the resolver unit test, never an actual TTY observation, in this change's artifacts or in this verification session. This gap was explicitly declared upfront in proposal.md ("the only line left uncovered is the single wiring line...") -- not a hidden defect, but genuinely unverified end to end. |
| Mode Resolution Is a Pure, Injected, Total Function | All 6 scenarios | test/domain/progress.test.ts -- exact 1:1 coverage of every scenario, plus an extra undefined case | COMPLIANT |
| Two Renderers Share One Event Stream | Bar redraws; plain appends; none emits nothing | Unit (formatPlainLine/renderBar no-CR/no-ANSI assertions) and observed live: plain mode's stderr had no carriage return; bar mode's stderr had carriage returns; none mode had 0 bytes | COMPLIANT, observed end to end |
| Four Reportable Phases With Synchronously-Known Denominators | Per-file/embedding denominators known at phase start; download nested inside embedding | test/application/index-progress.test.ts against real ejemplos/ (files/start.total before first tick, embedding/start.batches equals Math.ceil(...)) and observed live: discovery, then 11 file ticks, then "Embedding 27 chunks in 2 batches", then download lines nested between batch ticks | COMPLIANT, observed end to end |
| Progress Goes to stderr; stdout Is Unchanged | stdout identical across modes; every write lands on stderr | Observed live: none mode stderr is 0 bytes; stdout byte-identical (normalized) across none/plain | COMPLIANT, observed end to end |
| Bar Hygiene Before Warnings and the Final Summary | Bar cleared before embeddingsWarning; cleared before final summary; width capped | Unit: progress-sink.test.ts's finish() erase-math tests (real, non-tautological -- asserts erase length equals drawn length plus 2). Code inspection: cli.ts's try/finally calling progress.finish() runs strictly before the warning loop and the summary console.log. No test exercises the actual combination (a real embeddings failure and bar mode together, observing the real interleaved stderr) | PARTIAL -- structurally sound by construction (finally-block ordering plus isolated erase unit test), but the specific "failure mid-run in bar mode" combination is not covered by any single test or observation. Width-cap scenario is unit-tested (renderBar length <= width at 4 widths). |
| Degenerate Denominators Render No Ratio, Not a Division Error | --lexical emits zero embedding events; empty corpus renders zero without error; zero-denominator renders no ratio | test/application/index-progress.test.ts (embeddings: null yields zero embedding-phase events) plus unit tests for total === 0 in both formatters | COMPLIANT (unit plus integration; not independently re-observed live by this verification with --lexical against the real binary, though the existing subprocess suite's own fixture uses --lexical continuously and passes) |
| Reporting Preserves Existing Indexing Behavior | Indexed content identical regardless of mode; lexical fallback still occurs, now reported | BrokenEmbeddings integration test: exactly one embedding/failed event, report.mode equals "lexical". "Identical indexed content across modes" is not directly asserted at the DB/chunk/embedding level, only inferred from (a) chunk-count parity in stdout across modes and (b) code inspection showing report() calls have no side effect on the indexing pipeline | PARTIAL for the first scenario (sound by construction plus count-level proxy, not exhaustively tested); COMPLIANT for the fallback-still-reported scenario |
| A Short Run Does Not Flash a Bar | Sub-threshold run draws nothing; crossing threshold starts from accumulated state; plain is unaffected | progress-sink.test.ts: fake-clock tests directly exercise BAR_MIN_ELAPSED_MS (now 1,500ms, confirmed in source) with real, falsifiable assertions (stream.writes empty below threshold, accumulated state shown on first draw after crossing) | COMPLIANT -- strong unit-level proof against the real production constant, not a real-wall-clock observation (reasonably so, since flakiness would be worse) |
| The Bar Repaints During Long Silences | Bar advances with no events; timer never outlives the run; no timer in plain/none | progress-sink.test.ts's construction-eager-timer tests (reproduces the exact production bug shape: all events at clock=0, only the timer advances) -- genuinely triangulated, including a documented case where the first (event-lazy) implementation passed all its own tests yet was empirically proven not to fix the bug against the real CLI. Live observation: the bar run in this verification showed 2 real content frames with elapsed 3.6s to 3.8s, consistent with the documented residual (heartbeat fires during download I/O and inter-batch gaps, not during blocking ONNX inference) | COMPLIANT -- unusually well-triangulated; the documented residual limitation (0 bytes possible for a corpus whose entire run is one blocking embed() call) is honestly recorded in design.md and timing-measurement.md's addendum, not silently absorbed |
| Download-Progress Throttling Is a Pure Predicate | Below threshold yields no report; crossing yields exactly one report | progress.test.ts's createDownloadThrottle tests (below/crossing/non-monotonic/zero-total/1%-vs-5% ratio) | COMPLIANT -- also indirectly observed live: plain mode's 3 download lines over a partially-warm download are consistent with the 5% step and with design residual (b) (never reaching 100% on a partially-warm cache: the last line was 125.9/129.1 MB) |

Compliance summary: 8 of 11 scenario groups fully compliant with end-to-end or strong unit+integration
evidence; 3 requirements have at least one scenario resting only on a unit-test-plus-code-inspection
combination rather than a genuine end-to-end observation (Zero-Configuration Bar's TTY claim, Bar
Hygiene's failure-plus-bar-mode combination, and "indexed content is identical regardless of mode").
None of these three are fabricated or false -- they are honestly scoped gaps, and two of them
(the TTY claim and the untested carriage-return-on-real-stderr line) were explicitly disclosed as
accepted gaps by the change's own artifacts before this verification started.

## Known Deliberate State -- Verified as Honestly Recorded

| # | Item | Verified |
|---|---|---|
| 1 | Task 3.28 withdrawn (4,000-file corpus test deleted) | Confirmed unchecked in tasks.md; confirmed documented in apply-progress.md's RESOLVED callout; confirmed comment present in test/cli-subprocess.test.ts (lines 212-228); confirmed test count history 299 to 298 to 306 reconciles with npm test's current 306 |
| 2 | D3 revised: BAR_MIN_ELAPSED_MS 5,000 to 1,500 ms | Confirmed in src/domain/progress.ts line 43 (export const BAR_MIN_ELAPSED_MS = 1_500), with the revision rationale documented in design.md |
| 3 | D2 reversed: 200 ms repaint heartbeat added | Confirmed BAR_REPAINT_MS = 200 in source, setInterval(draw, BAR_REPAINT_MS) armed at sink construction (not lazily) in progress-sink.ts; spec gained "The Bar Repaints During Long Silences" requirement, present in spec.md |
| 4 | Residual: onnxruntime-node blocks the main thread during inference | Confirmed documented in design.md D2 ("Known residual limitation") and timing-measurement.md's Addendum section A (0/22 timer fires during embed()); the bar run performed in this verification is consistent with this (heartbeat fired during the download tail, not visibly during a blocking inference window in this particular run) |

All four items are accurately recorded, not overstated, and not misrepresented as complete.

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 -- percent-step download throttle (1%/5%) | Yes | DOWNLOAD_STEP_PERCENT_BAR = 1, DOWNLOAD_STEP_PERCENT_PLAIN = 5 in source, matching progress-sink.ts's per-mode throttle construction |
| D2 (revised) -- 100ms coalescer plus 200ms repaint heartbeat, construction-eager | Yes | Confirmed in progress-sink.ts around line 109 -- timer armed unconditionally at construction, not lazily |
| D3 (revised) -- 1,500ms bar threshold | Yes | Confirmed in source and cross-checked against live runs in this verification (both plain and bar runs took over 1.5s and crossed correctly) |
| D4 -- module boundary (pure domain/progress.ts, adapter infrastructure/progress-sink.ts, one impure line in cli.ts) | Yes | Confirmed via grep: zero fs/SQLite/huggingface/process imports in progress.ts; progress-sink.ts only writes to its injected stream; cli.ts has exactly one process.env/process.stderr.isTTY read |
| Proposal decision 4 -- lazy embeddings-load trigger unchanged | Yes | embedPending's structure and call site unchanged; embedding/start still placed after the embeddings === null guard |
| Proposal decision 5 -- optional callback, not a new port | Yes | IndexDocumentsOptions.onProgress is optional, not a ports.ts entry |
| Out-of-scope: server.ts/sync-index.ts/sync-scheduler.ts untouched | Yes | Byte-identical to main, confirmed via git diff |
| size:exception (single PR, about 840-line estimate) | Yes | Actual code+test diff is 1,410 lines; recorded and accepted per design.md/tasks.md |

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes | Full RED/GREEN/TRIANGULATE/REFACTOR table present in apply-progress.md for both batches |
| All tasks have tests | Yes | Every non-structural task has a corresponding test row; structural tasks (constants, wiring) explicitly note "triangulation skipped" with justification |
| RED confirmed (tests exist) | Yes | All listed test files exist and were read directly: progress.test.ts, progress-sink.test.ts, index-progress.test.ts, transformers-embeddings-progress.test.ts, cli-subprocess.test.ts |
| GREEN confirmed (tests pass) | Yes | 306/306 on real execution, matching the reported final count |
| Triangulation adequate | Yes | Multiple genuinely well-triangulated cases, including a documented instance where a first implementation passed all its unit tests yet was proven wrong against the real binary (D2's event-lazy vs construction-eager timer) -- a strong, honest signal, not overclaiming |
| Safety Net for modified files | Yes | Each batch records a baseline test run before starting; fake-embeddings.ts confirmed zero diff via git diff --stat (verified independently in this session -- file is untouched vs main per the earlier identity check) |

TDD Compliance: 6/6 checks passed

---

### Assertion Quality

Scanned all 5 new/modified test files for this change (progress.test.ts, progress-sink.test.ts,
index-progress.test.ts, transformers-embeddings-progress.test.ts, cli-subprocess.test.ts's new
describe block). No banned patterns found: no tautologies, no ghost loops over possibly-empty
collections, no assertion-without-production-call, no mock-to-assertion ratio exceeding 2x in any
file. Several tests explicitly assert behavior (frame byte content, erase math, timer counts)
rather than implementation details.

Assertion quality: All assertions verify real behavior.

---

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | about 52 | progress.test.ts (33), progress-sink.test.ts (14), transformers-embeddings-progress.test.ts (5) | vitest, vi.mock, vi.useFakeTimers |
| Integration | 4 | index-progress.test.ts | real ejemplos/ corpus, FakeEmbeddings/BrokenEmbeddings |
| Subprocess | 3 new (11 total in file) | cli-subprocess.test.ts | spawnSync against the built dist/cli.js |
| Manual (declared, not automated) | 1 | Real cold download, documented in CLAUDE.md -- not personally executed by the apply agent nor by this verification (would require clearing the model cache and downloading 129 MB); flagged as a follow-up for the repository owner, consistent with apply-progress.md |

## Issues Found

CRITICAL: None.

WARNING:
1. CLAUDE.md's manual smoke test comment (added in commit 404a1be, batch 1) is stale: it says
   the bar "appears once the run exceeds ~5s" and that "warm cache: bar is silent below the
   anti-flash threshold (~3-4s runs)". Both statements described the original
   BAR_MIN_ELAPSED_MS = 5000 value. The follow-up batch that revised the threshold to 1,500ms
   (commits b24b438, 40404dc, 798f2d0) never touched CLAUDE.md -- confirmed via
   git log main..HEAD -- CLAUDE.md (only 404a1be touches it). This is now actively wrong: this
   verification directly observed a ~3.6-3.8s ejemplos/ run in bar mode draw two real frames,
   contradicting the "warm cache ~3-4s: bar is silent" claim in CLAUDE.md. This should be
   corrected before archive -- it is user-facing guidance describing incorrect behavior, not
   merely an internal note.
2. "Indexed content is identical regardless of mode" (spec requirement "Reporting Preserves
   Existing Indexing Behavior") is not directly tested at the DB/chunk/embedding level -- only
   inferred from (a) chunk-count parity in stdout across modes and (b) code inspection showing
   report() calls have no side effect on the indexing pipeline. Sound by construction, but not an
   explicit equality assertion. Low risk given (a) and (b), but worth naming since this change's
   own stated lesson is "prove it, do not infer it."
3. apply-progress.md's batch-1 "Test Summary" states cli-subprocess.test.ts has "12 total in
   the file, 4 new" -- this was accurate at that point in time but was never updated after the
   large-corpus test was withdrawn later in the same document (RESOLVED note, same file). Actual
   current count is 11 (confirmed via npx vitest run test/cli-subprocess.test.ts: 11 passed).
   Purely a stale internal bullet; the same document's later section correctly documents the
   removal, and the final aggregate counts (298, then 306) are correct and match what was measured
   in this verification.

SUGGESTION:
1. The "Zero-Configuration Bar in an Interactive Terminal" requirement's core claim (bar renders
   in a real TTY) and the "Bar is cleared before embeddingsWarning" scenario both rest on
   combining a unit test with code inspection rather than a single end-to-end test or observation.
   Both gaps were disclosed up front in the change's own artifacts (proposal.md's "only line left
   uncovered" note; apply-progress.md's withdrawal of the carriage-return-on-real-stderr proof)
   rather than hidden, which is the right call given the cost/flakiness trade-off documented --
   flagging only so a future regression in cli.ts's wiring order or resolveProgressMode's TTY
   branch would not be caught by the current suite. No action required unless the repository owner
   wants to close this gap deliberately (for example a node-pty-based test, which would be new test
   infrastructure, or a documented manual verification step alongside the existing cold-download
   smoke test).

## Verdict

PASS WITH WARNINGS

61/62 tasks complete (the one exception is a documented, deliberate, and accurately-recorded
withdrawal, not an omission). Build, the full test suite (306/306), and typecheck are all green,
matching the artifacts' own claims exactly. The binary was run directly against a scratch copy of
ejemplos/ in all three modes and confirmed: plain writes progress to stderr only, none writes zero
bytes, stdout is byte-identical across modes (normalized for duration), and bar writes
carriage-return frames whose byte count and content are consistent with the change's own
documented residual limitation around ONNX inference blocking the event loop. All five files
required to be untouched are confirmed byte-identical to main, and package.json gained no
dependency. The four "deliberate state" items called out for this verification are all accurately
recorded, not overstated.

The three WARNING items should be addressed before archive, in order of importance: (1) fix
CLAUDE.md's stale threshold description -- a real correctness bug in user-facing documentation, not
just an internal artifact; (2) is low-risk and optional; (3) is cosmetic. None are CRITICAL and
none block functionality, but (1) is a genuine defect in documentation that will actively mislead
anyone following the manual smoke test as written.
