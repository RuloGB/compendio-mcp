# Tasks: Index Progress Reporting

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~840 (design's own estimate) |
| 400-line budget risk | High |
| Chained PRs recommended | No — chained split offered in design, declined by repo owner |
| Suggested split | Single PR, 3 internal commits (layer-sliced) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

`size:exception` already recorded and accepted by the repository owner on 2026-07-28
(`design.md`, "Delivery decision"). `sdd-apply` proceeds directly as a single PR built
from the 3 commits below — no further decision gate before implementation.

### Suggested Work Units (commits inside the one PR)

| Unit | Goal | Commit | Notes |
|------|------|--------|-------|
| 1 | Pure event/state/formatter/throttle layer, zero behavior change | Commit 1 | `src/domain/progress.ts` + its test. Independently verifiable — nothing imports it yet. |
| 2 | stderr-writing adapter, zero behavior change | Commit 2 | `src/infrastructure/progress-sink.ts` + its test. Depends on Commit 1's exports only. |
| 3 | Application/composition/CLI seams — behavior changes here | Commit 3 | Depends on Commits 1 and 2. Contains all 5 flagged traps. |

**Parallelization**: within Commit 1, the six function RED/GREEN pairs (1.4–1.15) are
mutually independent pure functions and can be built in any order once the type
skeleton (1.1) exists. Within Commit 3, IndexDocuments emission (3.1–3.7) and the
TransformersEmbeddings download seam (3.8–3.17) are independent of each other; both
must finish before composition wiring (3.18–3.20), which must finish before CLI wiring
(3.21+). Commits 1 → 2 → 3 are strictly sequential.

---

## Phase 1 — Commit 1: Pure domain layer (`src/domain/progress.ts`)

No behavior change to any command. Nothing imports this module yet.

- [x] 1.1 Create `src/domain/progress.ts` skeleton: `ProgressMode`, the 7-variant
      `ProgressEvent` union, `ProgressReporter`, `ProgressState`, and constants
      (`BAR_MIN_ELAPSED_MS=5000`, `BAR_REDRAW_MIN_MS=100`, `DOWNLOAD_STEP_PERCENT_BAR=1`,
      `DOWNLOAD_STEP_PERCENT_PLAIN=5`, `BAR_MAX_WIDTH=80`). No fs/SQLite/transformers.js/
      `process` imports. Structural, no branching — triangulation skipped.
- [x] 1.2 RED — `test/domain/progress.test.ts`: `resolveProgressMode` all 6 scenarios
      (`auto`+TTY→`bar`, `auto`−TTY→`plain`, explicit `bar`/`plain` ignore `isTTY`, `none`
      both ways, `undefined`/`"verbose"` ≡ `auto`) (spec: Mode Resolution Is a Pure,
      Injected, Total Function).
- [x] 1.3 GREEN — implement `resolveProgressMode(raw, isTTY)`.
- [x] 1.4 RED — `initialProgressState()` returns `{ phase: "idle", total: 0, download: null, ... }`.
- [x] 1.5 GREEN — implement `initialProgressState`.
- [x] 1.6 RED — `advanceProgress`: accumulates without drawing (pure state transition);
      a `download` event updates `state.download` while `state.phase` stays `"embedding"`.
- [x] 1.7 GREEN — implement `advanceProgress` covering all 7 event kinds.
- [x] 1.8 RED — `formatPlainLine`: one case per event kind; `files/start` renders
      `Indexing {total} documents`; `files/tick` renders a `[{current}/{total}]`-shaped
      line (these exact shapes are asserted later by the Commit 3 subprocess test — get
      them right here); `total === 0` renders no ratio; no output contains `\r` or an
      ANSI escape (spec: Two Renderers Share One Event Stream).
- [x] 1.9 GREEN — implement `formatPlainLine`.
- [x] 1.10 RED — `renderBar`: length ≤ width at 20/40/80/200; no `\r`, `\n`, or ANSI;
      `total === 0` renders no ratio; download state shows MB, not chunk counts.
- [x] 1.11 GREEN — implement `renderBar`.
- [x] 1.12 RED — `createDownloadThrottle`: below step ⇒ `false`; crossing ⇒ `true` once;
      non-monotonic `loaded` ⇒ `false`; `total <= 0` ⇒ `false`; 1% vs 5% report counts
      over a synthetic 0→129 MB stream (spec: Download-Progress Throttling Is a Pure
      Predicate).
- [x] 1.13 GREEN — implement `createDownloadThrottle(stepPercent)`.
- [x] 1.14 RED — `shouldDrawBar`: `< 5000ms` elapsed ⇒ `false`; first call after crossing
      the threshold ⇒ `true`; second call `< 100ms` later ⇒ `false` (spec: A Short Run
      Does Not Flash a Bar).
- [x] 1.15 GREEN — implement `shouldDrawBar(startedMs, nowMs, lastDrawMs)`.
- [x] 1.16 Verify: `npx vitest run test/domain/progress.test.ts` all green; grep confirms
      zero `fs`/SQLite/`@huggingface`/`process` imports in `src/domain/progress.ts`.

## Phase 2 — Commit 2: Infrastructure adapter (`src/infrastructure/progress-sink.ts`)

No behavior change to any command yet — nothing wires this in until Commit 3.

- [x] 2.1 RED — `test/infrastructure/progress-sink.test.ts`: `mode: "none"` writes
      nothing to a fake `{ write, columns }` stream across a full event sequence.
- [x] 2.2 GREEN — implement `createProgressSink(mode, stream, now?)` skeleton returning
      `{ onProgress, finish }`; `none` branch is a no-op.
- [x] 2.3 RED — `mode: "plain"` appends newline-terminated lines, no `\r`, using a fake
      `now`.
- [x] 2.4 GREEN — implement the `plain` branch: `formatPlainLine(event)` + `"\n"`,
      download events gated by `createDownloadThrottle(DOWNLOAD_STEP_PERCENT_PLAIN)`.
- [x] 2.5 RED — `mode: "bar"`: a run whose fake `now` never exceeds `BAR_MIN_ELAPSED_MS`
      writes nothing.
- [x] 2.6 GREEN — implement the 5-second gate using `BAR_MIN_ELAPSED_MS`.
- [x] 2.7 RED — `mode: "bar"`: the first frame after crossing 5 s shows the accumulated
      state (not zero), is `\r`-prefixed, contains no `\n`, and is padded to erase the
      previous frame's length; width derives from the injected `stream.columns` capped
      at `BAR_MAX_WIDTH`.
- [x] 2.8 GREEN — implement the `bar` branch: `advanceProgress` + `shouldDrawBar` +
      `renderBar(state, width)`; capture `stream.columns` once at construction as
      `Math.min(columns - 1, BAR_MAX_WIDTH)`.
- [x] 2.9 RED — `finish()` is idempotent (a second call does not throw or double-write)
      and a no-op in `plain`/`none`; in `bar` mode with an active frame it writes an
      erase (`\r` + spaces(lastLineLength) + `\r`), never a trailing newline.
- [x] 2.10 GREEN — implement `finish()`.
- [x] 2.11 Verify: `npx vitest run test/infrastructure/progress-sink.test.ts` all green;
      confirm the module writes only to its injected `stream`, never directly to
      `process.stdout`/`process.stderr` (spec: Progress Goes to stderr; stdout Is
      Unchanged).

## Phase 3 — Commit 3: Application / composition / CLI seams (behavior changes here)

### 3a. IndexDocuments emission (`src/application/index-documents.ts`)

- [ ] 3.1 RED — `test/application/index-progress.test.ts`: `vi.fn()` as `onProgress`
      with `FakeEmbeddings` against `ejemplos/`. Assert event order; `files/start.total
      === files.length` reported before the first tick; `embedding/start.batches ===
      Math.ceil(chunks / batchSize)`; a skipped file still ticks (spec: Four Reportable
      Phases With Synchronously-Known Denominators).
- [ ] 3.2 GREEN — add `onProgress?: ProgressReporter` to `IndexDocumentsOptions`; add
      private `report(e)` calling `this.options.onProgress?.(e)`; wire the 6 emission
      points per design's call-site table: `discovery/start` before `discover()`;
      `files/start` after `reset()`; `files/tick` at the top of the loop body (so the
      skipped-file `continue` still ticks); `embedding/start` after the `embeddings ===
      null` guard; `embedding/tick` before each `embed()` call; `embedding/failed` in
      the `catch`.
- [ ] 3.3 RED — same test file, with `embeddings: null`: assert **zero**
      `phase === "embedding"` events (spec: `--lexical` skips the embedding phase
      entirely).
- [ ] 3.4 GREEN — confirm this passes structurally from 3.2's placement (embedding/start
      sits after the null guard); triangulate only if it fails.
