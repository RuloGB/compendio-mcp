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

Fence delimiter lines MUST keep appearing in the flattened text — a later step needs them to recognize and drop a whole fence when a pass excludes fenced content.

**Narrowed by `excerpt-fence-drop-generalization`: a retained line's locatability is pass-scoped, not general.** A match on a now-retained heading-pattern line becomes locatable for lead-excerpt centering ONLY on the fenced-blocks-INCLUDED pass (the fallback that fires when the excluded pass yields no text at all) — never on the fenced-blocks-EXCLUDED pass, because that pass now recognizes and drops every fence style (backtick or tilde) that could retain such a line, regardless of whether an interior backtick is present. Before `excerpt-fence-drop-generalization`, a retained line inside a `~~~`-delimited fence happened to remain locatable even on the excluded pass, because that pass's fence-recognition was backtick-only and therefore blind to `~~~` fences; that was an incidental consequence of the fence-recognition gap this sibling change closes, not a designed guarantee, and it no longer holds for any fence style once fence-recognition is style-agnostic.

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

#### Scenario: A fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass, regardless of delimiter style

- GIVEN a chunk containing a balanced backtick fence with a heading-pattern line inside it (now retained by this requirement) and no interior backtick
- WHEN `search_docs` computes that chunk's excerpt with fenced blocks excluded (the default first pass)
- THEN the entire fence, including the retained heading-pattern line, is absent from the excerpt — proof that delimiter lines survived for the exclusion step to still recognize the fence

#### Scenario: A simple balanced fence is still fully dropped when fenced blocks are excluded

- GIVEN a chunk containing a balanced backtick fence with no interior backtick
- WHEN `search_docs` computes its excerpt with fenced blocks excluded (the default first pass)
- THEN the entire fence is absent from the excerpt — unchanged from before this requirement

#### Scenario: A retained heading-pattern line's match is locatable only on the fenced-blocks-included fallback pass

- GIVEN a chunk containing a balanced fence (backtick or tilde) with a heading-pattern line inside it, mixed with enough surrounding prose that the fenced-blocks-excluded pass does NOT yield empty text
- WHEN `search_docs` computes that chunk's excerpt with fenced blocks excluded (the default first pass), for a query matching that heading-pattern line
- THEN the fence, including the heading-pattern line, is absent from the excerpt — the match is not locatable on this pass, regardless of delimiter style

#### Scenario: The live case — `docs/documentation-convention.md`, "12. Templates"

- GIVEN this repo's `docs/documentation-convention.md`, whose "12. Templates" chunk is a fenced template containing `## Business rules`, `## Use cases`, `## Out of scope`
- WHEN `search_docs` matches that chunk and falls back to the fenced-blocks-included pass
- THEN the excerpt contains all three phrases — absent before this requirement

### Requirement: Fenced Content Is Excluded From a `search_docs` Excerpt Regardless of Delimiter Style or Interior Backticks

