# Delta for Index-Progress

## ADDED Requirements

### Requirement: Zero-Configuration Bar in an Interactive Terminal

`compendio index` MUST show a live, in-place redrawn progress bar on stderr when run in an interactive terminal, with no flag, no environment variable, and no config key set. Mode resolution MUST default to `auto`, and `auto` MUST resolve to `bar` whenever stderr is a TTY. `COMPENDIO_PROGRESS` is an override and an escape hatch; it MUST NOT be a prerequisite for the bar to appear.

#### Scenario: Bar appears with nothing configured

- GIVEN `COMPENDIO_PROGRESS` is unset, no `compendio.config.json` exists, and stderr is a TTY
- WHEN `compendio index` runs
- THEN a redrawn progress bar appears on stderr with no flag, variable, or config key having been set

#### Scenario: The environment variable is never required, only optional

- GIVEN `COMPENDIO_PROGRESS` is unset (the default state for every existing invocation)
- WHEN `compendio index` runs in a TTY
- THEN the bar still renders — the variable's only role is to override this default, not to unlock it

### Requirement: Mode Resolution Is a Pure, Injected, Total Function

The render mode (`bar | plain | none`) MUST be resolved by a pure, total function of exactly two injected inputs — the raw `COMPENDIO_PROGRESS` string and `isTTY` — with default `auto`. No renderer or resolver MUST read `process.env` or `process.stderr.isTTY` directly. An unset variable and an unrecognized value MUST both behave as `auto`, never as an error. `bar` and `plain`, when explicitly set, MUST select their renderer regardless of `isTTY`.

#### Scenario: auto resolves to bar on a TTY

- GIVEN mode input `auto` and `isTTY: true`
- WHEN the mode resolver runs
- THEN it returns `bar`

#### Scenario: auto resolves to plain off a TTY

- GIVEN mode input `auto` and `isTTY: false`
- WHEN the mode resolver runs
- THEN it returns `plain`

#### Scenario: Explicit bar forces the bar under a pipe

- GIVEN `COMPENDIO_PROGRESS=bar` and `isTTY: false`
- WHEN the mode resolver runs
- THEN it returns `bar`, ignoring `isTTY`

#### Scenario: Explicit plain forces plain lines in a TTY

- GIVEN `COMPENDIO_PROGRESS=plain` and `isTTY: true`
- WHEN the mode resolver runs
- THEN it returns `plain`, ignoring `isTTY`

#### Scenario: none silences regardless of isTTY

- GIVEN `COMPENDIO_PROGRESS=none`, tried with both `isTTY: true` and `isTTY: false`
- WHEN the mode resolver runs
- THEN it returns `none` in both cases

#### Scenario: Unrecognized value falls back to auto

- GIVEN `COMPENDIO_PROGRESS=verbose` (not one of `auto|bar|plain|none`) and `isTTY: true`
- WHEN the mode resolver runs
- THEN it returns the same result as `auto` would (`bar`), rather than throwing or defaulting to `none`

### Requirement: Two Renderers Share One Event Stream

Every progress event MUST render through exactly one of two renderers selected by mode: `bar` (carriage-return in-place redraw, one line, never appended to) or `plain` (one appended line per reported update, no `\r`, no ANSI cursor movement). `none` MUST emit nothing. The two are not interchangeable: a terminal interprets `\r` as a cursor return, while a file or pipe merely stores the byte — so `bar` output is unusable once redirected, which is why `plain` exists as a first-class renderer rather than a fallback afterthought.

#### Scenario: Bar mode redraws the same line

- GIVEN mode `bar` and a sequence of events for the same phase
- WHEN each event renders
- THEN each update reuses `\r` to redraw one line rather than appending a new one

#### Scenario: Plain mode appends one line per update, no carriage returns

- GIVEN mode `plain` and a sequence of events
- WHEN each event renders
- THEN each update is a separate appended line, and no rendered output contains `\r` or an ANSI escape

#### Scenario: none mode emits nothing

- GIVEN mode `none`
- WHEN `compendio index` runs through discovery, per-file, and embedding phases
- THEN stderr receives no progress output at all

### Requirement: Four Reportable Phases With Synchronously-Known Denominators

The system MUST report phases drawn from a fixed set — discovery, per-file parse/chunk/persist, per-batch embedding, and the one-time model download (nested inside the embedding phase, never a fifth top-level phase) — and whichever phases a given pass reports MUST fire in that relative order. Which phases a pass reports, and how each reported phase's denominator is computed, is producer-specific; what MUST hold identically for every producer is the core guarantee this requirement exists to protect: whichever phase a pass DOES report, that phase's denominator MUST be available and reportable at the moment the phase starts, before its first tick.

