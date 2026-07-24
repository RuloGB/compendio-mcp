# Delta for Indexing

## ADDED Requirements

### Requirement: Fingerprint-Based Incremental Diff

For each incremental sync pass, the system MUST diff the documents discovered on disk against `listDocuments()`, keyed by `ruta`, using the persisted `hash` (SHA-256 of raw file content) as the sole change fingerprint. A discovered file whose `ruta` is unknown to the index, or whose recomputed `hash` differs from the stored value, MUST be (re)indexed. A `ruta` present in the index but absent from the discovered corpus MUST be deleted — EXCEPT a `ruta` protected by that pass's `erroresLectura` (see "Read Failures Protect the Affected `ruta` Subtree From Deletion"), which MUST be excluded from the delete-candidate set: its existing indexed row, if any, is retained as-is, and the failure is reported in `omitidos` instead.

Documents whose `ruta` and `hash` both match MUST NOT be re-parsed or re-chunked, and MUST NOT be re-embedded either — UNLESS one or more of that document's indexed chunks has no corresponding `chunks_vec` row while the embeddings provider is operational for this pass (a vector-coverage gap, e.g. left by an interruption between committing chunks and generating their embeddings, or by prior embeddings-provider degradation). Vector coverage MUST be evaluated per chunk, not per document: the full-rebuild path embeds in batches that span document boundaries, so an interrupted run can leave a single document with some chunks vectorized and others not. For a document with such a gap, ONLY the chunks actually missing a vector are embedded and their vectors written, without re-parsing or re-chunking the document; the write MUST be idempotent, so a chunk that already holds a vector row is neither duplicated nor allowed to fail the pass. If the embeddings provider is still unavailable, such chunks MUST be left as-is (lexical-only) for this pass. A renamed file (same content, new path) MUST be treated as a delete of the old `ruta` plus an insert of the new one — no rename lineage is preserved.

#### Scenario: New or changed file is (re)indexed

- GIVEN a discovered file whose `ruta` is unknown to the index, or whose recomputed `hash` differs from the stored value
- WHEN an incremental sync pass runs
- THEN the file is parsed, chunked, embedded, and reflected in subsequent search/overview results

#### Scenario: Unchanged, fully vectorized file is left untouched

- GIVEN a discovered file whose recomputed `hash` matches the stored `hash` for its `ruta`, and every one of its indexed chunks already has a `chunks_vec` row
- WHEN an incremental sync pass runs
- THEN it is not re-parsed, re-chunked, or re-embedded

#### Scenario: Partially vectorized document has only its missing chunks embedded

- GIVEN an indexed document whose `hash` matches the discovered file, where SOME of its chunks have `chunks_vec` rows and others do not, and the embeddings provider is available for this pass
- WHEN an incremental sync pass runs
- THEN only the chunks lacking a vector are embedded and written, the chunks that already had one are neither re-embedded nor duplicated, the document is not re-parsed or re-chunked, and the pass does not fail on the already-covered chunks

#### Scenario: Vector gap persists while the provider is unavailable

- GIVEN an indexed document whose `hash` matches the discovered file, some of whose chunks have no `chunks_vec` row, and the embeddings provider is unavailable for this pass
- WHEN an incremental sync pass runs
- THEN those chunks are left as-is (lexical-only), matching the existing graceful-degradation convention, and are reconsidered on a future pass once the provider is available again

#### Scenario: Vector table has never been created

- GIVEN a project whose embeddings provider has never once succeeded, so no `chunks_vec` table exists in the database
- WHEN an incremental sync pass runs
- THEN vector-coverage reconciliation is a no-op for that pass — it reports no gap and raises no error — and the pass completes normally in lexical-only terms

#### Scenario: Deleted file is removed

- GIVEN a `ruta` present in `listDocuments()` with no corresponding file on disk
- WHEN an incremental sync pass runs
- THEN the document, its chunks, and its embeddings are removed from the index

#### Scenario: Rename is delete-plus-insert

- GIVEN a file moved from `docs/old.md` to `docs/new.md` with unchanged content
- WHEN an incremental sync pass runs
- THEN `docs/old.md` is deleted and `docs/new.md` is indexed as a new document, with no lineage preserved between them

#### Scenario: Transient read failure does not delete an existing document

- GIVEN an indexed `ruta` whose file fails to read during this pass (a transient error — e.g. an editor lock or IO hiccup) and is reported in `erroresLectura`
- WHEN an incremental sync pass runs
- THEN that `ruta` is excluded from the delete-candidate set, its existing indexed row is retained as-is, and the failure is reported in `omitidos`

### Requirement: Resolver Rejection on a Changed Known Document Deletes the Stale Row

When `convencion.modo: "estricto"` is active and a `ruta` already present in the index has a changed `hash` but its new content fails `policy.resolver()`, the incremental sync pass MUST delete that document's stale row (`deleteDocument(ruta)`) and report the file in `omitidos`, rather than leaving the prior, now-outdated indexed content being served indefinitely. A `ruta` that is new to the index (never previously indexed) and fails `policy.resolver()` MUST be skipped without indexing, exactly as `IndexDocuments` does today — no deletion applies, since there is no prior row to remove.

#### Scenario: Changed known document fails resolution and its stale row is deleted

- GIVEN a `ruta` already indexed under `convencion.modo: "estricto"`, whose recomputed `hash` differs from the stored value and whose new content fails `policy.resolver()`
- WHEN an incremental sync pass runs
- THEN the document's existing row, chunks, and embeddings are deleted, the file is reported in `omitidos`, and it no longer appears in search or overview results

#### Scenario: New document failing resolution is a plain skip

