# Verify Report: incremental-reindex

**Change**: incremental-reindex
**Mode**: full artifacts (proposal/spec/design/tasks/apply-progress all present); Strict TDD active
**Verdict**: **PASS WITH WARNINGS**

## Test / Build Evidence

- `npm test`: `Test Files 23 passed (23)` / `Tests 210 passed (210)` (baseline, before AND after every mutation below - tree confirmed clean each time)
- `npm run typecheck`: clean, no output
- `git diff --stat`: `16 files changed, 685 insertions(+), 77 deletions(-)` (tracked) plus 5 new untracked files (`src/application/index-pipeline.ts`, `src/application/sync-index.ts`, `src/application/sync-scheduler.ts`, `test/application/sync-index.test.ts`, `test/application/sync-scheduler.test.ts`) - identical before and after this verification pass; every mutation introduced during verification was reverted and confirmed byte-identical via `git diff --stat` plus a final green `npm test`.

## Completeness

- 39/39 tasks in `tasks.md` marked `[x]`, across all 3 phases (Store Primitives / SyncIndex diff engine / Trigger-Config-Visibility). Task completion matches actual code state - every file listed in `apply-progress.md`'s "Files Changed" tables is present in the diff, nothing extra, nothing missing.
- Delivery: single PR with `size:exception` accepted per `state.yaml`'s `delivery_decision` - consistent with the actual diff size (well over the 400-line budget, as forecast).

## Judgment-Day Resolutions (state.yaml phases.design.judgment_day.resolutions) - all 5 honored

| # | Resolution | Verified |
|---|---|---|
| 1 | No PRAGMA user_version gate anywhere (withdrawn) | grep for "user_version"/"isSchemaCurrent" across src/ returns no matches. startup() unconditionally calls runTracked() with no schema-staleness branch. |
| 2 | No ultimoIntentoFallido field (dropped) | grep for "ultimoIntentoFallido" across src/ returns no matches. SyncReport/SincronizacionInfo only carry omitidos/avisoEmbeddings; a failed pass is console.error-only in sync-scheduler.ts's runTracked(), lastReport untouched on failure. |
| 3 | erroresLectura subtree prefix rule | sync-index.ts's isProtected(): ruta === failed OR ruta.startsWith(failed + "/"). Tested directly for both a directory-level failure (subtree protected) and a file-level failure. |
| 4 | Chunk-granular vector reconciliation, idempotent replaceEmbeddings | listChunksMissingVectors() returns per-chunk records; replaceEmbeddings is DELETE-then-INSERT per chunk_id in one transaction (sqlite-index-store.ts). Tested at both store level (re-covering an already-vectorized chunk, no PK violation) and SyncIndex level (partial-gap close, provider-down persistence, provider-back-up reconsideration, and a read-failed ruta correctly excluded from reconciliation too). |
| 5 | Concurrency guarantee narrowed to per-document atomicity | indexing/spec.md's concurrency requirement explicitly disclaims a pass-level snapshot; each document's teardown+insert is one db.transaction() call, composed inside deleteDocument/upsertDocument. |

## Architectural Invariants (CLAUDE.md)

- Domain purity: grep for infrastructure imports inside src/domain/ returns no matches. src/domain/ports.ts gained ChunkMissingVector plus 4 method signatures only; no infra import leaked in.
- Ports-first: SyncIndex/SyncScheduler depend only on IndexStore/DocumentSource/MarkdownParser/EmbeddingsProvider interfaces from domain/ports.ts, never a concrete adapter.
- saveEmbeddings unchanged, INSERT-only: confirmed byte-for-byte at sqlite-index-store.ts - still throws on a pre-existing chunk_id, no delete-then-insert added to it. IndexDocuments's full-rebuild path (reset() + saveDocument() + embedPending) is a pure extraction (moved computeHash/transformFile into index-pipeline.ts); the pre-existing 29-test index-and-search.test.ts IndexDocuments suite passed unchanged, before and after, with zero test edits - a real approval-test signal that behavior did not drift.
- FTS5 external-content 'delete' command form: deleteDocumentRows() uses the external-content delete command form, not a plain DELETE FROM chunks_fts. Confirmed by source read and by the "leaves no chunks/chunks_fts/chunks_vec orphans, no stale lexical hits" test.
- chunks_vec keys are BigInt: every new/changed call site (deleteDocumentRows, upsertDocument's insertVec, replaceEmbeddings's del/insert) binds BigInt(chunkId), matching the existing saveEmbeddings precedent.