- [ ] 3.5 RED — same test file, with `BrokenEmbeddings`: assert exactly one
      `embedding/failed` event and `report.mode === "lexical"` (spec: Lexical fallback
      still occurs, now also reported).
- [ ] 3.6 GREEN — wire `report({ phase: "embedding", kind: "failed", reason })` in the
      existing `catch`, reusing the existing `describeError`-built message.
- [ ] 3.7 Verify: `test/helpers/fake-embeddings.ts` has zero diff — `FakeEmbeddings`/
      `BrokenEmbeddings` must not grow a progress concern (explicit proposal
      constraint).

### 3b. TransformersEmbeddings download seam (`src/infrastructure/embeddings/transformers-embeddings.ts`)

- [ ] 3.8 RED — `test/infrastructure/transformers-embeddings-progress.test.ts`:
      `vi.mock("@huggingface/transformers")` capturing `pipeline` args. Call
      `TransformersEmbeddings.create(model)` with **no** options argument; assert
      `progress_callback` is **absent** on the q8 `pipeline(...)` call (Trap 1 — gating
      on `onProgress !== undefined` is mandatory; an unconditional callback silently
      adds a `get_file_metadata` request per model file to `serve`/`search`/`eval`
      startup).
- [ ] 3.9 GREEN — add `TransformersEmbeddingsOptions { onDownloadProgress?: (p:
      DownloadProgress) => void }` param to `create()`; build `progress_callback`
      conditionally and include it in the options object only when defined — never
      spread.