When `search_docs` computes a result's `excerpt` with fenced blocks excluded (the default first pass),
a fenced code block MUST be excluded from that excerpt regardless of which delimiter style opens it
(` ``` ` or `~~~`) and regardless of whether the fence's interior contains a literal backtick. This
holds identically for the lead (rank 1) excerpt and every supporting (rank ≥ 2) excerpt, since both are
built through the same fenced-blocks-excluded pass over the same chunk content.

Before this requirement, a `~~~`-delimited fence was never excluded in either pass, and a backtick-delimited
fence whose interior contained a stray backtick was never excluded either — the fenced-blocks-excluded and
fenced-blocks-included passes produced byte-identical output for such a chunk, leaking the whole fence
(delimiters and body) into the excerpt as if exclusion were disabled for it.

**Scope is chunk-local and pass-scoped**, matching the sibling requirement above: this governs only the
fenced-blocks-excluded pass. The fenced-blocks-included pass (used as fallback when the excluded pass
yields no text) MUST remain entirely unaffected — a fence's content still survives that pass, unchanged.

**A fence with no interior occurrence of its own delimiter character produces byte-identical excluded-pass
output before and after this requirement** — this requirement widens which fences are recognized and
excluded; it does not change how an already-recognized, already-excluded fence is excluded.

**An unterminated fence** (no closing delimiter anywhere within the chunk) MUST NOT be excluded — this is
unchanged from before this requirement, in either delimiter style.

**A named, accepted non-guarantee — the balanced-parity divergence.** `read_doc`'s section lookup and the
excerpt flatten chain's heading-retention step both refuse to act on a chunk whose own fence-delimiter-line
count is ODD (unbalanced): they treat the whole chunk's fence state as untrusted and touch nothing. This
requirement's fence exclusion does NOT consult that same whole-chunk parity check — it locates the nearest
matching delimiter pair directly. Consequently, in a chunk containing a well-formed inner fence pair
followed by a further stray, unmatched delimiter (making the chunk's total delimiter count odd), `read_doc`
and the heading-retention step treat the entire chunk as untrusted and change nothing, while this
requirement's exclusion still finds and drops the well-formed inner pair, leaving only the stray delimiter
as leftover text. This is deliberately accepted, not a defect to be closed: nothing that should survive is
deleted by it, and closing it would require this exclusion step to consult whole-chunk delimiter parity
before matching — an architecture change this requirement deliberately does not make.

**A second named, accepted non-guarantee — improperly interleaved fences.** Exclusion pairs each opening
delimiter with the NEAREST following delimiter of the same style. Fences NESTED either way round are
handled correctly: the outer fence is consumed whole, which is what a nested fence's content is. But a
malformed document that INTERLEAVES two styles without nesting them (a tilde fence opened, a backtick
fence opened inside it, the tilde fence closed, then the backtick fence closed) pairs across the two
styles and leaves the trailing residue in the excerpt as text. The input is malformed markdown, nothing
that should survive is deleted, and this is accepted rather than closed.

#### Scenario: Fences nested one inside the other are excluded as a single outer fence

- GIVEN a chunk containing a backtick-delimited fence written inside a `~~~`-delimited fence (or the
  mirror image)
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the outer fence and everything it contains, including the inner fence, are absent from the excerpt

#### Scenario: Improperly interleaved fences leave a residue

- GIVEN a chunk in which a `~~~` fence and a backtick fence are opened and closed in interleaved order
  rather than nested order
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the first matched delimiter pair's content is absent from the excerpt
- AND the trailing unpaired delimiter and the text following it remain — the named, accepted non-guarantee

#### Scenario: A tilde-fenced block is excluded from the lead excerpt

- GIVEN a chunk ranked first whose content mixes prose with a `~~~`-delimited fenced code block
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the excerpt contains none of the fence's delimiter lines or interior content
- AND the excerpt contains the chunk's prose

#### Scenario: A tilde-fenced block is excluded from a supporting excerpt

- GIVEN a chunk ranked second or later whose content mixes prose with a `~~~`-delimited fenced code block
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the excerpt contains none of the fence's delimiter lines or interior content

#### Scenario: A CRLF-encoded tilde fence is excluded identically to an LF-encoded one

- GIVEN two otherwise-identical chunks, one using LF line endings and one using CRLF line endings, each
  containing a `~~~`-delimited fenced code block
- WHEN `search_docs` computes each result's excerpt with fenced blocks excluded
- THEN both excerpts exclude the fence's content identically, regardless of line-ending style

#### Scenario: A tilde fence carrying an info string is excluded in full

- GIVEN a chunk containing a fence opened with `~~~json` (an info string following the delimiter)
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the excerpt contains neither the delimiter line (including its info string) nor the fence's interior

#### Scenario: An indented tilde fence is excluded in full

- GIVEN a chunk containing a `~~~`-delimited fence whose delimiter lines carry leading whitespace (e.g.
  inside a list item)
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the excerpt contains neither the delimiter lines nor the fence's interior

#### Scenario: A backtick fence with an interior backtick is now excluded, diverging from the included pass

- GIVEN a chunk containing a balanced backtick-delimited fence whose interior contains a single literal
  backtick (e.g. a code comment quoting a backtick)
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded, and separately with
  fenced blocks included
- THEN the excluded-pass excerpt contains none of the fence's delimiter lines or interior content
- AND the excluded-pass excerpt differs from the included-pass excerpt, which still contains the fence in full

#### Scenario: A fence with no interior same-character content is unaffected

- GIVEN a chunk containing a balanced backtick-delimited fence whose interior contains no backtick, or a
  balanced tilde-delimited fence whose interior contains no tilde
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded, before and after this
  requirement takes effect
- THEN the excerpt text is byte-identical in both cases

#### Scenario: An unterminated fence is still not excluded

- GIVEN a chunk containing a fence opening delimiter with no matching closing delimiter anywhere in the
  chunk
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the fence's opening delimiter and its following content remain in the excerpt, unchanged from
  before this requirement

#### Scenario: The fenced-blocks-included fallback pass is unaffected

- GIVEN a chunk whose content is entirely one `~~~`-delimited fenced code block, so the excluded pass
  yields no text
- WHEN `search_docs` falls back to the fenced-blocks-included pass for that chunk
- THEN the excerpt contains the fence's full content, exactly as it would have before this requirement

#### Scenario: A well-formed inner fence pair is dropped even when the chunk's total delimiter count is odd

- GIVEN a chunk containing a complete, well-formed backtick fence pair followed by one further, unmatched
  opening delimiter (an odd total delimiter count for the chunk)
- WHEN `search_docs` computes that result's excerpt with fenced blocks excluded
- THEN the well-formed fence pair's content is absent from the excerpt
- AND the trailing unmatched delimiter remains as leftover text — the named, accepted non-guarantee

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

Every `path` value returned by `search_docs` result items and `docs_overview`'s per-document lines MUST carry its document's root-alias prefix in explicit mode and its discovered top-level root prefix in discovery mode, unchanged from the value persisted at index time. `read_doc({ path })` MUST accept that same value verbatim and resolve it to the corresponding document. The zero-config path shape MUST remain round-trippable.
(Previously: only the declared-root shape was specified, implicitly assuming a default single-element `["docs"]` root set; discovery-mode path shape was absent.)

#### Scenario: Zero-config paths round-trip without stripping

- GIVEN discovery mode is active and `search_docs` returns a path under `openspec/`
- WHEN that exact path is passed to `read_doc`
- THEN the document resolves successfully

#### Scenario: Explicit-mode paths remain unchanged

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `docs_overview` or `search_docs` returns a path
- THEN the path still carries the declared root alias unchanged

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

#### Scenario: A single declared root still prefixes every path

- GIVEN `docsDir: ["docs"]`
- WHEN `search_docs`, `read_doc`, and `docs_overview` are called
- THEN every `path` value returned or accepted carries the `docs/` prefix — not the unprefixed shape prior versions produced

### Requirement: `read_doc` Returns a Section Outline for Large Documents

When `read_doc` is called without `section`, the system MUST estimate the token size of the document using the existing token-estimation function (chars/4), computed over exactly the `content` string that a `document`-type response (no `section`) returns for that document — the matching stored parts joined together, with a title heading line restored when the joined text does not already start with one — and not over anything else; frontmatter is not part of this check, since it is added only afterward when formatting the response.

A heading counts as addressable when requesting it as `section` does NOT return every stored part of the document — that is, the set of stored parts that `read_doc({ path, section: heading })` draws its content from is not the complete set of parts stored for the document. This is a structural comparison, not a text comparison against the full-document response: a whole-document response (no `section`) prepends a `# title` line when the document's own content has no H1, while a `section` response never adds that line; this prepended title line is excluded from the comparison and never makes an otherwise-non-addressable heading addressable or vice versa.

Addressability is evaluated over one row per distinct normalized heading title (after the row-classification and collapsing rule below), in a fixed, deterministic, document-position order, and lazily: the check stops as soon as 2 addressable rows are found, or after evaluating a fixed maximum of 2,000 candidates in that order, whichever comes first. A document whose first 2,000 evaluated candidates include fewer than 2 addressable rows MUST fall back to the full document response, even if a later, unevaluated candidate would have been addressable; this bounds the gate's worst-case cost independently of document size.

If the estimated `content` size exceeds 6,000 tokens AND the document has 2 or more addressable rows, the response MUST be an outline instead of the document body.

The outline MUST list every H2 heading, and every H3 heading that appears before any H2 heading, as top-level rows sharing one namespace — H2s and pre-H2 H3s are never distinguished by nesting level among top-level rows. An H3 heading nested under exactly one H2 parent title is listed as that parent's child row instead. (H4 and deeper headings are never listed.) Which rows are actually rendered is subject to the outline row budget defined below; the budget MAY omit some children and MAY omit top-level rows themselves, but never changes which rows exist for the purpose of the addressable-row gate above. The outline MUST carry the document's frontmatter/metadata the same way the full-document response does.

**Row identity and collapsing.** Every listed row corresponds to a distinct normalized heading title (the same normalization used for section lookup); the outline MUST NOT list two rows for the same normalized title. A title is classified once, document-wide, from all of its H2/H3 occurrences:
- it is a **top-level row** when at least one of its occurrences is an H2, or an H3 appearing before any H2;
- otherwise, when every one of its occurrences is an H3 nested under the same single H2 parent title, it is that parent's **child row**;
- otherwise — an H3 title occurring under 2 or more distinct H2 parent titles, with no top-level occurrence — it belongs to a separate **`repeated` group**, listed once, apart from any parent's children.

When a title qualifies for both the top-level classification and the `repeated` classification (it has at least one top-level occurrence AND is also an H3 under 2 or more distinct parents), it MUST be classified as a top-level row, never as `repeated`, and none of its occurrences count toward the `repeated` group.

A top-level row is positioned at its first occurrence that is itself top-level (an H2, or an H3 before any H2) — which MAY be later in the document than the title's true first occurrence, when that first occurrence was a nested child occurrence later promoted by a top-level occurrence of the same title. This also covers the case where a title occurs once at the top level (an H2, or an orphan H3 before any H2) and once as an H3 under exactly one H2 parent: the title is a single top-level row; its child occurrence is pooled into that row's occurrence count and does NOT additionally appear in that parent's `children`. A promoted title (top-level or `repeated`) is excluded from every parent's `children` list. Every listed row MUST carry an occurrence count: the total number of H2/H3 lines, document-wide, sharing its normalized title. This count renders as a fixed short flag ("xN") if, and only if, the row's occurrence count is greater than 1.

This collapsing and classification MUST happen before addressable rows are counted for the 2-or-more gate above.

**The "+other" flag.** Every listed row MUST carry a fixed, locale-independent flag ("+other") if, and only if, requesting that row's heading as `section` returns content belonging to another heading occurrence's own section — that is, content that lies outside the span owned by the row's own heading occurrence(s). A heading occurrence's own span runs from that occurrence up to (but not including) the next heading occurrence, document-wide, at the same level or shallower. For a row backed by more than one occurrence (a pooled top-level title, or a `repeated` entry), the row's own sections are the union of every pooled occurrence's own span; the flag is set only when some matched content falls outside every one of those spans — content inside any one pooled occurrence's own span is never treated as foreign, even when it falls outside another pooled occurrence's span. A stored chunk that precedes every heading occurrence in the document (for example, the untitled introduction before the first H2/H3) belongs to no heading's own span; if such a chunk is pulled into a row's matched content (for example, because that row's title is a substring of the document's own title), the row's flag is always set.

This single rule covers: an H3 repeated under different H2 parents; one heading's text being a substring of another's; two adjacent sections fused at index time into one stored chunk; and a single oversized H2 with no H3 children whose content was split across multiple stored chunks by the chunker — in this last case every physical piece still belongs to the same single heading occurrence's own span, so the flag is NOT set. An ordinary H2 heading whose `section` response includes only its own nested H3 children's content, or its own repeated child titles, MUST NOT carry the flag, because a row's own children's content is never treated as foreign to it. The flag text MUST be generic and MUST NOT name the specific overlapping heading(s); its meaning is stated exactly once, in a legend line, and only when at least one listed row carries it.

**The "too large" flag.** A listed row whose own estimated token size still exceeds 6,000 tokens MUST carry a fixed, short flag ("too large") rather than a per-row prose annotation; the flag's meaning — that the heading is still too large to request as-is, and the agent should request a narrower heading or use its own file-reading tool — MUST be stated exactly once, in a legend line, not repeated per row. This applies whether or not that heading has nested children. This is an accepted, documented limitation: the outline does not nest further than H2/H3, and there is no way to force a smaller response for that single heading.

When a row carries more than one flag, they MUST render in the fixed order "xN", "too large", "+other"; each flag renders independently of the others, and the legend explains a flag only when some listed row uses it.

**Row budget (bounded outline size).** The rendered outline MUST be bounded in total size regardless of document heading count. The rendered outline's total estimated token size — including the header, legend, and any notice line, but excluding the document's frontmatter and excluding the document path (emitted once, in the header line, and not counted against the budget) — MUST NOT exceed 2,300 estimated tokens, for any document heading count, including documents with thousands of headings. Rows are selected for rendering, in a fixed degradation order:
1. If every candidate row (all top-level rows, their children, and the `repeated` group) fits within budget, all are rendered.
2. Otherwise, if the top-level rows alone fit within budget, all top-level rows are rendered; children of "too large" top-level rows are then rendered as a prefix, in document order, until the first child that would not fit. The `repeated` group and any remaining, unshown children are omitted. The response MUST carry a notice stating how many rows were hidden by this omission — counting both the omitted children and the omitted `repeated` group entries together — and directing the agent to request one of the listed headings, or to find a subsection with `search_docs` and pass its `section` value.
3. Otherwise, only the longest prefix of top-level rows, in document order, that fits within budget is rendered, with no children and no `repeated` group. The response MUST carry a notice stating how many of the total top-level headings are shown, and directing the agent to find the section with `search_docs` and pass its `section` value, or to use its own file-reading tool.

The row budget affects only which rows are rendered; it MUST NOT affect the addressable-row gate decision (full document vs. outline) described above, which is always evaluated over the full, unbudgeted set of candidate rows.

Every heading listed in the outline, passed back verbatim as `read_doc({ path, section })`, MUST resolve to a `section` result — never `section-not-found`— regardless of whether it is a top-level row, a child row, a `repeated` group entry, or a row shown only because an earlier row was omitted by the budget. Section-lookup semantics are unchanged: requesting a listed H2 continues to return its nested H3 content as well (substring matching, unchanged).

A document whose estimated `content` size exceeds the threshold but has fewer than 2 addressable rows (evaluated per the row classification, collapsing, and gate rules above) MUST be returned in full, exactly as documents at or below the threshold are today. This includes, but is not limited to: a large document with a single H2 heading and many H4 headings (H4s are never addressable, so at most one row can qualify), a large document stored as a single chunk (for example, a `NO_CHUNKING` document such as `glosario.md`), where requesting any of its headings as `section` returns the entire document and therefore is never addressable, and a large document whose entire structure is one wrapping H2 with no intro text, directly followed by many H3 children, where every heading's `section` response happens to include the whole document (that wrapper H2 is not addressable, but is still listed per this requirement, flagged "too large" if it exceeds 6,000 tokens itself). There is no parameter or configuration key to force full-body return above the threshold when 2 or more addressable rows exist; an agent that needs to read or summarize the whole large document starts from its outline and requests the sections it needs. The `read_doc` tool description and the server instructions MUST route whole-document reading this way and MUST NOT send it to the agent's own file-reading tool.

The `read_doc` tool description and any server-level usage instructions MUST NOT state that omitting `section` always returns the entire document; they MUST instead reflect that the entire document is returned when it is small or cannot usefully be split into sections, and that a large document with sections returns an outline.

**Non-guarantees** (documented, accepted, not covered by this requirement): a setext-style heading (underlined with `===`/`---` rather than a leading `#`) is never listed as a row, inherited from the existing ATX-only heading scanner used for section lookup; two small adjacent sections fused into one stored chunk at index time are both listed as separate rows, both report the same combined size, and both carry the "+other" flag; the internal `addressable` classification used for the gate above is never itself included in the outline response — only the heading text, its estimated size, and its flags are serialized per row; a row whose own single rendered line would already exceed the row budget is never shown; after budget-driven omission or truncation, fewer than 2 addressable rows may be visible in the rendered response even though the gate above found 2 or more; the addressable-row gate is decided over at most the first 2,000 candidates, in the pinned document-position order — not necessarily every candidate — so a document with 2,000 or more candidates where the first 2,000 include fewer than 2 addressable rows falls back to the full document even if a later, unevaluated candidate would have qualified.

#### Scenario: Large document with multiple sections returns an outline

- GIVEN a document whose `content` (as defined above) is estimated above 6,000 tokens and which has 2 or more addressable rows
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is an outline listing H2 headings with nested H3 headings as children, each with an estimated token size, carries the document's frontmatter/metadata, and contains no document body content

#### Scenario: Document at or below the threshold is unaffected

- GIVEN a document whose `content` (as defined above) is estimated at or below 6,000 tokens
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is the full document body, unchanged from prior behavior

#### Scenario: Large document with fewer than 2 addressable headings returns in full

- GIVEN a document whose `content` (as defined above) is estimated above 6,000 tokens and which, after row classification and collapsing, has fewer than 2 rows whose `section` response does not return every stored part of the document
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is the full document body, not an outline

#### Scenario: A large document with one H2 and many H4s returns in full

- GIVEN a large document whose only H2/H3-level heading is a single H2, with additional structure provided only by H4 headings
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is the full document body, because H4 headings are never addressable and at most one row qualifies

#### Scenario: A large single-chunk document returns in full

- GIVEN a large document stored as a single chunk (for example, a `NO_CHUNKING` document such as `glosario.md`), where requesting any of its headings as `section` returns the entire document
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is the full document body, because no heading request returns anything less than every stored part of the document

#### Scenario: A single wrapping H2 with exactly one H3 child returns in full

- GIVEN a large document with no intro text, a single wrapping H2 heading, and exactly one H3 child under it, where requesting the H2 as `section` returns the entire document
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is the full document body: the H2 is not addressable (it returns every stored part), the H3 is addressable, and 1 addressable row is below the 2-or-more gate

#### Scenario: Two identically-titled H2s with nothing else addressable return in full

- GIVEN a large document whose only two H2 headings share the same text (after normalization), and no other listed row is addressable
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN row classification runs first, collapsing both occurrences into a single top-level row, so the response is the full document body, not an outline

#### Scenario: An outline row round-trips through `section`

- GIVEN an outline response for a large document, containing a listed row — a top-level row, a child row, a `repeated` group entry, or a row shown only after budget-driven omission or truncation
- WHEN that row's heading value is passed verbatim as `read_doc({ path, section })`
- THEN the response is a `section` result carrying that heading's content, never `section-not-found`

#### Scenario: A split section is one outline row, not several

- GIVEN a large document whose chunker split one section into multiple stored chunks sharing the same heading
- WHEN the outline is rendered
- THEN that heading appears as exactly one row, with a size equal to the estimated token size of what `read_doc({ path, section: heading })` returns for that heading (all split pieces combined)

#### Scenario: A split oversized heading with no children is not flagged as including other content

- GIVEN a large document with a single H2 heading and no H3 children, whose content was split by the chunker into 2 or more physical stored chunks, where only the first physical piece keeps the literal heading line
- WHEN the outline is rendered
- THEN that heading's row is a single row covering every physical piece, and does NOT carry the "+other" flag, because every physical piece belongs to that same single heading occurrence's own span

#### Scenario: An oversized wrapper heading is listed with a flag

- GIVEN a large document with a wrapping H2 heading whose H3 children together make requesting that H2 exceed 6,000 tokens
- WHEN the outline is rendered
- THEN the wrapping H2's row is listed, carrying the "too large" flag, explained once in the legend, while its H3 children carry no such flag

#### Scenario: An oversized heading with no children is listed with a flag

- GIVEN a large document with an H2 heading, and no H3 children under it, whose own content exceeds 6,000 tokens
- WHEN the outline is rendered
- THEN that H2's row is listed, carrying the same "too large" flag, with no children to offer as a narrower alternative

#### Scenario: Identical heading titles collapse into one row with an occurrence count

- GIVEN a large document with two H2 headings that share the same text (after normalization)
- WHEN the outline is rendered
- THEN only one row is listed for that heading text, at the position of its first occurrence, carrying the "xN" flag with an occurrence count of 2, and requesting it as `section` resolves the same way it did before this requirement

#### Scenario: A heading repeated under several parents is listed once with its count

- GIVEN a large document with two or more different H2 parents, each having an H3 child that shares the same heading text, and that title has no top-level (H2, or pre-H2 H3) occurrence anywhere in the document
- WHEN the outline is rendered
- THEN that heading text appears exactly once, in a separate `repeated` group apart from any parent's children, carrying an "xN" flag equal to its total occurrence count, and does NOT appear under any parent's `children`

#### Scenario: A title with a child occurrence and a single top-level occurrence is one top-level row

- GIVEN a large document where a title occurs once as an H3 child under exactly one H2 parent, and once at the top level (an H2, or an orphan H3 before any H2)
- WHEN the outline is rendered
- THEN that title is listed exactly once, as a top-level row, positioned at its top-level occurrence; its child occurrence is pooled into that row's occurrence count; and the title does NOT additionally appear in that parent's `children`

#### Scenario: A title promoted to top-level is excluded from the repeated group

- GIVEN a large document where a title occurs as an H3 under two or more distinct H2 parents (qualifying it for the `repeated` group), and also occurs at least once as an H2, or as an orphan H3 before any H2 (qualifying it as top-level)
- WHEN the outline is rendered
- THEN that title is listed exactly once, as a top-level row positioned at its top-level occurrence, and does NOT additionally appear in the `repeated` group

#### Scenario: A substring title overlap flags only the row whose response includes the other

- GIVEN a large document with two unrelated, distinctly-titled headings where one heading's text is a substring of the other's (for example "Scope" and "Out of Scope"), and requesting the shorter heading's text as `section` returns content that includes the other heading's own span
- WHEN the outline is rendered
- THEN the row for the shorter heading ("Scope") carries the "+other" flag; the row for the other heading ("Out of Scope") does NOT carry it, unless its own `section` response likewise includes content outside its own span

#### Scenario: A heading fused with a neighbor at index time is flagged

- GIVEN a large document where two small adjacent sections were fused into a single stored chunk at index time, so requesting either heading's text as `section` returns the fused chunk containing both headings' content
- WHEN the outline is rendered
- THEN both rows carry the "+other" flag, because each row's `section` response includes content outside its own span

#### Scenario: An ordinary H2 with its own H3 children is not flagged

- GIVEN a large document with an H2 heading whose `section` response includes only its own nested H3 children's content and no content from any other listed row's own span
- WHEN the outline is rendered
- THEN that H2's row does NOT carry the "+other" flag, because its H3 children's content is its own, not foreign

#### Scenario: A parent whose section holds repeated child titles is not flagged

- GIVEN a large document with an H2 parent whose own section contains two or more H3 children that happen to share the same heading text as each other, entirely within that parent's own span
- WHEN the outline is rendered
- THEN the H2 parent's row does NOT carry the "+other" flag, because its children's repeated content is still its own, not foreign

#### Scenario: No two rows share a normalized title

- GIVEN any outline response
- WHEN its rows (top-level, children, and `repeated` group entries) are inspected
- THEN no two of them carry the same normalized heading title

#### Scenario: A repeated row fused with its parent's heading is flagged

- GIVEN a `repeated` row whose title occurs as an H3 under several different H2 parents, where each parent's own section was small enough to be emitted, together with the parent's `## heading` line, as a single stored chunk (the child title itself is not split into its own chunk)
- WHEN the outline is rendered
- THEN that `repeated` row carries the "+other" flag, because each pooled occurrence's matched content also includes its parent's own heading line

#### Scenario: A repeated row with no fused foreign content is not flagged

- GIVEN a `repeated` row whose title occurs as an H3 under several different H2 parents, where each parent's own section was large enough that the chunker gave each child its own dedicated stored chunk, with no preceding parent heading line and no other heading's content inside it
- WHEN the outline is rendered
- THEN that `repeated` row does NOT carry the "+other" flag

#### Scenario: A title that is a substring of the document title always flags its row

- GIVEN a large document whose untitled introductory content, before the first H2/H3 heading, carries the document's own title, and a listed heading's text is a substring of that document title
- WHEN the outline is rendered
- THEN that heading's row always carries the "+other" flag, because the introductory content precedes every heading occurrence and belongs to no heading's own span

#### Scenario: An H3 before any H2 is a top-level row

- GIVEN a document whose first heading is an H3, appearing before any H2 heading
- WHEN the outline is rendered
- THEN that H3 is listed as a top-level row, sharing the same namespace as H2 rows, not nested under any H2

#### Scenario: A wrapper heading over an entire spec-delta-shaped document is listed but not addressable

- GIVEN a large document shaped like a single wrapping H2 (for example `## ADDED Requirements`) with no intro text, directly followed by many H3 requirement headings, where requesting the wrapping H2 as `section` returns the whole document
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is an outline that lists the wrapping H2's row (flagged "too large" if it exceeds 6,000 tokens) even though that row is not addressable, and lists each H3 requirement heading as its own addressable child row

#### Scenario: Over budget, only too-large parents keep their subheadings

- GIVEN a large document whose top-level rows fit within the outline's row budget, but whose full set of rows (top-level rows, children, and `repeated` group) does not
- WHEN the outline is rendered
- THEN all top-level rows are rendered; children are rendered, in document order, only for top-level rows flagged "too large", up to the first child that would not fit; the `repeated` group and any remaining children are omitted; and the response carries a notice stating the total number of rows hidden, counting both the omitted children and the omitted `repeated` group entries together

#### Scenario: Over budget, top-level rows themselves are truncated

- GIVEN a large document whose top-level rows alone do not fit within the outline's row budget
- WHEN the outline is rendered
- THEN only the longest prefix of top-level rows, in document order, that fits is rendered, with no children and no `repeated` group, and the response carries a notice stating how many of the total top-level headings are shown

#### Scenario: Truncation never changes the addressable-row gate

- GIVEN a document that qualifies for an outline response because 2 or more addressable rows were found by the gate, but whose rendered outline is reduced by the row budget to fewer than 2 visible addressable rows
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is still the (budget-reduced) outline, not the full document body — the row budget never revisits or reverses the gate's outline-vs-document decision

#### Scenario: Outline size stays bounded at very large heading counts

- GIVEN a document with several thousand H2/H3 headings, of any shape (flat, nested, or with many repeated titles)
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is an outline whose total estimated token size (excluding frontmatter and the document path) does not exceed 2,300 estimated tokens, and the call completes without exhausting available memory

#### Scenario: The addressable-row gate never evaluates more than its candidate cap

- GIVEN a document with 2,000 or more candidate rows, none addressable within the first 2,000 in document-position order
- WHEN `read_doc` is called with `{ path }` and no `section`
- THEN the response is the full document body, because the gate stopped after evaluating its fixed 2,000-candidate cap without finding 2 addressable rows, even though later candidates are not evaluated

#### Scenario: The tool description no longer promises unconditional full-document return

- GIVEN the `read_doc` tool description and server-level usage instructions
- WHEN they are inspected
- THEN neither states that omitting `section` always returns the entire document

### Requirement: The `ejemplos/` Golden-Set Corpus Stays Below the Outline Threshold

Every document under `ejemplos/` MUST have its `content` (as defined above) estimated below the 6,000-token outline threshold, so `read_doc({ path })` without `section` continues to return full content for the entire golden-set corpus and the retrieval evaluation (`compendio eval`) is unaffected by this change.

#### Scenario: Every `ejemplos/` document returns in full

- GIVEN the `ejemplos/` corpus
- WHEN `read_doc({ path })` is called without `section` for each document in it
- THEN every response is the full document body, never an outline

### Requirement: MCP Zero-Config Expectations Reflect Discovery Mode

The system MUST preserve the same three-tool MCP surface (`docs_overview`, `search_docs`, `read_doc`) and MUST accept zero-config usage by returning discovery-mode paths instead of a hidden `docs/` default. Tool names and parameters MUST remain unchanged. Response shapes MUST remain unchanged, except that `read_doc` without `section` MAY additionally return an outline response (see "`read_doc` Returns a Section Outline for Large Documents") instead of the document body when that document's `content` exceeds the outline threshold and the document has 2 or more addressable rows; this is an additive variant of the existing no-`section` response, not a new tool, parameter, or removed shape.
(Previously: "Tool names, parameters, and response shapes MUST remain unchanged" had no carve-out and would have read as forbidding the outline variant.)

#### Scenario: Tool surface stays unchanged

- GIVEN a running MCP server
- WHEN the tool list is inspected
- THEN only `docs_overview`, `search_docs`, and `read_doc` are exposed

#### Scenario: Zero-config paths are discovery-shaped

- GIVEN no config file and a discovered root named `openspec`
- WHEN `search_docs` returns a result
- THEN its `path` is discovery-shaped and round-trips through `read_doc`

#### Scenario: A large document under discovery mode still returns an outline

- GIVEN no config file, a discovered root, and a document above the outline threshold with 2 or more addressable rows
- WHEN `read_doc({ path })` is called without `section`
- THEN the response is an outline, exactly as it would be under explicit root configuration

### Requirement: Unknown `path` Suggests the 3 Closest Matches

When `read_doc` is called with a `path` that does not match any indexed document, the system MUST respond with the 3 closest matching paths instead of raising an error. This behavior predates this change and is unaffected by the rename — it is stated here because the suggestion payload now carries `path` fields under their English name.

#### Scenario: Unknown path returns closest matches instead of an error

- GIVEN a corpus with no document at `docs/authh/login.md`
- WHEN `read_doc` is called with `path: "docs/authh/login.md"`
- THEN the response returns the 3 closest matching `path` values rather than throwing an error

### Requirement: MCP Tools Operate Without Documents or an Index

`compendio serve` MUST start successfully when all configured document roots are missing or empty and no database exists. Each MCP tool MUST return its normal response shape with empty content, rather than throwing because the store has not been initialized.

#### Scenario: Server starts without docs

- GIVEN no configured document root contains any indexable file and no database exists
- WHEN `compendio serve` starts
- THEN the server starts normally and is ready to accept tool calls

#### Scenario: Empty overview is well formed

- GIVEN the server is running without an index
- WHEN `docs_overview` is called
- THEN it succeeds with zero documents, no document lines, and no fabricated taxonomy buckets

#### Scenario: Empty search is well formed

- GIVEN the server is running without an index
- WHEN `search_docs` is called
- THEN it succeeds with the normal `mode` field and `results: []`, without a database error

#### Scenario: Unknown path remains a well-formed read result

- GIVEN the server is running without an index
- WHEN `read_doc` is called for any path
- THEN it returns the normal path-not-found response with zero available matches, without throwing

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

### Requirement: Located Spans Are Whole-Token Matches

A query term is locatable in a chunk only when it occurs as a whole token: a non-word character
(`[^\p{L}\p{N}]`) or a string edge MUST sit immediately before its start and after its end. A
substring occurring only as a prefix, suffix, or interior fragment of a longer word MUST NOT be
treated as a located span. This aligns the excerpt locator with the lexical retriever, which
matches whole tokens only (`unicode61`, no stemmer, no wildcard in the emitted `MATCH` string) — a
term the retriever could never have matched MUST NOT drive excerpt centring or the ellipsis
contract either. The boundary test MUST be evaluated in the same folded coordinate space the match
itself was found in, before mapping back to raw offsets — not on raw chunk text.

#### Scenario: A plural form no longer produces a span for its singular query term

- GIVEN a chunk whose only occurrence of a query term's root is inside a longer inflected word
  (e.g. the chunk contains only "Refunds" and the query term is "refund")
- WHEN `search_docs` returns
- THEN that chunk produces no located span for that term, because the lexical leg's own `MATCH`
  for the unquoted term would not have matched that occurrence either

#### Scenario: An exact whole-token match still produces a span

- GIVEN a chunk containing the exact token "timestamp" and a query term "timestamp"
- WHEN `search_docs` returns
- THEN that chunk produces a located span for that term, unaffected by this narrowing

#### Scenario: The boundary test is evaluated in folded, not raw, coordinates

- GIVEN a chunk whose raw text, under NFD normalization, places a bare combining mark adjacent to a
  query term where the equivalent NFC text would place a plain letter there instead
- WHEN `search_docs` returns
- THEN the locatable/not-locatable outcome for that term is the same for both normalization forms
  of the same text

### Requirement: Whole-Token Matching Has Five Named Non-Guarantees

This narrowing does not make span location byte-identical to the lexical tokenizer, and adds no
stemming. These divergences MUST remain and MUST stay documented:

1. **Folding divergence**: the locator's fold is narrower than `unicode61 remove_diacritics 2`.
2. **Tokenizer-class divergence**: the boundary class `[^\p{L}\p{N}]` is this project's own, not
   byte-for-byte `unicode61`'s token boundary; exotic code points can still disagree.
3. **No stemming**: an inflected form MUST NOT match its root term, in either direction.
4. **Astral/lone-surrogate adjacency**: a lone surrogate half beside an astral-plane letter MAY read
   as a boundary here where the lexical tokenizer would not.
5. **Corpus-frequency blindness**: this narrowing carries no signal about how common a term is
   corpus-wide; that stays out of scope for span location.

#### Scenario: An inflected form never counts toward locatability

- GIVEN a query term whose only occurrences in a chunk are inflected forms distinct from the exact
  token
- WHEN `search_docs` returns
- THEN the excerpt is built as if the term were absent, and no scoring or ranking signal changes
  this outcome

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

(Previously: "the location that caused the query to match" relied on substring location; it now
relies on whole-token location — see the ADDED requirement above. Same narrowing, same reason,
applied to the lead tier.)

#### Scenario: Answer past the old prefix boundary becomes visible

- GIVEN a rank-1 chunk whose flattened content exceeds `LEAD_EXCERPT_CHARS`, containing a unique
  answer past flattened offset 1400
- WHEN `search_docs` returns
- THEN the rank-1 result's `excerpt` contains that answer verbatim

### Requirement: Supporting Excerpts Are Centred On the Matched Span, With a Start-Anchored Fallback

A non-rank-1 result's `excerpt` MUST be a window of at most `SUPPORTING_EXCERPT_CHARS` (120,
unchanged) characters centred on the location that caused the query to match the chunk. When the
chunk's flattened content contains no locatable query term, the `excerpt` MUST fall back to a
start-anchored prefix of the same budget, exactly as before this change.

