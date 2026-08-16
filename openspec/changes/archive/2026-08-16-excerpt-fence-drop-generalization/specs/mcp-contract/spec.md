# Delta for MCP Contract

## ADDED Requirements

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

## MODIFIED Requirements

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

- GIVEN a chunk containing a balanced fence (backtick or tilde) with a heading-pattern line inside it (now retained by this requirement)
- WHEN `search_docs` computes that chunk's excerpt with fenced blocks excluded (the default first pass)
- THEN the entire fence, including the retained heading-pattern line, is absent from the excerpt — proof that delimiter lines survived for the exclusion step to still recognize the fence, for either delimiter style

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