| Producer | Phases always reported | Embedding phase reported | Per-file denominator | Embedding denominator |
|---|---|---|---|---|
| `compendio index` (`IndexDocuments`) | discovery, per-file, embedding | Unconditionally | `files.length`, known immediately after discovery returns | `ceil(pending.length / batchSize)`, known immediately after the per-file phase completes |
| `compendio sync` (`SyncIndex`) | discovery, per-file | Only when at least one document has a vector-coverage gap to reconcile | The changed-document count, known immediately after the pass's diff sub-pass completes, before the per-file phase's first tick | `{batches, chunks}` — the count of documents with a gap, and their total missing chunks — known once reconciliation begins, before its first tick |

A `compendio sync` pass that reports no embedding phase (nothing to reconcile, or `--lexical` with no embeddings provider) legitimately reports two phases, not four; this is conformant, not a violation — the four-phase enumeration binds unconditionally only for `compendio index`. See "A `compendio sync` Pass Never Emits `embedding/failed`" for what a sync pass reports instead of an `embedding/failed` event when its embeddings provider fails.
(Previously: the per-file denominator was pinned to `files.length` unconditionally and the embedding denominator was pinned to `ceil(pending.length / batchSize)` unconditionally, both written for `IndexDocuments`, the only phase-emitting producer that existed at the time — so the four-phase enumeration and both denominator formulas always applied unconditionally. `compendio sync` is a second producer whose embedding phase is conditional and whose denominators are shaped differently; the requirement is generalized to state the producer-invariant property — a reported phase's denominator is always known before its first tick — while pinning `IndexDocuments`' own behavior, unchanged, as one conformant instance rather than the only possible one.)

#### Scenario: Per-file denominator is known at phase start

- GIVEN discovery has returned `files.length` files
- WHEN the per-file phase begins
- THEN its total is reported as `files.length`, before the first file is processed

#### Scenario: A sync pass's per-file denominator is the changed set, not the discovered count

- GIVEN a `compendio sync` pass in which discovery finds `files.length` documents but only a smaller subset are new or have changed content
- WHEN the per-file phase begins
- THEN its total is reported as that changed-document count, known before the first document is processed, and this total MAY be smaller than `files.length`

#### Scenario: `compendio index`'s embedding batch denominator is known at phase start

- GIVEN a `compendio index` run (via `IndexDocuments`) whose per-file phase has completed with `pending.length` chunks awaiting embedding and a configured `batchSize`
- WHEN the embedding phase begins
- THEN its total is reported as `ceil(pending.length / batchSize)`, before the first batch is embedded

#### Scenario: A sync pass's embedding-phase denominator is its reconciliation group and chunk counts

- GIVEN a `compendio sync` pass whose apply sub-pass has completed and found 3 documents with a vector-coverage gap totaling 7 missing chunks
- WHEN the embedding phase (vector-coverage reconciliation) begins
- THEN its total is reported as `{batches: 3, chunks: 7}`, known before the first group is reconciled

#### Scenario: A sync pass with nothing to reconcile reports two phases, not four

- GIVEN a `compendio sync` pass in which every hash-matched document already has full vector coverage, or `--lexical` was passed so there is no embeddings provider
- WHEN the pass completes
- THEN it reports only the discovery and per-file phases — no `embedding/start`, `embedding/tick`, or download event is ever emitted for that pass — and this is conformant with this requirement, not a violation of it

#### Scenario: Download progress is reported inside the embedding phase, not separately

- GIVEN a cold model cache triggers a download while an embed call is in flight — whether during `compendio index`'s embedding-phase batch loop or during a `compendio sync` per-document embed in the per-file phase
- WHEN download progress is reported
- THEN it is reported as nested within the embedding phase's reporting, not as a separate top-level phase preceding or following it, regardless of which phase the triggering embed call itself belongs to

### Requirement: A `compendio sync` Pass Never Emits `embedding/failed`

Unlike `compendio index` (`IndexDocuments`), where an embeddings-provider failure is terminal for the batch loop and reported via an `embedding/failed` progress event, a `compendio sync` pass MUST NOT ever emit `embedding/failed` — neither when the embeddings provider fails while embedding a new/changed document during the per-file phase, nor when it fails while reconciling a vector-coverage gap during the embedding phase. In both cases the pass MUST continue processing the remaining documents/groups rather than treating the failure as terminal, and the failure MUST instead be surfaced through `SyncReport.embeddingsWarning` — the same channel the CLI summary already reads from — rather than through a progress event.