(Previously: "locatable" meant any substring occurrence; it now means a whole-token match — see
the ADDED requirement above. The fallback is therefore reachable in strictly more cases, though
measured evidence on this project's two available corpora found zero supporting fragments newly
reaching it — a lower bound measured in raw coordinates, not a guarantee, since the shipped
predicate runs in folded coordinates, which is strictly stricter. The 120-char budget and the
centring mechanism are unchanged; only which occurrences count as "a match" changes.)

**The fallback keys on the flattened content, not the raw chunk** (unchanged): a term occurring
only inside a heading line is removed by flattening before this window is computed and does not
count as locatable.

#### Scenario: Supporting fragment centres on the match, not the opening text

- GIVEN a non-rank-1 result whose chunk's query match occurs past character 120 of its flattened
  content
- WHEN `search_docs` returns
- THEN that result's `excerpt` is a window centred on the matched span, not the chunk's opening
  text

#### Scenario: No locatable term falls back to the start-anchored prefix

- GIVEN a non-rank-1 result whose chunk's flattened content contains no whole-token query term
  match (a vector-only match, or a chunk holding only inflected forms of every query term)
- WHEN `search_docs` returns
- THEN that result's `excerpt` is the chunk's word-snapped first ~120 characters with a trailing
  `…`, exactly as before this change

