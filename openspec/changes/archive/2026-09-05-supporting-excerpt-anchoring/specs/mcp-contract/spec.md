# Delta for MCP Contract

> **DESTRUCTIVE DELTA.** The REMOVED requirement below asserts the exact opposite of the ADDED
> requirement that replaces it (`spec.md:627-641`, "Supporting Excerpts Remain Start-Anchored
> Prefixes"). This is a replacement, not an amendment — flag it for the `rules.archive` warning
> before merging (`openspec/config.yaml`).

## ADDED Requirements

### Requirement: Supporting Excerpts Are Centred On the Matched Span, With a Start-Anchored Fallback

A non-rank-1 result's `excerpt` MUST be a window of at most `SUPPORTING_EXCERPT_CHARS` (120,
unchanged) characters centred on the location that caused the query to match the chunk. When the
chunk's flattened content contains no locatable query term, the `excerpt` MUST fall back to a
start-anchored prefix of the same budget, exactly as before this change.

A supporting fragment still routes between results rather than answers — that half of the replaced
requirement's rationale survives unchanged, which is why the 120-character budget itself stays
untouched here. Only where inside that budget the window sits changes.

**The fallback keys on the flattened content, not the raw chunk.** A query term occurring only
inside a heading line is removed by flattening (`stripHeadingLines`) before this window is
computed; such a term does not count as "locatable" for this requirement even though it is present
in `chunk.content`, and the fragment falls back to the start-anchored prefix.

#### Scenario: Supporting fragment centres on the match, not the opening text

- GIVEN a non-rank-1 result whose chunk's query match occurs past character 120 of its flattened
  content
- WHEN `search_docs` returns
- THEN that result's `excerpt` is a window centred on the matched span, not the chunk's opening
  text

#### Scenario: No locatable term falls back to the start-anchored prefix

- GIVEN a non-rank-1 result whose chunk's flattened content contains no query term at all (for
  example, a vector-only match sharing no vocabulary with the query)
- WHEN `search_docs` returns
- THEN that result's `excerpt` is the chunk's word-snapped first ~120 characters with a trailing
  `…`, exactly as before this change

#### Scenario: A term present only in a stripped heading is treated as unreachable

- GIVEN a non-rank-1 result whose chunk contains a query term only inside its own heading line, so
  the term is removed by flattening before any excerpt is built
- WHEN `search_docs` returns
- THEN that result's `excerpt` falls back to the start-anchored prefix, as if the term were absent
  from the chunk entirely

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Supporting Excerpts Remain Start-Anchored Prefixes

(Reason: Falsified by measurement, exploration §11.4 — a start-anchored prefix showed zero query
terms in 9.1% of supporting fragments on `ejemplos/` and 45.1% on an external 81-document corpus,
defeating the supporting tier's own documented job of letting an agent judge whether the lead
result is the right one. Superseded by centring the window on the matched span instead, within the
same unchanged budget.)
(Migration: See "Supporting Excerpts Are Centred On the Matched Span, With a Start-Anchored
Fallback" under ADDED above. No data migration applies — excerpts are computed at query time from
already-stored chunk content and are never persisted; a running `compendio serve` picks up the
change on restart with no reindex in either direction.)

## RENAMED Requirements

### Requirement: Lead Match Selection Is Not Positional → Match Selection Is Not Positional

(Reason: The requirement governed only the rank-1 chunk because `selectMatchCentre` was invoked
exclusively at rank 0 before this change. Removing the rank guard means every result now goes
through the same centring logic, so the "Lead" framing no longer matches the requirement's actual
reach.)
(Migration: None — `selectMatchCentre`'s own behaviour is unchanged; only which ranks invoke it
widens. See the MODIFIED entry above for the updated text and its added supporting-tier scenario.)