#### Scenario: An embeddings failure during the per-file phase emits no `embedding/failed`

- GIVEN a `compendio sync` pass in which the embeddings provider throws while embedding a new or changed document
- WHEN the pass completes
- THEN no `embedding/failed` event was ever emitted, that document is committed lexical-only, the pass continues with the remaining documents, and `SyncReport.embeddingsWarning` is set

#### Scenario: An embeddings failure during vector-coverage reconciliation emits no `embedding/failed`

- GIVEN a `compendio sync` pass in which the embeddings provider throws while reconciling one document's vector-coverage gap
- WHEN the pass completes
- THEN no `embedding/failed` event was ever emitted, that document's gap is left unresolved for a future pass, the pass continues with the remaining groups, and `SyncReport.embeddingsWarning` is set

### Requirement: Progress Goes to stderr; stdout Is Unchanged

All progress output, in every mode, MUST be written to stderr. `stdout` produced by `compendio index` MUST remain byte-for-byte identical to its pre-change output.

#### Scenario: stdout is identical across modes

- GIVEN two runs of `compendio index` against the same corpus, one with mode `bar` in a TTY and one with mode `none`
- WHEN both complete
- THEN their stdout output is byte-for-byte identical

#### Scenario: Every progress write lands on stderr

- GIVEN mode `bar` or `plain`
- WHEN `compendio index` runs
- THEN every progress write appears on stderr and none appears on stdout

### Requirement: Bar Hygiene Before Warnings and the Final Summary

When mode is `bar`, the in-progress bar line MUST be terminated/cleared before any `console.warn` diagnostic (including the existing `embeddingsWarning`) and before the final `console.log` summary, so neither is appended onto a partially-drawn bar line. The bar's rendered width MUST be capped so it cannot wrap onto a second terminal line.

#### Scenario: Bar is cleared before embeddingsWarning

- GIVEN mode `bar` and an embeddings failure that degrades the run to lexical-only mid-run
- WHEN `embeddingsWarning` is printed
- THEN the bar line is terminated/cleared first, so the warning is not appended onto bar characters

#### Scenario: Bar is cleared before the final summary

- GIVEN mode `bar` and a run that completes successfully
- WHEN the final `console.log` summary prints
- THEN the bar line has already been terminated/cleared, leaving no leftover bar characters on that line

#### Scenario: Bar width is capped on a narrow terminal

- GIVEN mode `bar` and a narrow terminal column width
- WHEN the bar renders
- THEN its rendered width does not exceed the capped width, so it cannot wrap into a second line

### Requirement: Degenerate Denominators Render No Ratio, Not a Division Error

When `--lexical` is set, `embeddings` is `null` and the embedding phase — including its batch loop and any nested download reporting — MUST NOT run at all. When a corpus yields zero discovered files, the per-file phase MUST report zero files and the embedding phase MUST report zero chunks, without dividing by zero. Any phase whose denominator is `0` MUST render with no ratio, rather than a malformed `0/0`.

#### Scenario: --lexical skips the embedding phase entirely

- GIVEN `compendio index --lexical`
- WHEN indexing runs
- THEN no embedding-phase progress event, batch loop, or download-progress event is ever emitted

#### Scenario: Empty corpus reports zero without a division error

- GIVEN a docs directory with zero indexable files
- WHEN `compendio index` runs
- THEN the per-file phase reports zero files and the embedding phase (if reached) reports zero chunks, with no exception thrown

#### Scenario: Zero-denominator phase renders no ratio

- GIVEN a phase whose denominator is `0`
- WHEN that phase's progress is rendered
- THEN the output contains no ratio (no `0/0`) rather than an attempted division

### Requirement: Reporting Preserves Existing Indexing Behavior

Progress reporting MUST NOT change what gets indexed, the order in which phases execute, or the existing lexical-only graceful degradation when the embeddings provider fails. These properties MUST hold identically whether the mode is `bar`, `plain`, or `none`.

#### Scenario: Indexed content is identical regardless of mode

- GIVEN the same corpus indexed once with mode `bar` and once with mode `none`
- WHEN both runs complete
- THEN the resulting indexed documents, chunks, and embeddings are identical

