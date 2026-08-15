# Delta for MCP Contract

## ADDED Requirements

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
