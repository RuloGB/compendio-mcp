# Delta for Indexing

## ADDED Requirements

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

## MODIFIED Requirements

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
