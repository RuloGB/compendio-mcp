# Archive Report: incremental-reindex

**Change**: incremental-reindex  
**Archived**: 2026-07-24  
**Status**: CLOSED — cycle complete and verified  
**Verdict**: PASS WITH WARNINGS (0 CRITICAL, 3 WARNING; non-blocking)

## Execution Summary

The incremental-reindex change has been fully planned, implemented, verified, and archived. All 39 implementation tasks across 3 phases (Store Primitives / SyncIndex diff engine / Trigger-Config-Visibility) are complete and marked `[x]`. The working tree passed all verification gates (210/210 tests, clean typecheck, 685 insertions + 77 deletions across 16 tracked files). The single-PR delivery was accepted as a size exception per the ask-on-risk delivery strategy.

## Specs Merged

Three delta specs were merged into their corresponding main specs under `openspec/specs/`:

| Domain | Action | Requirements Added |
|--------|--------|-------------------|
| `indexing` | Updated | 6 new requirements: Fingerprint-Based Incremental Diff, Resolver Rejection on Changed Known Document Deletes Stale Row, Per-Document Upsert and Delete Without Orphaning or FTS Desync, Incremental Sync Triggers (Startup and Throttled Pre-Tool-Call Check), Read Failures Protect Subtree, In-Process Incremental Sync Concurrency Guarantee |
| `configuration` | Updated | 1 new requirement: `sync` Configuration Section With Per-Project Throttle Default |
| `mcp-contract` | Updated | 1 new requirement: Sync-Status Visibility in `docs_overview` Response |

All existing requirements in each main spec were preserved. Total 8 new requirements across 3 domains.

## Verification Results

**Verdict**: PASS WITH WARNINGS

- **Critical issues**: 0 (no blockers)
- **Warning findings**: 3, of which **2 were closed before archiving** and 1 remains an accepted scoping gap.
  - **M3 — CLOSED**: per-document embed-before-upsert atomicity now has a regression test. `test/application/sync-index.test.ts` records the order of `embed` and `upsertDocument` calls and fails if a document is committed without its vectors.
  - **W2 — OPEN, ACCEPTED**: no literal `compendio serve` subprocess/end-to-end test for the startup sync scenario. Deliberate scoping gap per `design.md`.
  - **W3 — CLOSED**: `test/server.test.ts` now covers the `maybeSync()` wiring on all three MCP tools, not just `docs_overview`.

Production code was NOT changed to close M3 and W3 — both were pure coverage gaps, and the shipped behavior was already correct. Only tests were added.

**Test evidence** (final state, after both gaps were closed):
- npm test: 213/213 passed across 23 files
- npm run typecheck: clean
- npm run build: clean
- git diff --stat: 20 files changed in `src/`+`test/`, 1804 insertions(+), 76 deletions(-)

**Mutation evidence.** Every load-bearing line was broken on purpose and confirmed to turn a test red, then restored — the scheduler's in-flight dedupe, `inFlight` cleanup in `finally`, the `erroresLectura` subtree prefix rule, the resolver-rejection delete, the vector-reconciliation hash-match filter, embed-before-upsert ordering, and the `maybeSync()` wiring on each of the three MCP tools.

Three of those gaps were found *after* the suite was already green: the reconciliation hash-match filter, embed-before-upsert atomicity, and `maybeSync()` on `search_docs`/`read_doc` could each be deleted outright without a single test failing. Passing tests were not evidence of coverage; deliberately breaking the code was. Worth repeating on the next change of this size.

## Design Resolutions

All 5 judgment-day resolutions honored in the final implementation:

1. **No PRAGMA user_version gate** — withdrawn by user; startup() unconditionally calls syncIndex.execute()
2. **No ultimoIntentoFallido field** — dropped; sync failures are stderr-only
3. **erroresLectura subtree prefix rule** — implemented; directory-level read failures protect subtrees
4. **Chunk-granular idempotent vector reconciliation** — implemented via listChunksMissingVectors + replaceEmbeddings
5. **Concurrency guarantee narrowed to per-document atomicity** — implemented; no pass-level snapshot guarantee

## Architectural Compliance