#### Scenario: A term present only in a stripped heading is treated as unreachable

- GIVEN a non-rank-1 result whose chunk contains a query term only inside its own heading line
- WHEN `search_docs` returns
- THEN that result's `excerpt` falls back to the start-anchored prefix, as if the term were absent

### Requirement: Truncation Is Marked at Either Edge, Within Budget

An excerpt MUST carry a leading `…` whenever its window does not start at flattened offset 0 of
the chunk, and a trailing `…` whenever its window does not reach the end of the chunk's flattened
content — and MUST NOT carry either ellipsis when its window meets that edge. A spurious ellipsis
is a contract violation: it is the signal that sends a caller to `read_doc`. An excerpt's length
MUST NOT exceed its rank's budget plus at most one ellipsis per truncated edge (2 max).

(Previously: all three scenarios below exercised only the rank-1 window, where both-edges
truncation is rare. Centring supporting excerpts on the matched span (see the ADDED requirement
above) makes both-edges truncation the common case at that tier — measured 78.4% (`ejemplos/`) /
84.4% (external corpus), against 0% before. The requirement text itself is unchanged; a fourth
scenario is added to exercise the now-common case.)

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

#### Scenario: A supporting fragment centred away from both edges carries both ellipses within its own budget

- GIVEN a non-rank-1 excerpt window that starts after offset 0 of the chunk's flattened content and
  ends before that content's end
