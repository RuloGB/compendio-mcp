# Proposal: Index Progress Reporting — make `compendio index` show its work

`compendio index` prints nothing at all until it finishes. On a fresh machine that is roughly five
minutes of a silent, unkillable-looking process for 36 documents. This change gives the command a
live progress display: a redrawn bar in an interactive terminal, plain append-only lines everywhere
else, over a single shared event stream. No new dependency, no change to what gets indexed.

## Intent

The first run of compendio on a new project is the moment the tool earns or loses trust. Today that
first impression is a terminal that looks hung. The user cannot tell whether it is downloading a
129 MB model, embedding chunks, or deadlocked — so the rational move is Ctrl-C, which leaves a
half-built index and a bad verdict on the tool.

Success is a user who can see, at any second of the run, which phase is executing and how far
through it the process is — and who therefore waits.

## Scope

### In scope

| Piece | What it covers |
|---|---|
| One event stream | Phase events for discovery, per-file parse/chunk/persist, per-batch embedding, and one-time model download. Every denominator is already known synchronously when its phase starts (`files.length` after `discover()`; `ceil(pending.length / batchSize)` after the file loop). |
| **Two** renderers | `bar` — `\r` in-place redraw for a TTY. `plain` — append-only lines for pipes, redirected files and CI. `none` — today's silence. |
| Mode resolution | A pure function of `(COMPENDIO_PROGRESS, isTTY)`. Both inputs are **injected**, never read inside a renderer. |
| Application seam | Optional `onProgress?` callback on `IndexDocumentsOptions`, fanned out from `createContainer(options)`. |
| Download seam | An optional `progress_callback` forwarded into the existing `pipeline(...)` call in `TransformersEmbeddings.create`, threaded through `LazyEmbeddings`'s factory closure. |
| Stream discipline | Progress goes to **stderr** (extending `cli.ts`'s existing `console.warn` diagnostics convention). `stdout` stays byte-identical to today. |

### Out of scope, with reasons

| Excluded | Why |
|---|---|
| `SyncIndex` / `SyncScheduler` / `server.ts` / `compendio serve` | Confirmed a separate object graph that `compendio index` never touches (`composition.ts:80-84`). Different transport (stdout is JSON-RPC), different cadence, deliberately non-blocking startup. Revisit only against a real complaint about `serve` silence. |
| ETA / time-remaining prediction | Needs a real throughput number nobody has measured yet. Premature. |
| `index-md`, `eval` | Filesystem-only and query-time-only respectively. No silence complaint, no evidence of slowness. |
| Any progress-bar npm package (`ora`, `cli-progress`, …) | Would be this project's first UI dependency. The house style is hand-rolled for small amounts of work — own chunking, own RRF, own excerpt budget. This is one more. |
| Changing `EmbeddingsProvider.embed()`'s signature | Unnecessary: batch position is caller knowledge, download progress is construction-time knowledge. Neither belongs on `embed()`. |
| Moving the embeddings-load trigger point earlier | See decision 4. |

## Capabilities

### New Capabilities

- `index-progress`: the progress event stream for `compendio index` — phases and their denominators,
  the two render modes and how the mode is resolved, stderr/stdout separation, and the negative
  guarantee that reporting changes neither what is indexed, nor the phase order, nor the lexical
  fallback.

### Modified Capabilities

- None. `indexing`'s existing requirements are preserved unchanged **by design** (decision 4); that
  preservation is stated as a requirement of the new capability rather than as a delta.
  `configuration` is untouched — the override is an environment variable, not a
  `compendio.config.json` key.

## Approach

Emit typed events from `IndexDocuments` through an optional callback; render them at the CLI edge.
The formatter is a pure `(event, mode) -> output` function with no ambient state.

Rendering shape is **Approach 3 from the exploration (TTY-aware live bar)**, which the exploration
recommended against. That override is deliberate, and it comes with a scope consequence that must
not be underestimated: **a `\r` bar necessarily ships the append-only renderer too.** A redrawn bar
is unusable the moment stderr is a file, a pipe or a CI log, so Approach 3 is a *superset* of
Approach 2, not a substitute for it. Two renderers, one event stream.

**The design constraint that makes this testable:** the renderer MUST NOT read
`process.stderr.isTTY` itself.

The exploration's finding that the redraw path is unreachable by the current harness is factually
correct — `test/cli-subprocess.test.ts:63-65` calls `spawnSync` with no `stdio` option, so Node
defaults all three streams to `"pipe"` and the child's `isTTY` is always `undefined`. But
"unreachable by the harness as currently written" is not "untestable", and the harness is ours. With
the mode injected, both branches are ordinary unit tests with no TTY anywhere. Adding
`COMPENDIO_PROGRESS=auto|bar|plain|none` (default `auto`) then makes even the end-to-end selection
exercisable by the existing `spawnSync` harness — set the variable in the child's `env` and assert
the resulting stderr shape under a pipe. The only line left uncovered is the single wiring line in
`cli.ts` that reads `process.env` and `process.stderr.isTTY`.

An environment variable is chosen over a `--progress` flag because it also reaches invocations whose
argv you do not control (npm scripts, CI wrappers, agent harnesses), and it matches the established
`NO_COLOR`/`FORCE_COLOR`/`CI` convention. It is additionally a user escape hatch for ugly CI logs.

## Binding decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **TTY-aware live bar**, not append-only-only | Explicit user requirement. The interactive terminal is the primary real-world case. |
| 2 | **Ships both renderers** | A `\r` bar is unusable under redirection. Non-negotiable consequence of decision 1. |
| 3 | **TTY detection is injected** | Turns the entire rendering layer into pure, unit-testable functions and shrinks the untestable surface to one wiring line. |
| 3b | **Zero configuration to get the bar** | The bar is the default experience in an interactive terminal — `auto` resolves to `bar` when `isTTY` is true. No flag, no environment variable, no config key is required, ever. `COMPENDIO_PROGRESS` exists to let the test harness force a mode under a pipe and to give users an escape hatch; it is never a prerequisite for seeing the bar. Two renderers are not a preference: `\r` is a byte a terminal *interprets* and a file merely *stores*, so a redirected run would otherwise accumulate every frame (~3.000 frames over a five-minute run) on one unreadable line. |
| 4 | **Keep the lazy embeddings-load trigger unchanged** | Moving `TransformersEmbeddings.create()` before the file loop would mean a network failure is discovered *before* the corpus is parsed, chunked and persisted lexically. Today a user with no network still gets a complete, useful lexical index. That graceful degradation is documented behavior and worth more than tidier phase ordering. The phase-transition message is printed unconditionally around the *existing* `embedPending` call site (`index-documents.ts:94`), which achieves the same visible effect. |
| 5 | **Optional callback on `IndexDocumentsOptions`, not a new `ports.ts` port** | `ports.ts`'s five entries are all "swap this infrastructure for another backend". Progress has one real implementation and one no-op — it is an observability hook, and `IndexDocumentsOptions` already hosts optional per-run knobs (`embeddingBatchSize?`). |

## Affected areas

| Area | Impact | What changes |
|---|---|---|
| `src/domain/` (new module) | New | Event types, the pure `(event, mode) -> output` formatters, the pure mode resolver, the download-throttle predicate. Stays free of fs/SQLite/transformers deps per the project's design rule. |
| `src/application/index-documents.ts` | Modified | `onProgress?` on `IndexDocumentsOptions`; emit at phase boundaries, per file, per batch. |
| `src/infrastructure/embeddings/transformers-embeddings.ts` | Modified | Optional progress option forwarded into the existing `pipeline(...)` call; threaded through `LazyEmbeddings`'s factory closure. |
| `src/composition.ts` | Modified | `ContainerOptions.onProgress?`, fanned out to both destinations. |
| `src/cli.ts` | Modified | One wiring line resolving the mode; construct the sink and pass it in. |
| `test/` | New + Modified | Renderer/resolver unit tests; `vi.fn()` spy on the callback in the `FakeEmbeddings` integration suite; a `vi.mock("@huggingface/transformers")` test asserting `progress_callback` is forwarded; subprocess assertions on stdout cleanliness and per-mode stderr shape. |
| `src/server.ts`, `src/application/sync-index.ts` | Unchanged | Out of scope. `serve` passes nothing. |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **The 5-minute figure is unmeasured.** It is attributed to CPU embedding compute by elimination, not by timing. If the real split is download-dominated on a slow link, the bar emphasizes the wrong phase. | High | **First task of the next phase**: time `TransformersEmbeddings.create()` in isolation and each `embedPending` batch against the warm cache, and record the numbers in this change folder. Until then, commit to **no** UI text about duration, **no** throttle cadence, and **no** refresh interval. Those three are all downstream of this number. |
| 2 | **Two renderers is real surface**, larger than the exploration's recommendation. Risk of crossing the 400-line review budget. | Medium | Flagged now for the tasks phase. Natural slice line: pure event/formatter/resolver layer (fully unit-tested) lands before the CLI wiring and the download seam. |
| 3 | **Download `progress` events can fire very frequently** and would spam a plain renderer. | Medium | Keep the throttle a pure predicate of `(loaded, total, lastReported)`. Cadence value is set in design, after risk 1's measurement. |
| 4 | **Redraw artifacts**: narrow terminals wrapping the bar into scrollback, or a bar left un-finalized when embeddings fail mid-run and the existing `embeddingsWarning` prints. | Medium | The bar MUST be terminated/cleared before any `console.warn` or the final `console.log` summary. Cap the rendered width. Both are assertable on the formatter's output without a TTY. |
| 5 | **Degenerate denominators**: `--lexical` skips the embedding phase entirely (`embeddings === null`), and an empty corpus yields zero files and zero chunks. | Low | Explicit scenarios in the spec phase; a zero-denominator phase renders no ratio rather than dividing. |
| 6 | **CI cost** if a test ever asserts real download-progress text. | Low | Download wiring is tested at the `pipeline()`-mock level only. Real-download behavior stays a manual smoke test, alongside the existing ones. |

## Rollback plan

Nothing is persisted: no schema change, no config file key, no database write, no new dependency.

- **Soft rollback, no deploy:** `COMPENDIO_PROGRESS=none` restores today's exact output at runtime.
- **Hard rollback:** revert the commits. The seams are optional (`onProgress?`, an optional
  progress option on `create()`); with nothing passed, every call site behaves as it does today.

## Dependencies

- No new runtime dependency. `progress_callback` already exists in the installed
  `@huggingface/transformers`.
- **Prerequisite:** the timing measurement (risk 1) must be recorded before design fixes any
  cadence, refresh interval, or duration-claiming UI text.

## Success criteria

- [ ] A real timing measurement for `create()` and per-batch `embed()` is recorded in this change folder.
- [ ] `compendio index` in an interactive terminal shows a bar that redraws in place, never exceeds one line, and is cleared before the final summary — **with no flag, no environment variable and no config key set**.
- [ ] `compendio index 2> log.txt`, a pipe, and CI all produce append-only lines with no `\r` and no ANSI escapes.
- [ ] `COMPENDIO_PROGRESS=none` reproduces today's output exactly; `bar` and `plain` force their mode regardless of `isTTY`.
- [ ] `compendio index`'s stdout is byte-for-byte unchanged from today, and still parseable by the existing subprocess tests.
- [ ] Both renderers and the mode resolver are covered by unit tests that never touch a TTY; end-to-end mode selection is exercised through the existing `spawnSync` harness via the environment variable.
- [ ] `--lexical` and an empty corpus both run without a malformed or zero-denominator display.
- [ ] `package.json` gains no dependency. `npm test` and `npm run typecheck` are green.
