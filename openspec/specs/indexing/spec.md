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

### Requirement: Root-Alias-Prefixed Document `path`, Always

Every discovered `DocumentFile.path`, `ReadError.path`, and `EncodingNotice.path` MUST be prefixed with its declared root's alias, joined with `/` (e.g. `docs/x.md`, `openspec/specs/indexing/spec.md`). This applies uniformly regardless of how many roots are declared, including the default single-element `["docs"]` root set — there is no unprefixed shape anywhere in the system. `path` MUST remain the sole document identity key (`documents.path TEXT UNIQUE`); this change introduces no schema change. Two documents that would otherwise share a relative path under different roots (e.g. `docs/a.md` and `openspec/a.md`) MUST both index successfully as distinct documents.

#### Scenario: A document's path carries its root's alias

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN a file at `<openspec-root>/specs/indexing/spec.md` is discovered
- THEN its `path` is `openspec/specs/indexing/spec.md`

#### Scenario: Same-basename files under different roots do not collide

- GIVEN `docsDir: ["docs", "openspec"]`, with an `a.md` file directly under each root
- WHEN `compendio index` runs
- THEN both are indexed successfully as `docs/a.md` and `openspec/a.md`, with no UNIQUE-constraint error

#### Scenario: The default root set prefixes too

- GIVEN no config file, so `docsDir` defaults to `["docs"]`
- WHEN a file at `<default-root>/documentation-convention.md` is discovered
- THEN its `path` is `docs/documentation-convention.md`, not the unprefixed `documentation-convention.md` produced before this change

### Requirement: Field Inference in `loose` Mode

The system MUST infer `title` and `module` when not otherwise supplied, and MUST NOT invent `type`/`status`. A frontmatter field that is present but empty (an empty string, or YAML `null`) MUST be treated exactly as absent for `type`, `module`, and `status`: `type`/`status` stay absent, and `module` falls through to folder-segment inference. `module` inference MUST be relative to the document's containing declared root: the root's alias prefix MUST be stripped from the document's `path` before taking the first remaining path segment, so `module` keeps meaning "the folder this document sits in within its own root" rather than degrading into "which root it came from". This applies uniformly regardless of how many roots are declared, including the default single-element `["docs"]` root set — `docs/auth/login.md` MUST infer `module: "auth"`, never `"docs"`.

| Field | Inference source | Fallback |
|---|---|---|
| `title` | First H1 | Humanized filename |
| `summary` | First paragraph | Unchanged existing behavior |
| `module` | First path segment within the document's containing root (alias prefix always stripped first) | Absent for a file at its root's top level |
| `type` | None | Absent unless frontmatter/mapping supplies it |
| `status` | None | Absent unless frontmatter/mapping supplies it |
(Previously: `module` was the first path segment under an unprefixed `docsDir` path, with no root-alias to strip — `docsDir` could be a single string and `path` could be unprefixed. With `docsDir` always an array and `path` always prefixed, alias-stripping is unconditional rather than gated on a "multi-root mode" that no longer exists.)

#### Scenario: No H1 present

- GIVEN a `.md` file with no H1 heading
- WHEN indexed under `loose`
- THEN `title` is set to a humanized version of the filename

#### Scenario: Humanized filename, concrete example

- GIVEN a file at `docs/getting-started_with-search.md` with no H1
- WHEN indexed under `loose`
- THEN `title` resolves to `"Getting started with search"` (strip `.md`, replace `-`/`_` with spaces, collapse and trim whitespace, sentence-case the first letter)

#### Scenario: Empty-string frontmatter treated as absent

- GIVEN `docsDir` defaults to `["docs"]`, a file whose `path` is `docs/auth/login.md`, and frontmatter `module: ""`
- WHEN indexed under `loose`
- THEN `module` resolves to `"auth"` via folder inference (alias stripped, then the first remaining segment), not the empty string

#### Scenario: Empty type/status frontmatter treated as absent

- GIVEN a document with frontmatter `type: ""` and `status: null`
- WHEN indexed under `loose`
- THEN `type` and `status` are both absent, not empty strings

#### Scenario: `module` from folder segment, default root set

- GIVEN `docsDir` defaults to `["docs"]` and a file whose `path` is `docs/auth/login.md`
- WHEN indexed under `loose`
- THEN `module` resolves to `"auth"`, not `"docs"`