## Spec Scenario Compliance Matrix

### Indexing spec (16 scenarios)

| Scenario | Test | Status |
|---|---|---|
| New or changed file is (re)indexed | sync-index.test.ts "indexes a new file..." | PASS |
| Unchanged, fully vectorized file left untouched | sync-index.test.ts "does not re-embed a fully vectorized hash-match document" | PASS |
| Partially vectorized document has only missing chunks embedded | sync-index.test.ts "re-embeds only the chunks missing a vector..." | PASS |
| Vector gap persists while provider unavailable | sync-index.test.ts "leaves a vector-coverage gap untouched while the provider is unavailable..." | PASS |
| Vector table never created is a no-op | sqlite-index-store.test.ts "returns [] when chunks_vec was never created" (store level); sync-index.test.ts no-provider tests exercise the same guard at the pass level | PASS |
| Deleted file is removed | sync-index.test.ts "deletes a document whose ruta disappears from disk" | PASS |
| Rename is delete-plus-insert, no lineage | sync-index.test.ts "treats a rename as delete-plus-insert" | PASS |
| Transient read failure does not delete an existing document | sync-index.test.ts "excludes a directly-failed file ruta..." | PASS |
| Changed known document fails resolution -> stale row deleted | sync-index.test.ts "deletes the stale row when a known ruta's changed content fails..." | PASS |
| New document failing resolution is a plain skip | sync-index.test.ts "is a plain skip, with nothing to delete, when a NEW ruta fails..." | PASS |
| Deleting a document leaves no orphans | sqlite-index-store.test.ts deleteDocument describe block | PASS |
| Re-indexing a changed document has no duplicates | sqlite-index-store.test.ts upsertDocument describe block | PASS |
| Startup sync catches offline edits | No literal compendio serve subprocess test. Covered only by decomposed unit layers: SyncScheduler.startup() unit test plus source-level wiring in cli.ts (5-line diff) plus SyncIndex tested independently. See Finding W2. | PARTIAL (see W2) |
| Throttle window gates repeated calls | sync-scheduler.test.ts "syncs on first call, skips within window, then syncs again..." | PASS |
| No database file needs no special-casing | No dedicated "missing DB file" test, but there is no special-case branch in the code (confirmed by source read) - a fresh :memory: store (equivalent starting state to a fresh file, both created by the unconditional migrate()) is exactly what every "new file" test already exercises | PASS (by design absence of a branch plus equivalent-state test) |
| Unreadable subdirectory does not delete its documents | file-document-source.test.ts (reporting) plus sync-index.test.ts "excludes a directory-level failed ruta and every indexed ruta beneath it..." (consumption) | PASS |
| Unreadable docs root still throws | file-document-source.test.ts "still throws when the docs root itself cannot be read" | PASS |
| No partially-written document ever observed | Guaranteed by db.transaction() wrapping each document's delete+insert (SQLite/better-sqlite3 guarantee, source-verified); not independently mutation-tested beyond the atomicity gap noted in Finding M3 | PASS (architectural, see M3 for the adjacent gap) |
| A single call may straddle a sync pass | Documented non-guarantee in the spec text itself; nothing to test (this is a disclaimer, not a behavior) | N/A |
| External compendio index non-goal still applies | Pre-existing, unchanged by this change | PASS (unchanged) |

### Configuration spec (3 scenarios) - all PASS

config.test.ts: default 30000 / custom 60000 / non-numeric+negative+zero all fall back to 30000 / a very small positive value (100) accepted without a floor clamp. All four assertions independently verified passing.

### MCP-contract spec (3 scenarios) - all PASS (with a wiring-coverage caveat, Finding W3)

