# Apply Progress: Incremental Reindex

**Mode**: Strict TDD
**Delivery**: single-pr, size:exception accepted (2026-07-24) — three phases land as commits inside ONE pull request, not separate PRs.

## Batch 1 (this run): Phase 1 — Store Primitives (tasks 1.1-1.12)

### Completed Tasks

- [x] 1.1 `src/domain/ports.ts`: added `ChunkMissingVector` type + 4 `IndexStore` method signatures (`deleteDocument`, `upsertDocument`, `listChunksMissingVectors`, `replaceEmbeddings`)
- [x] 1.2 `sqlite-index-store.ts`: `deleteDocument(ruta)` — FTS5 `'delete'` command form per chunk, `chunks_vec` delete double-guarded (`vectorsEnabled && tableExists`), then `chunks`, then `documents`, one transaction; no-op when `ruta` is unknown
- [x] 1.3 `sqlite-index-store.ts`: `upsertDocument(meta, chunks, embeddings)` — guarded delete-if-exists (via shared `deleteDocumentRows`) then insert; `chunks_vec` write guarded by `vectorsEnabled` alone + `ensureVectorTable(dimension)`, so a brand-new project's first `upsertDocument` call still persists its embedding
- [x] 1.4 `sqlite-index-store.ts`: `listChunksMissingVectors()` — one batched query (`chunks` JOIN `documents`, `id NOT IN (SELECT chunk_id FROM chunks_vec)`), `[]` when vectors disabled or `chunks_vec` was never created
- [x] 1.5 `sqlite-index-store.ts`: `replaceEmbeddings(items)` — delete-then-insert per `chunk_id`, one transaction, idempotent (no PRIMARY KEY violation on an already-vectorized chunk)
- [x] 1.6 `file-document-source.ts`: `walk()`'s non-root `readdir` catch now pushes `{ ruta: prefix, error }` into `erroresLectura` instead of silently returning; the root-directory case still throws, unchanged
- [x] 1.7 Test: delete leaves no `chunks`/`chunks_fts`/`chunks_vec` orphans, no stale lexical hits (plus a no-op-on-unknown-ruta case)
- [x] 1.8 Test: re-indexing a changed document replaces content with no duplicates (plus: a brand-new document's embedding is written even before `chunks_vec` has ever been created)
- [x] 1.9 Test: `listChunksMissingVectors` returns only the uncovered chunk of a partially vectorized document, and `[]` when `chunks_vec` was never created
- [x] 1.10 Test: `replaceEmbeddings` on an already-vectorized chunk — no PRIMARY KEY violation, no duplicate row
- [x] 1.11 Test: mocked `readdir` (same `vi.hoisted` + `vi.mock("node:fs/promises", ...)` seam already used for `readFile`) throws for one subdirectory — asserts the `erroresLectura` entry, files beneath it absent from `files`, and that a root-directory failure still throws
- [x] 1.12 `npm test` (176/176 passed) + `npm run typecheck` (clean) — PR gate for this work unit

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/domain/ports.ts` | Modified | Added `ChunkMissingVector` interface; added `deleteDocument`, `upsertDocument`, `listChunksMissingVectors`, `replaceEmbeddings` to `IndexStore`. `saveEmbeddings` untouched. |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | Modified | Implemented the four new methods. Extracted a private `insertDocumentAndChunks` helper (shared by `saveDocument` and `upsertDocument`) and a private `deleteDocumentRows` helper (shared by `deleteDocument` and `upsertDocument`) during REFACTOR, removing duplicated insert SQL. No DDL/schema change; `migrate()`/`reset()` untouched. |
| `src/infrastructure/fs/file-document-source.ts` | Modified | `walk()`'s non-root `readdir` catch reports into `erroresLectura` instead of silently returning; root case unchanged. |
| `test/infrastructure/sqlite-index-store.test.ts` | Modified | Added 4 new `describe` blocks (`deleteDocument`, `upsertDocument`, `listChunksMissingVectors`, `replaceEmbeddings`), 7 new tests total. |
| `test/infrastructure/file-document-source.test.ts` | Modified | Added a `readdir` mock (same `vi.hoisted` seam as the existing `readFile` mock) and 2 new tests: unreadable subdirectory reported/excluded, unreadable root still throws. |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.2, 1.7 | `test/infrastructure/sqlite-index-store.test.ts` | Integration (`:memory:` SQLite) | ✅ 13/13 | ✅ Written (`store.deleteDocument is not a function`) | ✅ Passed | ✅ 2 cases (orphan-free delete + no-op on unknown ruta) | ✅ Extracted shared `deleteDocumentRows` |
| 1.1, 1.3, 1.8 | `test/infrastructure/sqlite-index-store.test.ts` | Integration | ✅ 13/13 | ✅ Written (`store.upsertDocument is not a function`) | ✅ Passed (after fixing an `insertVec`-prepared-against-missing-table bug found in GREEN execution) | ✅ 2 cases (re-index no duplicates + first-ever embedding write before `chunks_vec` exists) | ✅ Extracted shared `insertDocumentAndChunks` |
| 1.1, 1.4, 1.9 | `test/infrastructure/sqlite-index-store.test.ts` | Integration | ✅ 13/13 | ✅ Written (`store.listChunksMissingVectors is not a function`) | ✅ Passed | ✅ 2 cases (`[]` when table absent + partial coverage) | ➖ None needed |
| 1.1, 1.5, 1.10 | `test/infrastructure/sqlite-index-store.test.ts` | Integration | ✅ 13/13 | ✅ Written (`store.replaceEmbeddings is not a function`) | ✅ Passed | ➖ Single scenario per task list (no PK violation on re-cover) | ➖ None needed |
| 1.6, 1.11 | `test/infrastructure/file-document-source.test.ts` | Integration (mocked `node:fs/promises`) | ✅ 2/2 | ✅ Written (assertion failed: `erroresLectura` empty instead of reporting the subdirectory) | ✅ Passed | ✅ 2 cases (subdirectory reported/excluded + root still throws) | ➖ None needed |

### Test Summary

- **Total tests written**: 9 (7 in `sqlite-index-store.test.ts`, 2 in `file-document-source.test.ts`)
- **Total tests passing**: 176/176 (full suite), including all 9 new tests
- **Layers used**: Integration (9) — both files exercise a real `:memory:` SQLite instance / mocked `node:fs/promises`, no pure-unit layer applies here
- **Approval tests** (refactoring): None — no pre-existing behavior was being refactored under test; the `insertDocumentAndChunks`/`deleteDocumentRows` extraction was covered by the existing pre-refactor test suite (safety net) plus new tests, both re-run green after the extraction
- **Pure functions created**: 0 (all new methods are SQLite-adapter methods with necessary side effects; `toBlob` reused unchanged)

### Deviations from Design

None — implementation matches design. One correction discovered during GREEN execution, not a design deviation: the first draft of `upsertDocument` unconditionally prepared an `INSERT INTO chunks_vec` statement whenever `vectorsEnabled`, which threw `SqliteError: no such table: chunks_vec` when re-indexing a document with `embeddings: null` on a store where the vector table had never been created. Fixed by gating statement preparation on `this.vectorsEnabled && this.tableExists("chunks_vec")` — the design's "vectorsEnabled alone" write-guard governs *whether embeddings get written*, not whether it is safe to prepare a statement against a table that may not exist. Added a regression test (`writes embeddings for a brand-new document even before any compendio index run`) to cover the corresponding positive case (table gets created lazily and the embedding IS written).

### Issues Found

None.

## Batch 2 (this run): Phase 2 — Diff Engine: index-pipeline extraction + SyncIndex (tasks 2.1-2.14)

### Completed Tasks

- [x] 2.1 Created `src/application/index-pipeline.ts`: extracted the shared `parse -> policy.resolver -> chunk` transform (`transformFile`) plus `computeHash`/`describeError` out of `index-documents.ts`. Pure extraction — verified with the pre-existing `test/application/index-and-search.test.ts` suite (29 tests) as the regression net, run once BEFORE touching production code (safety net) and once AFTER, with **zero test edits**, per the coordinator's explicit instruction that any needed test edit would be a behavior-change signal
- [x] 2.2 Modified `index-documents.ts` to call `computeHash`/`transformFile`; `embedPending`'s end-of-pass batching (`DEFAULT_BATCH_SIZE = 16`) is untouched
- [x] 2.3 Created `src/application/sync-index.ts`: `SyncIndex.execute()` — diffs `source.discover()` against `store.listDocuments()` keyed by `ruta`, using the persisted `hash` as the sole fingerprint (Req: Fingerprint-Based Incremental Diff)
- [x] 2.4 `sync-index.ts`: `deleteMissingDocuments()` excludes both the exact `erroresLectura` `ruta` and every indexed `ruta` under `` `${ruta}/` `` (prefix rule, via `isProtected()`) from the delete-candidate set (Req: Read Failures Protect Subtree) — exercised against both a directory-level failure (Phase 1's `walk()` fix reports the failing subdirectory's relative path as exactly the `ruta` this rule matches against) and a file-level failure
- [x] 2.5 `sync-index.ts`: under `estricto`, a resolver rejection on a KNOWN `ruta` (present in `existingByRuta`) calls `deleteDocument` + reports `omitidos`, NOT `eliminados` (that array is reserved for disk-absence deletions per design's Data Flow); a NEW `ruta` failing resolution is a plain skip with nothing to delete (Req: Resolver Rejection Deletes Stale Row)
- [x] 2.6 `sync-index.ts`: `processNewAndChanged()` embeds a new/changed document's own chunks FIRST, then calls `upsertDocument(meta, chunks, embeddings|null)`; `embeddings` is `null` when the provider is absent or its `embed()` call throws for that document, in which case the document still commits lexical-only and `avisoEmbeddings` is set — the pass continues to the next document
- [x] 2.7 `sync-index.ts`: `reconcileVectors()` — `listChunksMissingVectors()`, filtered to `state.hashMatchRutas` (this pass's hash-match set), grouped by `ruta` via `groupByRuta()`, embedded per document, written with `replaceEmbeddings`; a no-op when `this.embeddings === null`
- [x] 2.8 `sync-index.ts`: `upsertDocument`/`deleteDocument`/`replaceEmbeddings` calls are each individually try/caught (`tryDelete()` for the two delete call sites; inline try/catch for upsert and for the reconciliation write) — a per-document failure is pushed to `omitidos` and the pass continues with the remaining documents (Req: resilience)
- [x] 2.9 Test `sync-index.test.ts` — "fingerprint-based incremental diff": new file indexed then left untouched when unchanged; changed file (hash differs) re-indexed with old content gone from lexical search; deleted-from-disk document removed (`eliminados`); rename treated as delete-plus-insert with no lineage
- [x] 2.10 Test `sync-index.test.ts` — "chunk-granular vector-coverage reconciliation": fully-vectorized hash-match document not re-embedded on the next pass; partially-vectorized hash-match document (one `chunks_vec` row dropped via a white-box raw-SQL seam, simulating an interruption) has ONLY the gap chunk re-embedded via `replaceEmbeddings`; a gap left untouched while the provider is unavailable (`avisoEmbeddings` correctly absent when nothing needed embedding that pass) and closed once the provider returns on a later pass
- [x] 2.11 Test `sync-index.test.ts` — "read failures protect the affected ruta subtree from deletion": a directory-level `erroresLectura` entry protects every indexed `ruta` beneath it; a file-level entry protects that exact `ruta`; both reported in `omitidos`, `eliminados` stays empty
- [x] 2.12 Test `sync-index.test.ts` — "resolver rejection on a changed known document deletes the stale row": a known `ruta`'s changed content failing `estricto` resolution is deleted (`eliminados` stays empty — it's an `omitidos`-only deletion) and disappears from the store; a brand-new `ruta` failing resolution is a plain skip with nothing to delete
- [x] 2.13 Test `sync-index.test.ts` — a hand-written `ThrowingStore` decorator (wraps a real `SqliteIndexStore`, throws for one configured `ruta` on `upsertDocument` and another on `deleteDocument`) proves the pass still completes the remaining (healthy) document and neither failure orphans/corrupts the pre-existing row it tried and failed to delete
- [x] 2.14 `npm test` (190/190 passed) + `npm run typecheck` (clean) — PR gate for this work unit. Line-count note: `sync-index.ts` (221 lines) + `sync-index.test.ts` (400 lines) = 621 lines, over the ~400-line note in this task. Per the task's own wording, this is a **commit-splitting** recommendation (2.1-2.6 core diff vs. 2.7-2.8 augmentation rules, as two commits), not a new size-exception decision — the whole change already carries the user-accepted single-pr `size:exception` from `state.yaml`. No commits were made this run (working tree only), so the split is a recommendation for whoever commits this work, not an action taken here.

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/application/index-pipeline.ts` | Created | `computeHash`, `describeError`, `transformFile` (parse -> policy.resolver -> chunk), `PipelineOptions`/`PipelineResult` types. Extracted verbatim from `index-documents.ts`'s per-file loop; caller supplies the hash (no double hashing) so `SyncIndex` can reuse its own diff hash. |
| `src/application/index-documents.ts` | Modified | Per-file loop now calls `computeHash`/`transformFile`; removed the now-dead private `isSinChunking`/`wholeDocumentChunk`/`describeError`. `embedPending` and its batching are byte-for-byte unchanged. Net -30 lines. |
| `src/application/sync-index.ts` | Created | `SyncIndex` class + `SyncReport` interface. Three private phases (`processNewAndChanged`, `deleteMissingDocuments`, `reconcileVectors`) threaded through a mutable `PassState` accumulator, extracted during REFACTOR for readability (see TDD evidence). |
| `test/application/sync-index.test.ts` | Created | 14 new tests across 6 `describe` blocks covering tasks 2.9-2.13. Includes a local `MutableSource` (swappable `files`/`erroresLectura` between `execute()` calls, simulating consecutive passes), a `dropVector()` white-box raw-SQL helper, and a `ThrowingStore` decorator for the write-failure-resilience test. |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1, 2.2 | `test/application/index-and-search.test.ts` (pre-existing, reused as approval test) | Integration | ✅ 29/29 (run before AND after, unchanged, zero edits) | N/A — approval-testing pattern for a pure extraction, per coordinator instruction | ✅ 29/29 still passing after extraction | ➖ N/A (refactor, not new behavior) | ✅ Extraction itself IS the refactor; `IndexDocuments` shrank from 164 to 128 lines |
| 2.3, 2.4, 2.9, 2.11 | `test/application/sync-index.test.ts` | Integration (`:memory:` SQLite + stub `DocumentSource`) | N/A (new file) | ✅ Written (`Cannot find module '../../src/application/sync-index'`) | ✅ Passed | ✅ 6 cases across the two describe blocks (new/changed/unchanged/deleted/rename; directory-level + file-level read-failure protection) | ✅ Extracted `processNewAndChanged`/`deleteMissingDocuments` from one monolithic `execute()` |
| 2.5, 2.12 | `test/application/sync-index.test.ts` | Integration | N/A (new file) | ✅ Written (`SyncIndex` did not exist) | ✅ Passed | ✅ 2 cases (known-ruta delete vs. new-ruta skip) | ➖ Covered by the same `execute()` extraction above |
| 2.6, 2.7, 2.8, 2.10, 2.13 | `test/application/sync-index.test.ts` | Integration | N/A (new file) | ✅ Written | ✅ Passed (one fix mid-GREEN: initial chunking config in two vector-coverage tests merged sections into a single chunk, breaking the "≥2 chunks" precondition — lengthened the test fixture's paragraph text past the configured `minTokens` merge threshold; not a production-code bug) | ✅ 6 cases (fully-vectorized skip, partial re-embed, provider-down/provider-back-up, embed-failure aviso, no-provider aviso, dual upsert+delete throw) | ✅ Extracted `reconcileVectors`/`tryDelete` from the monolithic `execute()` |

### Test Summary

- **Total tests written**: 14 (all in `test/application/sync-index.test.ts`)
- **Total tests passing**: 190/190 (full suite), including all 14 new tests
- **Layers used**: Integration (14) — real `:memory:` SQLite store, `RemarkMarkdownParser`, and either `FakeEmbeddings`/`BrokenEmbeddings` or a hand-written `ThrowingStore`/`MutableSource` stub; no pure-unit layer applies to a diff engine this store-coupled
- **Approval tests** (refactoring): 1 — the pre-existing `index-and-search.test.ts` suite (29 tests) served as the approval net for the 2.1/2.2 extraction, run unchanged before and after
- **Pure functions created**: 2 (`isProtected`, `groupByRuta` in `sync-index.ts`; `transformFile`/`computeHash`/`describeError` in `index-pipeline.ts` are also side-effect-free aside from `transformFile`'s call into the injected `parser`/`policy`)

### Deviations from Design

None — implementation matches design. Two test-authoring corrections, not production-code or design deviations: (1) two vector-coverage test fixtures initially used short section text that the configured chunking (`minTokens: 10`) merged into a single chunk, defeating the "partially vectorized, ≥2 chunks" precondition — fixed by lengthening the fixture paragraphs, no production code involved; (2) confirmed `SyncReport.eliminados`/`totalChunks` field semantics against design.md directly (design flags `eliminados` as "richer than spec requires... non-blocking", and `totalChunks` has no explicit formula) — implemented `totalChunks` as the sum of `indexados[].chunks` for this pass (chunks newly written), the only definition consistent with "reuses IndexReport shape" without re-counting untouched hash-match documents.

### Issues Found

None.

## Mutation-Testing Gap Closed (coordinator review, before Phase 3 started)

The coordinator re-verified Phase 2 independently (re-ran `npm test`/`typecheck`, reviewed the diff, mutation-tested `isProtected()` — narrowing it to an exact match produced a failing test, confirmed sound) and found ONE real gap: deleting the hash-match filter in `reconcileVectors()` —

```ts
const missing = this.store.listChunksMissingVectors(); // .filter(...) removed
```

— left `npx vitest run test/application/sync-index.test.ts` still reporting **14 passed**. Both existing reconciliation tests used documents already in the hash-match set, so the filter never had anything to exclude — a real coverage gap, not a false alarm.

**Fix**: added a new test to `test/application/sync-index.test.ts` (`describe("SyncIndex — chunk-granular vector-coverage reconciliation")`) — a document whose `ruta` fails to read on a given pass (reported in `erroresLectura`) never enters that pass's `hashMatchRutas` set and must stay untouched by reconciliation, not just protected from deletion. Uses a new `RecordingEmbeddings` wrapper (records `embed()` call inputs, delegates to a real `FakeEmbeddings`) to assert the provider is NOT invoked for that document's chunks.

**Verified both directions, as requested**:
- GREEN with the filter present: 15/15 (`npx vitest run test/application/sync-index.test.ts`).
- RED with the filter temporarily deleted: `AssertionError: expected [] to have a length of 1 but got +0` at the `listChunksMissingVectors()` assertion — 1 failed, the other 14 stayed green (isolating the failure to exactly the new test, no collateral breakage).
- GREEN again after restoring the filter: 15/15, full suite 191/191, typecheck clean.

**Design question raised and resolved**: is excluding a read-failed document from reconciliation actually correct, or is it an unnecessary restriction? Concluded it is CORRECT, not a bug — a read-failed `ruta` is deliberately left untouched entirely for that pass (same philosophy as the deletion-protection rule: transient vs. persistent unreadability is indistinguishable within one pass, so the safe move is "do nothing" rather than reconciling from possibly-stale last-known-good DB content while the file itself couldn't be verified this pass). It will be picked up normally once a future pass can read it again and it re-enters the hash-match set. No change to `design.md` needed; this is documented here as a deliberate confirmation, not a deviation.

## Batch 3 (this run): Phase 3 — Trigger, Config, Visibility (tasks 3.1-3.13)

### Completed Tasks

- [x] 3.1 `src/infrastructure/config.ts`: added `sync: { throttleMs: number }` to `CompendioConfig`/`DEFAULT_CONFIG` (`DEFAULT_THROTTLE_MS = 30000`); `validThrottleMs()` treats a non-finite, negative, or zero declared value the same as absent, falling back to the default; any finite positive value (however small) is accepted as-is
- [x] 3.2 Created `src/application/sync-scheduler.ts`: `SyncScheduler` — `lastRunAt` (initialized `-Infinity` so the very first call always triggers regardless of the clock's absolute starting value), `currentReport`/`lastReport` getter, `inFlight`, private `runTracked()`, `startup()`, `maybeSync()`. Depends on a narrow `Syncer` interface (`{ execute(): Promise<SyncReport> }`), not the concrete `SyncIndex` class, so scheduler tests stub it trivially
- [x] 3.3 `sync-scheduler.ts`: `runTracked()`'s failure path is `console.error`-only (stderr), `lastReport` is only assigned in the success branch (never touched on failure), `lastRunAt` and `inFlight = null` are both set in a `finally` unconditionally
- [x] 3.4 `src/composition.ts`: added `syncIndex`/`syncScheduler` fields to `Container`; wired `new SyncIndex(source, parser, store, embeddings, policy, { chunking: config.chunk, sinChunking: SIN_CHUNKING })` and `new SyncScheduler(syncIndex, config.sync.throttleMs)`
- [x] 3.5 `src/cli.ts`: `serve` action calls `container.syncScheduler.startup()` (synchronous, not awaited) between constructing the server and calling `server.connect(new StdioServerTransport())`
- [x] 3.6 `src/server.ts`: each of `docs_overview`/`search_docs`/`read_doc` handlers now starts with `await container.syncScheduler.maybeSync();`; `docs_overview`'s handler additionally maps `container.syncScheduler.lastReport` through `toSincronizacionInfo()` and passes it to `formatOverview()`
- [x] 3.7 `src/application/get-overview.ts`: added `SincronizacionInfo` interface, `toSincronizacionInfo(report: SyncReport | null): SincronizacionInfo | null` (content-based: `null` when `report` is `null`, OR when `omitidos` is empty and `avisoEmbeddings` is absent), and `formatOverview(overview, sincronizacion?)` appends an `"AVISO ..."`-per-line `Sincronizacion:` block only when the mapped value is non-null
- [x] 3.8 Test `config.test.ts`: 4 new tests — default `30000` with no `sync` block; custom `60000` accepted; non-numeric/negative/zero each fall back to `30000`; a very small positive value (`100`) is accepted, not clamped to a floor
- [x] 3.9 Test `sync-scheduler.test.ts` — throttle window (syncs on first call, skips within window, syncs again once elapsed); two concurrent `maybeSync()` calls await the SAME promise (`execute` called once); a `maybeSync()` arriving during `startup()` joins that SAME in-flight pass (`execute` called once total); a throwing sync never propagates, `lastReport` stays untouched, `lastRunAt` still advances (no hot-loop retry within the window), `inFlight` is cleared so a later call genuinely runs a new pass; `lastReport` starts `null` and reflects the last known-good pass
- [x] 3.10 Test `get-overview.test.ts` — `toSincronizacionInfo`: `null` for `null` report and for a content-empty report; surfaces `omitidos`; surfaces `avisoEmbeddings`. `formatOverview`: omits the `Sincronizacion` block for `undefined`/`null`/absent; renders `omitidos` + `avisoEmbeddings` content when present
- [x] 3.11 Test `index-and-search.test.ts` — new `describe("SyncIndex — end-to-end incremental sync over a temp docs directory")`: writes real files to an OS temp directory via `FileDocumentSource`, runs successive `SyncIndex.execute()` passes across an add, an edit, a second add, and a delete, asserting via `SearchDocuments`/`ReadDocument` (real `FakeEmbeddings`, `forzarLexico: true` to keep assertions about exact content boundaries independent of hybrid vector ranking)
- [x] 3.12 Test `server.test.ts` — new `describe("docs_overview tool — incremental sync trigger")`: constructs a fake `Container` whose `syncScheduler.maybeSync` is a spy, invokes the REAL registered `docs_overview` handler via its `handler` field (extended `RegisteredToolLike` to expose it), asserts the spy was called exactly once
- [x] 3.13 `npm test` (210/210 passed) + `npm run typecheck` (clean) — PR gate, full spec-scenario pass

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/infrastructure/config.ts` | Modified | `sync.throttleMs` config key, default `30000`, whitelist-merged with `validThrottleMs()` fallback guard |
| `src/application/sync-scheduler.ts` | Created | `SyncScheduler` + `Syncer` interface: startup + throttled trigger, in-flight promise dedupe, failure recovery |
| `src/composition.ts` | Modified | `Container` gains `syncIndex`/`syncScheduler`; both wired from existing pieces + `config.sync.throttleMs` |
| `src/cli.ts` | Modified | `serve` calls `container.syncScheduler.startup()` before `server.connect()`, not awaited |
| `src/server.ts` | Modified | Each of the three tool handlers awaits `syncScheduler.maybeSync()` first; `docs_overview` feeds `lastReport` through `toSincronizacionInfo()` into `formatOverview()` |
| `src/application/get-overview.ts` | Modified | `SincronizacionInfo` interface, `toSincronizacionInfo()` content-based mapper, `formatOverview()` gains an optional second parameter and an appended block |
| `test/infrastructure/config.test.ts` | Modified | 4 new tests for `sync.throttleMs` default/custom/invalid-fallback/small-value |
| `test/application/sync-scheduler.test.ts` | Created | 7 new tests: throttle window, in-flight dedupe (2 tests), failure recovery (2 tests), `lastReport` (2 tests) |
| `test/application/get-overview.test.ts` | Modified | 5 new tests: `toSincronizacionInfo` (4) + `formatOverview` sincronizacion block (2, one test has 2 assertions covering both omission paths) |
| `test/application/index-and-search.test.ts` | Modified | 1 new end-to-end test (add/edit/add/delete across 4 sync passes) |
| `test/server.test.ts` | Modified | Extended `RegisteredToolLike` with `handler`; 1 new test invoking the real `docs_overview` handler |
| `test/application/sync-index.test.ts` | Modified (mutation-gap fix, see above) | Added `RecordingEmbeddings` + 1 new test closing the `reconcileVectors` hash-match-filter mutation gap |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1, 3.8 | `test/infrastructure/config.test.ts` | Integration (real temp-dir config files) | ✅ 8/8 | ✅ Written (`Cannot read properties of undefined (reading 'throttleMs')`) | ✅ Passed | ✅ 4 cases (default, custom, 3x invalid-fallback, small-value-not-clamped) | ➖ None needed |
| 3.2, 3.3, 3.9 | `test/application/sync-scheduler.test.ts` | Unit (injected clock, stubbed `Syncer`) | N/A (new file) | ✅ Written (`Cannot find module '.../sync-scheduler'`) | ✅ Passed | ✅ 7 cases across 4 describe blocks | ➖ None needed — class was written directly at its final small size |
| 3.7, 3.10 | `test/application/get-overview.test.ts` | Unit/Integration mix | ✅ 5/5 | ✅ Written (`toSincronizacionInfo is not a function`) | ✅ Passed | ✅ 6 cases (4 mapper + 2 formatter) | ➖ None needed |
| 3.4, 3.5, 3.6 | N/A — pure wiring, no dedicated unit test (matches the repo's existing convention: no `composition.test.ts` exists) | — | — | — | — | — | — |
| 3.11 | `test/application/index-and-search.test.ts` | Integration (real filesystem, real `SqliteIndexStore`) | ✅ 29/29 | ✅ Written (new scenario, not previously exercised end-to-end) | ✅ Passed after fixing a test-authoring bug (see Deviations) | ➖ Single end-to-end scenario chaining add/edit/add/delete | ➖ None needed |
| 3.12 | `test/server.test.ts` | Unit (fake `Container`, real `createMcpServer`) | ✅ 4/4 | ✅ Written, and separately confirmed by temporarily removing the production `await maybeSync()` call — the test went red (`expected "vi.fn()" to be called 1 times, but got 0 times`), then green again after restoring it | ✅ Passed | ➖ Single scenario (one handler; the other two share identical wiring) | ➖ None needed |

### Test Summary

- **Total tests written this batch**: 18 (4 config + 7 scheduler + 6 get-overview + 1 e2e sync-index-and-search — the `+ 2` sincronizacion-block subcases live inside 1 test each — see per-file counts above) plus 1 for the Phase 2 mutation-gap fix = **19 new tests**
- **Total tests passing**: 210/210 (full suite)
- **Layers used**: Unit (`sync-scheduler.test.ts`, `server.test.ts` — fully stubbed dependencies), Integration (`config.test.ts` real temp-dir files, `get-overview.test.ts` real `:memory:` store, `index-and-search.test.ts` real filesystem + real store)
- **Approval tests** (refactoring): None this batch — no existing behavior was refactored
- **Pure functions created**: 2 (`validThrottleMs` in `config.ts`, `toSincronizacionInfo` in `get-overview.ts`)
- **Mutation checks performed and verified caught** (beyond the mandatory RED/GREEN cycle, given the coordinator's explicit scrutiny this session):
  1. `SyncScheduler.maybeSync()`: inserting `await Promise.resolve()` between the throttle check and `runTracked()` (simulating the exact race the design's synchronous check-then-assign ordering exists to prevent) → 1 test failed (`execute` called 0 times, not 1) → reverted, green.
  2. `SyncScheduler.runTracked()`: removing `this.inFlight = null` from the `finally` block (a permanently wedged scheduler) → 3 tests failed (`execute` stuck at 1 call) → reverted, green.
  3. `server.ts`'s `docs_overview` handler: removing `await container.syncScheduler.maybeSync();` → 1 test failed → reverted, green.

### Deviations from Design

None — implementation matches design. One test-authoring bug found and fixed during GREEN for task 3.11 (not a production bug): the original file content ("...alfa unico irrepetible") and the "stale content is gone" check both used the word "contenido", so the negative lexical assertion passed for the wrong reason (matching the shared word, not proving the old content was actually gone). Fixed by using fully disjoint single-token vocabulary per file version (`textoalfaoriginalunicoirrepetible`, `textobetaeditadodistintototalmente`, `textogammanuevodiferenteaparte`) and adding `forzarLexico: true` throughout, since `FakeEmbeddings`' concept-stem model would otherwise make generic (non-domain) test words collide in vector space, which is a property of the test fixture, not a reason to avoid precise lexical assertions.

### Issues Found

None.

### Workload / PR Boundary

- Mode: single PR, size:exception accepted
- Current work unit: Phase 3 of 3 (Trigger, Config, Visibility) — complete. **All 3 phases of this change are now done.**
- Boundary: this batch starts from Phase 2's unwired `SyncIndex` and ends at task 3.13's gate (full suite + typecheck green). This batch is what turns the feature ON: `composition.ts` now constructs `syncIndex`/`syncScheduler`, `cli.ts`'s `serve` command calls `startup()`, and all three MCP tool handlers call `maybeSync()`. `compendio index`'s full-rebuild path (`IndexDocuments`) is unchanged and untouched.
- Estimated review budget impact: combined with Phases 1-2, this change is well over the 400-line single-PR budget, as forecast throughout `state.yaml` and accepted as `size:exception`. The task 2.14 commit-splitting recommendation (core diff vs. augmentation rules, as two commits within the single PR) still stands and was not actioned here (no commits made this run).

### Status

**39/39 total tasks complete. All three phases (Store Primitives, Diff Engine, Trigger/Config/Visibility) are done.** `npm test`: 210/210 passed. `npm run typecheck`: clean. Ready for `sdd-verify`.

## Independent Verifier Follow-up — 2 Test-Coverage Gaps Closed (before `sdd-verify`)

An independent verifier returned **PASS WITH WARNINGS** (0 critical, 3 warnings): all 39 tasks match the specs, all five judgment-day resolutions are honored, every architectural invariant in `CLAUDE.md` holds. The verdict was about missing test coverage, not defects — production code was correct in both cases below and was **not changed**; only tests were added.

### Gap 1 — embed-before-upsert atomicity (`src/application/sync-index.ts`, `processNewAndChanged`)

The verifier found that reordering the per-document write into two separate calls (`upsertDocument(meta, chunks, null)` first, then a follow-up `embed()` + `replaceEmbeddings()`) still left `npm test` fully green. This is the exact property judgment-day flagged as load-bearing: a hash-current row must never be committed without its vectors, because the NEXT pass would see the hash match, skip the document as unchanged, and leave it silently vectorless forever.

**Fix**: added `describe("SyncIndex — embed-before-upsert atomicity ...")` to `test/application/sync-index.test.ts` — a `RecordingStore` (delegates to a real `SqliteIndexStore`, records `upsertDocument`'s exact `embeddings` argument) plus a `RecordingEmbeddings`-style stub, both pushing into ONE shared `order: string[]` log. Asserts: exactly one `upsertDocument` call for the ruta; that call's `embeddings` argument is non-null; and `order` is exactly `["embed:a.md", "upsert:a.md"]` — a single shared log makes "embed happened before upsert" a direct, meaningful index comparison rather than two independently-timed spies that could coincidentally agree.

**Verified both directions**:
- GREEN with the code intact: 16/16 in `sync-index.test.ts` (211 full suite... see below).
- RED after applying the exact reorder described above (upsert-then-embed-then-replaceEmbeddings, requiring `saved.chunkIds` from the upsert's return value to drive `replaceEmbeddings`): `AssertionError: expected null not to be null` at `expect(store.upsertEmbeddingsAtCallTime[0]).not.toBeNull()` — 1 test failed, the other 15 in that file (and all 210 pre-existing tests elsewhere) stayed green: **210 passed, 1 failed (211 total)** — the exact number the verifier reported as "210/210 green" is now impossible to reach with this bug present.
- GREEN again after reverting the reorder: 16/16, full suite 213/213 (counting Gap 2's tests too — see below), typecheck clean.

### Gap 2 — `maybeSync()` wiring on `search_docs` and `read_doc` (`src/server.ts`)

The verifier deleted the `await container.syncScheduler.maybeSync();` line inside the `search_docs` handler and the full suite still reported 210/210 — `test/server.test.ts` only had a thin check for `docs_overview`'s wiring, leaving two of the three mcp-contract-required throttled-check call sites completely unprotected.

**Fix**: extended `fakeContainerWithScheduler()` in `test/server.test.ts` with stub `searchDocuments`/`readDocument` fields, then added `describe("search_docs tool — incremental sync trigger")` and `describe("read_doc tool — incremental sync trigger")`, each invoking the REAL registered handler (via its `handler` field, same pattern as the existing `docs_overview` test) and asserting the injected `maybeSync` spy was called exactly once.

**Verified both directions, one handler at a time**:
- GREEN with the code intact: 7/7 in `server.test.ts`.
- RED after deleting `search_docs`'s `await container.syncScheduler.maybeSync();` (`src/server.ts` line 84 at the time): `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` in `search_docs tool — incremental sync trigger` — 1 failed, the other 6 (including `docs_overview`'s and `read_doc`'s) stayed green. Reverted, confirmed green.
- RED after deleting `read_doc`'s `await container.syncScheduler.maybeSync();` (line 112 at the time): same assertion failure, this time in `read_doc tool — incremental sync trigger` — 1 failed, the other 6 (including the just-restored `search_docs` test) stayed green, confirming test isolation. Reverted, confirmed green.

### Final Verification (both gaps closed, production code unchanged from Phase 3's end state)

```
npm test
 Test Files  23 passed (23)
      Tests  213 passed (213)

npm run typecheck
(no output — clean)
```

`git diff --stat` (tracked-file modifications only; 5 new untracked files — `src/application/index-pipeline.ts` 91 lines, `src/application/sync-index.ts` 221 lines, `src/application/sync-scheduler.ts` 81 lines, `test/application/sync-index.test.ts` 554 lines, `test/application/sync-scheduler.test.ts` 145 lines — are not counted by `git diff --stat` since they are untracked, not staged):

```
16 files changed, 715 insertions(+), 77 deletions(-)
```

**Note for the record**: the coordinator fixed a YAML parse error in `state.yaml` (an unescaped `:` inside a list item under `explore.open_product_decisions`, now a `>-` block scalar) while this batch was in progress. That fix is preserved as-is in the version of `state.yaml` this apply batch updates below.

### Third warning (not actioned, by explicit instruction)

The verifier's third warning — no literal `compendio serve` end-to-end subprocess test — is a deliberate, accepted scoping gap per `design.md`'s Testing Strategy (`test/server.test.ts` uses `{} as Container` / stub containers by design; the scheduler and handler wiring are unit-tested instead). Left untouched.
