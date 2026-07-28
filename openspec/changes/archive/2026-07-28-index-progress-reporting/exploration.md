# Exploration: Index Progress Reporting

`compendio index` runs silently for the full duration of a reindex — on a fresh machine, roughly
5 minutes for 36 documents with zero output. This document establishes whether progress reporting
is feasible (yes, with no architectural blocker), where the time most likely goes, what shape the
signal should take, which seam should carry it, and what a first change should and should not
include.

**Headline finding (Q1, see full derivation in §1):** wall time could not be directly measured this
session (the exploring agent had no shell tool). By elimination from known constants — 129 MB model
download, and `ejemplos/`'s 11-document corpus scaled ×3.3 to approximate 36 documents, yielding
roughly 8-12 embedding batches at batch size 16 — the 5-minute run is **very likely dominated by CPU
embedding compute**, not the download, *unless* the second machine's connection is unusually slow
(rough threshold: below ~10 Mbps, where download alone could take 1.5-3.5 minutes). This cannot be
disambiguated without an actual timed run. That run should be the first task of whichever phase
implements this change.

## 1. Where Does the Wall Time Actually Go?

### 1a. What is known without a live measurement

| Fact | Value | Source |
|---|---|---|
| Quantized model download size | ~129 MB (`onnx/model_quantized.onnx` 112.8 MB + `tokenizer.json` 16.3 MB) | Measured on the warm cache in this repo; corroborated by the public model card: `Xenova/multilingual-e5-small`, 117.65M params, 12 layers, 384-dim, int8 ONNX ≈ 118 MB |
| `ejemplos/` indexable documents | 11 (`ejemplos/docs/*.md` minus `INDEX.md`, which `config.ts`'s `exclude: [INDEX_FILE]` always drops) | Glob over `ejemplos/docs/**/*.md` |
| `ejemplos/` heading count (H1+H2+H3) | 64 across the 11 indexable docs | `rg -c '^#{1,3} '` |
| `ejemplos/` non-empty line count | 401 across the 11 indexable docs (~36.5 lines/doc average) | `rg -c '.'` |
| Embedding batch size | 16 (`DEFAULT_BATCH_SIZE`, `src/application/index-documents.ts:41`) | Read |
| Chunking rule | one chunk per H2 (H3 only if an H2 section exceeds `maxTokens`=800), then tiny adjacent pieces (<`minTokens`=100) are merged into the previous one | `src/domain/chunking.ts:20-78` |
| `glosario.md` exception | forced to exactly 1 chunk regardless of headings (`NO_CHUNKING`, `src/infrastructure/config.ts:43`) | Read + `test/application/index-and-search.test.ts:44-47` asserts this |

### 1b. Download-time arithmetic (bandwidth is the only real unknown here)

129 MB / bandwidth, best-case (no TLS/CDN overhead):

| Connection | Download time |
|---|---|
| 5 Mbps (slow / metered) | ~206 s (~3.4 min) |
| 10 Mbps | ~103 s (~1.7 min) |
| 25 Mbps (typical home) | ~41 s |
| 50 Mbps | ~21 s |
| 100 Mbps+ (fiber/office) | ~10 s |

On anything but a slow connection, download alone cannot explain 5 minutes. On a genuinely slow
connection, it plausibly explains most of it. **This is the one number a real run would pin down
immediately** (time-to-first-`embed()`-call minus time-to-`pipeline()`-return brackets it exactly).

### 1c. Chunk/batch estimate, scaled to 36 documents

The 64 raw headings over-count true chunks (each H1 doesn't become its own chunk; tiny pieces
merge; `glosario.md`'s 4 headings collapse to 1). Correcting for both: roughly **35-55 chunks**
across `ejemplos/`'s 11 documents — a heuristic range, not a verified count (the true count needs a
real `index` run or a DB query, neither available to the exploring agent).

Scaling by document-count ratio (36/11 ≈ 3.27×, assuming similar per-document size/structure —
**not guaranteed**: `ejemplos/`'s docs average ~36 non-empty lines each, which is compact for real
project documentation, so this ratio likely *undercounts* a real 36-doc corpus):

- Estimated chunks: ~115-180
- Estimated embedding batches at size 16: **ceil(115/16)=8 to ceil(180/16)=12** — call it "high
  single digits to low teens"

This is the number that matters for design purposes: batches are a **small, human-scannable
count**, not hundreds. A "batch 4/11" counter is cheap to compute and meaningful to read.

### 1d. Reconciling with the user's report (process of elimination)

Discovery (`readdir` + read 36 small text files), parsing (remark/gray-matter), chunking (pure
string ops), and SQLite persistence (`better-sqlite3`, synchronous, embedded, no network) are all
CPU/IO-light, local-only operations. Nothing in the test suite or code suggests any of these scale
to minutes for 36 files — the entire `test/application/index-and-search.test.ts` integration suite
runs the same pipeline against the real `ejemplos/` corpus with `FakeEmbeddings` (a synchronous,
zero-cost stub) as part of the normal `npm test` run, which is not reported as slow anywhere in the
repo. That leaves embedding compute (CPU-bound quantized transformer inference, batches of ≤16,
running after every other phase per §2) as the only phase structurally capable of costing minutes.

**Conclusion:** the 5-minute report is very likely dominated by CPU embedding compute on a normal
connection, and by model download on a slow one. Both are plausible; only a timed run
disambiguates. Practically, this means **the design should not bet everything on one phase** —
both need visibility (see §3).

### 1e. What a real measurement would need to do

Concretely specified so it is a one-step follow-up: time `TransformersEmbeddings.create()` in
isolation (isolates download + session init) and time each `embedPending` batch call (isolates
steady-state CPU throughput), both against the already-warm cache in this repo (no download cost)
to get a real per-chunk embedding time, then re-derive §1c's estimate with a real number instead of
a heuristic range. This should be the first task of `sdd-design` or `sdd-apply` for this change —
cheap to obtain, and it is the number every other recommendation here is downstream of.

## 2. Current State — Confirmed Against Code

| File | What happens | Confirms |
|---|---|---|
| `src/infrastructure/embeddings/transformers-embeddings.ts:17-27` | `TransformersEmbeddings.create()` calls `pipeline("feature-extraction", model, { dtype: "q8" })` (line 22) with no `progress_callback` | Evidence #1 |
| `src/infrastructure/embeddings/transformers-embeddings.ts:51-69` | `LazyEmbeddings.embed()` calls `this.factory()` (line 61) only on the *first* `embed()` call, memoizing both success and failure | Evidence #3 |
| `src/application/index-documents.ts:61-105` | Order is: `discover()` (63) → `store.reset()` (72) → per-file parse/chunk/persist loop (74-92) → `embedPending(pending)` (94) | Evidence #3/#4, refined below |
| `src/application/index-documents.ts:108-126` | `embedPending` batches `pending` by `embeddingBatchSize ?? 16` (112), loop 114-121 | Evidence #4 |
| `src/cli.ts:34-54` | `index` action awaits the whole `execute()` before any `console.warn`/`console.log` | Evidence #5 |

**One correction to the launch evidence, worth being precise about because it changes the scope
analysis in §9:** `SyncIndex` is **not** reached from `compendio index` at all. `composition.ts:65-83`
wires `indexDocuments` (→ `IndexDocuments`, the full-reindex path used by `cli.ts`'s `index` command)
and `syncIndex`/`syncScheduler` (→ `SyncIndex` via `SyncScheduler`, used *only* by `cli.ts`'s `serve`
command, which boots `server.ts`) as **two independent object graphs**. The user's literal repro —
`compendio index` — never touches `SyncIndex`. `SyncIndex` has an analogous but architecturally
distinct problem (embeds per-document inside `processNewAndChanged`, `sync-index.ts:131`, and per
chunk-group inside `reconcileVectors`, `sync-index.ts:176`), reached only through `serve`'s startup
pass (`SyncScheduler.startup()`, `sync-scheduler.ts:46-48`, called from `cli.ts:146`) and its
throttled pre-tool-call check (`SyncScheduler.maybeSync()`, called from all three `server.ts` tool
handlers at lines 90, 149, 182). This matters because `server.ts`'s stdout is the JSON-RPC channel
(never writable for progress) and its startup is deliberately non-blocking (`cli.ts:142-145`'s
comment: "NOT awaited"). See §9 for why this keeps `SyncIndex`/`serve` out of scope for a first
change.

**A third, previously-uncounted countable phase:** the per-file parse/chunk/persist loop
(`index-documents.ts:74-92`) is exactly as countable as the embedding batch loop — `files.length`
is known immediately after `discover()` returns (line 63), before the loop even starts. This is a
free, zero-new-plumbing progress signal (same mechanism the design already needs for batches),
worth including even though §1d's reasoning says it is a small fraction of total time.

## 3. What Should Be Reported, In What Phases?

Four phases, in execution order, each with a denominator known synchronously the moment the phase
starts:

| # | Phase | Denominator known at | Expected share of time (§1) |
|---|---|---|---|
| 1 | Discovery (`source.discover()`) | N/A (single call) | Small |
| 2 | Reset (`store.reset()`) | N/A (single DDL transaction) | Negligible |
| 3 | Parse + chunk + persist (per file) | Immediately after discovery (`files.length`) | Small-moderate |
| 4 | Embedding (per batch, possibly incl. one-time model download) | Immediately after phase 3 (`ceil(pending.length / batchSize)`) | Likely dominant (§1d) |

Phase 4 is really **two nested signals** — see §4's "two signals" finding, which is the key
architectural insight of this exploration.

## 4. Which Seam Carries the Signal?

### 4a. The two-signals finding

The model-download signal and the batch signal are **not the same signal** and do not belong on
the same seam:

- **Batch/file progress** is knowledge the *use case* already owns — `IndexDocuments.embedPending`
  knows `i`, `pending.length`, and `batchSize` (`index-documents.ts:114`) at the moment it needs to
  report them. An individual `EmbeddingsProvider.embed(texts)` call has no idea it is batch 3 of 11;
  only the caller does. This signal belongs at the **application layer**.
- **Model-download progress** is knowledge only the *infrastructure* class has — the
  `progress_callback` fires *inside* `pipeline(...)`, during `TransformersEmbeddings.create()`
  (before an `EmbeddingsProvider` instance with an `embed()` method even exists). This signal
  belongs at the **infrastructure/composition layer**, threaded through `create()` and
  `LazyEmbeddings`'s factory closure — never through `EmbeddingsProvider.embed()`.

Concretely, `EmbeddingsProvider.embed(texts: string[]): Promise<Float32Array[]>` (`ports.ts:56-58`)
should **not change**. Routing download progress through it would be a category error (download
happens once per process lifetime; `embed()` is called once per batch) and would force
`FakeEmbeddings`/`BrokenEmbeddings` (`test/helpers/fake-embeddings.ts`) to grow a no-op progress
concern they have no reason to know about.

The confirmed shape of the transformers.js signal (from
`node_modules/@huggingface/transformers/types/utils/core.d.ts:1-61` and
`.../utils/hub.d.ts:157-161`):

```ts
type ProgressCallback = (info: ProgressInfo) => void;
type ProgressInfo =
  | { status: "initiate"; name: string; file: string }
  | { status: "download"; name: string; file: string }
  | { status: "progress"; name: string; file: string; progress: number /* 0-100 */; loaded: number; total: number }
  | { status: "done"; name: string; file: string }
  | { status: "ready"; task: string; model: string }
  | { status: "progress_total"; name: string; progress: number; loaded: number; total: number; files: Record<string, { loaded: number; total: number }> };
```

`pipeline(task, model, options)` accepts `progress_callback` as part of `PretrainedModelOptions`
(`pipelines.d.ts:42`, extending `hub.d.ts`'s `PretrainedOptions`), so `TransformersEmbeddings.create`
would simply forward an optional param it already receives into the existing `pipeline(...)` call
at line 22 — no new dependency, the capability already exists in the installed package.

### 4b. Port vs. optional callback — for the batch/file signal

| | New port in `ports.ts` (e.g. `ProgressReporter`) | Optional callback in options (e.g. `IndexDocumentsOptions.onProgress?`) |
|---|---|---|
| **Consistency with existing seams** | Matches the established pattern — every cross-boundary point in this codebase is a `ports.ts` interface | New pattern for this codebase — no existing precedent for a plain callback field |
| **Fit with `ports.ts`'s actual purpose** | `ports.ts`'s 5 entries are uniformly "swap this infrastructure for a different backend" (fs↔other, SQLite↔other, transformers.js↔other). Progress reporting has one production shape (write a line) and one no-op — not really an adapter-swap concern | Matches `IndexDocumentsOptions`'s existing role as the home for optional per-run knobs (`embeddingBatchSize?` already lives there) |
| **Blast radius** | Widens the file CLAUDE.md describes as the deliberately curated adapter list | Localized to one options interface per use case |
| **Testability** | Needs a `NoopProgressReporter` test double (low cost — `fake-embeddings.ts` shows the pattern is familiar) | Trivially `vi.fn()`-spyable, same pattern `sync-scheduler.test.ts` already uses for `console.error` (precedent already in the codebase) |
| **Extensibility** | Scales better if progress later grows more methods (e.g. structured telemetry) without a breaking signature change | A single function's shape change breaks every call site if requirements grow |

**Recommendation (slight lean, not a foreclosed decision — this is `sdd-propose`/`sdd-design`'s
call):** optional callback on `IndexDocumentsOptions`, not a new port. The deciding factor is that
this is not a swappable backend in the sense the other five ports are — it is an observability hook
with essentially one real implementation.

**Implementation note verified by reading `index-pipeline.ts`:** `SyncIndex`'s constructor takes
`options: PipelineOptions` directly (`sync-index.ts:64`), the same low-level type `transformFile`'s
pure function uses (`index-pipeline.ts:7-12`) — unlike `IndexDocuments`, which has its own richer
`IndexDocumentsOptions`. Adding a callback to `SyncIndex` cleanly means giving it its own options
type analogous to `IndexDocumentsOptions`, not widening the shared `PipelineOptions` that
`transformFile` (a pure helper with no reason to know about progress) also uses.

### 4c. How the two signals are wired together in practice

`composition.ts`'s `createContainer(options)` would accept one new optional input (e.g.
`options.onProgress`) and fan it out internally to both destinations:

```
createContainer({ ..., onProgress? })
  → LazyEmbeddings(() => TransformersEmbeddings.create(model, { onDownloadProgress: onProgress }))
  → new IndexDocuments(..., { ..., onProgress })
  → new SyncIndex(..., { ..., onProgress })   // if/when SyncIndex is in scope
```

`cli.ts`'s `index` action constructs one renderer and passes it in; `server.ts`/`serve` passes
nothing (or an explicit no-op), preserving the "server stays silent on stdout, and does not need to
change at all for this scope" property from §9.

## 5. Does Eager Model Loading Belong In This Change?

The framing in the launch brief ("moving the download to the start, where a message about it is
most useful") is the right *goal*, but on closer reading it does not require the architecture change
it implies.

**The current lazy trigger point already gives the loop everything needed to print early**, without
moving *when* the model actually loads. `embedPending(pending)` is called exactly once, at
`index-documents.ts:94`, right after the file loop. A phase-transition report ("Generating
embeddings (may download ~129 MB on first run)...") can be emitted **immediately before that
existing call**, unconditionally — this requires no change to *where* `LazyEmbeddings` triggers
`TransformersEmbeddings.create()`, only to what gets printed around the call site that already
exists.

Genuinely moving construction earlier (before the file loop) has a real, non-hypothetical cost that
the original framing did not weigh: **today, a load failure is only discovered after the entire
corpus has already been parsed, chunked, and persisted lexically** — so if the network is down, the
user still gets a complete lexical index (real, immediate value) before finding out embeddings
failed. Moving the trigger earlier means a network failure is discovered *before* any of that
local, network-independent work happens; if the user then aborts believing the tool is broken, they
get nothing instead of a working lexical index. This is a real degradation of the
graceful-degradation property CLAUDE.md documents, not merely a timing cosmetic.

| | Keep lazy trigger, report around the existing call site (recommended) | Move `create()` before the file loop (eager) |
|---|---|---|
| Solves "message appears at the start of the slow part" | Yes — same effect, because the message is printed unconditionally before `embedPending`, regardless of whether a real download occurs | Yes |
| Preserves "lexical work is not wasted on network failure" | Yes — unchanged | No — network failure now precedes all local work |
| Affects `server.ts` startup ("deliberately stays instant") | No — this section is scoped to `IndexDocuments`, which `server.ts` never calls | Only if the *same* change were also applied to `SyncIndex`, which would directly conflict with `cli.ts:142-145`'s explicit non-blocking-startup comment — a much clearer reason to keep `SyncIndex` out of this shape entirely |
| Implementation cost | Low — one report call bracketing an existing call site | Medium — restructures `IndexDocuments.execute()`'s phase order and its failure handling |

**Recommendation:** do not move the trigger point. Emit the phase-transition message around the
existing lazy call site. This captures the stated goal without the resilience trade-off, and keeps
`SyncIndex`/`server.ts` untouched (§9). `progress_callback`'s events (§4a) can additionally let the
renderer *decide dynamically* whether to even show the download sub-line — a warm cache typically
resolves near-instantly with no meaningful `progress` events, so the message can stay generic
("Generating embeddings...") unless real download progress starts arriving.

## 6. Rendering: Library vs. Hand-Rolled, TTY vs. Non-TTY

### 6a. Dependency footprint

Current runtime dependencies (`package.json`): `@huggingface/transformers`, `@modelcontextprotocol/sdk`,
`better-sqlite3`, `commander`, `gray-matter`, `remark-parse`, `sqlite-vec`, `unified`, `yaml`, `zod`
— 10 total, all load-bearing (DB, embeddings, protocol, parsing). None is UI/console-flavored. A
progress bar library (`cli-progress`, `ora`, etc.) would be the **first UI dependency** in a project
whose own pitch (README/CLAUDE.md) is "everything runs locally... zero network calls at query time"
with a deliberately lean footprint, and whose existing house style already favors hand-rolled logic
over pulling in libraries for genuinely small amounts of work (own chunking, own RRF fusion, own
excerpt-budget logic — CLAUDE.md documents all three as intentional).

### 6b. A concrete, verified testability finding

`test/cli-subprocess.test.ts`'s `runCli()` helper calls `spawnSync(process.execPath, [...], {
encoding: "utf8" })` with no `stdio` option — Node defaults to `stdio: "pipe"` for every stream,
meaning the child process's `stdout`/`stderr` are OS pipes, not TTYs, by construction of how
`spawnSync` works (not a compendio-specific behavior). **`process.stderr.isTTY` inside every
existing subprocess test is always `false`.** This means any `\r`-based redraw/animated-bar code
path is structurally unreachable by the current test harness — it could only ever be verified
manually. This is a direct, concrete answer to the "how is this testable without a TTY" question:
plain append-only output is captured faithfully by `spawnSync`; redraw output is not exercisable by
it at all.

### 6c. Recommendation

Hand-rolled, stderr-only, **append-only** writer (no `\r` redraw) for a first change:

- No new dependency.
- Fully exercised by the existing `spawnSync`-based subprocess harness (§6b) — every line is
  captured whether the real destination is a TTY or not, so there is **no TTY/non-TTY branch to
  write or test at all** for this scope. Append-only text is valid output in a terminal, a
  redirected file, a pipe, and CI, unconditionally.
- Matches an existing precedent in the exact command being touched: `cli.ts`'s `index` action
  already sends diagnostics to stderr (`console.warn`, lines 39-44) and only the final summary to
  stdout (`console.log`, lines 45-48) — progress ticks are diagnostics, so stderr is not a new
  convention, it is the existing one extended. It also matches `server.ts`'s hard rule ("stdout
  belongs to the MCP protocol: all logging goes to stderr", `cli.ts:147`), so the same writer could
  later be reused there without violating that rule (out of scope for this change, see §9, but
  architecturally compatible).
- A TTY-aware redrawn bar remains available as a **strictly additive** follow-up later — same
  underlying event stream, a different renderer — once the append-only version is shipped and
  validated. Nothing here forecloses it.

## 7. Test Strategy (`strict_tdd: true`)

| Target | How | Hook |
|---|---|---|
| Event formatting (`event → string`) | Pure unit tests, no TTY/model dependency — should carry most of the interesting logic | New, e.g. `test/domain/progress.test.ts` or wherever the formatting function lives |
| `IndexDocuments` invoking the callback at the right points with the right event shapes | `vi.fn()` spy passed as the callback, assert call sequence/args | `test/application/index-and-search.test.ts` with `FakeEmbeddings` — correct hook for **batch/file** progress, since that signal is application-layer (§4a) and independent of which `EmbeddingsProvider` is used |
| `TransformersEmbeddings.create` forwarding a supplied progress option into `pipeline(...)` | `vi.mock("@huggingface/transformers", ...)` to intercept the dynamic `await import(...)` at `transformers-embeddings.ts:18`; assert the mock `pipeline` was called with a `progress_callback` function, and/or manually invoke the captured callback and assert correct relay | New unit test near `transformers-embeddings.ts` — the right, achievable way to test download-progress *wiring* without any real network call or the 129 MB artifact |
| stdout stays byte-clean/JSON-parseable while stderr carries progress | Subprocess assertions on `run.stdout`/`run.stderr` | `test/cli-subprocess.test.ts`, staying `--lexical` (as it already does, deliberately, to keep these tests hermetic and offline) — real model-download text should **not** be asserted in the automated suite |
| Real model download behavior end-to-end | Not automatable without a CI model-cache step (GitHub Actions runners are ephemeral; every cold CI run would otherwise pay the 129 MB tax on every test run) | Manual smoke test, same category as the existing "Manual smoke test against the example corpus" section in `CLAUDE.md` / `openspec/testing-capabilities.md` |

`test/helpers/fake-embeddings.ts`'s `FakeEmbeddings`/`BrokenEmbeddings` are confirmed **not** the
right hook for download-progress testing specifically (they never go through
`TransformersEmbeddings.create` at all) but **are** the right hook for batch/file progress testing,
per the two-signals finding in §4a.

## 8. Overall Approaches for the Change

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **1. Minimal — phase labels only** | One stderr line per phase transition (discovery/parsing/embedding/done), no counters | Smallest diff, trivially testable, zero rendering complexity | Does not answer "how much longer" during a multi-minute embedding phase | Low |
| **2. Determinate counters, append-only lines (recommended)** | Phase labels + periodic single-line updates ("batch 4/11..."), throttled download-percent updates, every update a new line, no redraw | Answers "how much longer"; §6b: fully covered by the existing subprocess test harness with zero TTY branching; no new dependency; low implementation risk (batch/file denominators already known, §2/§3) | Marginally more logic than Approach 1 (throttling download percent updates so they do not spam) | Low-Medium |
| **3. TTY-aware live redraw (bar)** | `\r`-based in-place redraw when `process.stderr.isTTY`, falls back to Approach 2 otherwise | Best UX in the primary real-world case (interactive terminal) | Highest effort; §6b: the redraw path is structurally unreachable by the current automated test harness — manual verification only | Medium-High |

**Recommendation:** Approach 2 for a first change. It fully resolves the reported problem, stays
within `strict_tdd`'s reach via the existing subprocess harness, adds no dependency, and does not
foreclose Approach 3 as a later, purely additive enhancement on the same event stream.

## 9. Scope Boundary

**In scope for a first change:**

- `compendio index` CLI command (`IndexDocuments`) — the literal reported bug.
- Phases 1-4 from §3 (discovery, parse/chunk/persist per file, embedding batches, one-time model
  download visibility nested inside phase 4).
- The optional-callback seam from §4b/§4c, threaded through `composition.ts`.
- Hand-rolled, stderr-only, append-only renderer (§6c).
- The `pipeline(...)` `progress_callback` forwarding in `TransformersEmbeddings.create` (§4a).

**Explicitly out of scope, with reasons:**

- `server.ts` / `SyncIndex` / `SyncScheduler` (`compendio serve`) — different transport constraint
  (stdout is JSON-RPC), different call cadence (per-document/per-group, not one batched loop,
  `sync-index.ts:131,176`), and startup is deliberately non-blocking (`cli.ts:142-145`). Confirmed
  in §2 to be an entirely separate object graph from `compendio index`, not merely a code-sharing
  concern. Revisit only against a real complaint about `serve` silence, independently.
- ETA/time-remaining prediction — needs the real throughput number this exploration explicitly
  could not obtain (§1e); premature.
- `index-md` (`GenerateIndexMd`) — filesystem-only, no embeddings, no evidence of a slowness
  complaint (CLAUDE.md: reads the filesystem directly, by design, to stay fast).
- `eval` (`EvaluateSearch`) — embeds only the goldenset questions at query time (a handful of
  calls), not the corpus; no evidence of a silence complaint.
- Animated/colorized polish (Approach 3) — additive later, not required to solve the reported
  problem.
- Any change to `EmbeddingsProvider.embed()`'s signature — §4a establishes it is unnecessary.

## 10. Risks, Ranked

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | High | §1's time split is an estimate, not a measurement — the whole design leans on "embedding compute likely dominates" | Run the real timing check (§1e) as the first task of the next phase, before committing to specific UI text/thresholds |
| 2 | Medium | Throttling the download `progress` events (they can fire frequently) needs a concrete cadence decision (e.g. every 10%) to avoid stderr spam | Decide the cadence explicitly in `sdd-design`; keep it a pure, unit-testable function of `(loaded, total, lastReportedPercent)` |
| 3 | Medium | `SyncIndex` needs its own richer options type (not the shared `PipelineOptions`) if/when it later gains a callback — easy to get wrong by widening the shared low-level type instead | Flagged precisely in §4b; `sdd-design` should give `SyncIndex` an options type parallel to `IndexDocumentsOptions` |
| 4 | Low | A new UI-flavored dependency would be a first for this project's deliberately lean footprint | §6c recommends against it; revisit only if Approach 3's polish is explicitly desired later |
| 5 | Low | CI cost if a future test tries to assert real download-progress text | §7 recommends against it explicitly; keep download-wiring tests at the `pipeline()`-mock unit level |

## Decisions to Surface for `sdd-propose`

1. **Port vs. callback for batch/file progress** (§4b) — recommended: optional callback on
   `IndexDocumentsOptions` (and a new, parallel options type for `SyncIndex` if it is ever
   extended), not a new `ports.ts` entry. Real tradeoff either way; not foreclosed here.
2. **Keep the lazy embeddings-load trigger point unchanged** (§5) — report around the existing call
   site rather than restructuring `IndexDocuments.execute()`'s phase order. Recommended, with the
   resilience trade-off spelled out for the record.
3. **Approach 2 (determinate counters, append-only stderr lines, no TTY redraw) as the shape for a
   first change** (§8) — recommended over both a bare phase-label version and a full animated bar.
4. **Run the real timing measurement first** (§1e) — this exploration's biggest open item; every
   other recommendation here is directionally sound regardless of the exact number, but UI text
   ("this may take a few minutes") and any future threshold/cadence decisions should wait for it.
5. **`SyncIndex` / `server.ts` progress is out of scope for this change** (§9) — confirmed via a
   correction to the original evidence (§2): it is not reached by `compendio index` at all.

## Ready for Proposal

Yes. Progress reporting is architecturally feasible with no blocker: the seams exist, the phases
are countable, the test harness already covers the recommended (non-redraw) rendering shape, and no
core interface (`EmbeddingsProvider.embed()`) needs to change. The one real gap is the missing live
timing measurement (§1e) — recommended as the opening task of whichever phase implements this, not
as a blocker to proposing the change itself.
