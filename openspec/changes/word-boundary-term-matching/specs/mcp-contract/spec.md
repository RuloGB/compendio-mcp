# Delta for mcp-contract

Scope: `locateSpans` narrows "locatable" from substring to whole token. No scoring, ranking,
budget, or window-mechanism change. `search/spec.md` has zero excerpt/window/span requirements
(grep-verified) — this delta is `mcp-contract`-only.

## ADDED Requirements

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

## MODIFIED Requirements

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
- THEN that result's `excerpt` is a window centred on the matched span, not the chunk's opening text

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

## Unchanged — stated so it need not be re-derived

- **Graduated Excerpt Budget by Result Rank** (1400 / 120), **Truncation Is Marked at Either Edge**,
  **Vector-Only Results Produce Well-Formed Excerpts**, **Match Selection Is Not Positional** — all
  untouched. `selectMatchCentre`'s scoring, accumulator, and tie-breaks do not change; only the
  population of spans fed into it narrows.
- **Not specified here**: no `selectMatchCentre` scoring change, no ranking change, no
  `matchedTerms` field. This delta does not claim to fix Open problem 3 (rarity-weighted centre
  selection) in `docs/retrieval-open-work.md` — that stays open and out of scope.
