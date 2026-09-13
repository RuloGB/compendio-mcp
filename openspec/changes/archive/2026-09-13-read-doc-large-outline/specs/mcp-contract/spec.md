# Delta for MCP Contract

## ADDED Requirements

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

Every heading listed in the outline, passed back verbatim as `read_doc({ path, section })`, MUST resolve to a `section` result — never `section-not-found` — regardless of whether it is a top-level row, a child row, a `repeated` group entry, or a row shown only because an earlier row was omitted by the budget. Section-lookup semantics are unchanged: requesting a listed H2 continues to return its nested H3 content as well (substring matching, unchanged).

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

## MODIFIED Requirements

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
