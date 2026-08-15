# Delta for MCP Contract

## ADDED Requirements

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
