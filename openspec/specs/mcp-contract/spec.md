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

### Requirement: A Heading Line Inside a Fenced Code Block Is Not an Addressable Section

A line matching the `##`-through-`######` heading pattern that occurs inside a fenced code block (delimited by matching ` ``` ` or `~~~` markers, either fence style) MUST NOT be treated as an addressable section of the document by `read_doc`. This applies to both consumers of derived heading names: `read_doc({ path, section })` MUST NOT resolve a request against a chunk whose only match for the requested `section` is such a fenced heading line, and a `section-not-found` response's list of available section names MUST NOT include one. A heading line outside any fence — including one below the chunker's H2/H3 descent, reachable only from within chunk content — is unaffected by this requirement and continues to resolve and to be listed exactly as before.

When the only candidate match for a requested `section` is a fenced heading line, the correct response is `section-not-found`, not a resolution against whichever chunk happens to contain that line. A response produced this way is not distinguished from an ordinary no-match response by any additional field; it is the same `section-not-found` shape the system already produces for a `section` value that matches nothing at all.

**Scope is chunk-local, and that is a documented boundary, not an oversight.** A document is read one stored chunk at a time; a fence that opens in one chunk and closes in a later one is not tracked across that boundary, so a heading line inside such a straddling, chunk-crossing fence remains addressable. The same is true of a fence left unterminated for the rest of the document, and of an indented (4-space) code block, which carries no fence delimiter to detect at all. This requirement does not cover those three shapes; it covers a heading line whose enclosing fence opens and closes within the content of the single chunk being read.

A fourth shape is also not covered, and its consequence is the opposite of the mid-fence-start non-guarantee above: a chunk whose fence-delimiter count is even but *misaligned* — one stray closing delimiter (continuing a fence opened in a preceding chunk) immediately followed, later in the same chunk, by one stray opening delimiter (starting a fence that continues into a following chunk) — is indistinguishable, from within that chunk alone, from a genuine, self-contained, balanced fence. A heading line sitting between the two stray delimiters can therefore be suppressed even though a document-wide view would have kept it addressable. Where the mid-fence-start non-guarantee's outcome is safe (a heading merely stays reachable, unguarded), this one's outcome is the regression direction this requirement otherwise rules out (a real heading becomes unreachable). It is accepted on reachability grounds rather than closed, because closing it needs document-level fence state, which is out of scope for this requirement's chunk-local mechanism.

This requirement governs `read_doc`'s own derivation of section names from chunk content. It does not modify, and is not satisfied or violated by, the existing requirements governing a `section` value's non-emptiness and round-trip through `search_docs` (the "`search_docs`'s `section` Is Never Empty and Round-Trips" requirement) or the emptiness of listed labels (the "`read_doc` Never Renders an Empty-Labeled Bullet..." requirement) — those govern different inputs (a `search_docs`-produced `heading`, and label emptiness) and neither is affected by this change.

#### Scenario: A request naming only a fenced heading returns section-not-found

- GIVEN a document with a chunk whose content contains a fenced code block, and inside that fence a line matching the heading pattern (e.g. `## Business rules`), with no chunk in the document actually headed by that name
- WHEN `read_doc` is called with `{ path, section: "Business rules" }`
- THEN the response is `section-not-found`, not a `section` result built from the chunk containing the fenced line

#### Scenario: The live case — `docs/documentation-convention.md`, "Business rules"

- GIVEN this repository's own `docs/documentation-convention.md`, indexed as this repo indexes it (zero-config `loose`), whose "12. Templates" chunk contains a fenced functional-spec template with a `## Business rules` line inside that fence
- WHEN `read_doc` is called with `{ path: "docs/documentation-convention.md", section: "Business rules" }`
- THEN the response is `section-not-found` — not the "12. Templates" chunk's content

#### Scenario: A fenced heading is absent from the available-sections listing

- GIVEN the same document, and a `read_doc` call whose requested `section` matches no real section
- WHEN the `section-not-found` response lists available section names
- THEN none of the heading-pattern lines that occur inside that document's fenced code blocks appears in that list

#### Scenario: Both fence marker styles suppress the phantom heading

- GIVEN two otherwise-identical chunks, one containing a heading-pattern line inside a ` ``` `-delimited fence and the other inside a `~~~`-delimited fence
- WHEN `read_doc` derives addressable section names from each chunk's content
- THEN neither fenced heading line is offered or resolved as a section, regardless of which fence style encloses it

#### Scenario: A genuine section heading outside any fence still resolves

- GIVEN a document with a real H4 heading that exists only inside a chunk's content (below the chunker's H2/H3 descent) and is not inside any fenced code block
- WHEN `read_doc` is called with a `section` value matching that heading
- THEN the response is a `section` result for that heading, unaffected by this requirement

#### Scenario: A fence left open across chunk boundaries is a documented non-guarantee

- GIVEN a chunk whose content begins mid-fence, with no opening delimiter in that chunk because the fence opened in a preceding chunk
- WHEN that chunk contains a heading-pattern line
- THEN this requirement does not guarantee that line is excluded from resolution or listing — chunk-crossing and unterminated fences are outside this requirement's scope, as stated above

### Requirement: A Heading-Pattern Line Inside a Fenced Code Block Is Not Stripped From a `search_docs` Excerpt

A line matching the ATX heading pattern (`#` through `######`) inside a fenced code block (` ``` ` or `~~~`) within a chunk's content MUST NOT be removed from that chunk's `search_docs` excerpt as a heading — it is author-written content, already covered by the result's `section`. A heading-pattern line OUTSIDE any fence MUST still be stripped as today; this narrows the strip's scope, it does not remove it.

**Scope is chunk-local**, matching the sibling `read_doc` requirement, using the same delimiter-counting rule: retention applies only when that chunk's own fence-delimiter-line count is even (balanced). An odd count means the chunk begins or ends mid-fence, and the line is stripped as today.

Fence delimiter lines MUST keep appearing in the flattened text — a later step needs them to recognize and drop a whole fence when a pass excludes fenced content. A match on a now-retained line MUST become locatable for lead-excerpt centering; before this requirement it had no surviving text to centre on.

This requirement governs only what text is removed before this spec's window/budget/ellipsis rules apply; it does not modify the sibling `read_doc` requirement, which governs a different consumer of the same chunk content.

**Four shapes are not covered**, per the sibling requirement's discipline, with different consequences here:

1. **Unterminated fence** (odd count) — strip still applies; unfixed, not regressed.
2. **Chunk-crossing fence** — same shape and consequence as (1).
3. **4-space indented code block** — no delimiter to detect; still stripped.
4. **Misaligned-even parity hole** — a stray-closer-then-stray-opener chunk reads as balanced. Unlike the sibling requirement, where this makes a real heading unreachable, here it is **opposite and milder**: a real heading is misread as fence-interior and **retained**, leaking into the excerpt as prose — cosmetic, not correctness-breaking.

This takes effect **without reindexing**: excerpts are computed from stored chunk content at query time, so the next call reflects it — the opposite of a chunk-boundary or heading change, which needs a full reindex.

#### Scenario: A fence-interior heading-pattern line is retained when the excluded pass is empty

- GIVEN a chunk whose content is entirely one fenced code block, with a line inside it matching the heading pattern (e.g. `# a python comment`), so the fenced-blocks-excluded pass yields no text
- WHEN `search_docs` falls back to the fenced-blocks-included pass for that chunk
- THEN the excerpt contains that heading-pattern line's own text

#### Scenario: A real heading outside any fence is still dropped

- GIVEN a chunk whose content contains a heading-pattern line outside any fenced code block
- WHEN `search_docs` returns a result for that chunk
- THEN the `excerpt` text does not contain that heading line

#### Scenario: An odd fence-delimiter count leaves today's behavior unchanged

- GIVEN a chunk containing an unterminated (odd delimiter count) fence with a heading-pattern line inside it
- WHEN `search_docs` returns a result for that chunk
- THEN the heading-pattern line is stripped from the `excerpt`, exactly as before this requirement

#### Scenario: A fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass

- GIVEN a chunk containing a balanced backtick fence with a heading-pattern line inside it (now retained by this requirement) and no interior backtick
- WHEN `search_docs` computes that chunk's excerpt with fenced blocks excluded (the default first pass)
- THEN the entire fence, including the retained heading-pattern line, is absent from the excerpt — proof that delimiter lines survived for the exclusion step to still recognize the fence

#### Scenario: A simple balanced fence is still fully dropped when fenced blocks are excluded

- GIVEN a chunk containing a balanced backtick fence with no interior backtick
- WHEN `search_docs` computes its excerpt with fenced blocks excluded (the default first pass)
- THEN the entire fence is absent from the excerpt — unchanged from before this requirement

#### Scenario: The live case — `docs/documentation-convention.md`, "12. Templates"

- GIVEN this repo's `docs/documentation-convention.md`, whose "12. Templates" chunk is a fenced template containing `## Business rules`, `## Use cases`, `## Out of scope`
- WHEN `search_docs` matches that chunk and falls back to the fenced-blocks-included pass
- THEN the excerpt contains all three phrases — absent before this requirement

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

### Requirement: `docs_overview` Taxonomy Counters Are Safe For Any `type`/`module` Value

Every `type` and `module` value MUST be counted correctly in `docs_overview`'s rendered `By type:` and `By module:` lines, regardless of the string — including a value that collides with a member name inherited from `Object.prototype` (`__proto__`, `constructor`, and their kin). A bucket keyed by such a value MUST appear in the rendered output with its correct numeric count: it MUST NOT be silently omitted, MUST NOT render as anything other than that count in its place, and MUST NOT alter the count reported for any other value in the same corpus. This requirement governs the *safety of a bucket's value* for any string key; it is a sibling to, and does not modify, "`docs_overview` Omits Empty Taxonomy Buckets", which governs bucket *presence* and is unaffected by this one — a corpus that genuinely declares no `type`/`module` still omits that line entirely, exactly as before.

#### Scenario: A `__proto__` type value is not silently dropped

- GIVEN a corpus containing a document whose `type` is the literal string `__proto__`
- WHEN `docs_overview` is called
- THEN the rendered `By type:` line includes a `__proto__ (1)` entry, not an omitted bucket

#### Scenario: A `constructor` type value renders as a count, not garbled text

- GIVEN a corpus containing a document whose `type` is the literal string `constructor`
- WHEN `docs_overview` is called
- THEN the rendered `By type:` line includes a `constructor (1)` entry, and contains no rendered function source text (e.g. `native code`) in its place

#### Scenario: A `__proto__` module value, reached via a folder name, is not silently dropped

- GIVEN a corpus containing a document whose path places it under a folder literally named `__proto__`, so its inferred `module` is `__proto__`
- WHEN `docs_overview` is called
- THEN the rendered `By module:` line includes a `__proto__ (1)` entry, not an omitted bucket

#### Scenario: A `constructor` module value, reached via a folder name, renders as a count

- GIVEN a corpus containing a document whose path places it under a folder literally named `constructor`, so its inferred `module` is `constructor`
- WHEN `docs_overview` is called
- THEN the rendered `By module:` line includes a `constructor (1)` entry, and contains no rendered function source text in its place

#### Scenario: A hostile value does not affect an ordinary value's count in the same corpus

- GIVEN a corpus mixing documents typed `__proto__`, `constructor`, and an ordinary value such as `guide`
- WHEN `docs_overview` is called
- THEN the rendered `By type:` line reports the correct count for all three, with the ordinary value's count unaffected by the other two

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

### Requirement: Config-Warning Visibility in `docs_overview` Response

The `docs_overview` MCP tool's rendered text response MUST include a `Config:` block whenever the running process's loaded configuration produced one or more config-load reports (an invalid declared numeric value, an unrecognized key, or an inverted `chunk.minTokens`/`chunk.maxTokens` pair — see the Configuration spec's "Config Load Reports Invalid Values and Unrecognized Keys"). This block is distinct from, and never folded into, the `Sync:` block: a config-load report describes a property of the running process, constant for its lifetime, while `Sync:` describes the outcome of the most recent sync pass. The `Config:` block MUST be omitted entirely — never rendered empty — when the loaded configuration produced no report. Because the report describes process-lifetime state rather than a one-time event, it MUST be rendered on every `docs_overview` call for as long as the process runs with that configuration, not only on the first call.

#### Scenario: A running process with an invalid declared value renders the block

- GIVEN a process started with `compendio.config.json` declaring an invalid `chunk.maxTokens`
- WHEN `docs_overview` is called
- THEN its rendered response includes a `Config:` block naming the fallback

#### Scenario: A clean configuration omits the block

- GIVEN a process started with no `compendio.config.json`, or one declaring only valid, recognized keys with `chunk.minTokens` at or below `chunk.maxTokens`
- WHEN `docs_overview` is called
- THEN its rendered response contains no `Config:` block

#### Scenario: The block persists across repeated calls, not only the first

- GIVEN a process started with an invalid declared config value
- WHEN `docs_overview` is called twice in the same process lifetime
- THEN the `Config:` block appears in both responses, not only the first

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

### Requirement: Root-Alias-Prefixed `path` Flows Through `search_docs`, `read_doc`, and `docs_overview`, Always

Every `path` value returned by `search_docs` result items and `docs_overview`'s per-document lines MUST carry its document's root-alias prefix, unchanged from the value persisted at index time — regardless of how many roots are declared, including the default single-element `["docs"]` root set. `read_doc({ path })` MUST accept that same root-prefixed value verbatim and resolve it to the corresponding document: a `path` returned by `search_docs` or `docs_overview` MUST round-trip through `read_doc` with no caller-side stripping or rewriting.

#### Scenario: `search_docs` returns a root-prefixed path

- GIVEN `docsDir: ["docs", "openspec"]` and a query whose only match lives under the `openspec` root
- WHEN `search_docs` returns
- THEN the matching result item's `path` carries the `openspec/` prefix

#### Scenario: A root-prefixed path round-trips through `read_doc`

- GIVEN a `path` value returned by `search_docs` or `docs_overview`
- WHEN that exact value is passed as `read_doc({ path })`
- THEN the response is a `"document"` (or `"section"`) result, never `"path-not-found"`

#### Scenario: `docs_overview` lists root-prefixed paths across every declared root

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `docs_overview` is called
- THEN its per-document lines include documents from both roots, each shown under its own root-prefixed `path`

#### Scenario: The default single-root set still prefixes every path

- GIVEN no config file, so `docsDir` defaults to `["docs"]`
- WHEN `search_docs`, `read_doc`, and `docs_overview` are called
- THEN every `path` value returned or accepted carries the `docs/` prefix — not the unprefixed shape prior versions produced

### Requirement: Unknown `path` Suggests the 3 Closest Matches

When `read_doc` is called with a `path` that does not match any indexed document, the system MUST respond with the 3 closest matching paths instead of raising an error. This behavior predates this change and is unaffected by the rename — it is stated here because the suggestion payload now carries `path` fields under their English name.

#### Scenario: Unknown path returns closest matches instead of an error

- GIVEN a corpus with no document at `docs/authh/login.md`
- WHEN `read_doc` is called with `path: "docs/authh/login.md"`
- THEN the response returns the 3 closest matching `path` values rather than throwing an error

### Requirement: `read_doc` Tolerates Exactly One Extra Leading Path Segment

`read_doc({ path })` MUST attempt to resolve the literal `path` value against the index first. When the literal value does not match any indexed document, the system MUST retry exactly once with the path's leftmost segment stripped (e.g. `repo/docs/x.md` → `docs/x.md`), and MUST use that match if found. This tolerance MUST NOT be applied recursively — only one segment is ever stripped, and only as a fallback attempted after the literal path has already missed, so a genuine document whose own `path` is the stripped form always loses to an exact match at the deeper, literal path when both would otherwise apply. The tolerance MUST NOT add a segment: a `path` value with fewer segments than an indexed document's `path` (e.g. a bare basename supplied for a document indexed as `docs/x.md`) MUST NOT be resolved by this mechanism.

#### Scenario: A one-segment-over-prefixed path resolves via the stripped fallback

- GIVEN a document indexed as `docs/x.md`
- WHEN `read_doc` is called with `path: "repo/docs/x.md"`
- THEN the literal value misses, the system retries with the leading segment stripped (`docs/x.md`), and that match resolves the document

#### Scenario: An exact match always wins over the stripped fallback

- GIVEN `docsDir: ["docs", "adr"]`, a document indexed as `docs/adr/x.md` (a file under the `docs` root, in its `adr/` subdirectory) and another indexed as `adr/x.md` (a file at the top of the `adr` root)
- WHEN `read_doc` is called with `path: "docs/adr/x.md"`
- THEN the literal exact match resolves directly, and the stripped-fallback lookup is never attempted

#### Scenario: A miss whose stripped form names another root's document resolves to that document

- GIVEN `docsDir: ["docs", "adr"]` and a document indexed as `adr/x.md`, with **no** document indexed as `docs/adr/x.md`
- WHEN `read_doc` is called with `path: "docs/adr/x.md"`
- THEN the literal value misses, the one-segment strip yields `adr/x.md`, and that document is returned — the tolerance MUST NOT special-case this, because the stripped form is a legitimate indexed path and the mechanism cannot distinguish it from the over-prefixed case it exists to serve

> **This is a documented non-guarantee, not an oversight.** Because every alias is exactly one segment,
> a stripped path can name a different root's document whenever the first segment of the requested
> path happens to equal another declared alias. It fires **only** when the requested path does not
> exist, so it converts a "path not found" into a plausible neighbouring document rather than
> corrupting a correct lookup. An earlier design revision claimed such a hit was "not representable";
> that claim was too strong and is withdrawn here. Callers that need certainty pass a `path` returned
> by `search_docs` or `docs_overview`, which always exists and therefore always takes the exact branch.

#### Scenario: A bare basename does not recover a root prefix

- GIVEN a document indexed as `docs/x.md` and no document indexed as the bare `x.md`
- WHEN `read_doc` is called with `path: "x.md"`
- THEN the literal value misses, the one-segment tolerance offers no further reduction of a single-segment path, and the response is the documented "unknown path" result with the 3 closest matches — not a resolved document

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