#### Scenario: A file at its root's top level has no module, even prefixed

- GIVEN `docsDir: ["docs", "openspec"]` and a file whose `path` is `docs/documentation-convention.md`
- WHEN indexed under `loose`
- THEN `module` is absent, not `"docs"`

#### Scenario: Frontmatter wins over inference

- GIVEN `docsDir` defaults to `["docs"]`, a file whose `path` is `docs/auth/login.md`, and frontmatter `module: "identity"`
- WHEN indexed under `loose`
- THEN `module` resolves to `"identity"`, not `"auth"`

#### Scenario: `module` on a deeper, second-root document

- GIVEN `docsDir: ["docs", "openspec"]` and a file whose `path` is `openspec/specs/indexing/spec.md`
- WHEN indexed under `loose`
- THEN `module` resolves to `"specs"`, not `"openspec"`

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

Whenever a document's bytes are not valid UTF-8 but are successfully decoded via BOM detection or the CP1252 fallback, the system MUST report that document as transcoded to every consumer of the index/sync report (`compendio index`, `compendio index-md`, the sync pass feeding `docs_overview`, and a manual `compendio sync` run) — even when the transcoded content is byte-for-byte the string a correct decoder would have produced anyway. This obligation holds on every pass over that document, independently of whether the document's content hash has changed since the previous pass: a document reported as transcoded on one pass MUST be reported again on the next pass that discovers it, for as long as its bytes still require the fallback, exactly as if its content had changed. The document MUST still be indexed normally and MUST NOT appear in `skipped`; a transcoded document is a reportable event, not a failure.
(Previously: the reporting obligation was stated per decode event, without saying whether an unchanged-hash document must be reported again on a later pass — the case a two-pass sync implementation risks silently dropping if the notice push moves out of the discovery-time decode and into a changed-documents-only loop.)

#### Scenario: A perfect transcode is still reported

- GIVEN a CP1252 document whose bytes decode via the fallback with no lossy substitution
- WHEN `compendio index` runs
- THEN the document is indexed successfully, does not appear in `skipped`, and the run's report still names it as transcoded

#### Scenario: The transcode notice reaches CLI output

- GIVEN a transcoded document reported by an `index` or `index-md` run
- WHEN the CLI prints its summary
- THEN a transcoding notice for that document's path is printed, alongside the existing `skipped`/`embeddingsWarning` warnings

#### Scenario: An unchanged-but-transcoded document is reported on every pass, not only when its content changes

- GIVEN a CP1252 document already indexed and reported as transcoded on a prior pass, whose bytes on disk — and therefore its recomputed hash — have not changed since
- WHEN a subsequent incremental sync pass runs (whether triggered by `serve` or invoked manually via `compendio sync`)
- THEN that document is included again in this pass's transcoding notices, even though "Fingerprint-Based Incremental Diff" correctly leaves it un-reparsed, un-rechunked, and un-reembedded

### Requirement: Corrected Decoding Self-Heals via Incremental Sync

Because the change fingerprint (`computeHash(content)`) hashes the already-decoded string rather than the raw bytes (see "Fingerprint-Based Incremental Diff"), fixing this decoding defect for a previously mis-decoded document changes its stored hash even though the file's bytes on disk are unchanged. An incremental sync pass — whether triggered by `serve` or invoked manually via `compendio sync` — MUST therefore treat that document as changed and re-index it; no full `compendio index` MUST be required to apply corrected decoding to an already-indexed corpus. This is the inverse of "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents": there, bytes were unchanged and only chunking config moved, so the hash never changed and a full reindex was mandatory; here, bytes are unchanged but decoded output differs, so the hash does change and an incremental pass suffices.
(Previously: scoped to "an incremental `serve` sync pass" — the only trigger that existed when this requirement was written. The self-healing property follows from the fingerprint mechanism alone, so it holds identically for a manually-triggered `compendio sync` pass.)

#### Scenario: An incremental pass alone re-indexes a previously mis-decoded document

- GIVEN a document previously indexed under the old, UTF-8-only decoder, whose bytes on disk have not changed
- WHEN the encoding-aware decoder is deployed and an incremental sync pass runs, whether triggered by `serve` or invoked manually via `compendio sync`
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

