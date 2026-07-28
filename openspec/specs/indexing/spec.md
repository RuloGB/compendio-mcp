# Delta for Indexing

## ADDED Requirements

### Requirement: Resilience Skip Reasons Apply in Both Modes

Independently of `convention.mode`, the system MUST report a file in `skipped` for any of three resilience reasons — the file is unreadable, the file fails markdown/frontmatter parsing, or the file yields zero indexable chunks after parsing/chunking ("the document has no indexable content") — and these three reasons apply identically under both `loose` and `strict`: the per-file unreadable/parse-failure containment sits ahead of any mode-specific metadata validation, so a file can be skipped for a resilience reason under `strict` exactly as it would under `loose`, before `strict`'s own taxonomy/presence checks ever run.

#### Scenario: I/O-unreadable file is skipped and the run continues, under strict too

- GIVEN a `.md` file that cannot be read (an I/O error occurs while reading its content)
- WHEN indexed under `strict`
- THEN the file is reported in `skipped` with its error message, and indexing continues with the remaining files — identically to how it would be handled under `loose`

#### Scenario: Malformed frontmatter fails to parse and the run continues

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse
- WHEN indexed under `loose`
- THEN the file is reported in `skipped` with its error message, and indexing continues with the remaining files

#### Scenario: Malformed frontmatter fails to parse and the run continues, under strict too

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse, and `convention.mode: "strict"` configured
- WHEN indexed under `strict`
- THEN the file is reported in `skipped` with its error message, and indexing continues with the remaining files — identically to how it would be handled under `loose`

#### Scenario: Document with no indexable content is skipped

- GIVEN a `.md` file that parses successfully but yields zero indexable chunks after chunking (e.g., an empty body)
- WHEN indexed under `loose` or `strict`
- THEN the file is reported in `skipped` with the reason "the document has no indexable content"

### Requirement: `loose` Mode Never Skips Files for Metadata Reasons

Under `convention.mode: "loose"` (the default), the convention policy (resolver) MUST NOT skip a file for missing, unknown, or absent `type`/`module`/`status` values.

#### Scenario: File with no frontmatter at all

- GIVEN a `.md` file with no frontmatter and no H1
- WHEN indexed under `loose`
- THEN the file is indexed successfully with `type`, `module`, and `status` absent

### Requirement: `strict` Mode Validates Declared Taxonomies Per Field, Independently

Under `convention.mode: "strict"`, the convention policy (resolver) MUST validate `type` and `status` independently against the project's declared `convention.types` and `convention.statuses`, respectively: when a taxonomy is declared for a field, its value MUST belong to that list; when a taxonomy is not declared for a field, that field falls back to presence-only validation (see the requirement below) rather than being rejected. `module` has no taxonomy of any kind — it MUST always be validated for presence only, regardless of what is or isn't declared for `type`/`status`. Files with a `type`/`status` value outside its declared taxonomy, or missing a required field, MUST be reported in `skipped`.

#### Scenario: Value outside declared taxonomy

- GIVEN `convention.types: ["guide"]`, a document with `type: "adr"`, and a valid `module`
- WHEN indexed under `strict`
- THEN the document is skipped and reported in `skipped`

#### Scenario: Mixed declaration — one taxonomy declared, the other not

- GIVEN `convention.types: ["guide"]` is declared and `convention.statuses` is not declared
- WHEN a document has `type: "guide"`, `status: "anything-non-empty"`, and a valid `module`
- THEN the document is accepted: `type` is validated against the declared list and `status` is accepted by presence only

### Requirement: `strict` Without a Declared Taxonomy Falls Back to Presence-Only Validation, Per Field

For each of `type`/`status`, when `convention.mode: "strict"` is set but that field's corresponding taxonomy (`convention.types`/`convention.statuses`) is not declared, the system MUST validate only that the field is present and non-empty; any non-empty value MUST be accepted. This fallback is evaluated independently per field — one taxonomy being declared does not affect the fallback for the other. `module` has no taxonomy to declare and MUST always follow this presence-only rule.

#### Scenario: Strict with no declared types, non-empty value

- GIVEN `convention.mode: "strict"` and no `convention.types` declared
- WHEN a document has `type: "anything"`
- THEN the document is accepted

#### Scenario: Strict with no declared types, missing value

