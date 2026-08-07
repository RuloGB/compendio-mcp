# Delta for MCP Contract

## ADDED Requirements

### Requirement: `search_docs`'s `section` Is Never Empty and Round-Trips

For any document indexed under the "Every Emitted Chunk Heading Is Non-Empty" invariant, the `section` field on every `search_docs` result item MUST NOT be the empty string. Because `section` is a direct copy of the underlying chunk's `heading`, this follows structurally rather than requiring separate logic — and, for the same reason, it is a guarantee about *indexing*, not one `search_docs` can enforce on its own. A corpus persisted before this change and not yet reindexed still yields empty `section` values; that is the documented consequence of "Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents", not a violation of this requirement. `search_docs` MUST NOT attempt to repair such values at query time.

The returned value MUST round-trip: passed back verbatim as `read_doc({ path, section })`, it MUST resolve to a `section` result, never `section-not-found`. Multiple results, and multiple chunks within one `read_doc` call, MAY share the same `section` value — that is the existing, deliberate reassembly behavior for oversized sections, unchanged here; this requirement does not imply fragment-level addressability.

#### Scenario: A heading-less document's results carry a non-empty section

- GIVEN a document with no H1 and no H2, indexed under `convention.mode: "loose"` by a `compendio index` run under the current invariant
- WHEN `search_docs` returns a result whose chunk came from that document
- THEN the result's `section` field is non-empty

#### Scenario: A corpus not yet reindexed is not repaired at query time

- GIVEN a corpus persisted before this change, holding chunks whose stored `heading` is empty
- WHEN `search_docs` returns a result from one of those chunks
- THEN the empty `section` is returned as stored, and the fix is reached by running a full `compendio index`, not by query-time substitution

#### Scenario: The returned section round-trips through read_doc

- GIVEN a `search_docs` result for a heading-less document, with its `section` value
- WHEN that value is passed verbatim as `read_doc({ path, section })`
- THEN the response is a `section` result, not `section-not-found`

### Requirement: `read_doc` Never Renders an Empty-Labeled Bullet, and Explains a Sectionless Document in Prose

`read_doc`'s rendered response MUST NOT contain a bullet with an empty label, under any input — including a stored `heading` value that is empty (e.g. on a document not yet reindexed under the corrected invariant). When a `section` request matches nothing and the document has no non-empty section name to offer at all, the response MUST say so in prose instead of an empty or degenerate list, and MUST name `read_doc({ path })` (without `section`) as the call that returns the full document.

#### Scenario: A document with no addressable sections explains itself

- GIVEN a document whose chunks yield no non-empty section names, and a `read_doc` call with a `section` that does not match
- WHEN the response is rendered
- THEN it states in prose that the document has no addressable sections, names `read_doc({ path })` as the working alternative, and contains no empty-labeled bullet

#### Scenario: A document with some sections still lists them normally

- GIVEN a document with at least one non-empty section name, and a `read_doc` call whose `section` matches none of them
- WHEN the response is rendered
- THEN it lists the available non-empty section names, with no empty-labeled bullet among them