### Requirement: Embeddings Degradation Reporting Is Trigger-Agnostic and Cause-Agnostic

When computed embeddings cannot be persisted during a sync pass — whether the pass is a full `compendio index` run or an incremental `compendio sync`/`serve` pass, and whether the cause is the embeddings provider or the vector store itself — the system MUST report the pass as `mode: "lexical"` with a non-empty `embeddingsWarning` naming vector persistence as the cause when the store, not the provider, is why vectors were not persisted. Every document affected by that unavailability MUST remain in `indexed`, MUST NOT appear in `skipped` for that reason, and MUST be retrievable by a subsequent lexical search. This obligation holds even on a pass in which no document is new or changed, since the store's capacity to persist vectors is a standing property of the pass, not a per-document event. A genuine write failure unrelated to vector-persistence unavailability — one that prevents the document itself from being committed — remains a skip, exactly as today; this requirement MUST NOT be satisfied by converting that failure into a lexical-mode degrade.

#### Scenario: Vectors cannot be persisted while the provider works

- GIVEN a new or changed document, an embeddings provider that succeeds, and a store that cannot persist vectors
- WHEN a sync pass processes that document
- THEN the document appears in `indexed`, not `skipped`, `report.mode` is `"lexical"`, `embeddingsWarning` is non-empty and names vector persistence (not the provider) as the cause, and a subsequent lexical search returns its content

#### Scenario: The same store, on a pass that changes nothing

- GIVEN the same vector-persistence-unavailable store and a pass in which no document is new or changed
- WHEN that pass completes
- THEN `report.mode` is still `"lexical"` with a non-empty `embeddingsWarning`, not `"hybrid"` — the degradation is reported even though no document went through the per-document embedding path

#### Scenario: A genuine hard write failure is still a skip, not a degrade

- GIVEN a document whose store write fails for a reason other than vector-persistence unavailability, so the whole write is rolled back
- WHEN the pass processes that document
- THEN the document appears in `skipped` with its error, exactly as today

### Requirement: `IndexStore` States Vector-Persistence Capability and Enforces It Consistently

The `IndexStore` port MUST expose `canPersistVectors()`, a way for a caller to determine — before generating embeddings — whether the store can currently persist vectors at all: a standing capability of the store, distinct from whether any vector currently exists. `upsertDocument`'s contract MUST state explicitly that it writes `chunks_vec` only when `embeddings` is non-null AND `canPersistVectors()` is true; when vector persistence is unavailable, the `embeddings` argument MUST be ignored, the call MUST still write the document, its chunks, and its FTS rows, and MUST still return normally — a caller that does not consult `canPersistVectors()` first has no way to observe the drop through the return value. The methods that already refuse to proceed when vector persistence is unavailable (`saveEmbeddings`, `replaceEmbeddings`) MUST continue throwing in that case; nothing in the store's internal vector-table setup MUST be simplified into a substitute for those explicit throws.

#### Scenario: The capability query reflects unavailability

- GIVEN a store whose vector extension failed to load
- WHEN a caller calls `canPersistVectors()` before embedding
- THEN it returns `false`, independent of whether any vector table or vector row currently exists

#### Scenario: `upsertDocument` ignores embeddings without throwing, and the document still commits

- GIVEN a store where `canPersistVectors()` is `false`, and a caller that calls `upsertDocument` with non-null embeddings anyway
- WHEN the call completes
- THEN it does not throw, the document, its chunks, and its FTS rows are committed, and no vector row is written for any of its chunks

#### Scenario: `saveEmbeddings` and `replaceEmbeddings` still throw when vectors cannot be persisted

- GIVEN a store where `canPersistVectors()` is `false`
- WHEN `saveEmbeddings` or `replaceEmbeddings` is called with one or more items
- THEN the call throws, exactly as before this change

### Requirement: Vector-Coverage Reconciliation Is Reported as Written Work, Never Attempted Work