- GIVEN `convention.mode: "strict"` and no `convention.types` declared
- WHEN a document has no `type` field (or an empty string)
- THEN the document is skipped and reported in `skipped`

#### Scenario: Strict, missing module

- GIVEN `convention.mode: "strict"` (`module` has no taxonomy and is always presence-only)
- WHEN a document has no `module` field (or an empty string), regardless of whether `type`/`status` are otherwise valid
- THEN the document is skipped and reported in `skipped`

### Requirement: `strict` Requires an H1 Title, With No Filename Fallback

Under `convention.mode: "strict"`, `title` MUST come from the document's H1 heading. A document with no H1 MUST be reported in `skipped`. The `loose` filename-humanization fallback MUST NOT apply under `strict` — `strict` performs no inference of any kind, only validation.

#### Scenario: Document with no H1 is skipped under strict

- GIVEN a document with no H1 heading, otherwise satisfying all declared `type`/`module`/`status` requirements
- WHEN indexed under `strict`
- THEN the document is skipped and reported in `skipped`, and `title` is NOT humanized from the filename

### Requirement: Field Inference in `loose` Mode

The system MUST infer `title` and `module` when not otherwise supplied, and MUST NOT invent `type`/`status`. A frontmatter field that is present but empty (an empty string, or YAML `null`) MUST be treated exactly as absent for `type`, `module`, and `status`: `type`/`status` stay absent, and `module` falls through to folder-segment inference.

| Field | Inference source | Fallback |
|---|---|---|
| `title` | First H1 | Humanized filename |
| `summary` | First paragraph | Unchanged existing behavior |
| `module` | First path segment under `docsDir` | Absent for root-level files |
| `type` | None | Absent unless frontmatter/mapping supplies it |
| `status` | None | Absent unless frontmatter/mapping supplies it |

#### Scenario: No H1 present

- GIVEN a `.md` file with no H1 heading
- WHEN indexed under `loose`
- THEN `title` is set to a humanized version of the filename

#### Scenario: Humanized filename, concrete example

- GIVEN a file at `docs/getting-started_with-search.md` with no H1
- WHEN indexed under `loose`
- THEN `title` resolves to `"Getting started with search"` (strip `.md`, replace `-`/`_` with spaces, collapse and trim whitespace, sentence-case the first letter)

#### Scenario: Empty-string frontmatter treated as absent

- GIVEN `docsDir: "docs"`, a file at `docs/auth/login.md`, and frontmatter `module: ""`
- WHEN indexed under `loose`
- THEN `module` resolves to `"auth"` via folder inference, not the empty string

#### Scenario: Empty type/status frontmatter treated as absent

- GIVEN a document with frontmatter `type: ""` and `status: null`
- WHEN indexed under `loose`
- THEN `type` and `status` are both absent, not empty strings

#### Scenario: `module` from folder segment

- GIVEN `docsDir: "docs"` and a file at `docs/auth/login.md`
- WHEN indexed under `loose`
- THEN `module` resolves to `"auth"`

#### Scenario: Root-level file has no module

- GIVEN `docsDir: "docs"` and a file at `docs/readme.md`
- WHEN indexed under `loose`
- THEN `module` is absent

#### Scenario: Frontmatter wins over inference

- GIVEN `docsDir: "docs"`, a file at `docs/auth/login.md`, and frontmatter `module: "identity"`
- WHEN indexed under `loose`
- THEN `module` resolves to `"identity"`, not `"auth"`

### Requirement: Optional Persisted Metadata

`DocumentMeta.type`/`.module`/`.status` MUST be optional strings, not closed unions. The corresponding SQLite columns MUST be nullable. Every `compendio index` run MUST guarantee the current schema — including against a database file created by a prior version with `NOT NULL` `type`/`module`/`status` columns — without requiring the user to manually delete `.compendio/`. The system MUST NOT provide separate migration tooling beyond this guarantee.

#### Scenario: Absent fields persist as NULL

- GIVEN a document indexed with no `type`
- WHEN the SQLite row is written
- THEN the `type` column is `NULL`

#### Scenario: Pre-existing database with the old NOT NULL schema is upgraded in place

