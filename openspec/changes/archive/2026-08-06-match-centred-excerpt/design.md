# Design: Match-Centred Lead Excerpt

## Technical Approach

**Approach B — a pure domain locator — carries the whole change. No new port method, no
`highlight()`, no SQLite in the excerpt path.**

The lead excerpt becomes a window instead of a prefix through four pure pieces in `src/domain/`,
composed at the one existing call site (`src/application/search-documents.ts:110`):

1. **Tokenize the query** with the exact regex that already builds the FTS5 query — moved into the
   domain and *shared*, not copied, so the terms the locator hunts for are by construction the terms
   the lexical leg searched with.
2. **Locate those terms in the raw chunk** (`chunk.content`, the same string FTS5 indexed —
   `sqlite-index-store.ts:179,182`), under a case- and diacritic-fold.
3. **Flatten the whole chunk, carrying a per-character offset map**, so a raw-space position can be
   translated into flattened space. This is the proposal's fixed ordering and the only genuinely new
   non-trivial logic.
4. **Choose a centre** by weighted distinct-term coverage — never first hit — and **slice a window**
   with word snapping and an ellipsis on each truncated edge.

The mechanism choice is deliberately confined to step 2. Steps 1, 3 and 4 never learn where their
span list came from, so a probe that invalidates the locator (§Decision 1) costs one function, not
the design.

## Architecture Decisions

### Decision 1: Approach B alone — and exactly what would falsify it

**Choice: B (pure domain locator). Rejected: A (FTS5 `highlight()` behind a new `IndexStore` method)
and A+B composed.** The exploration recommended A+B (§9); this design overrides that recommendation
on four grounds, argued against the code rather than from preference.

**1. A's advantage is tokenization fidelity, and Decision 2 buys most of it for free.** A is faithful
because it runs SQLite's tokenizer. But the divergence risk B carries has two halves — *term
splitting* and *diacritic folding* — and Decision 2 eliminates the first half outright by making
`toFtsQuery` and the locator consume one tokenizer. What remains at risk is folding alone, which is
narrower than the exploration's "approximately, not exactly" framing suggests.

**2. B's failure mode is a miss, not a mis-centre.** The locator searches for query terms *inside the
chunk's own text*. If its fold is narrower than `unicode61 remove_diacritics 2`, it fails to
recognize an occurrence and returns fewer spans — degrading to today's prefix. It cannot invent a
span in the wrong place, because a span only exists where the folded term literally occurs. Under
Approach A the same floor applies to every vector-only chunk. **Both approaches degrade to the same
behaviour; B degrades on a narrower set.** (Direction of the risk: NFD + combining-mark strip is a
subset of what `remove_diacritics 2` folds, so disagreements are expected to be misses. That
direction is REASONED, not measured — see the probe below.)

**3. A does not help with the risk that actually matters.** `highlight()` marks every instance of
every OR'd term, stopwords included (`toFtsQuery`, `sqlite-index-store.ts:429-436`). So A hands the
selector the same raw material B does: a bag of term positions with no BM25 weight attached. Gate 3
— the stopword trap, and the failure mode that "looks like success" — is decided entirely by
Decision 4's selection policy. **A buys nothing on the highest-likelihood risk in the change.**

**4. Under A alone the vector-only path keeps the defect; under A+B the project maintains two
mechanisms that must satisfy the same gates.** This repository's recorded failure mode is precisely
divergence between two things that were supposed to agree. B has one code path for lexical, vector
and both (Decision 7), so there is nothing to keep in sync.

Secondary, and deliberately not load-bearing: A costs a method on `src/domain/ports.ts`, a query in
`SqliteIndexStore`, delegating stubs in `RecordingStore` (`test/application/sync-index.test.ts:361`)
and `ThrowingStore` (`:465`), a per-result SQL round trip at query time, and marker-collision
handling. The size forecast already sits at 300–470 against a 400 budget with A+B at the top, in a
project whose forecast has grown at every phase (`bounded-chunk-size`: 240–420 → 555–695 → 773
actual). Starting at the ceiling of a forecast that historically doubles is a poor opening move — but
if A were the *right* mechanism, cost would not save B. The first three arguments are why it is not.

#### The probe that can overturn this — first task of `apply`, before any code is written

**P1 — fold agreement over the corpus alphabet (BLOCKING).** Exploration §7 claim 1, made concrete:

1. Collect the distinct non-ASCII characters actually present in `ejemplos/docs/` and in the new
   fixtures. That set, not Unicode at large, is the population that matters.
2. For each character `c`: insert `x{c}x` into an in-memory FTS5 table declared with the production
   tokenizer (`tokenize='unicode61 remove_diacritics 2'`, `sqlite-index-store.ts:65-68`) and run
   `MATCH '"x{fold(c)}x"'` where `fold` is the domain fold. Then the reverse direction: query with
   the unfolded character against a row holding the folded one.
3. **Pass = zero disagreements.** Record the full character set and the result in the apply notes.

**P1b — coverage over real queries (BLOCKING, same task).** Run `ejemplos/goldenset.yaml`'s 22
queries through `searchLexical`; for every returned chunk, assert `locateSpans` finds ≥ 1 span.
**Pass = 100%.** This measures directly what Approach A would have bought: a chunk FTS5 matched that
the domain locator cannot see is exactly the gap A closes.

| Probe result | Response |
|---|---|
| P1 and P1b both clean | B stands as designed. **P2 (`highlight()` under `MATCH ? AND rowid = ?`) is not run** — it is load-bearing only for A, and A is not being built |
| P1 disagrees on a small, enumerable character set | Extend the fold with explicit entries for those characters. Precedent: `decode-text.ts`'s hand-written CP1252 table, adopted for the same reason — the platform primitive was insufficient and the corrective set was small and citable. Re-run P1 to clean |
| P1 disagrees broadly, or P1b shows lexical-leg chunks with zero spans | **B is falsified.** Escalate to A+B: run P2 first, then source spans from a new `IndexStore.locateLexicalMatch` for chunks in `lexicalIds`, and keep the domain locator for the rest. Decisions 3–7 are unchanged — only the producer of `MatchSpan[]` moves |

The escalation is cheap by construction: `buildExcerpt` takes `MatchSpan[]`, not a query
(Decision 6), so the mechanism is one argument at one call site.

### Decision 2: query tokenization moves into the domain and is shared with `toFtsQuery`

**Choice**: `tokenizeQuery(query: string): string[]` lives in `src/domain/match-location.ts` and
carries the regex verbatim from `sqlite-index-store.ts:430-433`. `toFtsQuery` becomes
`tokenizeQuery(q).map(t => `"${t}"`).join(" OR ")`, keeping the null-on-empty return.

**Rationale**: the alternative — copying the regex into the domain — creates two definitions of "what
a query term is" that a future edit can silently separate, which is the exact class of defect this
repository keeps recording. Sharing also removes half of Approach B's fidelity gap (Decision 1,
argument 1) at negative cost.

**Direction is legal and has precedent**: `src/infrastructure/config.ts:4` already value-imports from
`src/domain/index-markdown.js`. Infrastructure depending on the domain is the allowed arrow.

**Load-bearing detail**: `tokenizeQuery` MUST NOT lowercase or fold. `toFtsQuery` does not today, and
FTS5 does its own case folding; changing the emitted MATCH string risks moving retrieval, which Gate
4 asserts must not happen. Folding is applied by the locator, on top of the raw tokens.

**Consequence worth naming**: this design deliberately touches the lexical path. That makes **Gate 4
a real gate rather than a formality** — under a design that never reached `sqlite-index-store.ts`,
asserting `eval` identity would be near-vacuous.

### Decision 3: the raw→flattened map is a per-character parallel array, built by mapping-aware transforms

This is the highest-risk piece (exploration §11): a silent off-by-N centres on the wrong text and no
test fails by default. The design's answer is a structure whose correctness is *mechanically*
checkable, not one that has to be argued.

```ts
interface FlatText {
  text: string;
  /** map[i] = offset in the raw markdown of the character that produced text[i]. */
  map: readonly number[];   // map.length === text.length, non-decreasing
}
```

`flattenWithMap(markdown, dropFencedBlocks): FlatText` reimplements today's chain
(`excerpt.ts:61-74`) **in the same order**, as six transforms of `FlatText → FlatText`:

| # | Today | Tracked form |
|---|---|---|
| S1 | `split("\n").filter(heading).join(" ")` | scan lines with their raw start offsets; emit kept lines with their own offsets; the separator space between two consecutive kept lines maps to the raw offset of the line that follows it |
| S2 | `.replace(/```[^`]*```/g, " ")` (conditional) | each match → one space mapped to the match's first raw offset |
| S3 | ``.replace(/[`*_>|]/g, " ")`` | each match → one space, offsets unchanged (1:1) |
| S4 | `.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")` | replacement is capture 1, carried with **its own** raw offsets (a contiguous slice of the match) — link text is real content and may hold the marker |
| S5 | `.replace(/\s+/g, " ")` | each run → one space mapped to the run's first offset |
| S6 | `.trim()` | drop leading/trailing whitespace, slicing `map` identically |