When a `compendio sync` pass fills one or more documents' missing chunk vectors during vector-coverage reconciliation, the system MUST report that work to the user — distinctly from the count of documents indexed as new or changed this pass, and never merged into it. This reporting MUST reflect work actually committed to the index, not merely attempted: a document whose reconciliation embedding call fails, or whose vector write fails and rolls back, MUST contribute nothing to this report, regardless of how many chunks were attempted for it — such a document's failure surfaces instead through the pass's existing degraded-embeddings warning (an embed failure) or through `skipped` (a write failure), exactly as those failures are already reported today. On a pass that reconciles nothing — because no vector-coverage gap existed, or because none of the attempted reconciliations succeeded — the pass's ordinary summary MUST be unperturbed: byte-identical to what it would report if this reporting capability did not exist at all.

#### Scenario: A pass that changes no document but fills vector-coverage gaps reports the work it did

- GIVEN a `compendio sync` pass in which no document is new or changed, but one or more hash-matched documents have their vector-coverage gaps filled and written
- WHEN the pass completes
- THEN the report and the CLI summary make that reconciliation work visible, rather than the pass reporting as if it changed nothing and did nothing

#### Scenario: Reconciliation work is reported distinctly from changed-document counts, never merged

- GIVEN a `compendio sync` pass in which one document is indexed as changed and, independently, a different, unchanged document has its vector-coverage gap filled and written
- WHEN the pass completes
- THEN both facts are visible separately — the changed-document count and chunk total are unaffected by the reconciliation work, and the reconciliation work is reported without being folded into the changed-document counts

#### Scenario: A failed reconciliation embed contributes zero, not a partial count

- GIVEN a `compendio sync` pass in which the embeddings provider throws while reconciling one document's vector-coverage gap
- WHEN the pass completes
- THEN that document contributes nothing to the reconciliation report — none of its attempted chunks are counted — and the failure is surfaced via the pass's degraded-embeddings warning, not via the reconciliation report

#### Scenario: A rolled-back reconciliation write contributes zero, not a partial count

- GIVEN a `compendio sync` pass in which a document's replacement vectors are computed successfully but the subsequent write of those vectors to the store fails and rolls back
- WHEN the pass completes
- THEN that document contributes nothing to the reconciliation report, and the document is reported in `skipped` instead

#### Scenario: An ordinary pass with nothing to reconcile is unperturbed

- GIVEN a `compendio sync` pass in which no document has a vector-coverage gap to reconcile
- WHEN the pass completes
- THEN the summary the user sees is identical to what it would be if this reporting capability did not exist — no additional line, no altered wording, no altered counts

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

### Requirement: Incremental Sync Trigger — Manual `compendio sync` Invocation

`compendio sync` MUST trigger exactly one incremental sync pass per invocation, using the same incremental sync mechanism `serve`'s startup and throttled pre-tool-call triggers use — a manual run diffs and applies pending changes identically to an automatic one for the same corpus state. Because it is a one-shot process rather than a long-lived server, `compendio sync` MUST NOT participate in the throttled scheduling that gates `serve`'s pre-tool-call check: `sync.throttleMs` MUST NOT gate a manual invocation, and every invocation MUST perform a fresh incremental pass regardless of how recently a prior pass ran. Unlike a `serve`-triggered pass — whose failure is caught and logged to stderr so a background sync error never breaks a live tool call — a manual pass's failure MUST propagate out of the command, and the process MUST exit non-zero; there is no "proceed against the current index" fallback for a command whose entire purpose is a definitive result. The command's report MUST include the count of documents deleted during that pass, a field the full-`compendio index` report has no counterpart for.

#### Scenario: A manual invocation runs exactly one incremental pass

- GIVEN a corpus with pending new, changed, and deleted documents
- WHEN `compendio sync` runs
- THEN it performs exactly one incremental sync pass — applying the same diff-and-reindex behavior `serve`'s triggers use — and exits once that pass completes, with no continuous or watching behavior

#### Scenario: The configured throttle does not gate a manual invocation

- GIVEN `sync.throttleMs` configured to a nonzero value
- WHEN `compendio sync` runs twice in immediate succession
- THEN both invocations perform a full incremental pass — the throttle window that gates `serve`'s pre-tool-call check has no effect on the manual command

#### Scenario: A failed manual pass exits non-zero

- GIVEN an incremental sync pass encounters a failure severe enough to abort the pass
- WHEN that pass is triggered by `compendio sync` rather than by `serve`
- THEN the failure propagates out of the command and the process exits non-zero — unlike the identical failure occurring inside `serve`, which is caught, logged to stderr, and does not stop the running server

