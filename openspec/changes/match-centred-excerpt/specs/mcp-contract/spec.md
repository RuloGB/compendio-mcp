# Delta for MCP Contract

## ADDED Requirements

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