- WHEN `search_docs` returns
- THEN that `excerpt` carries a leading `…` and a trailing `…`, and its total length does not
  exceed `SUPPORTING_EXCERPT_CHARS` plus the length of two ellipses

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

### Requirement: Match Selection Is Not Positional

When a chunk chosen for any result rank contains multiple candidate match locations, selection of
which location centres that result's excerpt MUST NOT default to the earliest occurrence when a
high-frequency query term occurs early in the chunk and a distinctive query term occurs later.
Selection MUST prefer the region containing the query's distinctive terms, at every rank.

(Previously titled "Lead Match Selection Is Not Positional" and scoped to the rank-1 chunk only,
because `selectMatchCentre` was invoked exclusively at rank 0 — see the RENAMED entry below. The
centring mechanism itself is unchanged; only the population of results it runs against has
widened, since a non-rank-1 result now reaches this same selection whenever it has a locatable
term.)

#### Scenario: A high-frequency term near the start does not win over a later distinctive term (lead)

- GIVEN a query whose high-frequency term occurs before flattened offset 100 of the rank-1 chunk,
  while its distinctive terms cluster past flattened offset 1400
- WHEN `search_docs` returns
- THEN the rank-1 result's `excerpt` contains the distinctive-term region, not the early
  high-frequency term's neighbourhood

#### Scenario: The same preference holds for a supporting fragment

- GIVEN a query whose high-frequency term occurs near the start of a non-rank-1 chunk, while its
  distinctive terms cluster elsewhere in that same chunk, with both candidate windows fitting
  within `SUPPORTING_EXCERPT_CHARS`
- WHEN `search_docs` returns
- THEN that result's `excerpt` is centred on the distinctive-term region, not the early
  high-frequency term's neighbourhood