- GIVEN a `ruta` with no prior indexed row, whose content fails `policy.resolver()` under `convencion.modo: "estricto"`
- WHEN an incremental sync pass runs
- THEN the file is skipped and reported in `omitidos`, with no document created and nothing to delete

### Requirement: Per-Document Upsert and Delete Without Orphaning or FTS Desync

The `IndexStore` port MUST provide operations to delete a single document by `ruta` and to (re)index a single document, both of which MUST leave `chunks`, `chunks_fts`, and `chunks_vec` consistent. Deletion MUST NOT rely on `ON DELETE CASCADE` alone (the connection never enables `PRAGMA foreign_keys`); it MUST explicitly remove the document's dependent `chunks` rows, plus their `chunks_fts` and `chunks_vec` rows, using the FTS5 external-content `'delete'` command form for `chunks_fts` rather than a plain `DELETE`.

#### Scenario: Deleting a document leaves no orphans

- GIVEN an indexed document with chunks, FTS rows, and vector rows
- WHEN that document is deleted by `ruta`
- THEN no `chunks`, `chunks_fts`, or `chunks_vec` rows referencing it remain, and lexical search returns no hits from its former content

#### Scenario: Re-indexing a changed document has no duplicates

- GIVEN a document already indexed under a given `ruta`
- WHEN it is re-indexed after a content change
- THEN its old chunks, FTS rows, and vector rows are fully replaced, with no stale or duplicate rows for that `ruta`

### Requirement: Incremental Sync Triggers — Startup and Throttled Pre-Tool-Call Check

`compendio serve` MUST run one incremental sync pass at startup, before answering any tool call. The three MCP tool handlers (`docs_overview`, `search_docs`, `read_doc`) MUST share a single pre-call hook that runs at most one incremental sync pass per throttle window (see Configuration spec); calls within the same window MUST reuse the already-current index without triggering another diff.

#### Scenario: Startup sync catches offline edits

- GIVEN a corpus changed since the last `compendio index` run
- WHEN `serve` starts
- THEN the startup sync pass indexes the changes before the first tool call is answered

#### Scenario: Throttle window gates repeated calls

- GIVEN a tool call arrives within the throttle window since the last sync pass, and a later call arrives after that window has elapsed
- WHEN both calls are handled
- THEN the first reuses the current index with no new diff, and the second triggers a fresh sync pass before being answered

#### Scenario: No database file needs no special-casing

- GIVEN no `.compendio/compendio.db` file exists yet
- WHEN `serve` starts
- THEN `migrate()` creates the current schema and the startup sync pass indexes every discovered document as new, with no additional branch for the empty-index case

### Requirement: Read Failures Protect the Affected `ruta` Subtree From Deletion

`DocumentSource.discover()` MUST report a failure to read a directory below the docs root in `erroresLectura`, instead of silently returning as it does today. Every file beneath a directory that failed to be read is absent from `files` for that pass, so an unreported directory failure would make the incremental diff treat that entire subtree as deleted.

For every entry in `erroresLectura`, an incremental sync pass MUST exclude from that pass's delete-candidate set both the reported `ruta` itself and every indexed `ruta` beneath it (prefix `<ruta>/`), MUST retain those existing rows as-is, and MUST report the failure in `omitidos`. A failure to read the ROOT docs directory MUST still throw, unchanged — an unreadable docs root is a configuration error, not a transient per-subtree hiccup.

#### Scenario: Unreadable subdirectory does not delete its documents

- GIVEN indexed documents under `guias/` and a `readdir` failure on that subdirectory during a pass (e.g. a Windows permissions hiccup or a network-share blip)
- WHEN an incremental sync pass runs
- THEN the directory failure is reported in `erroresLectura`, every indexed `ruta` under `guias/` is excluded from the delete-candidate set and retained as-is, and the failure is reported in `omitidos`

#### Scenario: Unreadable docs root still throws

- GIVEN the configured docs directory itself cannot be read
- WHEN discovery runs
- THEN it throws, exactly as it does today, rather than reporting an empty corpus

### Requirement: In-Process Incremental Sync Concurrency Guarantee

Within a single `serve` process, every individual SQLite call is synchronous and cannot be interleaved by other JavaScript, and each document's teardown-plus-insert MUST run inside ONE transaction. The guarantee this provides is PER-DOCUMENT atomicity: a reader MUST never observe a partially-written document — no chunks without their `documents` row, no `chunks_fts` desynced from `chunks`, no mix of pre-change and post-change chunks for the same `ruta`.

This is explicitly NOT a pass-level snapshot. A sync pass awaits the embeddings provider between documents, and a tool handler may itself await mid-request (`search_docs`'s vector leg does), so a single call MAY resume mid-pass and reflect some of that pass's documents but not others. This in-process guarantee is additional to, and does not replace, the existing non-goal for concurrent access from a separately-running `compendio index` process (see "Concurrent Readers During `compendio index` Are Out of Scope").

#### Scenario: No partially-written document is ever observed

- GIVEN an incremental sync pass writing a changed document
- WHEN a tool handler reads the index
- THEN it observes that document either entirely in its pre-sync state or entirely in its post-sync state, never a mix of its old and new chunks and never chunks whose `documents` row is missing

#### Scenario: A single call may straddle a sync pass

- GIVEN a tool call that yields to the event loop mid-request (e.g. awaiting the embeddings provider) while a sync pass is running
- WHEN it resumes and completes
- THEN its response is not guaranteed to reflect the whole pass — some documents may be pre-sync and others post-sync — while every individual document it does reflect is internally consistent

#### Scenario: External `compendio index` non-goal still applies

- GIVEN `serve` is running with in-process incremental sync active
- WHEN a user separately runs `compendio index` from another OS process
- THEN the existing external-process non-goal (transient empty results/errors during that run's `reset()` transaction) still applies unchanged
