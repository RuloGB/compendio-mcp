# Delta for MCP Contract

## ADDED Requirements

### Requirement: Open `type` Across MCP Tool and CLI

The MCP `search_docs` tool's `type` parameter MUST be an optional open string (no enum). The CLI `--type` flag MUST accept any string value and MUST NOT exit with a non-zero code for a value outside any declared taxonomy; it MAY emit a warning.

#### Scenario: MCP accepts an arbitrary type value

- GIVEN a running MCP server
- WHEN `search_docs` is called with `type: "playbook"`
- THEN the call succeeds and schema validation does not reject the value

#### Scenario: CLI warns but does not fail

- GIVEN the CLI is invoked with `--type notarealtype`
- WHEN the command runs
- THEN the process does not call `process.exit(2)` and MAY print a warning

### Requirement: Conditional Frontmatter Rendering in `read_doc`

`read_doc`'s rendered header MUST include a `type:`, `module:`, or `status:` line only when that field is present on the document. Absent fields MUST be omitted from the rendered output, never shown as empty or placeholder values.

#### Scenario: Document with no module

- GIVEN a document with `type` and `status` set but no `module`
- WHEN `read_doc` renders the header
- THEN the header includes `type:` and `status:` lines and no `module:` line

#### Scenario: Document with none of the three fields

- GIVEN a document with no `type`, `module`, or `status`
- WHEN `read_doc` renders the header
- THEN none of those three lines appear in the rendered output

### Requirement: `search_docs` Omits Absent `status` from Result Items

When a matched document has no `status`, the corresponding `search_docs` result item MUST omit the `status` field (or leave it absent) rather than rendering an empty string or a placeholder value.

#### Scenario: Result item for a document with no status

- GIVEN a matched document with no `status`
- WHEN `search_docs` returns its result items
- THEN the item for that document has no `status` field, never `status: ""` or a placeholder value

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

### Requirement: `docs_overview` Per-Document Line Omits Absent `type`/`status` Segments

`docs_overview`'s per-document text line (the shared line format also used by `INDEX.md` generation) MUST omit the `[type]` bracket segment entirely when `type` is absent, and MUST omit the `(status)` parenthesized segment entirely when `status` is absent. The system MUST NOT render `[undefined]`, empty brackets, or any placeholder text in either segment's place. Per-document lines MUST be ordered alphabetically by `path`.

#### Scenario: Document with no type and no status in the docs_overview line

- GIVEN a document with no `type` and no `status`
- WHEN `docs_overview` renders that document's line
- THEN the line contains neither a `[...]` segment nor a `(...)` segment for those fields — never `[undefined]` or empty brackets

#### Scenario: Document with type but no status in the docs_overview line

- GIVEN a document with `type: "guide"` and no `status`
- WHEN `docs_overview` renders that document's line
- THEN the line includes the `[guide]` segment and omits the `(status)` segment entirely

#### Scenario: Per-document lines ordered alphabetically by path

- GIVEN a corpus with documents at various paths, some with `type` absent
- WHEN `docs_overview` renders its per-document lines
- THEN the lines appear in ascending alphabetical order of `path`

### Requirement: `docs_overview` Omits Empty Taxonomy Buckets

`docs_overview`'s rendered text output MUST omit the "By type:" line entirely when no document in the corpus defines a `type`, and MUST omit the "By module:" line entirely when no document defines a `module`. The system MUST NOT synthesize a "no-type"/"no-module" catch-all bucket, and MUST NOT render either line as empty (e.g. `By type: —`) when there is nothing to report. This applies to both the MCP `docs_overview` tool's text response and the CLI's `overview` command, since both render through the same `formatOverview`/`formatCounts` functions.

#### Scenario: Corpus with no type anywhere

- GIVEN a corpus where no document defines `type`
- WHEN `docs_overview` is called
- THEN the rendered output contains no "By type:" line at all

#### Scenario: Corpus with partial type coverage

- GIVEN a corpus where some documents define `type` and others do not
- WHEN `docs_overview` is called
- THEN the "By type:" line includes counts only for documents that define a `type`; documents without `type` are not counted in any synthetic bucket, and the rendered line MUST NOT contain the literal text "undefined"

### Requirement: Sync-Status Visibility in `docs_overview` Response

