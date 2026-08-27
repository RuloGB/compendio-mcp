# Design: Skip Database Creation When No Documents Exist

## Technical Approach

Exploration Approach 5: `SqliteIndexStore` becomes lazy (no filesystem work in the constructor; open on demand) and write-side use cases exit early when discovery finds nothing. Reads never create: they return well-formed empties when the DB file is absent and open an existing DB otherwise. No port signatures change; `createContainer`, `Container` and all consumers stay unchanged. User answers override the proposal: index-md header-only, missing-root `index` success, zero-metric `eval`.

## Architecture Decisions

Chosen option in **bold**.

| Decision | Options | Rationale |
|----------|---------|-----------|
| Location of laziness | **(a)** inert constructor + `ensureOpen()`; (b) move store construction out of `createContainer`; (c) discovery gate in the container | (b) breaks the sync composition root; (c) needs an async container. Laziness is an adapter detail. |
| Read short-circuit | (a) `initialized` flag only; **(b)** file-existence check | Must still open a DB left by a previous run. Short-circuit = not open AND file absent AND not `:memory:`. |
| `reset()` semantics | **(a)** store contract "never creates"; (b) guard in `IndexDocuments` | No database ⇒ nothing to drop. File exists ⇒ open + drop/recreate, so stale rows still clear on an empty reindex. |
| Missing root (ENOENT) | **(a)** silent zero files; (b) keep `ReadError`, exclude from all-fail throw | Per spec. Sync then purges docs under a missing root (same semantics as removing it from `docsDir`); genuine I/O errors keep subtree protection. |
| index-md, zero docs | **(a)** header-only write, as today; (b) skip | User decision. `FileIndexWriter` mkdirs the first root when absent. |
| Empty sync pass | **(a)** early return when `files = 0 ∧ existing = 0`; (b) let the flow run | (b) reaches `canPersistVectors()`, which must open the DB. The exit still maps `readErrors` to `skipped`. |
| `canPersistVectors()` uninitialized | **(a)** open the store; (b) optimistically `true` | (b) risks the silent vector drop the port contract warns about. Reachable only when files were discovered. |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/infrastructure/sqlite/sqlite-index-store.ts` | Modify | Inert constructor; nullable `db`; private `ensureOpen()`/`databaseExists()`; reads short-circuit to empty when the file is absent; `reset()`/`deleteDocument()` no-op there; `close()` safe unopened |
| `src/application/index-documents.ts` | Modify | Zero-file early exit: `store.reset()` (clears stale rows if DB exists), empty report (`readErrors` → `skipped`) |
| `src/application/sync-index.ts` | Modify | Early exit with empty `SyncReport` when `files = 0 ∧ existing = 0`, before `PassState`/`canPersistVectors()` |
| `src/infrastructure/fs/file-document-source.ts` | Modify | Root `readdir` ENOENT → zero files (no throw, no `readError`); other root errors throw as today |
| `src/infrastructure/fs/file-index-writer.ts` | Modify | `mkdir` before `writeFile` (first root may not exist) |
| `src/cli.ts` | Modify | `index` prints "nothing to index" when `indexed.length === 0` |
| `src/domain/ports.ts` | Modify (docs only) | `reset()`: "no-op when the database file does not exist" |
| `src/composition.ts` | Modify (comment only) | Update stale `migrate()` side-effect note |

Unchanged: `server.ts`, `sync-scheduler.ts`, search/overview/read/eval/index-md — empty behavior falls out of the store short-circuits.

## Command Behavior (no docs / no DB)

| Command | Behavior |
|---------|----------|
| `index` | Success, "nothing to index"; existing DB with rows still reset |
| `sync` | Empty report; existing DB: missing docs purged (unchanged) |
| `index-md` | Header-only `INDEX.md`; first root created if absent |
| `search` / `overview` / `eval` | Well-formed empty / zero metrics, exit 0 |
| `serve` | Clean startup pass; all tools well-formed empty |

## Interfaces / Contracts

No new methods or signatures. Uninitialized reads return empty (`[]`/`null`/empty `Map`/`false`); `close()` no-ops unopened (`withContainer` always closes); `:memory:` counts as "exists", keeping test semantics.

## Testing Strategy

| Layer | What to test | Approach |
|-------|-------------|----------|
| Unit | Lazy store lifecycle: inert constructor, empty reads, first-write creation, reset no-create vs clear, close unopened, `:memory:` unchanged | Extend `sqlite-index-store.test.ts`; temp dirs + `existsSync` |
| Unit | ENOENT root → zero files; genuine failure still throws; all roots missing → success | Extend `composite-document-source.test.ts` + `file-document-source` cases |
| Unit | Zero-file `IndexDocuments`/`SyncIndex` early exits; existing-DB reset/purge paths | Application tests, fake sources + real store |
| Integration | No-DB CLI: every command exits 0 well-formed, no `.compendio/` created | Container-level tests in a temp project |
| Integration | No-docs `serve`: clean startup, tools well-formed empty | Extend `server.test.ts` |
| Regression | Full `npm test` + `typecheck`; audit tests assuming eager creation | Full suite |

## Migration / Rollout

No migration required: pre-existing databases open lazily on first use. Rollback: revert — eager creation returns and nothing needs cleanup (lazy creation never modifies an existing database).

## Open Questions

None.