get-overview.test.ts fully covers the content-based toSincronizacionInfo/formatOverview contract (omission on null and on content-empty report; rendering of omitidos and avisoEmbeddings). server.ts wires docs_overview to feed lastReport through this mapper - confirmed correct by source read. See Finding W3 for the asymmetric regression coverage across the three handlers.

## Mutation Testing (performed independently this session, not taken on the apply agent's word)

All mutations below were applied to the actual source, run against the real test suite, confirmed RED, then reverted and confirmed GREEN plus a clean git diff --stat (byte-identical to the pre-mutation state).

### M1 - SyncScheduler in-flight dedupe (PASS - caught)

Inserted an extra await between the throttle check and runTracked() in maybeSync() (src/application/sync-scheduler.ts), reproducing the exact race the design's synchronous check-then-assign ordering exists to prevent.

- RED: npx vitest run test/application/sync-scheduler.test.ts -> 1 failed ("two concurrent maybeSync() calls await the SAME promise" - execute called 0 times instead of 1).
- Reverted, GREEN: 7/7.

### M2 - Resolver-rejection-deletes-a-known-ruta rule (PASS - caught)

Removed the "if (existingDoc !== undefined) delete it" branch in sync-index.ts's processNewAndChanged() (the "delete the stale row" half of the resolver-rejection rule).

- RED: npx vitest run test/application/sync-index.test.ts -> 1 failed ("deletes the stale row when a known ruta's changed content fails policy.resolver() under estricto" - getDocumentByRuta("a.md") returned the stale row instead of null).
- Reverted, GREEN: 15/15.

### M3 - Per-document embed-BEFORE-upsert atomicity (FAIL - NOT caught; genuine gap)

Reordered processNewAndChanged() to commit store.upsertDocument(meta, chunks, null) FIRST, then compute embeddings and write them via a SEPARATE store.replaceEmbeddings(...) call afterward - i.e. breaking the single-transaction "embed before commit" guarantee design.md calls load-bearing, while still converging to the same end state when nothing crashes mid-pass.

- Ran npx vitest run test/application/sync-index.test.ts test/application/index-and-search.test.ts -> 45/45 still passed. Ran the full suite -> 210/210 still passed. npm run typecheck clean (after adding the necessary non-null assertions the reordering required).
- Why it isn't caught: every existing test either (a) checks the FINAL state after a fully-completed, uninterrupted pass - which is identical whether embeddings are written inside the same transaction as the chunks or in a follow-up call - or (b) exercises the RECONCILIATION safety net (listChunksMissingVectors/replaceEmbeddings) starting from an ALREADY-EXISTING gap simulated via the white-box dropVector() helper, never from the initial commit path itself. No test kills/interrupts a pass between "chunks committed" and "vectors committed" for a newly processed document, which is the exact scenario this design decision (and the whole vector-coverage-reconciliation requirement's premise) exists to prevent.
- Reverted, confirmed GREEN: 210/210, typecheck clean, git diff --stat shows zero diff for sync-index.ts.
- Severity: WARNING, not CRITICAL. The shipped code IS correct - sync-index.ts genuinely awaits this.embeddings.embed(...) before calling this.store.upsertDocument(meta, chunks, chunkEmbeddings), and upsertDocument commits everything in one db.transaction(). There is no spec scenario literally worded as "an interrupted commit never happens" (the closest scenarios test the reconciliation recovery mechanism, which is thoroughly covered) - this is a load-bearing design decision without a corresponding regression test, not an unmet spec requirement. A future refactor could silently reintroduce the two-write split and nothing in CI would fail.

## Additional Findings (found via independent inspection plus one more mutation)

### W2 (WARNING) - No literal serve-startup end-to-end test