S2, S3 and S5 share one `trackedReplace(flat, regex, replacer)` helper, so there is a single place
where offsets are carried.

**Lookup**: `toFlatOffset(flat, rawOffset)` binary-searches for the least `i` with
`map[i] >= rawOffset`, returning `text.length` when none exists. `map` is non-decreasing because no
transform reorders. A raw position that was destroyed resolves to the nearest surviving position
after it, which is the right behaviour for centring — and is also the discriminator in Decision 7.

**The invariants that make an off-by-N loud** (asserted as unit tests over generated markdown, not
only over hand-picked examples):

- **I1** `map.length === text.length`
- **I2** `map` is non-decreasing, and every entry is a valid index into the raw string
- **I3** `∀i: text[i] === " " || raw[map[i]] === text[i]`
- **I4** `flattenWithMap(x, d).text` equals today's `flatten(x, d)` for every generated input

**I3 is the centrepiece.** It holds by construction: every emitted non-space character is copied
verbatim (kept line text in S1, pass-through in S2/S3/S5, capture text in S4), and every synthesized
character is a space. A one-character drift anywhere in the chain breaks it on the first input with a
heading, a fence, a link or a whitespace run. It costs one loop and needs no fixture.

**I4** is a transitional golden test: `flatten-map.test.ts` keeps a `referenceFlatten` copy of
today's chain and compares against it. A duplicate implementation inside a test is a maintenance cost
paid deliberately — `flatten`'s exact output is the excerpt contract, and this refactor is otherwise
free to change it silently.

**Rejected**: a run/segment list (`{rawStart, rawEnd, flatStart}[]`) — fewer entries, more code, and
it cannot express I3 as a one-line check. `Int32Array` instead of `number[]` — a micro-optimization on
strings bounded at ~1 900 characters by `chunk.maxTokens: 480` (`config.ts:58`, `tokens.ts:7`).

**No fast path when there are no spans.** `buildExcerpt` always builds the map, including for
supporting fragments that will not use it. A second, map-free flatten path would be a second
implementation of the same transformation — the drift risk this repo keeps paying for — and the cost
is one ~2 000-entry array per emitted result.

### Decision 4: selection is maximum weighted distinct-term coverage over a sliding window

**Choice**: among all budget-wide windows anchored at a match occurrence, pick the one maximizing

```
S(window) = Σ  w(t)      over the DISTINCT terms t occurring in the window
w(t)      = log(1 + L / f(t))     f(t) = occurrences of t in this chunk, L = Σ f
```

with tie-breaks: **(1)** total length of the distinct matched terms in the window, **(2)** earliest
start. The chosen window's cluster span is `[start of its first occurrence, end of its last]`, and
the centre is that span's midpoint.

Computed by a two-pointer sweep over occurrences sorted by flattened offset — O(n log n) for the
sort, O(n) for the sweep, with n bounded by the term count of one chunk.

**Why distinctness AND rarity, not either alone.** Distinct-term count alone loses the minimal form of
Gate 3: a query of one stopword plus one distinctive term, each occurring once, ties at one distinct
term and falls through to "earliest" — which is first-hit wearing a disguise. Rarity alone loses to a
window packed with thirty repetitions of `de`. Summing `w` over *distinct* terms defeats both:
repetition cannot inflate a window, and a lone rare term outscores a lone common one.

`w` is an **in-chunk IDF**. It has no corpus statistics behind it and does not need any: a stopword is
frequent everywhere, including in this chunk, so within-chunk frequency is a sound proxy and costs
nothing. On Gate 3's fixture shape (`the` ~40 occurrences, the distinctive term once) the weights are
~0.7 against ~3.7 — not a close call.

**Scattered matches with no cluster** fall out without a special case: every window then holds exactly
one occurrence, `S` reduces to `w(t)`, and the **rarest term wins**. That is the correct answer, and it
is what a scattered chunk deserves.

