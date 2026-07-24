# Tasks: Incremental Reindex

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500-800 (design forecast) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 2 -> PR 3 (revises design's 2-PR note; see below) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (proposed; each slice is inert/dead-code until PR 3 activates it, so each is independently safe to merge) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Revision of design's 2-PR note**: design proposed PR#1 (store primitives) / PR#2 (sync+scheduler+config+visibility). Splitting PR#2's actual content shows `sync-index.ts` alone (diff + 3 augmentation rules + its dedicated test suite covering 5+ spec scenario groups) is itself ~450-700 lines — already at or over budget on its own. A 3-way split isolates the diff engine from the trigger/wiring layer so no single PR hugs the ceiling.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Store primitives: 4 new `IndexStore` ops + `FileDocumentSource` fix, fully tested, unwired | PR 1 | Base: main. Dead code until PR 2/3 call it. |
| 2 | Diff engine: `index-pipeline.ts` extraction + `SyncIndex` use case, fully tested, unwired | PR 2 | Base: PR 1 branch. Unit-testable via stubs; no server/cli wiring. |
| 3 | Trigger + config + visibility: `SyncScheduler`, `sync.throttleMs`, composition/server/cli wiring, `sincronizacion` | PR 3 | Base: PR 2 branch. Turns the feature on; full spec-scenario pass. |

## Task-Phase Decisions (resolving `state.yaml` carried_to_tasks)

- **Subdirectory readdir-failure test seam**: mock `readdir` from `node:fs/promises` using the SAME `vi.hoisted(() => vi.fn())` + `vi.mock` pattern `file-document-source.test.ts` already uses for `readFile`, and make it throw only for one subdirectory path. Fully portable (no `chmod`, no OS permission dependency) and exercises the exact `walk()` non-root catch branch. No platform skip needed.
- **Port surface growth**: confirmed as designed — `deleteDocument`, `upsertDocument`, `listChunksMissingVectors`, `replaceEmbeddings` are ADDED to `IndexStore`; `saveEmbeddings` stays INSERT-only and untouched, so the full-rebuild (`IndexDocuments`) path never changes shape.

## Phase 1: Store Primitives (PR #1)

- [x] 1.1 `src/domain/ports.ts`: add `ChunkMissingVector` type + 4 `IndexStore` method signatures (Req: Per-Document Upsert and Delete)
- [x] 1.2 `sqlite-index-store.ts`: `deleteDocument(ruta)` — FTS5 `'delete'` form per chunk, `chunks_vec` (double-guarded), `chunks`, `documents`, one transaction (Req: no orphans)
- [x] 1.3 `sqlite-index-store.ts`: `upsertDocument(meta, chunks, embeddings)` — guarded delete-if-exists then insert; `chunks_vec` write guarded by `vectorsEnabled` alone + `ensureVectorTable` (Req: re-index no duplicates)
- [x] 1.4 `sqlite-index-store.ts`: `listChunksMissingVectors()` — one batched query, `[]` when vectors off/table absent (Req: vector-coverage scenarios)
- [x] 1.5 `sqlite-index-store.ts`: `replaceEmbeddings(items)` — delete+insert per `chunk_id`, one transaction, idempotent (Req: partially-vectorized re-embed)
- [x] 1.6 `file-document-source.ts`: `walk()`'s non-root `readdir` catch pushes `{ruta:prefix,error}` into `erroresLectura` instead of silent return; root case still throws (Req: Read Failures Protect Subtree)
- [x] 1.7 Test `sqlite-index-store.test.ts`: delete leaves no `chunks`/`chunks_fts`/`chunks_vec` orphans, no stale lexical hits
- [x] 1.8 Test `sqlite-index-store.test.ts`: re-indexing a changed document replaces with no duplicates
- [x] 1.9 Test `sqlite-index-store.test.ts`: `listChunksMissingVectors` partial coverage + `[]` when `chunks_vec` never created
- [x] 1.10 Test `sqlite-index-store.test.ts`: `replaceEmbeddings` on an already-vectorized chunk — no PRIMARY KEY violation, no duplicate row
- [x] 1.11 Test `file-document-source.test.ts`: mock `readdir` (portable seam from Task-Phase Decisions) throwing for one subdirectory — asserts `erroresLectura` entry, files beneath absent, root failure still throws
- [x] 1.12 Run `npm test` + `npm run typecheck` — PR #1 gate

## Phase 2: Diff Engine — SyncIndex (PR #2, base = PR #1)

- [x] 2.1 Create `src/application/index-pipeline.ts`: extract shared `parse -> policy.resolver -> chunk` transform out of `index-documents.ts` (no behavior change to `IndexDocuments`)
- [x] 2.2 Modify `index-documents.ts` to call the shared helper; `embedPending` batching unchanged
- [x] 2.3 Create `src/application/sync-index.ts`: `SyncIndex.execute()` — hash diff keyed by `ruta` (Req: Fingerprint-Based Incremental Diff)
- [x] 2.4 `sync-index.ts`: exclude `erroresLectura` `ruta` + every indexed `ruta` under `` `${ruta}/` `` from delete candidates (Req: Read Failures Protect Subtree)
- [x] 2.5 `sync-index.ts`: `estricto` resolver rejection on a KNOWN `ruta` -> `deleteDocument` + `omitidos`; on a NEW `ruta` -> plain skip (Req: Resolver Rejection Deletes Stale Row)
- [x] 2.6 `sync-index.ts`: per document, embed its chunks first, then `upsertDocument(meta, chunks, embeddings|null)`; `null` on provider failure commits lexical-only + `avisoEmbeddings`
- [x] 2.7 `sync-index.ts`: vector-coverage reconciliation — `listChunksMissingVectors()`, filter to this pass's hash-match set, group by `ruta`, embed, `replaceEmbeddings`
- [x] 2.8 `sync-index.ts`: catch `upsertDocument`/`deleteDocument`/`replaceEmbeddings` failures per document -> `omitidos`, pass continues (Req: resilience)
- [x] 2.9 Test `sync-index.test.ts`: new/changed/unchanged/deleted/rename scenarios via stub `DocumentSource` (`buildHarness`)
- [x] 2.10 Test `sync-index.test.ts`: fully-vectorized hash-match skipped; partially-vectorized re-embeds only missing chunks (provider up/down)
- [x] 2.11 Test `sync-index.test.ts`: `erroresLectura` `ruta` + subtree prefix survive the pass, reported in `omitidos`
- [x] 2.12 Test `sync-index.test.ts`: `estricto` resolver-rejection delete vs. new-`ruta` skip
- [x] 2.13 Test `sync-index.test.ts`: store stub throwing per `ruta` for upsert and for delete — pass still completes remaining documents
- [x] 2.14 Run `npm test` + `npm run typecheck` — PR #2 gate; if `sync-index.ts` + its tests exceed ~400 lines in practice, split 2.3-2.6 (core diff) from 2.7-2.8 (augmentation rules) into two commits before PR review, not as a size exception

## Phase 3: Trigger, Config, Visibility (PR #3, base = PR #2)

- [x] 3.1 `src/infrastructure/config.ts`: `sync.throttleMs` default `30000`; non-finite/`<=0` falls back to default (Req: sync config section)
- [x] 3.2 Create `src/application/sync-scheduler.ts`: `SyncScheduler` (`throttleMs`, `lastRun`, `lastReport`, `inFlight`), `runTracked()`, `startup()`, `maybeSync()` (Req: Incremental Sync Triggers)
- [x] 3.3 `sync-scheduler.ts`: failure caught in `runTracked` -> stderr-only, `lastReport` untouched, `lastRun` advanced, `inFlight` cleared in `finally`
- [x] 3.4 `src/composition.ts`: wire `syncIndex` + `syncScheduler(config.sync.throttleMs)` into `Container`
- [x] 3.5 `src/cli.ts`: `serve` calls `scheduler.startup()` before `server.connect()`, not awaited
- [x] 3.6 `src/server.ts`: each of `docs_overview`/`search_docs`/`read_doc` handlers `await scheduler.maybeSync()` first; feed `lastReport` into overview
- [x] 3.7 `src/application/get-overview.ts`: content-based `SincronizacionInfo` mapper + `formatOverview(overview, sincronizacion?)` (Req: Sync-Status Visibility)
- [x] 3.8 Test `config.test.ts`: `sync.throttleMs` default / custom / invalid-fallback scenarios
- [x] 3.9 Test `sync-scheduler.test.ts` (fake clock): throttle window; concurrent `maybeSync` dedupe; a call during startup awaits the SAME `inFlight`; sync-throws recovery
- [x] 3.10 Test `get-overview.test.ts`: `sincronizacion` omitted when report `null` or content-empty; rendered when `omitidos`/`avisoEmbeddings` present
- [x] 3.11 Test `index-and-search.test.ts`: add/edit/delete a temp file, sync, assert search/read reflect it (`FakeEmbeddings`)
- [x] 3.12 Test `server.test.ts`: thin check that a real handler awaits `maybeSync()`
- [x] 3.13 Run `npm test` + `npm run typecheck` — PR #3 gate, full spec-scenario pass