#### Scenario: Deletions are reported by count, a field the full reindex report lacks

- GIVEN a manual sync pass in which one or more previously indexed documents are no longer present on disk
- WHEN `compendio sync` completes
- THEN its report states how many documents were deleted during that pass — a count `compendio index`'s report carries no field for

### Requirement: Read Failures Protect the Affected `path` Subtree From Deletion

`DocumentSource.discover()` MUST report a failure to read a directory below a declared root in `readErrors`, instead of silently returning as it does today. Every file beneath a directory that failed to be read is absent from `files` for that pass, so an unreported directory failure would make the incremental diff treat that entire subtree as deleted.

For every entry in `readErrors`, an incremental sync pass MUST exclude from that pass's delete-candidate set both the reported `path` itself and every indexed `path` beneath it (prefix `<path>/`), MUST retain those existing rows as-is, and MUST report the failure in `skipped`. A `ReadError` for a declared root's own read failure MUST carry that root's alias as its `path` value — not the declared root string — because delete-protection and subtree matching operate on the alias-prefixed `path` shape every indexed document uses; the declared root string MAY still appear in the failure's human-readable message text.

A failure to read one declared root's directory MUST NOT throw by itself: it MUST be reported (in `readErrors`/`skipped` shape, keyed by the root's alias) and the run MUST continue indexing the remaining, readable roots. Only when EVERY declared root fails to read MUST the run throw — the same "nothing to index is a configuration error" semantics, generalized from one root to N. This is uniform across every declared root count: with a single declared root, "one root fails" and "every root fails" are the same event, so a one-element root set preserves the pre-existing always-throws behavior without any special case.
(Previously: a failure to read the root docs directory always threw, unconditionally, with no notion of multiple declared roots or of a `ReadError.path` distinct from the declared root string. The dual single-root/multi-root split this delta first introduced is retired along with the `docsDir` union: with `docsDir` always an array, "N roots, throw only when all N fail" is the one rule, and it degenerates correctly to "throw" for N=1.)

#### Scenario: Unreadable subdirectory does not delete its documents

- GIVEN indexed documents under `guides/` and a `readdir` failure on that subdirectory during a pass (e.g. a Windows permissions hiccup or a network-share blip)
- WHEN an incremental sync pass runs
- THEN the directory failure is reported in `readErrors`, every indexed `path` under `guides/` is excluded from the delete-candidate set and retained as-is, and the failure is reported in `skipped`

#### Scenario: One of several declared roots is unreadable — reported, run continues

- GIVEN `docsDir: ["docs", "openspec"]` and no `openspec/` directory exists in this project
- WHEN `compendio index` runs
- THEN the run completes with exit code 0, every `docs/` document is indexed, and the missing root is reported (in `skipped`/`readErrors` shape) with `ReadError.path` equal to `"openspec"` (its alias)

#### Scenario: The sole declared root failing is "every root failing" and still throws

- GIVEN `docsDir: ["docs"]` (the default shape) and `docs/` cannot be read
- WHEN `compendio index` runs
- THEN it throws — with exactly one declared root, "one root fails" and "every root fails" are the same event, so the pre-existing always-throws behavior holds without a special case

#### Scenario: Every declared root fails to read

- GIVEN `docsDir` is an array and none of its declared roots can be read
- WHEN `compendio index` runs
- THEN it throws, mirroring the "nothing to index is a configuration error" semantics generalized from one root to N

#### Scenario: A failed root's `ReadError.path` is its alias, protecting its subtree from deletion

- GIVEN a declared root `packages/app/docs` (alias `docs`) whose documents are persisted under the `docs/...` prefix, and that root becomes unreadable during an incremental sync pass
- WHEN the pass runs
- THEN the resulting `ReadError.path` is `"docs"` (the alias), so every indexed `docs/...` path is excluded from the delete-candidate set and retained; a `ReadError.path` carrying the declared string `"packages/app/docs"` instead would match no persisted path and would let `deleteMissingDocuments` purge that root's entire corpus

### Requirement: Removing a Declared Root Purges Its Indexed Documents on the Next Sync Pass