**Rejected alternatives**:
- **First occurrence** — the proposal forbids it, and it reproduces the defect while looking fixed.
- **A hard-coded stopword list** — language-specific, and this project refuses language-specific
  machinery on the record: FTS5 is declared with no stemmer and no stoplist
  (`sqlite-index-store.ts:65-68`), precisely so an English codebase can index Spanish documentation
  without loss (`CLAUDE.md`, Working conventions). A stoplist here would be the first such dependency.
- **Exposing BM25 term weights** — needs `bm25()` per term, i.e. Approach A plus more; out of scope
  per the proposal, and it weights *documents*, not positions.
- **Term length as the primary weight** — a crude rarity proxy; kept only as the first tie-break,
  where it breaks the single-occurrence tie that IDF cannot.

**Known residual, stated rather than discovered later**: a query consisting solely of common terms has
no distinctive centre to find. Selection then lands on the earliest such term and the excerpt
approximates today's prefix. That is the honest answer, not a defect — there is nothing better to
centre on.

### Decision 5: the window clamps to a full budget, snaps both edges, and adds ellipses on top

Given flattened `text`, a `centre`, and `budget`:

```
if text.length <= budget            → return text whole, no ellipsis (today's early return, excerpt.ts:50)
start = clamp(centre - ⌊budget/2⌋, 0, text.length - budget)
end   = start + budget
```

**The clamp is what removes every degenerate edge case.** A match near offset 0 yields `start = 0`
and therefore no leading `…`; a match near the end yields `end = text.length` and therefore no
trailing `…`; text shorter than the budget never reaches the window at all. There are no special
branches for these — Gate 2's second and third bullets are consequences of one `clamp`, which is why
they are cheap to assert and hard to regress.

**Word snapping, both edges**, generalizing today's single-edge rule (`excerpt.ts:51-53`) and keeping
its guard:

- Leading (only when `start > 0`): advance `start` past the first space in the window, accepted only
  if that space lies within the first half of the window.
- Trailing (only when `end < text.length`): retreat `end` to the last space, accepted only if it lies
  past the midpoint of the *current* window.
- Applied leading-first, then trailing against the updated start. Both operations shrink, so
  `end - start <= budget` always holds.
- **Guard**: if either snap would push the selected cluster span outside `[start, end)`, that snap is
  reverted. Snapping can never hide the match it was centred on. Stated as a mechanism rather than as
  an argument, because the argument ("the match is at the centre") stops being airtight for a cluster
  nearly as wide as the budget.

**Ellipses are added on top of the budget**, exactly as today (`excerpt.ts:53` appends after slicing
to `maxChars`). Maximum length is therefore `budget + 2`, which is what Gate 2 asserts and why
`test/application/index-and-search.test.ts:124,135,182` move from `+ 1` to `+ 2`. Leading `…` iff
final `start > 0`; trailing `…` iff final `end < text.length`.

**Text with no spaces at all** (one unbroken token): both snaps fail their guards, the window is a
hard cut, both ellipses are emitted. Correct and honest.

### Decision 6: `buildExcerpt` takes raw-space spans as a third optional positional parameter

```ts
export function buildExcerpt(
  markdown: string,
  maxChars: number = SUPPORTING_EXCERPT_CHARS,
  spans: readonly MatchSpan[] = [],
): string;
```

`spans` are in **raw** coordinates — the same string `markdown` is. `buildExcerpt` flattens, maps
them, and only then selects and slices, which is the proposal's fixed ordering enforced by the
signature rather than by convention.

`[]` (or absent) is today's prefix path, byte-identical. **Verified**: all six existing tests call
with one or two positional arguments (`test/domain/excerpt.test.ts:11,18,24,33,39,46`) and compile
and pass unchanged.

**Rejected**: an options object — the two existing parameters are positional and one field does not
justify the churn. **Rejected**: passing `query: string` and locating inside `buildExcerpt` — it
would weld term-location to excerpt policy and destroy Decision 1's escalation seam, since under an
A+B escalation the spans arrive from the store.

### Decision 7: spans are computed for rank 0 only, and the vector-only path is the empty-spans path

**Rank 0 only.** Supporting fragments stay prefixes (proposal, Resolved decisions), so the call site
computes spans only when `results.length === 0`. This makes a decision that would otherwise be an
emergent property *visible in the code*, and costs one locator run per search rather than k.