- [ ] 3.10 RED — same file: with `onDownloadProgress` passed, assert `progress_callback`
      **is** a function on the q8 call.
- [ ] 3.11 GREEN — pass `progress_callback` on the q8 `pipeline(...)` call.
- [ ] 3.12 RED — same file: make the q8 mock call reject; assert `progress_callback` is
      **also** present on the fallback `pipeline(...)` call (Trap 2 — the fallback
      today passes no options object at all and is the easy one to miss).
- [ ] 3.13 GREEN — pass the same `progress_callback` into the fallback call.
- [ ] 3.14 RED — invoke the captured callback with a synthetic
      `{ status: "progress_total", loaded, total }`; assert the mapped `{ loaded, total
      }` reaches `onDownloadProgress`.
- [ ] 3.15 GREEN — implement the callback body, mapping only `status ===
      "progress_total"`.
- [ ] 3.16 RED — invoke the callback with `status` of `"progress"`, `"initiate"`,
      `"done"`, `"ready"`; assert `onDownloadProgress` is not called for any of them.
- [ ] 3.17 GREEN — confirm the existing guard already satisfies this; no new code
      expected (triangulate only if it fails).

### 3c. Composition wiring (`src/composition.ts`) — exactOptionalPropertyTypes trap

- [ ] 3.18 Add `onProgress?: ProgressReporter` to `ContainerOptions`; conditionally
      build the `IndexDocumentsOptions` passed to `new IndexDocuments(...)` (`if
      (onProgress !== undefined) o.onProgress = onProgress`, mirroring the existing
      `docsDir` pattern in `cli.ts`'s `withContainer`) — hop 1.
- [ ] 3.19 Conditionally build the `TransformersEmbeddingsOptions` inside the
      `LazyEmbeddings` factory closure (`onProgress === undefined ? {} : {
      onDownloadProgress: ({ loaded, total }) => onProgress({ phase: "embedding", kind:
      "download", loaded, total }) }`) — never spread `ProgressReporter | undefined`
      (Trap 3, hop 2).
- [ ] 3.20 Verify: `npm run typecheck` is clean — both hops satisfy
      `exactOptionalPropertyTypes: true` (`tsconfig.json:11`) with zero spread errors.
      `SyncIndex` (unrelated line) stays unchanged.

### 3d. CLI wiring (`src/cli.ts`, `test/cli-subprocess.test.ts`)

- [ ] 3.21 RED — `test/cli-subprocess.test.ts`: extend `runCli` to accept an `env`
      parameter that **spreads `process.env`** (`{ ...process.env, ...env }`) (Trap 4 —
      a bare `{ COMPENDIO_PROGRESS }` drops `PATH` and breaks on Windows). Write a
      mode-selection assertion that depends on the new signature.
- [ ] 3.22 GREEN — implement the `runCli` signature change; existing call sites keep
      working via the default merge.
- [ ] 3.23 RED — `COMPENDIO_PROGRESS=none`: stderr has no progress output (spec: none
      mode emits nothing).
- [ ] 3.24 GREEN — wire `src/cli.ts`: `resolveProgressMode(process.env
      ["COMPENDIO_PROGRESS"], process.stderr.isTTY === true)`; `createProgressSink(mode,
      process.stderr)`; thread `onProgress` through `withContainer`'s options into
      `createContainer`; `try { report = await container.indexDocuments.execute() }
      finally { progress.finish() }`.
- [ ] 3.25 RED — `COMPENDIO_PROGRESS=plain`: stderr contains an `Indexing 5 documents`
      line and `[1/5]`-shaped per-file lines; no `\r` anywhere in stderr.
- [ ] 3.26 GREEN — confirm the `plain` sink branch produces this shape against the real
      pipeline; if wording drifts from Phase 1's `formatPlainLine`, fix it there.
- [ ] 3.27 RED — `COMPENDIO_PROGRESS=bar`: stderr contains `\r` (the child has no TTY —
      the env var is what makes `bar` reachable by `spawnSync`).
- [ ] 3.28 GREEN — confirm `bar` is reachable end-to-end through the wiring from 3.24.
- [ ] 3.29 RED — all three modes (`none`/`plain`/`bar`): stdout still matches
      `/Indexed 5 documents \(\d+ chunks\)/` and is **byte-for-byte identical** across
      modes; `--lexical` stays set throughout so no real download triggers (spec:
      stdout is identical across modes — the explicit stdout-parity verification task).
- [ ] 3.30 GREEN — fix any accidental stdout write the failing test surfaces (design
      guarantee: the sink only ever writes to its injected stream).
- [ ] 3.31 Verify: `search`, `eval`, `overview`, and `serve` command actions in
      `src/cli.ts` remain unmodified — no `onProgress` wiring added to their
      `withContainer` calls, so Trap 1's gate stays structurally unreachable for every
      command except `index`.

## Phase 4 — Final verification

- [ ] 4.1 Run `npm test` (full suite) green — no regression in `domain`,
      `infrastructure`, `application`, or `cli-subprocess` suites.
- [ ] 4.2 Run `npm run typecheck` clean.
- [ ] 4.3 Confirm `package.json` gained no new dependency.
- [ ] 4.4 Manual smoke test (not automatable — 129 MB per run, not run in CI): clear the
      transformers.js model cache, run `node dist/cli.js --root ejemplos index` in an
      interactive terminal and confirm the bar appears and tracks the download; re-run
      with `COMPENDIO_PROGRESS=none` and confirm stdout is unchanged and stderr is
      silent. Document this alongside the existing manual smoke tests in `CLAUDE.md`.