#### Scenario: Lexical fallback still occurs, now also reported

- GIVEN the embeddings provider throws during a run with mode `plain`
- WHEN `IndexDocuments` completes
- THEN the run finishes in lexical-only mode exactly as it does today, and this is additionally visible in the progress output rather than only in the final `embeddingsWarning`

### Requirement: A Short Run Does Not Flash a Bar

Measured on this project's own corpus, a warm-cache run completes end to end in about 3 seconds
(`timing-measurement.md`), so drawing a bar for it would be a flash of noise that appears and vanishes
before it can be read. In `bar` mode the bar MUST therefore not be drawn until the run has exceeded an
elapsed-time threshold; a run that finishes below the threshold MUST leave stderr free of any bar
output and produce the same final summary it produces today. Once the threshold is crossed the bar
MUST render normally, reflecting the progress already accumulated rather than restarting from zero.
The concrete threshold value is a design-time decision and is not fixed by this requirement. `plain`
mode is unaffected: appended lines in a log or CI transcript are not a flash, and suppressing them
would cost the exact visibility that mode exists to provide.

#### Scenario: A warm-cache run finishes below the threshold with no bar

- GIVEN mode `bar` and a run that completes faster than the elapsed-time threshold
- WHEN the run finishes
- THEN no bar was ever drawn on stderr, and the final summary is unchanged

#### Scenario: Crossing the threshold starts the bar at real progress

- GIVEN mode `bar` and a run still executing when the elapsed-time threshold is crossed
- WHEN the bar is first drawn
- THEN it reflects the progress accumulated so far, not a restart from zero

#### Scenario: plain mode reports from the first event regardless of duration

- GIVEN mode `plain` and a run that completes faster than the elapsed-time threshold
- WHEN the run finishes
- THEN its progress lines were appended from the first event, with no threshold applied

### Requirement: The Bar Repaints During Long Silences

Progress events are not evenly spaced. `IndexDocuments` emits an `embedding/tick` **before** awaiting
each batch, and a warm-cache run of a one-batch corpus therefore emits every event within the first
~25 ms and then blocks for seconds — ~0.85 s loading the model, ~1.4 s per batch — with nothing to
report. A purely event-driven renderer draws nothing across that gap, which is precisely the "looks
hung" state this capability exists to eliminate.

In `bar` mode the bar MUST therefore repaint on a timer while a phase is active, independently of
whether any event has arrived, and each repainted frame MUST contain an elapsed-time indicator that
visibly advances between frames. Repainting a byte-identical frame communicates nothing; the changing
value is what distinguishes "working" from "hung". The repaint timer MUST NOT keep the process alive
(it is unreferenced), MUST NOT start before the elapsed-time threshold is crossed, MUST be stopped by
`finish()`, and MUST NOT exist at all in `plain` or `none` mode. The concrete repaint interval is a
design-time decision and is not fixed by this requirement.

#### Scenario: The bar advances while no event arrives

- GIVEN mode `bar`, a crossed elapsed-time threshold, and a phase that emits no further events
- WHEN the repaint interval elapses more than once
- THEN more than one frame is written, and consecutive frames differ in their elapsed-time indicator

#### Scenario: The repaint timer never outlives the run

- GIVEN mode `bar` and a run that has drawn at least one frame
- WHEN `finish()` is called
- THEN the repaint timer is stopped and no further frame is written

#### Scenario: No repaint timer in plain or none mode

- GIVEN mode `plain` or `none`
- WHEN a phase stays active with no events for longer than the repaint interval
- THEN nothing additional is written, because no repaint timer was ever created

### Requirement: Download-Progress Throttling Is a Pure Predicate

Model-download `progress` events MUST be throttled by a pure predicate of `(loaded, total, lastReported)` before being reported — never by a fixed timer or sleep — so a high-frequency stream of download events does not spam the `plain` renderer with one line per event. The concrete throttle cadence is a design-time decision and is not fixed by this requirement.

#### Scenario: Repeated events below the throttle threshold produce no extra output

- GIVEN a sequence of download `progress` events whose `loaded` values do not yet satisfy the throttle predicate relative to `lastReported`
- WHEN each event arrives
- THEN none of them produces a new reported line

#### Scenario: An event crossing the threshold produces exactly one report

- GIVEN a download `progress` event whose `loaded` value satisfies the throttle predicate relative to `lastReported`
- WHEN it is evaluated
- THEN exactly one line is reported and `lastReported` is updated accordingly