**There is no vector-only branch.** The locator runs on the chunk's own text and knows nothing about
which leg surfaced it. A chunk the vector leg found alone still gets centred if it happens to contain
query terms — usually it does, since semantic neighbours share vocabulary — and falls back to the
prefix when it does not. So the vector-only case *is* the empty-spans case, which is also the
backward-compatibility case, which is also the fold-miss case. **One branch serves all three**, which
is why the six existing tests already cover it and why Gate 5's first bullet is a unit test rather
than a fixture.

**Consequence, recorded because the exploration flagged the opposite**: `lexicalIds` / `vectorIds`
(`search-documents.ts:82-86`) are available but deliberately **not consumed**. They would be needed
only under an A+B escalation.

### Decision 8: two new domain files, no new port, no new adapter

| Placement | Why |
|---|---|
| `src/domain/flatten-map.ts` (new) — `FlatText`, `flattenWithMap`, `toFlatOffset` | `flatten` moves here from `excerpt.ts` because the map is inseparable from it. Its own file because it is the highest-risk logic in the change and deserves its own test file and its own invariants rather than being buried as a private helper |
| `src/domain/match-location.ts` (new) — `MatchSpan`, `tokenizeQuery`, `foldForMatch`, `locateSpans`, `selectMatchCentre` | Locating and choosing share the `MatchSpan` type and are always used together. Pure: no I/O, no injectable dependency |
| `src/domain/excerpt.ts` (modified) — window slicing, dual-edge snapping, ellipsis policy | Excerpt policy stays where excerpt policy lives |
| **No `ports.ts` change** | `openspec/config.yaml`'s design rule routes new *adapters* through `ports.ts`. Nothing here is an adapter — no I/O, nothing to inject. Precedent set explicitly by `2026-08-06-encoding-aware-reads` Decision 6: the project has no pattern of wrapping locally-called pure functions in ports (`splitToBound`, `chunkOutline`, `estimateTokens` are all called directly) |

## Flow notes

Non-trivial path, per `rules.design`. Line numbers are current, pre-change.

```
SearchDocuments.runSearch (search-documents.ts:75)
  │
  ├─ lexicalIds = store.searchLexical(query, filters, limit)     :82   ── unchanged
  │      └─ SqliteIndexStore.searchLexical → toFtsQuery          :334,429
  │             └─ NOW: toFtsQuery = tokenizeQuery(q) quoted+OR'd      (Decision 2)
  ├─ vectorIds  = vectorLeg(...)                                 :83   ── unchanged
  ├─ fused      = reciprocalRankFusion([...])                    :86   ── fusion.ts UNCHANGED
  ├─ chunks/top = getChunksByIds → capPerDocument → slice(0,k)   :88-94 ── unchanged
  │
  ├─ terms = tokenizeQuery(query.query)                          NEW, hoisted out of the loop
  │
  └─ for entry of top:                                           :98
        rank  = results.length                                   :110 (already implicit)
        spans = rank === 0 ? locateSpans(chunk.content, terms)   NEW  (Decision 7)
                           : []
        excerpt = buildExcerpt(chunk.content, excerptBudget(rank), spans)   :110
```

Inside `buildExcerpt` — the ordering the proposal fixed as a correctness constraint:

```
markdown (raw chunk)  +  spans (RAW coordinates)
   │
   ├─ flat = flattenWithMap(markdown, dropFences=true)                  whole chunk, never a substring
   │     └─ if flat.text is empty → flat = flattenWithMap(markdown, false)   (excerpt.ts:42-48 two-pass;
   │                                                                          the map belongs to the
   │                                                                          pass that produced the text)
   ├─ flatSpans = spans.map(s => ({ start: toFlatOffset(flat, s.start),
   │                                end:   toFlatOffset(flat, s.end),
   │                                term:  s.term }))
   │              .filter(s => s.end > s.start)     ← a span whose text did NOT survive flattening
   │                                                  (inside a dropped fence) collapses to width 0
   │                                                  and is discarded: you cannot centre on text
   │                                                  the reader will never see
   ├─ if flat.text.length <= maxChars      → return flat.text            (no ellipsis, no window)
   ├─ if flatSpans is empty                → today's prefix path          (Decision 7)
   ├─ centre = selectMatchCentre(flatSpans, maxChars)                     (Decision 4)
   └─ window = clamp → snap leading → snap trailing → ellipses            (Decision 5)
```

Two facts this ordering depends on, both verified: `flatten()` destroys `|` unconditionally
(`excerpt.ts:70`), so no table structure survives to be cut mid-row; and a fence is always a complete
pair inside one stored chunk (`split-text.ts:92-111,127-131`), so flattening a whole chunk never sees
a half fence. Slicing raw first would break the second.

