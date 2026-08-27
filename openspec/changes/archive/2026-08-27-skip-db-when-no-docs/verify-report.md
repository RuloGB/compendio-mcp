# Verification Report

**Change**: `skip-db-when-no-docs`
**Mode**: Standard (Strict TDD not active)
**Planning mode**: `openspec`
**Verification date**: 2026-08-27

## Completeness

| Metric | Value |
|---|---:|
| Tasks total | 13 |
| Tasks complete | 13 |
| Tasks incomplete | 0 |

All implementation tasks in `tasks.md` are marked `[x]`.

## Build, Tests, and Coverage Evidence

### Tests

Command: `npm test`

```text
Test Files  50 passed (50)
Tests       870 passed (870)
Duration    21.74s
Exit code   0
```

### Typecheck

Command: `npm run typecheck`

```text
> tsc --noEmit && tsc -p tsconfig.test.json
Exit code 0
```

### Build

Command: `npm run build`

```text
> tsc
Exit code 0
```

### Coverage

No coverage command or threshold is configured for this project. ➖ Not available.

## Spec Compliance Matrix

Status meanings: ✅ `COMPLIANT` means a covering test passed; ⚠️ `PARTIAL` means runtime evidence covers only part of the scenario; ❌ `UNTESTED` means no covering test was found.

| Requirement | Scenario | Test evidence | Result |
|---|---|---|---|
| Lazy Database Creation and Empty Reindex | Missing root is empty index work | `test/cli-subprocess.test.ts` — “index with missing root exits 0…” | ✅ COMPLIANT |
| Lazy Database Creation and Empty Reindex | Empty reindex clears stale rows | `test/infrastructure/sqlite-index-store.test.ts` — “reset() clears stale rows…”; no end-to-end empty `IndexDocuments` reindex with a pre-existing DB | ⚠️ PARTIAL |
| Lazy Database Creation and Empty Reindex | First discovered write initializes the store | `test/infrastructure/sqlite-index-store.test.ts` — “first write creates the database file and directory” | ✅ COMPLIANT |
| Incremental Sync Triggers | Startup sync catches offline edits | `test/application/sync-scheduler.test.ts` — startup/throttle tests; `test/cli-subprocess.test.ts` — S3 sync edit/search scenario | ✅ COMPLIANT |
| Incremental Sync Triggers | Throttle window gates repeated calls | `test/application/sync-scheduler.test.ts` — throttle-window tests | ✅ COMPLIANT |
| Incremental Sync Triggers | Missing database with non-empty corpus initializes on write | `test/cli-subprocess.test.ts` — S6 “sync against a never-indexed project indexes the whole corpus” | ✅ COMPLIANT |
| Incremental Sync Triggers | Empty startup remains database-free | `test/application/sync-index.test.ts` — “empty-work early exit”; no test starts the actual server/scheduler with an empty filesystem | ⚠️ PARTIAL |
| Read Failures Protect Subtree | Unreadable subdirectory protects documents | `test/application/sync-index.test.ts` — subtree-protection tests | ✅ COMPLIANT |
| Read Failures Protect Subtree | Missing root succeeds with no work | `test/infrastructure/file-document-source.test.ts` — ENOENT returns zero files; `test/cli-subprocess.test.ts` — missing-root index | ✅ COMPLIANT |
| Read Failures Protect Subtree | One of several roots is missing | `test/infrastructure/composite-document-source.test.ts` — one root empty/one root with files | ✅ COMPLIANT |
| Read Failures Protect Subtree | One root has a genuine read failure | `test/infrastructure/composite-document-source.test.ts` — one root throws and other files remain | ✅ COMPLIANT |
| Read Failures Protect Subtree | Sole root with genuine read failure throws | `test/infrastructure/composite-document-source.test.ts` — single-root failure | ✅ COMPLIANT |
| Read Failures Protect Subtree | Every root has genuine read failure throws | `test/infrastructure/composite-document-source.test.ts` — aggregate all-root failure | ✅ COMPLIANT |
| Read Failures Protect Subtree | Failed root protects its alias subtree | `test/application/sync-index.test.ts` — Gate 4b alias subtree protection | ✅ COMPLIANT |
| Search Without an Index | Search with no database | `test/server.test.ts` and `test/cli-subprocess.test.ts` — empty search response | ✅ COMPLIANT |
| Search Without an Index | Filtered search with no database | `test/server.test.ts` — filtered `search_docs` handler with type/module/tags against no DB | ✅ COMPLIANT |
| Search Without an Index | CLI search with no database | `test/cli-subprocess.test.ts` — “search with no database exits 0…” | ✅ COMPLIANT |
| MCP Tools Without Documents | Server starts without docs | `test/server.test.ts` constructs a server/container, but does not exercise `serve` startup/scheduler readiness with no docs | ⚠️ PARTIAL |
| MCP Tools Without Documents | Empty overview is well formed | `test/server.test.ts` — zero documents and no fabricated buckets | ✅ COMPLIANT |
| MCP Tools Without Documents | Empty search is well formed | `test/server.test.ts` — normal mode and `results: []` | ✅ COMPLIANT |
| MCP Tools Without Documents | Unknown path is well-formed | `test/server.test.ts` — path-not-found response | ✅ COMPLIANT |
| Empty Discovery Writes INDEX.md | Empty default root writes header | `test/cli-subprocess.test.ts` — missing root header-only INDEX.md and no DB | ✅ COMPLIANT |
| Empty Discovery Writes INDEX.md | Missing first root still writes target | Same subprocess test verifies `docs/INDEX.md` is created | ✅ COMPLIANT |
| Empty Discovery Writes INDEX.md | Existing DB is not used for empty INDEX.md | `test/cli-subprocess.test.ts` — stale DB plus empty filesystem produces header-only `INDEX.md` | ✅ COMPLIANT |