All CLAUDE.md invariants confirmed:
- Domain purity: no infrastructure imports in src/domain/
- Ports-first: SyncIndex/SyncScheduler depend only on port interfaces
- saveEmbeddings unchanged: INSERT-only, full-rebuild path untouched (29-test approval-test passed)
- FTS5 external-content 'delete' form: used correctly per spec
- chunks_vec keys are BigInt: consistent with saveEmbeddings precedent

## Delivery Notes

**Accepted limitations** (carried into merged specs for future reference):

1. **Old-version index not detected or migrated**: An index file created by a prior compendio version with different schema (e.g., NOT NULL tipo/modulo/estado) will not auto-upgrade. Remedy: delete `.compendio/` or run `compendio index` once. This is an accepted risk given compendio's beta status and minimal installed base.

2. **Whole-pass sync failure stderr-only**: If a full incremental sync pass fails, the error is logged to console.error() and `lastReport` remains untouched (the agent sees no change via docs_overview). This is documented and accepted per the product decision to withdraw ultimoIntentoFallido.

3. **No end-to-end serve test**: The "Startup sync catches offline edits" scenario is proven by decomposed unit layers (SyncScheduler unit test, source-level wiring in cli.ts, SyncIndex tested independently) but has no literal `compendio serve` subprocess test. This is a design-accepted scoping gap.

All three are explicitly noted in the archived state.yaml and design.md, and do not block this archive.

## Task Completion Gate

Before archiving, the persisted tasks artifact was inspected:
- **File**: `openspec/changes/incremental-reindex/tasks.md`
- **Result**: All 39 implementation tasks marked `[x]`
- **Verification**: Task completion matches actual code state (every file listed in apply-progress.md present in diff, nothing extra/missing)
- **Status**: ✅ PASS — gate permits archive

## Mutation Testing (Independent)

Performed 4 mutations during verification against the real source; 2 caught real correctness points, 2 exposed test gaps (non-blocking):

| Mutation | Caught? | Implication |
|----------|---------|-------------|
| M1: Remove in-flight dedupe check in SyncScheduler.maybeSync() | ✅ YES | Confirmed race correctness |
| M2: Remove "delete stale row" branch for resolver rejection | ✅ YES | Confirmed deletion on estricto rejection |
| M3: Reorder upsertDocument to commit chunks BEFORE embeddings | ❌ NO | Caught no regression (shipped code correct, test gap only) |
| M4: Remove maybeSync() call from search_docs handler | ❌ NO | Caught no regression (shipped code correct, test gap only) |

All mutations reverted; final state byte-identical to pre-verification (git diff --stat confirmed).

## Archive Contents

Moved from `openspec/changes/incremental-reindex/` to `openspec/changes/archive/2026-07-24-incremental-reindex/`:

- ✅ proposal.md
- ✅ design.md
- ✅ tasks.md (all 39 tasks marked complete)
- ✅ specs/ (3 delta specs: indexing, configuration, mcp-contract)
- ✅ state.yaml
- ✅ apply-progress.md
- ✅ verify-report.md

All artifacts preserved as-is; no deletions or truncations.

## Source of Truth Updated

Main specs now reflect all new behavior from this change:

- `openspec/specs/indexing/spec.md` — 6 new requirements, 16 new scenarios
- `openspec/specs/configuration/spec.md` — 1 new requirement, 3 new scenarios
- `openspec/specs/mcp-contract/spec.md` — 1 new requirement, 3 new scenarios

These specs are the canonical source of truth for the incremental-reindex feature going forward.

## SDD Cycle Complete

This change has completed all six SDD phases:
1. **Explore** ✅ — 5 critical findings and product decisions surfaced
2. **Propose** ✅ — approach, risks, rollback, and binding decisions documented
3. **Spec** ✅ — 8 requirements across 3 domains, all-ADDED delta specs
4. **Design** ✅ — 5 architecture decisions, 14 judgment-day findings fixed across 3 iterations
5. **Apply** ✅ — 3 phases, 39 tasks, Strict TDD, all tests green
6. **Verify** ✅ — PASS WITH WARNINGS, all judgment-day resolutions honored, all architectural invariants confirmed, 4 independent mutations run
7. **Archive** ✅ — specs merged, change folder moved, audit trail closed

Ready for the next change.