## Interfaces / Contracts

```ts
// src/domain/flatten-map.ts
export interface FlatText {
  text: string;
  /** map[i] = offset in the source markdown of the character that produced text[i].
   *  Length equals text.length; non-decreasing; see I1–I4 in design Decision 3. */
  map: readonly number[];
}
export function flattenWithMap(markdown: string, dropFencedBlocks: boolean): FlatText;
/** Least i with map[i] >= rawOffset, or text.length. Destroyed positions resolve
 *  to the nearest surviving position after them. */
export function toFlatOffset(flat: FlatText, rawOffset: number): number;

// src/domain/match-location.ts
export interface MatchSpan {
  /** Inclusive start, in the coordinates of the string being searched. */
  start: number;
  /** Exclusive end. */
  end: number;
  /** The normalized query term this span matched; drives rarity weighting. */
  term: string;
}
/** Query terms, byte-for-byte the split `toFtsQuery` has always used. Not folded,
 *  not lowercased: the FTS5 MATCH string must not change (Gate 4). */
export function tokenizeQuery(query: string): string[];
/** Lowercase + NFD + combining-mark strip. Applied to both sides of a comparison. */
export function foldForMatch(text: string): string;
/** Every occurrence of every term in `raw`, in raw coordinates, ascending. */
export function locateSpans(raw: string, terms: readonly string[]): MatchSpan[];
/** Centre of the best budget-wide window, or null when `spans` is empty. */
export function selectMatchCentre(spans: readonly MatchSpan[], budget: number): number | null;

// src/domain/excerpt.ts
export function buildExcerpt(
  markdown: string,
  maxChars?: number,
  spans?: readonly MatchSpan[],
): string;
```

## The gates, made mechanically checkable

### Fixture corpus: `test/fixtures/excerpt-window/docs/`

Following the `test/fixtures/vector-reach/` precedent — small, committed, cheap to re-run. English,
per the language contract (only `ejemplos/` and `goldenset.yaml` stay Spanish). Driven through
`buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_WINDOW_DOCS)` (`test/helpers/build.ts:61`) — a
**null embeddings provider**, so the corpus runs lexical-only and the gates are deterministic with no
model and no vector leg.

| File | Shape | Serves |
|---|---|---|
| `window.md` | one chunk; flattened length ≈ 1 600; unique marker `MERIDIANO-4417` at flattened offset ≈ 1 420; the query's distinctive terms occur **exactly once each**, inside the marker's sentence; the marker itself is **not** a query term | Gates 1, 2 |
| `stopword-trap.md` | one chunk; flattened ≈ 1 600; `the` first occurs before flattened offset 100 and ≥ 20 times overall; distinctive term `windvane` occurs **once**, at flattened offset > 1 400, beside marker `TRAMONTANA-9182`. Query: `the windvane` | Gate 3 |
| `short.md` | flattened length well under 1 400 | Gate 2, "fits → no ellipsis at either end" |
| two small distractors | ordinary prose, no marker vocabulary | makes rank 1 a real assertion |

**Raw-size budget**: `estimateTokens = ⌈chars/4⌉` (`tokens.ts:7`) against `maxTokens: 480`
(`config.ts:58`) caps a single chunk at ~1 900 raw characters. Targeting ~1 600 flattened at the
~0.89 flatten ratio the §1 case measured puts raw at ~1 800 — 450 tokens, only 30 of headroom. **Keep
markdown decoration light and raw ≤ 1 800 characters.**

**Each fixture asserts its own preconditions**, so a later edit that voids a gate fails loudly instead
of passing for free: chunk count === 1; marker's flattened offset inside `[1 410, 1 480]`; flattened
length inside `[1 550, 1 650]`; for the trap, `the`'s first offset < 100 and count ≥ 20, `windvane`'s
offset > 1 400 and count === 1. Computed in the test via `flattenWithMap`, not hard-coded.

### Gate 1 — baseline first, mechanically

The proposal requires the pre-change baseline be **run and recorded before** the change. Rendered as
a three-step task sequence that is TDD-compatible and leaves evidence:

1. Land the fixture plus a test named `BASELINE (to be inverted)` asserting the rank-1 excerpt does
   **not** contain `MERIDIANO-4417` and **ends** with `…`. Run `npm test` against unmodified `src/`.
   **It must pass.** If it fails, the fixture is void — rebuild with a larger offset. Record the run
   in the apply notes.
