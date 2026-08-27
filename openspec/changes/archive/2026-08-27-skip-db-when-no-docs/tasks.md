# Tasks: Skip Database Creation When No Documents Exist

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 350–500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Lazy SQLite lifecycle and discovery semantics | PR 1 | Store, filesystem adapters, focused unit tests |
| 2 | Empty-work use cases and CLI behavior | PR 2 | Depends on PR 1; application/integration tests included |
| 3 | Serve/read regressions and full verification | PR 3 | Depends on PR 2; MCP and regression suite |

## Phase 1: Infrastructure — Lazy SqliteIndexStore

- [x] 1.1 **RED:** Extend `test/infrastructure/sqlite-index-store.test.ts` for inert construction, empty uninitialized reads, first-write creation, safe unopened `close()`, `:memory:`, and reset no-create/clear semantics.
- [x] 1.2 **GREEN:** Modify `src/infrastructure/sqlite/sqlite-index-store.ts` with nullable lazy connection, `databaseExists()`/`ensureOpen()`, read short-circuits, write initialization, no-op reset/delete when absent, and safe close; update `src/domain/ports.ts` contract docs.
- [x] 1.3 **RED/GREEN:** Add root ENOENT cases to `test/infrastructure/file-document-source.test.ts` and `test/infrastructure/composite-document-source.test.ts`; update `src/infrastructure/fs/file-document-source.ts` so missing roots are empty while genuine failures retain existing all-fail behavior.
- [x] 1.4 Update `src/infrastructure/fs/file-index-writer.ts` to create its target directory before writing; cover missing-root writes in `test/infrastructure/file-index-writer.test.ts`.

## Phase 2: Core — Empty-Work Use Cases and Discovery

- [x] 2.1 **RED/GREEN:** In `src/application/index-documents.ts`, return the empty report after discovery while invoking `reset()` only to clear an existing DB; preserve read-error reporting and progress semantics in `test/application/index-and-search.test.ts` and focused application tests.
- [x] 2.2 **RED/GREEN:** In `src/application/sync-index.ts`, return an empty report before capability checks when `files.length === 0` and `existing.length === 0`; retain deletion/protection behavior for existing rows and validate in `test/application/sync-index.test.ts`.
- [x] 2.3 Confirm `src/application/generate-index-md.ts`, `src/application/search-documents.ts`, `src/application/get-overview.ts`, and `src/application/read-document.ts` use store empty short-circuits without DB creation; add/adjust empty behavior tests as needed.

## Phase 3: Integration — CLI and Serve Behavior

- [x] 3.1 Update `src/cli.ts` to report successful `index` runs with "nothing to index"; ensure `search`, `overview`, and `eval` with no DB exit 0, with eval producing zero metrics.
- [x] 3.2 Update the stale lifecycle comment in `src/composition.ts`; verify unchanged wiring, startup sync, and `close()` behavior through `test/composition.test.ts` and `test/application/sync-scheduler.test.ts`.
- [x] 3.3 Keep `index-md` header-only at the first declared root and DB-free; test missing/empty roots and stale-DB independence in `test/application/generate-index-md.test.ts`.

## Phase 4: Testing — Contract and Regression Verification

- [x] 4.1 Add no-DB CLI subprocess coverage in `test/cli-subprocess.test.ts` for missing/empty roots, artifact absence, "nothing to index," empty search/overview, and zero-metric eval.
- [x] 4.2 Add no-docs MCP coverage in `test/server.test.ts`: serve starts, `docs_overview` has zero documents/buckets, `search_docs` has normal mode plus `results: []`, and `read_doc` returns path-not-found with no matches.
- [x] 4.3 Run `npm test`, `npm run typecheck`, and `npm run build`; audit eager-creation assumptions in `test/infrastructure/sqlite-index-store-degraded.test.ts` and existing-corpus integration tests.