- GIVEN a `.compendio/compendio.db` created by a prior version, with `NOT NULL` `type`/`module`/`status` columns
- WHEN `compendio index` runs against a corpus containing a frontmatter-less document
- THEN the schema is dropped and recreated with nullable columns, and the document is indexed successfully — with no manual deletion of `.compendio/` required

### Requirement: Concurrent Readers During `compendio index` Are Out of Scope

Concurrent access from another process (e.g. a long-lived `compendio serve`, or a concurrent CLI reader) while a `compendio index` run is in flight is a declared non-goal: it is OUT OF SCOPE / best-effort. Because `reset()`'s schema drop-and-recreate runs inside a single transaction, a concurrent reader MAY observe empty results or a transient error (e.g. "no such table") for the duration of that transaction; the single transaction minimizes but does not eliminate this window. The supported behavior for a concurrent reader is to re-run the query after the `compendio index` run completes.

#### Scenario: Concurrent reader during an in-flight index run

- GIVEN a long-lived `compendio serve` process (or another CLI reader) querying the index
- WHEN a separate `compendio index` run's `reset()` transaction is in flight
- THEN the concurrent reader MAY observe empty results or a transient error, and retrying the query after the `index` run completes MUST return correct results

### Requirement: Fingerprint-Based Incremental Diff

For each incremental sync pass, the system MUST diff the documents discovered on disk against `listDocuments()`, keyed by `path`, using the persisted `hash` (SHA-256 of raw file content) as the sole change fingerprint. A discovered file whose `path` is unknown to the index, or whose recomputed `hash` differs from the stored value, MUST be (re)indexed. A `path` present in the index but absent from the discovered corpus MUST be deleted — EXCEPT a `path` protected by that pass's `readErrors` (see "Read Failures Protect the Affected `path` Subtree From Deletion"), which MUST be excluded from the delete-candidate set: its existing indexed row, if any, is retained as-is, and the failure is reported in `skipped` instead.

Documents whose `path` and `hash` both match MUST NOT be re-parsed or re-chunked, and MUST NOT be re-embedded either — UNLESS one or more of that document's indexed chunks has no corresponding `chunks_vec` row while the embeddings provider is operational for this pass (a vector-coverage gap, e.g. left by an interruption between committing chunks and generating their embeddings, or by prior embeddings-provider degradation). Vector coverage MUST be evaluated per chunk, not per document: the full-rebuild path embeds in batches that span document boundaries, so an interrupted run can leave a single document with some chunks vectorized and others not. For a document with such a gap, ONLY the chunks actually missing a vector are embedded and their vectors written, without re-parsing or re-chunking the document; the write MUST be idempotent, so a chunk that already holds a vector row is neither duplicated nor allowed to fail the pass. If the embeddings provider is still unavailable, such chunks MUST be left as-is (lexical-only) for this pass. A renamed file (same content, new path) MUST be treated as a delete of the old `path` plus an insert of the new one — no rename lineage is preserved.

#### Scenario: New or changed file is (re)indexed

- GIVEN a discovered file whose `path` is unknown to the index, or whose recomputed `hash` differs from the stored value
- WHEN an incremental sync pass runs
- THEN the file is parsed, chunked, embedded, and reflected in subsequent search/overview results

#### Scenario: Unchanged, fully vectorized file is left untouched

- GIVEN a discovered file whose recomputed `hash` matches the stored `hash` for its `path`, and every one of its indexed chunks already has a `chunks_vec` row
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

- GIVEN a `path` present in `listDocuments()` with no corresponding file on disk
- WHEN an incremental sync pass runs
- THEN the document, its chunks, and its embeddings are removed from the index

#### Scenario: Rename is delete-plus-insert

- GIVEN a file moved from `docs/old.md` to `docs/new.md` with unchanged content
- WHEN an incremental sync pass runs
- THEN `docs/old.md` is deleted and `docs/new.md` is indexed as a new document, with no lineage preserved between them

#### Scenario: Transient read failure does not delete an existing document

- GIVEN an indexed `path` whose file fails to read during this pass (a transient error — e.g. an editor lock or IO hiccup) and is reported in `readErrors`
- WHEN an incremental sync pass runs
- THEN that `path` is excluded from the delete-candidate set, its existing indexed row is retained as-is, and the failure is reported in `skipped`