2. Replace that test with the real assertion: the excerpt contains `MERIDIANO-4417` **verbatim**. It
   is now red.
3. Implement to green.

Step 1's observed green is what makes the gate capable of failing. Because the window clamps to
`[200, 1 600]` on this fixture, the same test also asserts a **leading** `…` and **no trailing** `…`
— an off-by-N that lands the window elsewhere fails on the marker, and a clamp error fails on the
ellipses.

### Gates 2–5

| Gate | Harness | Assertion |
|---|---|---|
| 2 | unit, `excerpt.test.ts` | `length <= budget + 2`; spans near offset 0 → no leading `…`; spans near the end → no trailing `…`; `short.md` → neither |
| 3 | integration over `stopword-trap.md` | excerpt contains `TRAMONTANA-9182` **and** does not start with the document's opening words. A first-hit implementation fails both. Plus a unit test on `selectMatchCentre` for the two-distinctive-terms-late versus one-distinctive-term-early case, which the fixture cannot express cheaply |
| 4 | `npm test`, `npm run typecheck`, `npm run build`, `compendio eval` on `ejemplos/` | MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22, **unmoved**. Non-vacuous here because Decision 2 touches `toFtsQuery` |
| 5 | unit + integration | `buildExcerpt(long, 1400, [])` → prefix, `<= budget + 1`, trailing `…` only (Decision 7: the vector-only path *is* this path). Integration over `test/fixtures/vector-reach/` for a well-formed excerpt end to end. Contract text: `server.ts:110` and `CLAUDE.md` reviewed against the wording below |

### Contract text, written out so it can be applied as a diff

`server.ts:108-111`, replacing the current two sentences:

> The top result carries a full-length excerpt, centred on the part of the document that matched,
> which usually answers outright; the rest carry short ones from the start of their section, enough
> to tell whether the top result is the right one. Each result has path, title, section, excerpt and
> score. A '…' at **either** end of an excerpt marks content omitted there — that is the signal to
> call read_doc with its path and section.