Because "Fingerprint-Based Incremental Diff" already deletes any indexed `path` absent from the discovered corpus, removing a declared root from `docsDir` MUST be treated identically to any other set of files disappearing from disk: on the next incremental sync pass, or the next full `compendio index`, every document previously indexed under that root's prefix MUST be deleted — even though the files still exist on disk outside the configured roots. No root-removal-specific detection or special-casing is introduced; the existing path-presence diff produces this outcome unmodified.

#### Scenario: Removing a root from a live `serve` purges its documents

- GIVEN a running `compendio serve` process configured with `docsDir: ["docs", "openspec"]`, then reconfigured to `docsDir: ["docs"]`
- WHEN the next throttled incremental sync pass runs
- THEN every previously indexed `openspec/...` document is deleted, even though those files still exist on disk

#### Scenario: Adding a root indexes its files as new documents

- GIVEN a project reconfigured from `docsDir: ["docs"]` to `docsDir: ["docs", "openspec"]`
- WHEN the next sync pass or full `compendio index` runs
- THEN every file under the newly declared root appears as an unknown `path` and is indexed as a new document, with no special detection mechanism

### Requirement: In-Process Incremental Sync Concurrency Guarantee

Within a single `serve` process, every individual SQLite call is synchronous and cannot be interleaved by other JavaScript, and each document's teardown-plus-insert MUST run inside ONE transaction. The guarantee this provides is PER-DOCUMENT atomicity: a reader MUST never observe a partially-written document — no chunks without their `documents` row, no `chunks_fts` desynced from `chunks`, no mix of pre-change and post-change chunks for the same `path`.

