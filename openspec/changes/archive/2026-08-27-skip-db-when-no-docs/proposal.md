# Proposal: Skip Database Creation When No Documents Exist

## Intent

Compendio creates `.compendio/compendio.db` during container construction, before any document discovery. Every command leaves database artifacts even when the project has no `docs` folder, an empty one, or declared `docsDir` roots that are missing or empty. A zero-document project should leave zero artifacts.

## Scope

### In Scope

- Lazy `SqliteIndexStore`: no directory or file creation until the first write operation.
- Reads (`search`, `overview`, `read_doc`, sync's `listDocuments`) against a nonexistent DB return well-formed empty results instead of throwing.
- Early exit in `IndexDocuments`, `SyncIndex`, and `GenerateIndexMd` when discovery yields zero files.
- `reset()` clears stale data when the DB already exists; never creates one when it does not.
- `compendio serve` starts without docs; tools respond with well-formed empty results.

### Out of Scope

- Deleting a pre-existing `.compendio/` (no cleanup of prior artifacts).
- Changing the "no readable root" discovery error for `index` (it still errors — just without the DB side effect).
- `eval` behavior beyond not creating the DB (zero-result metrics are acceptable).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `indexing`: DB is created on first write; a full reindex of an empty corpus resets an existing DB but never creates one; the "No database file needs no special-casing" scenario is scoped to non-empty corpora.
- `search`: queries against a project with no index return empty results, not an error.
- `mcp-contract`: `serve` without docs starts normally; all three tools return well-formed empty responses.
- `index-md`: zero discovered documents skips the `INDEX.md` write (reports 0 documents, no file created).

## Approach

Lazy store + early exit (exploration Approach 5). The constructor does no filesystem work; a private `ensureInitialized()` performs `mkdirSync` + `open()` at first write. Read methods short-circuit to empty results while uninitialized. Use cases exit early after discovery when `files.length === 0` (sync additionally requires nothing pending deletion). The composition root and `Container` interface stay unchanged.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/infrastructure/sqlite/sqlite-index-store.ts` | Modified | Defer mkdir/open; empty reads while uninitialized |
| `src/application/index-documents.ts` | Modified | Zero-file early exit; guarded `reset()` |
| `src/application/sync-index.ts` | Modified | Early exit when nothing to upsert or delete |
| `src/application/generate-index-md.ts` | Modified | Skip `INDEX.md` write on zero documents |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stale data survives reindexing an empty corpus | Med | `reset()` still runs when the DB file exists |
| An uninitialized read path throws | Med | Every read method short-circuits; per-command tests |
| Lazy init mid-session (docs added after `serve` start) | Low | First write initializes; normal path thereafter |
| Concurrent initialization race | Low | `mkdirSync(recursive)` + `CREATE TABLE IF NOT EXISTS` are idempotent |

## Rollback Plan

Revert the change's commits. Eager creation returns; nothing is migrated or cleaned up, since lazy creation never modifies an existing database.

## Dependencies

None.

## Success Criteria

- [ ] `index`, `sync`, `index-md`, `search`, `overview`, and `serve` on missing or empty roots create no `.compendio/`
- [ ] A full reindex of an empty corpus with an existing DB leaves it empty of rows
- [ ] Reads with no DB return empty results (CLI and MCP) without erroring
- [ ] `npm test` and `npm run typecheck` green; existing-corpus behavior unchanged