`CLAUDE.md`, MCP-tools section, bullet 2: "the rank-1 fragment gets `LEAD_EXCERPT_CHARS` (1400)"
becomes "…(1400), spent as a window centred on the matched span rather than as a prefix", and "A
trailing `…` is the documented truncation signal" becomes "A `…` at either edge is the documented
truncation signal".

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/flatten-map.ts` | Create | `FlatText`, `flattenWithMap` (six tracked transforms), `toFlatOffset`. `flatten` moves here |
| `src/domain/match-location.ts` | Create | `MatchSpan`, `tokenizeQuery`, `foldForMatch`, `locateSpans`, `selectMatchCentre` |
| `src/domain/excerpt.ts` | Modify | Third optional `spans` parameter; window clamp; dual-edge snapping; leading `…`; delegates flattening |
| `src/application/search-documents.ts` | Modify | `tokenizeQuery` once per search; `locateSpans` for rank 0; pass spans at `:110` |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | Modify | `toFtsQuery` delegates to `tokenizeQuery` (Decision 2) |
| `src/server.ts` | Modify | `:110` contract prose — both edges |
| `src/domain/ports.ts` | **Unchanged** | No new adapter (Decision 8) |
| `src/domain/fusion.ts` | **Unchanged** | Provenance is not consumed (Decision 7) |
| `test/domain/flatten-map.test.ts` | Create | I1–I4, including the `referenceFlatten` golden comparison |
| `test/domain/match-location.test.ts` | Create | Tokenizer parity with `toFtsQuery`; fold cases; selection policy incl. the stopword and scattered cases |
| `test/domain/excerpt.test.ts` | Modify | Six existing tests unchanged; new window, snapping, ellipsis and empty-spans tests |
| `test/application/excerpt-window.test.ts` | Create | Gates 1, 3, 5 over the fixture corpus, with self-asserted fixture preconditions |
| `test/application/index-and-search.test.ts` | Modify | `LEAD_EXCERPT_CHARS + 1` → `+ 2` at `:124,135,182`; `SUPPORTING_EXCERPT_CHARS + 1` at `:184` unchanged |
| `test/helpers/build.ts` | Modify | `EXCERPT_WINDOW_DOCS` export |
| `test/fixtures/excerpt-window/docs/*.md` | Create | Five documents (§The gates) |
| `openspec/specs/mcp-contract/spec.md` | Modify | Delta — `sdd-spec`'s output, not this phase's |
| `CLAUDE.md` | Modify | Two excerpt claims |

## Testing Strategy

`strict_tdd: true`. The order is forced by the dependency chain and by Gate 1's baseline step.

| Layer | What | Where |
|---|---|---|
| Probe | P1 fold agreement, P1b locator coverage — **before any implementation** (Decision 1) | apply notes |
| Unit | I1–I4 over generated markdown: headings, fences, links, tables, whitespace runs, non-ASCII, empty input, all-fenced input (the two-pass case) | `flatten-map.test.ts` |
| Unit | `tokenizeQuery` produces exactly the tokens `toFtsQuery` used to; `foldForMatch` on the corpus alphabet; `locateSpans` on overlapping and repeated terms | `match-location.test.ts` |
| Unit | `selectMatchCentre`: stopword-early vs rare-late; two-distinct-late vs one-distinct-early; scattered singletons → rarest wins; determinism of both tie-breaks | `match-location.test.ts` |
| Unit | Window: clamp at both extremes; snapping on both edges; the snap-revert guard; ellipsis presence/absence; `<= budget + 2`; empty spans → byte-identical prefix | `excerpt.test.ts` |
| Integration | Gate 1 (baseline, then inverted), Gate 3, Gate 5 | `excerpt-window.test.ts` |
| Integration | `ejemplos/` suite unchanged; excerpt length bounds updated to `+ 2` | `index-and-search.test.ts` |
| Manual | Gate 4: `compendio eval` on `ejemplos/`, identity | `verify-report.md` |
| Manual | Recorded observation (not a gate): distribution of supporting fragments' first match offset over `ejemplos/` + its 22 golden queries, fraction beyond `SUPPORTING_EXCERPT_CHARS` | `verify-report.md` |

## Migration / Rollout

**No migration, no schema marker, no shim, no reindex — in either direction.** The excerpt is
computed at query time from `chunk.content` (`search-documents.ts:110`) and is never persisted; the
`chunks_fts` DDL (`sqlite-index-store.ts:65-68`) is untouched, and under this design it is not even
read differently. Rollback is `git revert` plus `npm run build`; a running `compendio serve` picks it
up on restart. This is the cheapest rollback profile of the last three changes.

**Delivery size — a design-phase forecast, and it is above the proposal's.** Driver-based:
`flatten-map.ts` ~120, `match-location.ts` ~110, `excerpt.ts` +70/−12, call site ~8, `toFtsQuery`
~−6/+3, unit tests ~260, integration test ~90, fixtures ~50, spec delta ~40, contract and docs ~15.
That lands near **750–800 changed lines** against a 400-line PR budget — above the proposal's
300–470, and consistent with this project's recorded pattern of the forecast growing at every phase.
Recording the growth rather than smoothing it is the point.

Natural cut, if the review-workload gate wants two PRs:

- **PR #1 — the pure core.** `flatten-map.ts`, `match-location.ts`, the `toFtsQuery` extraction, and
  their unit tests including I1–I4 and the full selection policy. Independently valuable (one
  tokenizer instead of two) and independently falsifiable (the invariants). Ships no wire change.
- **PR #2 — the window.** `excerpt.ts`, the call site, the fixtures, Gates 1/2/3/5, the spec delta,
  `server.ts` and `CLAUDE.md`.

The decision belongs to `sdd-tasks`, not here.

## Open Questions

- [ ] `w(t)`'s exact form. Assumed pure in-chunk IDF with a term-length tie-break. If a Gate 3 variant
      needs a length term promoted into `w` itself, that is a one-line change — but it must be driven
      by a failing case, not by taste.
- [ ] Whether the `referenceFlatten` golden test (I4) stays permanently or is deleted once the change
      ships. Assumed it stays; a duplicated implementation in a test is a real cost and reviewers may
      disagree.
- [ ] The supporting-fragment offset measurement (proposal's recorded observation): script under
      `scripts/` or a `verify`-only test? Assumed a script, following `vector-reach.mjs`. `sdd-verify`
      decides.
- [ ] Residual, stated not fixed: `locateSpans` matches folded substrings, so a query term can match
      inside a longer word (`the` inside `theory`). FTS5 would not. The consequence is confined to
      centring, the in-chunk IDF de-weights exactly the terms most prone to it, and enforcing token
      boundaries in the locator is a small follow-up if P1b or Gate 3 shows it matters.