This is explicitly NOT a pass-level snapshot. A sync pass awaits the embeddings provider between documents, and a tool handler may itself await mid-request (`search_docs`'s vector leg does), so a single call MAY resume mid-pass and reflect some of that pass's documents but not others. This in-process guarantee is additional to, and does not replace, the existing non-goal for concurrent access from a separately-running `compendio index` process (see "Concurrent Readers During `compendio index` Are Out of Scope").
(Previously: the closing scenario named only `compendio index` as the external-process case. A manual `compendio sync` run is also a separate OS process relative to a live `serve`, and its concurrency symptom differs from `compendio index`'s — no `reset()` runs, so the failure mode is `SQLITE_BUSY` rather than a transient "no such table" read, under WAL with better-sqlite3's default 5 000 ms busy timeout.)

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
- AND a manual `compendio sync` run from another OS process falls under the same non-goal, though its symptom differs: performing no `reset()`, it instead risks `SQLITE_BUSY` on short per-document write transactions under WAL (better-sqlite3's default 5 000 ms busy timeout), which propagates as a non-zero CLI exit rather than a transient read anomaly; the supported response is to retry

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

### Requirement: Every Emitted Chunk Heading Is Non-Empty

This is an invariant on the emitted `Chunk`, not a guarantee about any upstream data source. For every `Chunk` produced by `chunkOutline` or by `wholeDocumentChunk` (the `NO_CHUNKING` path), `heading` MUST be a non-empty string — regardless of whether the source document has any markdown heading, and regardless of what a humanized filename resolves to. It composes with "Every Split Piece Retains Its Full Heading Path": the path MUST already be non-empty before bounding splits a piece, and splitting continues to propagate it unchanged, exactly as today.

#### Scenario: Heading-less document under loose mode

- GIVEN a `convention.mode: "loose"` document with no H1 and no H2, long enough that chunking splits its body into several chunks
- WHEN it is chunked
- THEN every emitted chunk's `heading` is non-empty and identical across all of them

#### Scenario: A filename that humanizes to an empty string still yields a non-empty heading

- GIVEN a heading-less document at a path such as `-.md` or `_.md`
- WHEN it is chunked
- THEN every emitted chunk's `heading` is still non-empty

#### Scenario: `NO_CHUNKING` documents are covered by the same invariant

- GIVEN a heading-less document listed in `NO_CHUNKING`
- WHEN it is chunked via `wholeDocumentChunk`
- THEN every emitted chunk's `heading` is non-empty

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

Incremental sync's change fingerprint is the document's content hash alone (see "Fingerprint-Based Incremental Diff"), so a change to `chunk.maxTokens` or the splitting logic does NOT retroactively re-chunk documents whose hash hasn't changed. Operators MUST run a full `compendio index` (its `reset()` drops and recreates the schema) for new boundaries to reach an existing corpus; an incremental sync pass alone — whether triggered by `serve` or invoked manually via `compendio sync` — MUST NOT be relied on for this, since both run the identical fingerprint-based diff against the same unchanged content hash. This is a documented operational step — the system MUST NOT introduce a schema version marker or automatic re-chunk migration for it.
(Previously: scoped to "an incremental `serve` sync pass alone" — the only trigger that existed when this requirement was written. The limit follows from the fingerprint mechanism itself, so it applies identically to a manually-triggered `compendio sync` pass.)

#### Scenario: Incremental sync alone does not apply new chunk boundaries to unchanged documents

- GIVEN a corpus already indexed under a previous `chunk.maxTokens` value, with a document whose content has not changed since
- WHEN `chunk.maxTokens` changes and only an incremental sync pass runs — whether triggered by `serve` or invoked manually via `compendio sync` — with no full `compendio index`
- THEN that unchanged document's existing chunks remain at their old boundaries

#### Scenario: A full reindex applies the new bound

- GIVEN the same corpus, with `chunk.maxTokens` changed
- WHEN a full `compendio index` run executes
- THEN every document is re-chunked under the new bound, including documents whose content did not change

### Requirement: Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents

Incremental sync's change fingerprint remains the document's content hash alone (see "Fingerprint-Based Incremental Diff"). A change to how `heading` resolves — without altering document content — does NOT retroactively update the `heading` of chunks whose hash hasn't changed. A full `compendio index` MUST be run for the corrected value to reach an existing corpus; an incremental sync pass alone — whether triggered by `serve` or invoked manually via `compendio sync` — MUST NOT be relied on for this. This is the same operational shape as "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents", extended from `chunk.maxTokens`/splitting-logic changes to `heading`-resolution changes; no schema version marker or automatic re-chunk migration is introduced for it either.
(Previously: scoped to "an incremental `serve` sync pass alone" — the only trigger that existed when this requirement was written. The limit follows from the same fingerprint mechanism, so it applies identically to a manually-triggered `compendio sync` pass.)

#### Scenario: Incremental sync alone does not correct existing empty headings

- GIVEN a corpus indexed before this change, with a document whose chunks were persisted with `heading: ""`, and whose content has not changed since
- WHEN this change is deployed and only an incremental sync pass runs — whether triggered by `serve` or invoked manually via `compendio sync` — with no full `compendio index`
- THEN that document's chunks keep their empty `heading`

#### Scenario: A full reindex applies the corrected heading

- GIVEN the same corpus
- WHEN a full `compendio index` run executes
- THEN the affected document is re-chunked and its chunks receive a non-empty `heading`

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

### Requirement: The Retrieval Evaluation Corpus Stays Addressable After a Path-Shape Change

`ejemplos/goldenset.yaml`'s expected document addresses (`esperado:`) MUST match the `path` shape `compendio index` produces for the same corpus. When a change alters how document `path` values are produced, the evaluation corpus's addresses MUST be updated in the same change, and the retrieval quality baseline (recall@5 and MRR measured against `compendio eval`) MUST be re-measured and recorded rather than assumed to hold unchanged. A change to `path` production that leaves the evaluation corpus's addressing stale MUST be a detectable, measurable failure when the evaluation is actually run — it MUST NOT be a state the automated test suite can report as passing while never exercising the addressing that changed. This is the goldenset's role: a falsifier of retrieval quality, not a fixture whose own drift can go unnoticed.

#### Scenario: Evaluation addresses are re-established after a path-shape change

- GIVEN a change that alters how document `path` values are produced (e.g. adding a root-alias prefix)
- WHEN the evaluation corpus's `esperado` addresses are updated to the new `path` shape in the same change
- THEN `compendio eval` reports recall@5 and MRR figures consistent with the pre-change baseline, and that comparison is recorded

#### Scenario: A stale evaluation corpus produces a measurable failure, not a silent gap

- GIVEN a change to `path` production that leaves the evaluation corpus's `esperado` addresses in the old, now-incorrect shape
- WHEN `compendio eval` is run against the updated index
- THEN recall@5 and MRR drop toward zero because no `esperado` address matches any indexed `path`, and this is a measurable, reportable outcome of actually running the evaluation — not something a passing `npm test` run can substitute for