The `docs_overview` MCP tool response MUST include a `sync` field surfacing the outcome of the most recent incremental sync pass: any `skipped` (documents skipped, with reasons), any `embeddingsWarning` degradation notice, and any encoding-transcoding notices (which documents were transcoded from a non-UTF-8 encoding during that pass, even when the transcode was exact) produced by that pass. These three are the field's guaranteed content, not an open-ended "at minimum" left to interpretation. The field MUST be omitted only when the most recent sync pass had nothing to report across all three — no skips, no embeddings degradation, and no transcoded documents — consistent with the project's convention of omitting empty/absent fields rather than rendering placeholders.
(Previously: guaranteed only `skipped` and `embeddingsWarning` "at minimum", leaving the encoding notice's inclusion to an untested reading of that phrase. `encoding-aware-reads` made it a named, guaranteed third component.)

#### Scenario: Sync pass skipped a document

- GIVEN the most recent incremental sync pass reported a document in `skipped`
- WHEN `docs_overview` is called
- THEN its response's `sync` field surfaces that skip and its reason to the calling agent

#### Scenario: Sync pass had nothing to report

- GIVEN the most recent incremental sync pass skipped no documents, hit no embeddings degradation, and transcoded no documents
- WHEN `docs_overview` is called
- THEN the response omits the `sync` field rather than rendering it empty

#### Scenario: Embeddings degrade during an incremental sync

- GIVEN the embeddings provider fails during an incremental sync pass, forcing lexical-only mode
- WHEN `docs_overview` is called afterward
- THEN its `sync` field surfaces the resulting `embeddingsWarning`, matching how the CLI already reports `embeddingsWarning` for `compendio index`

#### Scenario: Sync pass transcoded a document

- GIVEN the most recent incremental sync pass decoded a CP1252 document via the fallback path, even though the decode was exact
- WHEN `docs_overview` is called
- THEN its `sync` field surfaces that document as transcoded — distinct from `skipped`, since the document was indexed successfully rather than skipped

### Requirement: Renamed MCP Tool Signatures And Response Field Names

The `search_docs` tool MUST accept `{ query, type?, module?, tags?, k?, include_excluded? }`. The `read_doc` tool MUST accept `{ path, section? }`. The `docs_overview` tool MUST accept no parameters. Every param and response field this domain's other requirements reference (`path`, `title`, `section`, `excerpt`, `status`, `score`, `mode: "hybrid" | "lexical"`, `indexed`, `skipped`, `deleted`, `embeddingsWarning`, `byType`, `byModule`, `syncStatus`) MUST use its English form; the three tool names (`docs_overview`, `search_docs`, `read_doc`) are already English and unchanged. No retired Spanish param or field name (`tipo`, `modulo`, `etiquetas`, `ruta`, `seccion`, `incluir_no_vigentes`, `omitidos`, `indexados`, `avisoEmbeddings`) MUST remain reachable through any tool call or response.

#### Scenario: Full call with renamed params succeeds

- GIVEN a running MCP server
- WHEN `search_docs` is called with `{ query: "auth", type: "guide", module: "identity", tags: ["security"], k: 5, include_excluded: false }`
- THEN the call succeeds and every field is interpreted under its English name, with ranking behavior identical to the pre-rename contract

#### Scenario: Retired Spanish param names are not recognized

- GIVEN a running MCP server
- WHEN `search_docs` is called with a payload using `tipo`/`modulo`/`etiquetas`/`incluir_no_vigentes` instead of their English equivalents
- THEN those keys are not recognized as filters — the call behaves as if no such filter were supplied, since the retired Zod keys no longer exist on the schema

### Requirement: Unknown `path` Suggests the 3 Closest Matches

When `read_doc` is called with a `path` that does not match any indexed document, the system MUST respond with the 3 closest matching paths instead of raising an error. This behavior predates this change and is unaffected by the rename — it is stated here because the suggestion payload now carries `path` fields under their English name.

#### Scenario: Unknown path returns closest matches instead of an error

- GIVEN a corpus with no document at `docs/authh/login.md`
- WHEN `read_doc` is called with `path: "docs/authh/login.md"`
- THEN the response returns the 3 closest matching `path` values rather than throwing an error

### Requirement: Graduated Excerpt Budget by Result Rank

The `excerpt` field on a `search_docs` result item MUST use a per-rank budget: the rank-1
result's `excerpt` MUST be drawn from `LEAD_EXCERPT_CHARS` (1400), every other result's from
`SUPPORTING_EXCERPT_CHARS` (120). This captures pre-existing behavior, stated here because no
`openspec/specs/` requirement currently covers it.

#### Scenario: Rank-1 gets the lead budget, others the supporting budget

- GIVEN a `search_docs` call returning 5 results
- WHEN the response is built
- THEN the rank-1 result's `excerpt` is drawn from a 1400-character budget, and every other
  result's `excerpt` from a 120-character budget

### Requirement: Lead Excerpt Is a Window Centred on the Matched Span

When the rank-1 chunk's flattened content exceeds `LEAD_EXCERPT_CHARS`, its `excerpt` MUST be a
window of at most `LEAD_EXCERPT_CHARS` characters positioned around the location that caused the
query to match the chunk, not a window anchored at the chunk's start. The budget is unchanged.

#### Scenario: Answer past the old prefix boundary becomes visible

- GIVEN a rank-1 chunk whose flattened content exceeds `LEAD_EXCERPT_CHARS`, containing a unique
  answer whose flattened offset lands past character 1400
- WHEN `search_docs` returns
- THEN the rank-1 result's `excerpt` contains that answer verbatim

### Requirement: Supporting Excerpts Remain Start-Anchored Prefixes

Every non-rank-1 result's `excerpt` MUST remain a prefix anchored at the start of the chunk's
flattened content and MUST NOT centre on a matched span, even when the match occurs past the
supporting budget. Deliberate, not an oversight: a supporting fragment routes between results
rather than answers, and a prefix stays legible against `path`/`section` in a way a
stripped-context window would not.

#### Scenario: Supporting fragment shows the opening text, not the match

- GIVEN a non-rank-1 result whose chunk's query match occurs past character 120 of its flattened
  content
- WHEN `search_docs` returns
- THEN that result's `excerpt` is the chunk's word-snapped first ~120 characters with a trailing
  `…`, not a window around the match

### Requirement: Truncation Is Marked at Either Edge, Within Budget

An excerpt MUST carry a leading `…` whenever its window does not start at flattened offset 0 of
the chunk, and a trailing `…` whenever its window does not reach the end of the chunk's flattened
content — and MUST NOT carry either ellipsis when its window meets that edge. A spurious ellipsis
is a contract violation: it is the signal that sends a caller to `read_doc`. An excerpt's length
MUST NOT exceed its rank's budget plus at most one ellipsis per truncated edge (2 max).

#### Scenario: Window at the start omits the leading ellipsis

- GIVEN a rank-1 excerpt window that begins at flattened offset 0 of the chunk
- WHEN `search_docs` returns
- THEN that `excerpt` carries no leading `…`

#### Scenario: Window at the end omits the trailing ellipsis

- GIVEN a rank-1 excerpt window whose end coincides with the end of the chunk's flattened content
- WHEN `search_docs` returns
- THEN that `excerpt` carries no trailing `…`

#### Scenario: Window truncated on both edges stays within budget plus two

- GIVEN a rank-1 excerpt window that starts after offset 0 and ends before the chunk's flattened
  content ends
- WHEN `search_docs` returns
- THEN that `excerpt` carries a leading `…` and a trailing `…`, and its total length does not
  exceed `LEAD_EXCERPT_CHARS` plus the length of two ellipses

### Requirement: Vector-Only Results Produce Well-Formed Excerpts

A result whose chunk was surfaced only by the vector search leg, with no lexical match for the
query, MUST still receive a well-formed `excerpt`: within its rank's budget, following the same
ellipsis contract as a lexically-matched result, without the call erroring.

#### Scenario: Vector-only rank-1 result still gets a valid excerpt

- GIVEN a rank-1 result surfaced only by the vector search leg, with no lexical match for the
  query
- WHEN `search_docs` returns
- THEN its `excerpt` is within the lead budget (plus at most two ellipsis characters), obeys the
  ellipsis contract, and the call does not error

### Requirement: Lead Match Selection Is Not Positional

When a rank-1 chunk contains multiple candidate match locations, selection of which location
centres the lead excerpt MUST NOT default to the earliest occurrence when a high-frequency query
term occurs early in the chunk and a distinctive query term occurs later. Selection MUST prefer
the region containing the query's distinctive terms.

#### Scenario: A high-frequency term near the start does not win over a later distinctive term

- GIVEN a query whose high-frequency term occurs before flattened offset 100 of the rank-1 chunk,
  while its distinctive terms cluster past flattened offset 1400
- WHEN `search_docs` returns
- THEN the rank-1 result's `excerpt` contains the distinctive-term region, not the early
  high-frequency term's neighbourhood

