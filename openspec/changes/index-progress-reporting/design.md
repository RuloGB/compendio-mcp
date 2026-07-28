# Design: Index Progress Reporting

One typed event stream emitted from `IndexDocuments`, rendered at the CLI edge by one of two pure
formatters. Everything that decides *what to show* is a pure function in `src/domain/progress.ts`;
one adapter (`src/infrastructure/progress-sink.ts`) owns stderr, the clock, and the `\r` bytes; one
expression in `cli.ts` reads `process.env` and `process.stderr.isTTY`.

`timing-measurement.md` reorders the priorities the proposal assumed: the 129 MB download is
~255-290 s of the reported 300 s run, embedding is 105 ms/chunk (~9-46 s for 36 docs), and all other
work is 0.06 s. So download cadence is designed first, batches are a secondary counter, and a warm
~3 s run must not flash a bar.

## Decisions

### D1 — Download cadence: percent-step throttle, 1% for `bar`, 5% for `plain`

**Choice**: `createDownloadThrottle(stepPercent)` returns the spec's exact
`(loaded, total, lastReported) => boolean` predicate with the step closed over. `bar` uses 1,
`plain` uses 5.

| Step | Reports over the whole download | Gap at the inferred 0.46 MB/s |
|---|---|---|
| 1% | 100 | ~2.8 s |
| 2% | 50 | ~5.6 s |
| **5%** | **20** | **~14 s** |
| 10% | 10 | ~28 s |

**Rationale**: a bar frame is transient and overwritten, so a redraw costs nothing and buys
liveness — 1% keeps it visibly moving through the phase that *is* the run. A plain line is
permanent, so 5% yields **20 lines total** for a once-per-machine download: compact in a CI log,
and still a heartbeat well inside the anxiety window, because `embedding/start` has already
printed `first run downloads ~129 MB`. **Rejected**: one shared step — 1% means a 100-line CI log,
10% means a bar frozen for 28 s, which is the exact "looks hung" failure being fixed.

**Verified source shape** (`node_modules/@huggingface/transformers/src/pipelines.js:139-157`,
`src/utils/core.js:118-139`): `pipeline()` wraps our callback in `DefaultProgressCallback`, which
emits an aggregate `progress_total` *and* forwards the per-file `progress`. We consume
`progress_total` **only** — one monotonic 0-100 over all files, pre-seeded with every file's size,
so no per-file bookkeeping and no double counting.

### D2 — Bar refresh: a 100 ms coalescer **and** a 200 ms repaint heartbeat *(revised)*

**Original choice**: `shouldDrawBar(startedMs, nowMs, lastDrawMs)` refuses a redraw within 100 ms of
the last. **Rejected at the time**: `setInterval` animation — "an extra timer to unref and tear down,
for a display whose underlying number is static for seconds at a time."

**Why it was revised.** That rationale measured how *often* events arrive and never asked what
happens when **none** arrive. Observed by running the built CLI against this repo's own `docs/`:
stderr came back **0 bytes** on a 2 911 ms run, well past the elapsed threshold. The cause is in
`index-documents.ts:125` — `embedding/tick` is emitted *before* `await embed()`, so a one-batch warm
run emits every event inside the first ~25 ms and then blocks silently for ~2.9 s (≈0.85 s model
load + ≈1.4 s inference). With no event to react to, an event-driven renderer draws nothing. The
20-document forced run had already shown this and was misread: it drew exactly **one** frame.

The rejected rationale also had the argument backwards. "The number is static for seconds at a time"
is not a reason to skip the animator — it is the reason to *have* one. The original complaint was
"looks hung", not "I don't know how much is left"; liveness is the primary signal.

**Revised choice**: keep `shouldDrawBar` as a 100 ms **floor** (it still absorbs the per-file burst
of ~600 events/s), and add a repaint heartbeat on top:

- `BAR_REPAINT_MS = 200` — while a phase is active and the elapsed threshold has been crossed, the
  sink repaints on a timer regardless of event arrival. 200 ms sits above the 100 ms floor, so the
  two never fight, and gives 5 visible updates per second.