The "Startup sync catches offline edits" indexing-spec scenario has no test that spawns compendio serve (or otherwise drives cli.ts plus server.ts together) and observes an offline edit reflected in the first tool response. Coverage is entirely bottom-up: SyncScheduler.startup()'s unit test proves the in-flight-dedupe mechanics; cli.ts's 5-line wiring diff and server.ts's per-handler maybeSync() calls are verified by source read plus one handler-level spy test (see W3). test/cli-subprocess.test.ts exercises index/search/overview/--version/--help through the real compiled dist/cli.js, but has no serve case at all - reasonable given serve is a long-lived stdio server (harder to subprocess-test than one-shot commands), and this is consistent with design.md's own testing-strategy note (server.test.ts uses a fake Container; the scheduler is unit-tested standalone, plus a thin integration check). Flagged as a design-accepted scoping choice, not a violation - but it means the full startup-to-first-tool-call flow is proven only by composition, never end-to-end.

### W3 (WARNING, confirmed by mutation) - Only docs_overview's maybeSync() wiring is regression-tested

test/server.test.ts's new "docs_overview tool - incremental sync trigger" test spies on syncScheduler.maybeSync and asserts it was called when invoking the real docs_overview handler - but there is no equivalent test for search_docs or read_doc, even though server.ts calls await container.syncScheduler.maybeSync(); at the top of all three handlers and the Indexing spec explicitly requires the three MCP tool handlers to share a single pre-call hook.

Verified by mutation: removed the maybeSync() call from the search_docs handler (src/server.ts, line 84) only. Ran npm test -> 210/210 still passed (full suite, no failure anywhere). Reverted; git diff --stat -- src/server.ts confirmed byte-identical to baseline (9 insertions/4 deletions), npm test green again (210/210), typecheck clean.

Severity: WARNING. The current code is correct (all three handlers do call maybeSync(), confirmed by source read of src/server.ts), but a future edit that accidentally dropped the call from search_docs or read_doc would ship with a fully green test suite.

## Config Verification

sync.throttleMs default 30000, custom-value acceptance, and the non-finite/negative/zero -> default fallback are all implemented (src/infrastructure/config.ts's validThrottleMs()) and each scenario has a passing, non-trivial test in test/infrastructure/config.test.ts (including a case proving a very small positive value like 100 is accepted, not clamped to an arbitrary floor).

## Strict TDD Compliance

- TDD Cycle Evidence tables present in apply-progress.md for all 3 batches, with RED (test file exists / real failing message quoted), GREEN (cross-checked against this session's own npm test run - 210/210), TRIANGULATE, and REFACTOR columns filled in for every task group.
- Assertion Quality Audit: scanned all new/modified test files (sync-index.test.ts, sync-scheduler.test.ts, plus the modified blocks in sqlite-index-store.test.ts, file-document-source.test.ts, config.test.ts, get-overview.test.ts, index-and-search.test.ts, server.test.ts) - zero tautologies, zero assertions-without-production-code-calls, zero ghost loops over possibly-empty query results (the one "for (const invalid of [...])" loop in config.test.ts iterates a fixed 3-element literal array, not a queryable/filterable collection that could resolve empty). No smoke-test-only patterns; every test asserts specific values (hashes, chunk ids, ruta lists, exact error messages), not just "did not throw."
- Assertion quality: All assertions verify real behavior.

## Overall Verdict

PASS WITH WARNINGS - 0 CRITICAL findings, 3 WARNING findings (M3 embed-before-upsert atomicity has no regression test; W2 no literal serve end-to-end test; W3 only 1 of 3 handlers' maybeSync() wiring is regression-tested). All 5 judgment-day resolutions honored. All architectural invariants (domain purity, ports-first, saveEmbeddings INSERT-only, FTS5 'delete' form, BigInt vec keys) confirmed by source inspection. Every spec scenario across the 3 delta specs has real, passing coverage except where explicitly noted as a design-accepted scoping gap (W2). The working tree was returned byte-identical to its pre-verification state (git diff --stat: 685 insertions(+), 77 deletions(-) across 16 tracked files, unchanged) after every mutation performed during this pass, with a final npm test of 210/210 and a clean npm run typecheck.

None of the three WARNING findings block a merge on their own - the shipped code is correct by source inspection in all three cases. They are recommendations for follow-up tests (ideally before archiving, given this ships as a single oversized PR and this is the last gate before review), not defects requiring a return to sdd-apply.
