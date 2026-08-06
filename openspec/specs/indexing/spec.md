# Delta for Indexing

## ADDED Requirements

### Requirement: Resilience Skip Reasons Apply in Both Modes

Independently of `convention.mode`, the system MUST report a file in `skipped` for any of four resilience reasons — the file is unreadable, the file's bytes are genuinely undecodable (neither valid UTF-8 nor plausibly CP1252), the file fails markdown/frontmatter parsing, or the file yields zero indexable chunks after parsing/chunking ("the document has no indexable content") — and these four reasons apply identically under both `loose` and `strict`: the per-file unreadable/parse-failure containment sits ahead of any mode-specific metadata validation, so a file can be skipped for a resilience reason under `strict` exactly as it would under `loose`, before `strict`'s own taxonomy/presence checks ever run. The undecodable-encoding message MUST be distinguishable from the plain "could not open the file" I/O message — they are different failures with different fixes — and undecodable content MUST NOT be transcoded under any fallback.
(Previously: three resilience reasons — unreadable, parse failure, no indexable content. Genuinely undecodable encoding is a fourth, added by `encoding-aware-reads`, with its own distinct message.)

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

#### Scenario: Genuinely undecodable content is skipped with a distinct message, never transcoded

- GIVEN a file whose bytes are neither valid UTF-8 nor plausibly CP1252 (e.g., binary content misnamed `.md`)
- WHEN it is discovered during indexing, under either `loose` or `strict`
- THEN it is reported in `skipped` with a message distinguishable from the generic "could not open the file" I/O error, and it is never transcoded or indexed

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

### Requirement: Encoding-Aware Decoding Before Content Reaches the Pipeline

Before a discovered file's bytes become a `DocumentFile.content` string, the system MUST decode them on evidence rather than assume UTF-8. Detection MUST proceed in this order: (1) sniff a byte-order mark identifying UTF-8, UTF-16LE, or UTF-16BE and decode accordingly; (2) when no BOM is present, decode as UTF-8 only when the bytes are exactly valid UTF-8; (3) when the bytes are not valid UTF-8, decode as CP1252 only when every byte maps to a defined CP1252 code point — including the `0x80–0x9F` range mapping to its assigned punctuation (curly quotes, en/em dash, ellipsis, etc.), never to a C1 control code and never to the code point Latin-1 would produce for that same byte. Detection coverage is limited to UTF-8, UTF-16-with-BOM, and CP1252; the system MUST NOT extend this to any other encoding by guessing. A file whose bytes are already valid UTF-8 MUST decode identically to current behavior and MUST NOT be reported as transcoded.

#### Scenario: CP1252 curly quotes, dash, and ellipsis decode correctly

- GIVEN a CP1252-encoded document containing curly quotes (`0x93`/`0x94`), an en dash (`0x96`), and an ellipsis (`0x85`)
- WHEN it is indexed
- THEN the decoded content contains the code points `U+201C`, `U+201D`, `U+2013`, `U+2026`, and zero `U+FFFD`

#### Scenario: CP1252 accented vowels decode correctly

- GIVEN a CP1252-encoded document containing only accented characters in `0xA0–0xFF` (e.g. `ó`)
- WHEN it is indexed
- THEN the decoded content contains the correct accented code points (e.g. `U+00F3`) and zero `U+FFFD`

#### Scenario: Valid UTF-8 is unaffected

- GIVEN a valid UTF-8 document
- WHEN it is indexed
- THEN it decodes exactly as it does today, and no transcoding notice is produced for it

#### Scenario: UTF-8 BOM is consumed

- GIVEN a UTF-8-encoded document with a leading byte-order mark
- WHEN it is indexed
- THEN the BOM is consumed and the remaining content decodes correctly

#### Scenario: UTF-16 BOM, little-endian and big-endian, decodes correctly

- GIVEN a UTF-16LE-encoded document and a UTF-16BE-encoded document, each with its byte-order mark present
- WHEN each is indexed
- THEN both decode to their correct string content

### Requirement: A Successfully Transcoded Document Is Always Reported

Whenever a document's bytes are not valid UTF-8 but are successfully decoded via BOM detection or the CP1252 fallback, the system MUST report that document as transcoded to every consumer of the index/sync report (`compendio index`, `compendio index-md`, and the sync pass feeding `docs_overview`) — even when the transcoded content is byte-for-byte the string a correct decoder would have produced anyway. The document MUST still be indexed normally and MUST NOT appear in `skipped`; a transcoded document is a reportable event, not a failure.

#### Scenario: A perfect transcode is still reported

- GIVEN a CP1252 document whose bytes decode via the fallback with no lossy substitution
- WHEN `compendio index` runs
- THEN the document is indexed successfully, does not appear in `skipped`, and the run's report still names it as transcoded

#### Scenario: The transcode notice reaches CLI output

- GIVEN a transcoded document reported by an `index` or `index-md` run
- WHEN the CLI prints its summary
- THEN a transcoding notice for that document's path is printed, alongside the existing `skipped`/`embeddingsWarning` warnings