### Requirement: Resolver Rejection on a Changed Known Document Deletes the Stale Row

When `convention.mode: "strict"` is active and a `path` already present in the index has a changed `hash` but its new content fails `policy.resolver()`, the incremental sync pass MUST delete that document's stale row (`deleteDocument(path)`) and report the file in `skipped`, rather than leaving the prior, now-outdated indexed content being served indefinitely. A `path` that is new to the index (never previously indexed) and fails `policy.resolver()` MUST be skipped without indexing, exactly as `IndexDocuments` does today — no deletion applies, since there is no prior row to remove.

#### Scenario: Changed known document fails resolution and its stale row is deleted

- GIVEN a `path` already indexed under `convention.mode: "strict"`, whose recomputed `hash` differs from the stored value and whose new content fails `policy.resolver()`
- WHEN an incremental sync pass runs
- THEN the document's existing row, chunks, and embeddings are deleted, the file is reported in `skipped`, and it no longer appears in search or overview results

#### Scenario: New document failing resolution is a plain skip

- GIVEN a `path` with no prior indexed row, whose content fails `policy.resolver()` under `convention.mode: "strict"`
- WHEN an incremental sync pass runs
- THEN the file is skipped and reported in `skipped`, with no document created and nothing to delete

### Requirement: Per-Document Upsert and Delete Without Orphaning or FTS Desync

The `IndexStore` port MUST provide operations to delete a single document by `path` and to (re)index a single document, both of which MUST leave `chunks`, `chunks_fts`, and `chunks_vec` consistent. Deletion MUST NOT rely on `ON DELETE CASCADE` alone (the connection never enables `PRAGMA foreign_keys`); it MUST explicitly remove the document's dependent `chunks` rows, plus their `chunks_fts` and `chunks_vec` rows, using the FTS5 external-content `'delete'` command form for `chunks_fts` rather than a plain `DELETE`.

#### Scenario: Deleting a document leaves no orphans

- GIVEN an indexed document with chunks, FTS rows, and vector rows
- WHEN that document is deleted by `path`
- THEN no `chunks`, `chunks_fts`, or `chunks_vec` rows referencing it remain, and lexical search returns no hits from its former content

#### Scenario: Re-indexing a changed document has no duplicates

- GIVEN a document already indexed under a given `path`
- WHEN it is re-indexed after a content change
- THEN its old chunks, FTS rows, and vector rows are fully replaced, with no stale or duplicate rows for that `path`

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

### Requirement: Read Failures Protect the Affected `path` Subtree From Deletion

`DocumentSource.discover()` MUST report a failure to read a directory below the docs root in `readErrors`, instead of silently returning as it does today. Every file beneath a directory that failed to be read is absent from `files` for that pass, so an unreported directory failure would make the incremental diff treat that entire subtree as deleted.

For every entry in `readErrors`, an incremental sync pass MUST exclude from that pass's delete-candidate set both the reported `path` itself and every indexed `path` beneath it (prefix `<path>/`), MUST retain those existing rows as-is, and MUST report the failure in `skipped`. A failure to read the ROOT docs directory MUST still throw, unchanged — an unreadable docs root is a configuration error, not a transient per-subtree hiccup.

#### Scenario: Unreadable subdirectory does not delete its documents

- GIVEN indexed documents under `guides/` and a `readdir` failure on that subdirectory during a pass (e.g. a Windows permissions hiccup or a network-share blip)
- WHEN an incremental sync pass runs
- THEN the directory failure is reported in `readErrors`, every indexed `path` under `guides/` is excluded from the delete-candidate set and retained as-is, and the failure is reported in `skipped`

#### Scenario: Unreadable docs root still throws

- GIVEN the configured docs directory itself cannot be read
- WHEN discovery runs
- THEN it throws, exactly as it does today, rather than reporting an empty corpus

### Requirement: In-Process Incremental Sync Concurrency Guarantee

Within a single `serve` process, every individual SQLite call is synchronous and cannot be interleaved by other JavaScript, and each document's teardown-plus-insert MUST run inside ONE transaction. The guarantee this provides is PER-DOCUMENT atomicity: a reader MUST never observe a partially-written document — no chunks without their `documents` row, no `chunks_fts` desynced from `chunks`, no mix of pre-change and post-change chunks for the same `path`.

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
