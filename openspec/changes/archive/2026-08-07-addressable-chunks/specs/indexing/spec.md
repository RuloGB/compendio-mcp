# Delta for Indexing

## ADDED Requirements

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

### Requirement: Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents

Incremental sync's change fingerprint remains the document's content hash alone (see "Fingerprint-Based Incremental Diff"). A change to how `heading` resolves — without altering document content — does NOT retroactively update the `heading` of chunks whose hash hasn't changed. A full `compendio index` MUST be run for the corrected value to reach an existing corpus; an incremental `serve` sync pass alone MUST NOT be relied on for this. This is the same operational shape as "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents", extended from `chunk.maxTokens`/splitting-logic changes to `heading`-resolution changes; no schema version marker or automatic re-chunk migration is introduced for it either.

#### Scenario: Incremental sync alone does not correct existing empty headings

- GIVEN a corpus indexed before this change, with a document whose chunks were persisted with `heading: ""`, and whose content has not changed since
- WHEN this change is deployed and only an incremental `serve` sync pass runs (no full `compendio index`)
- THEN that document's chunks keep their empty `heading`

#### Scenario: A full reindex applies the corrected heading

- GIVEN the same corpus
- WHEN a full `compendio index` run executes
- THEN the affected document is re-chunked and its chunks receive a non-empty `heading`