### Requirement: Corrected Decoding Self-Heals via Incremental Sync

Because the change fingerprint (`computeHash(content)`) hashes the already-decoded string rather than the raw bytes (see "Fingerprint-Based Incremental Diff"), fixing this decoding defect for a previously mis-decoded document changes its stored hash even though the file's bytes on disk are unchanged. An incremental `serve` sync pass MUST therefore treat that document as changed and re-index it; no full `compendio index` MUST be required to apply corrected decoding to an already-indexed corpus. This is the inverse of "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents": there, bytes were unchanged and only chunking config moved, so the hash never changed and a full reindex was mandatory; here, bytes are unchanged but decoded output differs, so the hash does change and an incremental pass suffices.

#### Scenario: An incremental pass alone re-indexes a previously mis-decoded document

- GIVEN a document previously indexed under the old, UTF-8-only decoder, whose bytes on disk have not changed
- WHEN the encoding-aware decoder is deployed and an incremental `serve` sync pass runs
- THEN the document's recomputed content hash differs from its stored hash, so it is re-parsed, re-chunked, and re-embedded by that pass alone, with no full `compendio index` required

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

### Requirement: Chunk Size Is an Unconditional Upper Bound

No `Chunk` emitted by `chunkOutline` MUST exceed `chunk.maxTokens` (`estimateTokens(content) <= maxTokens`), on any of its three source paths: a document's intro before its first heading, a childless (leaf) H2 section, or an oversized H3 child section. `maxTokens` is a hard bound on every emitted piece, never a hint heading-based descent may exceed.

#### Scenario: Heading-less document is split into multiple bounded chunks

- GIVEN a markdown document with zero H2/H3 headings whose entire body exceeds `maxTokens`
- WHEN it is chunked
- THEN every emitted chunk's `estimateTokens(content)` is `<= maxTokens`, and together the chunks cover the full body

#### Scenario: Childless section exceeding the bound is split

- GIVEN an H2 section with no H3 children whose own text exceeds `maxTokens`
- WHEN it is chunked
- THEN it is split into multiple chunks, each within `maxTokens`, instead of emitted as one oversized chunk

#### Scenario: Oversized child section is split

- GIVEN an H2 section with H3 children where one child's own text (`sectionFullText`) exceeds `maxTokens`
- WHEN it is chunked
- THEN that child is split into multiple chunks, each within `maxTokens`

### Requirement: Split Preference Cascade With Guaranteed Fallback

A piece exceeding `maxTokens` MUST be split via a cascade of decreasing granularity: paragraph/line first, then sentence (only if a resulting piece still exceeds `maxTokens`), then word (only if sentence-level still exceeds it). Each finer level MUST run only on pieces still over the bound, so the split lands at the coarsest boundary that satisfies it — and the bound MUST still hold in the degenerate case of one paragraph/sentence/line with no smaller boundary above word granularity.

#### Scenario: Oversized section with multiple paragraphs splits at paragraph boundaries

- GIVEN a section exceeding `maxTokens` composed of multiple paragraphs, each individually within `maxTokens`
- WHEN it is split
- THEN the split occurs at paragraph boundaries and no sentence- or word-level split is needed

#### Scenario: A single oversized paragraph falls through to sentence-level splitting

- GIVEN a section whose entire content is one paragraph exceeding `maxTokens`
- WHEN it is split
- THEN the cascade falls through to sentence boundaries, and every resulting piece is within `maxTokens`

#### Scenario: A single oversized line falls through to word-level splitting

- GIVEN a piece whose entire content is one line/sentence exceeding `maxTokens` with no sentence boundary inside it
- WHEN it is split
- THEN the cascade falls through to word boundaries, and every resulting piece is within `maxTokens`

### Requirement: A Split Markdown Table's Pieces Stay Valid Markdown

When an oversized piece contains a markdown table and is split across a row boundary, each resulting piece MUST repeat the table's header row and separator row, so every piece parses as a valid, independently-renderable markdown table rather than an orphaned fragment of rows.

#### Scenario: Splitting an oversized table repeats header and separator on every piece

- GIVEN a markdown table whose full content exceeds `maxTokens`
- WHEN it is split into multiple pieces
- THEN each piece begins with the header row and separator row followed by its share of data rows, and each piece parses as valid markdown

### Requirement: Every Split Piece Retains Its Full Heading Path

When bounding splits an oversized piece into multiple chunks, every resulting chunk MUST carry the same full heading path (e.g. `"H2 > H3"`) that the original, unsplit piece would have carried. Splitting for size MUST NOT truncate, renumber, or otherwise alter the heading path.

#### Scenario: Split pieces share the parent's heading path

- GIVEN an H3 child section under an H2 parent whose combined text exceeds `maxTokens` and is split into 3 pieces
- WHEN the resulting chunks are inspected
- THEN all 3 chunks carry the identical heading path `"H2 title > H3 title"`