**Compliance summary**: 20/23 scenarios fully compliant; 3 partial; 0 untested.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| Lazy store lifecycle | ✅ Implemented | Constructor avoids disk work for file-backed stores; writes call `ensureOpen()`, reads use `openIfExists()`. |
| Empty full index | ✅ Implemented | Empty discovery calls `reset()`, whose absent-file path is a no-op, then returns a lexical empty report. |
| Empty incremental sync | ✅ Implemented | `SyncIndex` checks discovered files and existing rows before capability checks or writes. |
| Missing-root semantics | ✅ Implemented | Root `ENOENT` becomes zero files; non-ENOENT root failures retain existing throw/protection behavior. |
| Header-only index-md | ✅ Implemented | Filesystem discovery drives generation; `FileIndexWriter` creates the target directory before writing. |
| Empty read behavior | ✅ Implemented | Missing DB reads return empty arrays/maps/null and do not create artifacts. |
| CLI behavior | ✅ Implemented | `index` reports “Nothing to index”; no-DB search/overview/eval paths remain successful. |

## Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Inert file-backed store constructor | ⚠️ With documented deviation | Followed for file-backed DBs. `:memory:` opens eagerly because it cannot be checked by file existence; tests preserve its prior semantics. |
| File-existence-aware reads | ✅ Yes | `openIfExists()` opens an existing DB while returning empty results for an absent one. |
| `reset()` never creates an absent DB | ✅ Yes | `reset()` returns before opening when the database file is absent and clears an existing DB. |
| Missing root maps to zero files | ✅ Yes | Only root `ENOENT` is converted; genuine root errors still participate in all-fail behavior. |
| Header-only INDEX.md on zero docs | ✅ Yes | Matches the user override and updated spec, rather than the original proposal. |
| Empty sync early exit | ✅ Yes | Avoids `canPersistVectors()` and therefore avoids DB initialization when there is no work. |
| `canPersistVectors()` behavior | ✅ Yes | Uninitialized file-backed stores report capability without opening/creating the DB. |
| Composition and port stability | ✅ Yes | Wiring/signatures remain unchanged; only lifecycle documentation was updated. |

## Issues Found

### CRITICAL

- None.

### WARNING

- The no-docs MCP test constructs the server and invokes handlers, but does not run the actual `serve` startup/scheduler path. The handler contract is covered; startup readiness is only indirectly supported.
- The stale-row reset behavior is tested at the store level, not through an end-to-end empty `IndexDocuments` execution.
- The file-backed inert-constructor design is intentionally not universal: `:memory:` remains eagerly opened. This is the documented deviation and does not create filesystem artifacts.

### SUGGESTION

- Add one subprocess/server startup test that exercises the actual `serve` scheduler readiness path with an empty filesystem.

## Verdict

**PASS WITH WARNINGS**

All 13 tasks are complete. The implementation passes build, typecheck, and the full 870-test suite. The two previously untested required scenarios now have passing runtime coverage. Three scenarios remain partial: actual `serve` startup/scheduler readiness with no docs, end-to-end empty `IndexDocuments` reset against a stale DB, and the intentional eager `:memory:` exception. No CRITICAL issues remain.
