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

The system MUST report four phases in execution order — discovery, per-file parse/chunk/persist, per-batch embedding, and the one-time model download — with the download reported as nested inside the embedding phase, not as a fifth top-level phase. Each phase's denominator MUST be available and reportable at the moment the phase starts: `files.length` for the per-file phase (known immediately after discovery returns), and `ceil(pending.length / batchSize)` for the embedding phase (known immediately after the per-file phase completes).

#### Scenario: Per-file denominator is known at phase start

- GIVEN discovery has returned `files.length` files
- WHEN the per-file phase begins
- THEN its total is reported as `files.length`, before the first file is processed

#### Scenario: Embedding batch denominator is known at phase start

- GIVEN the per-file phase has completed with `pending.length` chunks awaiting embedding and a configured `batchSize`
- WHEN the embedding phase begins
- THEN its total is reported as `ceil(pending.length / batchSize)`, before the first batch is embedded

#### Scenario: Download progress is reported inside the embedding phase, not separately

- GIVEN a cold model cache triggers a download during the embedding phase
- WHEN download progress is reported
- THEN it is reported as nested within the embedding phase's reporting, not as a separate top-level phase preceding or following it

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