### Requirement: `NO_CHUNKING` Suppresses Heading-Based Splitting Only

`NO_CHUNKING` means "do not split this file by markdown headings", not "emit exactly one chunk regardless of size". A `NO_CHUNKING` file within `maxTokens` MUST still emit a single chunk, unchanged from today. A `NO_CHUNKING` file above `maxTokens` MUST be split by the same paragraph/sentence/word cascade used elsewhere — never by its internal heading structure — into multiple chunks each within the bound. No configuration flag exempts a `NO_CHUNKING` file from the size bound.

#### Scenario: `NO_CHUNKING` file within the bound is still a single chunk

- GIVEN a file listed in `NO_CHUNKING` whose body is `<= maxTokens`
- WHEN it is chunked
- THEN it is emitted as exactly one chunk, unchanged from current behavior

#### Scenario: `NO_CHUNKING` file above the bound splits by content size, not by its headings

- GIVEN a file listed in `NO_CHUNKING` containing internal markdown headings, whose body exceeds `maxTokens`
- WHEN it is chunked
- THEN it is split into multiple chunks via the paragraph/sentence/word cascade, every chunk is within `maxTokens`, and the split points are NOT derived from its internal heading structure

### Requirement: Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents

Incremental sync's change fingerprint is the document's content hash alone (see "Fingerprint-Based Incremental Diff"), so a change to `chunk.maxTokens` or the splitting logic does NOT retroactively re-chunk documents whose hash hasn't changed. Operators MUST run a full `compendio index` (its `reset()` drops and recreates the schema) for new boundaries to reach an existing corpus; an incremental `serve` sync pass alone MUST NOT be relied on for this. This is a documented operational step — the system MUST NOT introduce a schema version marker or automatic re-chunk migration for it.

#### Scenario: Incremental sync alone does not apply new chunk boundaries to unchanged documents

- GIVEN a corpus already indexed under a previous `chunk.maxTokens` value, with a document whose content has not changed since
- WHEN `chunk.maxTokens` changes and only an incremental sync pass runs (no full `compendio index`)
- THEN that unchanged document's existing chunks remain at their old boundaries

#### Scenario: A full reindex applies the new bound

- GIVEN the same corpus, with `chunk.maxTokens` changed
- WHEN a full `compendio index` run executes
- THEN every document is re-chunked under the new bound, including documents whose content did not change

### Requirement: English Contract Preserves the `ejemplos/` Multilingual Retrieval Baseline

The `ejemplos/` reference corpus MUST retain its Spanish prose, its Spanish frontmatter VALUES, and an untouched `goldenset.yaml`; only its three frontmatter KEYS translate to their English equivalents (`status:`, `tags:`), matching the renamed default `frontmatterFields` identity mapping. Because frontmatter keys are stripped from the document before chunking/embedding (only `content` reaches the index) and `EvaluateSearch` passes no metadata filters to `search`, this key-only rename MUST NOT change the goldenset's ranking behavior. The captured baseline — hybrid recall@5 = 1.00 and MRR = 0.943 — MUST hold exactly after the rename; any deviation is a defect in the rename, not a new baseline to accept.

**Scope of the "hold exactly" clause**: it binds the English-contract frontmatter-key rename specifically — a pure string substitution touching no chunk boundary, so content reaching the chunker/embedder is byte-identical before and after. It MUST NOT be read as pinning these figures against every later change. A change that deliberately alters `ejemplos/` chunking (e.g., a chunk-size bound) moves a real retrieval input and MUST declare and satisfy its own baseline-preservation gate, rather than inheriting this requirement's "any deviation is a defect" framing by default.
(Previously: the "hold exactly, any deviation is a defect" framing was unscoped, leaving it readable as binding every future change against these exact figures.)

#### Scenario: Frontmatter key rename does not move the eval metrics

- GIVEN the `ejemplos/` corpus with `status:`/`tags:` replacing `estado:`/`etiquetas:` in its 3 frontmatter-bearing files
- WHEN `compendio eval` runs against it in hybrid mode
- THEN recall@5 = 1.00 and MRR = 0.943, unchanged from the pre-rename baseline

#### Scenario: Corpus prose and goldenset stay untouched

- GIVEN the renamed codebase
- WHEN `ejemplos/docs/**` prose, frontmatter values, and `ejemplos/goldenset.yaml` are diffed against their pre-rename versions
- THEN no byte differs, other than the 3 renamed frontmatter key lines

#### Scenario: A chunk-boundary-moving change is not bound by this requirement's exact-hold clause

- GIVEN a separate change that deliberately alters `ejemplos/` chunk boundaries (e.g., a chunk-size bound applied to `chunkOutline`)
- WHEN `compendio eval` is run against `goldenset.yaml` before and after that change
- THEN this requirement's "any deviation is a defect" framing does NOT apply to that change's metrics; that change's own success criteria define what movement, if any, is acceptable