- `renderBar` gains an **elapsed-time indicator** rendered to one decimal (e.g. `3.2s`). A repainted
  byte-identical frame communicates nothing; the advancing number is what separates "working" from
  "hung", and unlike a spinner it is also information.
- The timer is **`unref()`'d** so it can never hold the process open, is **armed at sink
  construction** (bar mode only) so it can detect the threshold crossing even with zero events after
  it — see "Implementation correction" below — is cleared by `finish()`, and is never created in
  `plain` or `none` mode. Every tick still funnels through `shouldDrawBar`, so nothing is written
  before the threshold regardless of how early the timer object exists.

**Rejected**: moving `embedding/tick` to *after* each batch — with a single batch the silence is
still inside the `await`, so the user's own corpus would remain blank; it treats a symptom.

**Implementation correction (discovered during apply, verified empirically).** The original text
above read "created only on the first draw (never before the threshold)" — i.e., the timer would be
armed lazily, inside the draw routine, only after a successful event-driven draw. That is
insufficient: it cannot fix the exact bug this decision exists to fix. If literally every event
fires before the threshold and *none* arrives afterward (the one-batch scenario this section already
describes), no event ever calls the draw routine after crossing, so a lazily-armed timer never gets
armed at all — the bug persists unchanged. Fixed by arming the timer unconditionally at sink
construction (bar mode only, still unref()'d, still cleared by `finish()`); confirmed by a dedicated
unit test that reproduces the exact event shape (every event at `clock = 0`, then only the fake timer
advances) and by an isolated real-timer integration test.

**Known residual limitation (measured, not fixed by this decision).** Even with the timer armed
correctly, three independent instrumented runs against the real `TransformersEmbeddings` pipeline
(an unrelated `setInterval` alongside the real indexing run; a fake-stream-instrumented sink against
the real run; both against this repo's own `docs/` and against `ejemplos/`) show the Node event loop
essentially starved for the run's dominant cost: over one ~4 s run, an independent 50 ms timer fired
only 2 times; over one ~5.4 s two-batch run, only 4 times, clustered in gaps *between* batches, with
zero fires during either batch's own inference window. The cause is outside this decision's scope:
`onnxruntime-node`'s CPU inference call blocks the JS main thread synchronously for its full
duration, so no JS-level timer — regardless of when it is armed — can fire while it runs, because
Node is single-threaded and a synchronous native call yields to nothing. Consequence, observed: for a
corpus small enough that its *entire* duration is one blocking `create()`+`embed()` call (e.g. this
repo's current `docs/`, now down to a single indexable file), stderr can still be empty end to end,
even past the threshold. For a corpus with more than one batch or a genuinely slow *network* download
(non-blocking socket I/O, unlike a warm local cache read), the heartbeat does fire — observed directly
against `ejemplos/`: two real frames drawn near the tail of model loading, with the elapsed indicator
advancing `3.7s` → `3.8s`. Fixing the residual gap would mean moving embedding inference off the main
thread (`worker_threads` or similar) — a materially larger change, out of scope here, and a decision
this agent did not make unilaterally. Flagged for the repository owner.

### D3 — Bar threshold: 1 500 ms elapsed *(revised — originally 5 000 ms)*

**Choice**: `BAR_MIN_ELAPSED_MS = 1500`.

**Original rationale (5 000 ms)**: the slowest measured warm run on this project's own corpus is
3.94 s, so 5 s clears it by ~27%. Any run crossing 5 s is either a cold download (~285 s) or a
corpus ≥3× denser than `ejemplos/`.

**Why it was revised.** That reasoning optimised against the flash and never asked what it cost.
Post-apply, the repository owner ran an index and saw no bar — correctly, since this repo's own
`docs/` indexes in 3.24 s warm, below the gate. The consequence nobody weighed at decision time:
**5 s hid the bar from every ordinary invocation.** The only runs that showed it were a cold 129 MB
download or a synthetic corpus built to be slow — which also made the feature impossible to
validate on demand. A gate that suppresses its own feature in the common case is tuned wrong.

**Revised rationale (1 500 ms)**, against measured warm-cache durations:

| Run | Duration | Bar visible at 1 500 ms |
|---|---|---|
| 5-document subprocess fixture (`--lexical`) | ~0.63 s | no — subprocess tests unaffected |
| This repo's own `docs/` | 3.24 s | ~1.7 s |
| `ejemplos/` (slowest warm run measured) | 3.94 s | ~2.4 s |

A genuine flash is under ~0.5 s and that band stays suppressed; 1.7-2.4 s is comfortably readable.
**Rejected**: keeping 5 s (hides the bar from real use, as observed); removing the gate entirely
(restores the sub-second flash on trivial runs); making an explicit `COMPENDIO_PROGRESS=bar` bypass
the gate (a second behavioral branch, added only to keep one badly-tuned constant).

**Test coupling.** The threshold's dependent tests were rewritten to derive from
`BAR_MIN_ELAPSED_MS` and `BAR_REDRAW_MIN_MS` instead of hardcoding `5_000`/`5_100`. They assert the
gate's *behavior*, not today's number, so retuning either constant no longer turns them red.

**Carrying accumulated progress** (spec: "not a restart from zero") falls out of the shape: the
sink advances `ProgressState` on **every** event whether or not it draws, and `renderBar` is a
function of the *state*, not the event. When the threshold is crossed, `lastDrawMs` is still `null`,
so the very next event draws immediately — showing the accumulated state by construction.

### D4 — Module boundary

| Layer | File | Holds |
|---|---|---|
| Pure (`src/domain/`) | `progress.ts` | Event union, `ProgressState`, mode resolver, `advanceProgress`, both formatters, throttle factory, `shouldDrawBar`, constants |
| Adapter (`src/infrastructure/`) | `progress-sink.ts` | Mutable state, injected `now()`, injected stream, `\r` + space-padding erase, throttle instance, `finish()` |
| Wiring (`src/cli.ts`) | — | The one impure expression |

`progress-sink.ts` sits at the infrastructure root next to `config.ts` (the existing precedent for a
non-port adapter), not in a new one-file subdirectory. It is not a `ports.ts` entry: per proposal
decision 5, it is an observability hook, not a swappable backend.

## Contracts

```ts
// src/domain/progress.ts — no fs, no SQLite, no transformers.js, no `process`
export type ProgressMode = "bar" | "plain" | "none";

export type ProgressEvent =
  | { phase: "discovery"; kind: "start" }
  | { phase: "files"; kind: "start"; total: number }
  | { phase: "files"; kind: "tick"; current: number; total: number; path: string }
  | { phase: "embedding"; kind: "start"; batches: number; chunks: number }
  | { phase: "embedding"; kind: "download"; loaded: number; total: number }  // nested by construction
  | { phase: "embedding"; kind: "tick"; current: number; total: number }
  | { phase: "embedding"; kind: "failed"; reason: string };

export type ProgressReporter = (event: ProgressEvent) => void;

export interface ProgressState {
  phase: "idle" | "discovery" | "files" | "embedding";
  label: string;
  current: number;
  total: number;                                        // 0 => render no ratio
  download: { loaded: number; total: number } | null;
}

export function resolveProgressMode(raw: string | undefined, isTTY: boolean): ProgressMode;
export function initialProgressState(): ProgressState;
export function advanceProgress(state: ProgressState, event: ProgressEvent): ProgressState;
export function formatPlainLine(event: ProgressEvent): string;            // no \r, no ANSI
export function renderBar(state: ProgressState, width: number, elapsedMs: number): string;
  // no \r, no \n, no ANSI, length <= width; elapsedMs renders as one-decimal
  // seconds (e.g. "3.2s") — the repaint heartbeat's liveness signal
export function createDownloadThrottle(
  stepPercent: number,
): (loaded: number, total: number, lastReported: number) => boolean;      // false when total <= 0
export function shouldDrawBar(startedMs: number, nowMs: number, lastDrawMs: number | null): boolean;

export const BAR_MIN_ELAPSED_MS = 1_500;
export const BAR_REDRAW_MIN_MS = 100;
export const BAR_REPAINT_MS = 200;
export const DOWNLOAD_STEP_PERCENT_BAR = 1;
export const DOWNLOAD_STEP_PERCENT_PLAIN = 5;
export const BAR_MAX_WIDTH = 80;
```

```ts
// src/infrastructure/progress-sink.ts
export interface ProgressStream { write(chunk: string): unknown; columns?: number | undefined }
export interface ProgressSink { onProgress: ProgressReporter; finish(): void }  // finish() idempotent
export function createProgressSink(
  mode: ProgressMode, stream: ProgressStream, now?: () => number,
): ProgressSink;
```

Rendered bar, ASCII only (`=`/`-`, never box-drawing: the reporting machine is Windows 10, where a
non-UTF-8 code page turns block characters into mojibake):

```
\r[=========-----------] 45%  downloading model 58/129 MB<pad to previous length>
```

Width is capped without the formatter touching the terminal: the sink reads `stream.columns` once
at construction and passes `Math.min(columns - 1, BAR_MAX_WIDTH)` (default 80) into `renderBar`,
which clamps the fill segment and truncates the label to fit.

## Seams and exact call sites

### Application seam

`IndexDocumentsOptions` gains `onProgress?: ProgressReporter`; `private report(e: ProgressEvent)`
calls `this.options.onProgress?.(e)`.

| `index-documents.ts` (current line) | Emission |
|---|---|
| before `this.source.discover()` (63) | `{ phase: "discovery", kind: "start" }` |
| after `this.store.reset()` (72), before the loop | `{ phase: "files", kind: "start", total: files.length }` |
| first statement of the loop body (74, via `files.entries()`) | `{ phase: "files", kind: "tick", current: i + 1, total, path }` — at the **top**, so the `continue` on a skipped file (79-81) still ticks |
| `embedPending`, after the `embeddings === null` guard (109-111) | `{ phase: "embedding", kind: "start", batches: Math.ceil(pending.length / batchSize), chunks: pending.length }` |
| inside the batch loop (114), **before** `await this.embeddings.embed(...)` (117) | `{ phase: "embedding", kind: "tick", current, total }` — must precede the await, because the download happens inside batch 1 |
| `catch` (123), after building the message | `{ phase: "embedding", kind: "failed", reason }` |

Placing `embedding/start` after the null guard is what makes "`--lexical` emits nothing" structural
rather than conditional. `pending.length === 0` yields `batches: 0`, and `renderBar`/`formatPlainLine`
render no ratio for `total === 0`.

### Download seam

```ts
// transformers-embeddings.ts
export interface DownloadProgress { loaded: number; total: number }
export interface TransformersEmbeddingsOptions {
  onDownloadProgress?: (progress: DownloadProgress) => void;
}
static async create(model: string, options?: TransformersEmbeddingsOptions): Promise<TransformersEmbeddings>
```

Build `progress_callback` once and pass it to **both** `pipeline(...)` calls — the q8 call (line 22)
*and* the untyped fallback (line 24), which today takes no options object at all. It maps only
`status === "progress_total"`.

```ts
// composition.ts — ContainerOptions gains `onProgress?: ProgressReporter`
const onProgress = options.onProgress;
const embeddings = options.forceLexical === true ? null
  : new LazyEmbeddings(() => TransformersEmbeddings.create(
      config.embeddings.model,
      onProgress === undefined ? {} : {
        onDownloadProgress: ({ loaded, total }) =>
          onProgress({ phase: "embedding", kind: "download", loaded, total }),
      },
    ));
```

**Why the callback is conditional, not always-on**: `pipeline()` runs a `get_file_metadata` Range
request per model file *only when `progress_callback` is truthy* (`pipelines.js:141-152`). Passing
it unconditionally would add network round-trips to `serve`, `search` and `eval`. Gating on
`onProgress` keeps every existing call path byte-identical to today — and makes
`COMPENDIO_PROGRESS=none` identical all the way down to `pipeline()`, which is what the rollback
plan promises.

`SyncIndex` (line 80) is constructed unchanged. `exactOptionalPropertyTypes: true` is on: build
`IndexDocumentsOptions` as an object then `if (onProgress !== undefined) o.onProgress = onProgress`,
exactly as `withContainer` already does for `docsDir`. Spreading `ProgressReporter | undefined`
will not typecheck.

### CLI wiring — the only impure read

```ts
const mode = resolveProgressMode(process.env["COMPENDIO_PROGRESS"], process.stderr.isTTY === true);
const progress = createProgressSink(mode, process.stderr);
// ...inside the action, threaded through withContainer's options:
let report: IndexReport;
try { report = await container.indexDocuments.execute(); } finally { progress.finish(); }
```

Bar hygiene collapses to that one `finally`: every `console.warn` (skipped files, `embeddingsWarning`)
and the final `console.log` already run **after** `execute()` returns, so a single `finish()` clears
the line ahead of all of them, on the success and throw paths alike. `finish()` writes
`\r` + spaces(lastLineLength) + `\r` — an erase, not a newline, so no blank line is left behind.
stdout is untouched by construction: the sink only ever writes to its injected stream.

## Data flow

```
IndexDocuments ──onProgress(event)──┐
                                    ├─→ ProgressSink ─→ advanceProgress(state)
pipeline() progress_total ──────────┘        │              │
  → TransformersEmbeddings.create            │         bar: shouldDrawBar? → renderBar(state,width) → "\r…" → stderr
  → composition closure ────────────┘        └────── plain: throttle? → formatPlainLine(event) → "…\n" → stderr
                                                     none: nothing
```

## File changes

| File | Action | Description |
|---|---|---|
| `src/domain/progress.ts` | Create | Events, state, resolver, reducer, both formatters, throttle, threshold, constants |
| `src/infrastructure/progress-sink.ts` | Create | stderr writer: state, injected clock/stream, `\r` erase, `finish()` |
| `src/application/index-documents.ts` | Modify | `onProgress?` on options, `report()`, 6 emission points |
| `src/infrastructure/embeddings/transformers-embeddings.ts` | Modify | Options param on `create()`, `progress_callback` on both `pipeline(...)` calls |
| `src/composition.ts` | Modify | `ContainerOptions.onProgress?`, fanned out to `LazyEmbeddings` and `IndexDocuments` |
| `src/cli.ts` | Modify | Mode resolution, sink construction, `onProgress` through `withContainer`, `finally { finish() }` |
| `test/domain/progress.test.ts` | Create | Pure unit tests |
| `test/infrastructure/progress-sink.test.ts` | Create | Sink unit tests, fake stream + fake clock |
| `test/infrastructure/transformers-embeddings-progress.test.ts` | Create | `vi.mock` of `@huggingface/transformers` |
| `test/application/index-progress.test.ts` | Create | `vi.fn()` spy with `FakeEmbeddings`/`BrokenEmbeddings` |
| `test/cli-subprocess.test.ts` | Modify | `runCli` gains `env`; per-mode stderr shape, stdout unchanged |

## Testing strategy

| Layer | Target | Approach |
|---|---|---|
| Unit | `resolveProgressMode` | All 6 spec scenarios: `auto`+TTY→`bar`, `auto`−TTY→`plain`, forced `bar`/`plain` ignore `isTTY`, `none` both ways, `undefined` and `"verbose"` ≡ `auto` |
| Unit | `formatPlainLine` | One case per event kind; output carries no `\r` and no ANSI escape; `total === 0` renders no `0/0` |
| Unit | `renderBar` | Length ≤ width for widths 20/40/80/200 (including with the elapsed indicator present); no `\r`, no `\n`, no ANSI; `total === 0` renders no ratio; download state shows MB, not counts; elapsed renders to one decimal (e.g. `3.2s`) and two different `elapsedMs` values produce different frames |
| Unit | `advanceProgress` | Accumulates without drawing; `download` updates while `phase` stays `"embedding"` |
| Unit | `createDownloadThrottle` | Below step ⇒ `false`; crossing ⇒ `true` once; non-monotonic `loaded` ⇒ `false`; `total <= 0` ⇒ `false`; 1% vs 5% report counts over a synthetic 0→129 MB stream |
| Unit | `shouldDrawBar` | Below `BAR_MIN_ELAPSED_MS` ⇒ `false`; first call after crossing ⇒ `true`; second call less than `BAR_REDRAW_MIN_MS` later ⇒ `false`. Derived from the exported constants, not hardcoded, so retuning either does not turn the tests red |
| Unit | `createProgressSink` | Fake `{ write, columns }` + fake `now`, `vi.useFakeTimers()` advanced in lockstep with the fake clock for the repaint heartbeat. `none` writes nothing; `plain` appends newline-terminated lines with no `\r`; `bar` writes `\r`-prefixed, newline-free frames padded to erase; a run below `BAR_MIN_ELAPSED_MS` writes nothing; the first frame after crossing it shows accumulated state, not zero; with no further event, the repaint timer fires at `BAR_REPAINT_MS` and consecutive frames differ in elapsed; `finish()` stops the timer (no further frame after it fires) and is idempotent and a no-op in `plain`/`none`; `plain`/`none` never create a timer even across a repaint-interval-sized gap (`vi.getTimerCount() === 0`) |
| Unit | `TransformersEmbeddings.create` | `vi.mock("@huggingface/transformers")` capturing `pipeline` args. Assert `progress_callback` is a function on the q8 call; make that call reject to assert it is present on the fallback too; invoke the captured callback with a synthetic `progress_total` and assert the mapped `{ loaded, total }`; assert `progress`/`initiate`/`done`/`ready` are ignored; assert `progress_callback` is **absent** when no option is passed. No network |
| Integration | `IndexDocuments` emission | `vi.fn()` as `onProgress` with `FakeEmbeddings` against `ejemplos/`. Assert order; `files/start.total === files.length` before the first tick; `embedding/start.batches === ceil(chunks / batchSize)`; skipped files still tick. With `embeddings: null`: zero `phase === "embedding"` events. With `BrokenEmbeddings`: exactly one `embedding/failed`, report still `mode: "lexical"`. `fake-embeddings.ts` is not modified |
| Subprocess | End-to-end mode selection | `runCli` gains `env: { ...process.env, COMPENDIO_PROGRESS }` (the spread is required — dropping `PATH` breaks Windows). `spawnSync` gives the child no TTY, so the variable is what makes `bar` reachable. `none` ⇒ no progress on stderr; `plain` ⇒ `Indexing 5 documents` plus `[1/5]`-shaped lines and no `\r`; `bar` ⇒ stderr contains `\r`. All three ⇒ stdout still matches `/Indexed 5 documents \(\d+ chunks\)/`. Stays `--lexical`, so no download |
| Manual | Real cold download | Not automated (129 MB per CI run). Smoke test alongside the existing ones in `CLAUDE.md` |

## Review budget

Estimated ~840 changed lines — over the 400-line budget. Slice at the layer line:

1. `src/domain/progress.ts` + `test/domain/progress.test.ts` (~340)
2. `src/infrastructure/progress-sink.ts` + its test (~210)
3. Application/composition/CLI seams + integration, `vi.mock` and subprocess tests (~290)

**400-line budget risk: High. Chained PRs recommended: Yes.** Slices 1 and 2 are independently
verifiable with no behavior change to any command; slice 3 is where behavior changes.

**Delivery decision — `size:exception` recorded.** The chained split above was offered and declined:
this change ships as a **single PR**, with the over-budget size explicitly accepted by the repository
owner on 2026-07-28. The layer boundaries above are retained as the **commit** structure inside that
one PR, so a reviewer can still walk it slice by slice — the pure layer, then the adapter, then the
seams that change behavior — rather than as a flat 840-line diff.

## Migration / rollout

No migration. No schema, config key, dependency or persisted state. `COMPENDIO_PROGRESS=none` is a
runtime rollback; reverting the commits restores today's behavior because every seam is optional.

## Open questions

- None blocking.
- Accepted residuals: (a) a run finishing just above 5 s draws a bar for well under a second — one
  wasted frame that `finish()` erases, no lasting artifact; (b) a partially warm cache never reaches
  100% on the download ratio, because `pipeline()` seeds cached files' `loaded` at 0 and they never
  fire `progress`; (c) if a server omits `Content-Length`, `total` is 0, the throttle stays `false`
  and the display falls back to the batch counter.
