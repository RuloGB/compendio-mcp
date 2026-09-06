# Exploration: word-boundary-term-matching

> Opened as `rarity-weighted-match-centre` (Open problem 3, Lever C). Renamed 2026-09-06 after
> §4.5 and §4.6 falsified the formula-change framing and identified the substring-matching defect
> as the real, independently-justified finding. The original framing is kept below as the record of
> why the cycle changed.

Source: `docs/retrieval-open-work.md` § "Open problem 3 — Within a correct section, the window can
still miss the answer". This is **Lever C**, deferred by `2026-09-05-supporting-excerpt-anchoring`
with its reasons intact.

## 0. Evidence status (read this before any other section)

Nothing in this document was executed by the exploration phase. Every number below is
either (a) quoted from source with `file:line`, or (b) **hand-derived arithmetic**, explicitly
labelled. Where a claim is unmeasured it says so. The commands the later phases MUST run to
replace each inference are listed in §7.5.

Two claims in `docs/retrieval-open-work.md` itself are challenged below on the basis of (b). They
are challenged, not refuted — hand arithmetic is exactly the class of reasoning this project has
already been burned by.

**Orchestrator addendum (verified after the phase returned, by execution):** §3.3's central claim
was independently checked and **holds**. See §3.4.

---

## 1. Exact current behaviour, from the code

### 1.1 Where the pipeline enters

Single production call chain, no branches:

- `src/application/search-documents.ts:128` — `const spans = locateSpans(chunk.content, terms);`
  computed for **every** rank (the `rank === 0 ?` guard was removed by
  `supporting-excerpt-anchoring`). `terms` is hoisted once per search at `:108`
  (`tokenizeQuery(query.query)`).
- `src/application/search-documents.ts:133` —
  `excerpt: buildExcerpt(chunk.content, excerptBudget(rank), spans)`.
- `src/domain/excerpt.ts:78` — `const centre = selectMatchCentre(flatSpans, maxChars);`
  **This is the only call site of `selectMatchCentre` in the entire repository**
  (verified: `grep selectMatchCentre` returns `src/domain/match-location.ts`,
  `src/domain/excerpt.ts`, `test/domain/match-location.test.ts`, and archived SDD prose only).
- `src/domain/excerpt.ts:81` — `computeWindow(text, centre, maxChars, flatSpans)`.

Note the coordinate change at `excerpt.ts:75`: spans are located in **raw** chunk coordinates and
then mapped to **flattened** coordinates by `mapSpansToFlat` (`excerpt.ts:93-101`), which
*discards* any span that collapsed to zero width during flattening. So `selectMatchCentre` never
sees a span the reader could not see.

### 1.2 Candidate window enumeration

`src/domain/match-location.ts:130-167`. A two-pointer sweep over `sorted` (all occurrences of all
terms, ascending by `start` then `end`). For each `right`, the left pointer is advanced until the
cluster fits:

```ts
while (sorted[right]!.end - sorted[left]!.start > budget) {   // :132
```

So the candidate set is: for every occurrence index `right`, the **maximal** occurrence run
`[left..right]` whose raw extent fits `budget`. The chosen window's extent is
`[sorted[left].start, sorted[right].end]` and the returned centre is its midpoint
(`:170`, `Math.floor((start + end) / 2)`).

Two properties follow that matter for any redesign:

- Windows are anchored at occurrences, never at arbitrary offsets. A region with no occurrence is
  never a candidate.
- The window is the *maximal* left-extension, so a window is never scored on a proper subset of the
  occurrences that would fit. This means a rare term adjacent to a dense cluster inherits the
  cluster's score — you cannot isolate it.

### 1.3 The scoring function, verbatim

```ts
const occurrenceCount = new Map<string, number>();        // :110-113
for (const span of sorted) occurrenceCount.set(span.term, (…) + 1);
const totalOccurrences = sorted.length;                   // :114
const weight = (term: string): number => {                // :115-118
  const f = occurrenceCount.get(term) ?? 1;
  return Math.log(1 + totalOccurrences / f);
};
```

**Precisely what the "in-chunk IDF" is computed over** — this is the load-bearing detail and the
doc's paraphrase is easy to misread:

| Symbol | Domain | NOT |
|---|---|---|
| `f(t)` | occurrences of term `t` **in the `spans` array for this one chunk** | corpus document frequency; chunk *word* count; anything persisted |
| `L` (`totalOccurrences`) | `sorted.length` — total occurrences of **all query terms** in this chunk | chunk length; corpus size; number of distinct terms |
| the term set | the **query's** tokens only (`tokenizeQuery(query.query)`) | the chunk's vocabulary |

So `w(t) = log(1 + L/f(t))` has **no corpus statistics whatsoever**. Design.md
(`2026-08-06-match-centred-excerpt/design.md:199-202`) states this deliberately: *"`w` is an
in-chunk IDF. It has no corpus statistics behind it and does not need any: a stopword is frequent
everywhere, including in this chunk, so within-chunk frequency is a sound proxy and costs
nothing."* §4 below argues that this specific justification is where the defect actually lives.

### 1.4 Where `distinct` vs `total occurrences` enters — exactly

Both enter, in different places, and conflating them is the most common misreading:

- **`distinct` enters the *score*.** `distinctScore` is incremented **only when a term enters the
  window for the first time** (`:146-150`: `if (enteringCount === 0) distinctScore += weight(...)`)
  and decremented only when its last instance leaves (`:135-142`). A second occurrence of an
  already-present term adds nothing.
- **Total occurrences enter the *weight*, twice** — as `L` in the numerator (shared by every term)
  and as `f(t)` in the denominator (per term).

Therefore: repetition of a term *inside* the window cannot inflate that window's score, but
repetition of a term *anywhere in the chunk* lowers that term's weight in **every** window.

### 1.5 Tie-breaks, in order (`:155-160`)

1. higher `distinctScore`
2. then greater `distinctLength` — the sum of `term.length` over the window's **distinct** terms
   (`:149`, `:138`)
3. then smaller `clusterStart` (earliest)

`bestScore` initialises to `-Infinity` so the first candidate always wins the first comparison; the
sweep is left-to-right, so among exact ties on all three the earliest is kept (strict `>` / `<`
everywhere). Determinism across input order is pinned by
`test/domain/match-location.test.ts:188-196`.

---

## 2. The defect shape, and whether this repo can reproduce it

### 2.1 Abstract characterisation

The shape that defeats the current rule:

- **E** (early region): ≥3 *distinct* query terms whose occurrences all fit inside one
  budget-wide window, each of *moderate* in-chunk frequency.
- **R** (late region): one query term, individually rarer than every term in **E**, whose
  occurrences fit their own budget-wide window.
- **Separation**: the gap between E and R must exceed `budget`, or the two merge into one window
  and the comparison never happens. At the supporting tier `budget = 120`, so the separation
  requirement is trivially met; at the lead tier `budget = 1400`, E and R must be ~1400 characters
  apart, which is near the chunk-size ceiling (`chunk.maxTokens: 480` ⇒ ~1900 flattened chars,
  `design.md:170`). **This asymmetry is significant and under-discussed**: the shape is far easier
  to hit at rank ≥ 1 than at rank 0, which bears directly on approach (d) in §5.
- **Score condition**: `Σ_{t∈E} w(t) > w(r)`. With `w(t) = log(1 + L/f(t))` and `w` bounded above
  by `log(1 + L)`, three distinct terms of *any* frequency already sum past a single term unless
  their individual frequencies are high. Concretely (hand-derived): if E holds 3 terms at `f = 3`
  each and R holds one at `f = 1`, with `L = 10`:
  `Σ_E = 3·log(1 + 10/3) = 3·1.466 = 4.40` vs `w(r) = log(11) = 2.40`. E wins by 1.8×.
  **Even at `f = 5` each**, `Σ_E = 3·log(3) = 3.30 > 2.40`. Sum-over-distinct is a very strong bias
  toward count.

### 2.2 Can anything committed in this repo reproduce it? — **No.**

Checked every committed corpus that reaches `selectMatchCentre`:

| Fixture | Shape it carries | Why it does not reproduce |
|---|---|---|
| `test/fixtures/excerpt-window/docs/stopword-trap.md` | 1 high-frequency term (`the`, ≥20) + 1 unique term (`windvane`) | Two terms only. There is no E of ≥3 distinct terms; this is the *opposite* shape — the one the current rule already handles. |
| `test/fixtures/excerpt-window/docs/window.md` | 1 marker past offset 1400 | Single-region; no competing cluster at all. |
| `ejemplos/` + `goldenset.yaml` | Spanish 11-doc corpus, 29 chunks | Chunks are small; the 22 queries are short. Whether any query/chunk pair exhibits the shape is **unmeasured** — §6.1's anti-vacuity counter is exactly the instrument that would answer it, and the expectation (unmeasured) is that it will report **zero**, which is precisely what makes `ejemplos/` a good *negative* control for the gate. |
| `test/fixtures/vector-reach/`, `excerpt-fence-drop/`, `strict/` | built for other invariants | none carry a multi-distinct-term early cluster. |

The motivating instance — `demo-docs/reference/billing-rules.md` § *6. Settlement reconciliation >
Capture collision* — lives in `C:\Users\Raul\Workspace\DocuTests2` and **cannot be committed here**
(the repo is public and holds zero client data; and the corpus is the acceptance-test control
group).

**Conclusion, stated plainly as `retrieval-open-work.md` demands: no committed fixture reproduces
the discriminating shape. Building one is a hard prerequisite, not a task ordering preference.**

### 2.3 The fixture the cycle must build

Following `test/fixtures/excerpt-window/`'s **self-asserted-precondition** pattern
(`test/application/excerpt-window.test.ts:12-68`): a `describe` block that indexes the fixture and
asserts the *fixture's own* structural properties before any gate asserts behaviour, so a fixture
that silently drifts fails loudly instead of making the gate vacuous. Note `:58-63` — that block
already carries the lesson that guarding the wrong string makes the gate pass without
discriminating.

The new fixture's preconditions must assert, over the **flattened** stored chunk (never the file on
disk, never `chunk.content`):

1. the document produces exactly **one** chunk (otherwise the competing regions land in different
   chunks and never compete);
2. terms `e1,e2,e3` each occur **exactly N** times (N ≥ 2, pinned), all occurrences inside
   `[0, 200]`;
3. term `r` occurs exactly **1** time, at offset > 1500 — i.e. `f(r) < f(e_i)` **strictly**, by
   construction, and the separation exceeds `LEAD_EXCERPT_CHARS`;
4. an invented answer marker (`MERIDIANO-4417`-style, ASCII, no diacritics) adjacent to `r`, whose
   offset is asserted `> LEAD_EXCERPT_CHARS` — the trap `excerpt-window.test.ts:58-63` records;
5. the flattened length, bounded top and bottom, so re-chunking drift is caught.

**Two traps specific to this fixture**, both already paid for in this repo:

- The marker must not be reachable by a plain prefix (see 4), or the gate passes on a reverted tree.
- Fixture files are LF-normalised on checkout unless `.gitattributes` covers them. This fixture
  needs no CRLF, but if the cycle adds a CRLF variant it must add the `.gitattributes` entry in the
  same commit.

---

## 3. The two failure modes the current rule defeats

Both named in `2026-08-06-match-centred-excerpt/design.md:193-197`:

> *"Distinct-term count alone loses the minimal form of Gate 3: a query of one stopword plus one
> distinctive term, each occurring once, ties at one distinct term and falls through to 'earliest'
> — which is first-hit wearing a disguise. Rarity alone loses to a window packed with thirty
> repetitions of `de`. Summing `w` over distinct terms defeats both."*

### 3.1 Stopword-packing

**Mechanism**: a query stopword (`the`, `de`, `charge`) occurs many times in a tight early region.
Under a rule that scores by *raw occurrence count* or by *unnormalised density*, that region wins
purely by volume. Defeated today by two independent mechanisms simultaneously: (i) the score counts
**distinct** terms, so 30 repetitions of `de` score once; (ii) `w(de)` is *depressed* by its own
frequency (`f` in the denominator).

**Pinned by**:
- `test/domain/match-location.test.ts:142-149` — unit form. `the`×2 @0,10 vs `rare`×1 @500,
  budget 100 ⇒ expects `502`.
- `test/domain/match-location.test.ts:160-170` — scattered singletons. `a`×5 vs `b`×1 ⇒
  expects `1000`.
- `test/application/excerpt-window.test.ts:95-112` — **Gate 3**, integration. Query `"the windvane"`
  against `stopword-trap.md`; asserts the excerpt contains `TRAMONTANA-9182` and does **not** start
  with `"The keeper checks the lamp"`.
- `test/application/search-documents-spans.test.ts:138-169` — supporting-tier form. `block`×20 at
  offset 0 vs `quetzal`×1 at ~offset 220; asserts `toContain("quetzal")` **and**
  `not.toContain("block")`.

### 3.2 First-occurrence-in-disguise

**Mechanism**: when every candidate window ties on the primary score, selection falls through to
the "earliest start" tie-break (`match-location.ts:158-160`) — which reproduces the exact first-hit
defect the whole `match-centred-excerpt` change existed to kill, while *looking* like a principled
rule. Defeated today by the rarity term: a lone rare term outscores a lone common one, so the
one-distinct-term-each case never reaches the earliest tie-break.

**Pinned by**: `match-location.test.ts:142-149` again (this is the fixture design.md calls "the
minimal form of Gate 3" — it is the canary for *both* modes at once), and by
`excerpt-window.test.ts:107` (`expect(lead.excerpt.startsWith("The keeper checks the lamp")).toBe(false)`).

### 3.3 Which assertions a candidate change would break — and the finding that changes this cycle

`docs/retrieval-open-work.md:155-158` states that `test/domain/match-location.test.ts:151-158`
*"would have to be **inverted**."* That claim is inherited from
`2026-09-05-supporting-excerpt-anchoring/exploration.md:256-257`.

**Hand-derived arithmetic says that is probably false for the leading candidate formulas.**
The fixture is:

```ts
{ start: 0,   end: 5,   term: "alpha" },
{ start: 500, end: 504, term: "beta"  },
{ start: 520, end: 525, term: "gamma" },   // budget 200, expects 512
```

All three terms have `f = 1` and `L = 3`, so **`w(alpha) = w(beta) = w(gamma) = log(4) = 1.3863`**
— the fixture is *equal-rarity by construction*. Trace each candidate:

| Candidate score | `{alpha}` | `{beta,gamma}` | Primary result | After tie-breaks |
|---|---|---|---|---|
| current: `Σ` over distinct | 1.3863 | 2.7726 | late wins | **512** (green) |
| (a) `max` over distinct | 1.3863 | 1.3863 | **tie** | `distinctLength` 5 vs 9 ⇒ late wins ⇒ **512** (still green) |
| (b) `Σ w^p`, p>1 | 1.3863^p | 2·1.3863^p | late wins | **512** (green) |
| (c) distinct-count floor, rarity tiebreak | count 1 vs 2 | late wins | **512** (green) |
| mean rarity (`Σ/|distinct|`) | 1.3863 | 1.3863 | **tie** | length ⇒ late ⇒ **512** (green) |

**Every candidate leaves this test green.** The only way to invert it is to *also* drop the
`distinctLength` tie-break (`:157`) — a second, unrelated change.

**Why this matters far more than the correction itself**: if it holds, then *the entire committed
test suite is blind to the change this cycle proposes*. Every one of the five pinning assertions in
§3.1/§3.2 stays green under sum→max (traced: §3.1's fixtures all have a single-distinct-term-per-
window shape, exactly as `supporting-excerpt-anchoring/exploration.md:92` already observed —
*"both fixtures happen to be single-distinct-term-per-window shapes … they cannot serve as a Lever
C regression gate as they stand"*). A change no existing test can detect, in a mechanism the only
automated gate cannot see (§6), is the exact profile of this repository's documented failure mode.
**The fixture and the probe are not deliverables of this cycle — they are its entry conditions.**

### 3.4 Orchestrator verification of §3.3 — **executed, and it holds**

§3.3 was hand-derived by a phase agent with no Bash tool, so the orchestrator ran it. Method: patch
`src/domain/match-location.ts`'s `distinctScore` accumulation from a running sum to a running
**max** over the live window's distinct terms, run the four pinning test files, then revert.

The patch (verbatim, applied at `src/domain/match-location.ts:153-163`):

```ts
const maxScore = Math.max(...Array.from(windowCounts.keys(), weight));
// …and every `distinctScore` in the `better` comparison and in
// `bestScore = distinctScore` replaced by `maxScore`.
```

Result, measured 2026-09-06 on this tree:

| Run | Command | Result |
|---|---|---|
| Four pinning files, **patched** | `npx vitest run test/domain/match-location.test.ts test/application/excerpt-window.test.ts test/domain/excerpt.test.ts test/application/search-documents-spans.test.ts` | **4 files, 62 tests, all passed** |
| Full suite, **patched** | `npm test` | **52 files, 914 passed, 1 skipped, 0 failed** |
| Full suite, **reverted** (baseline) | `npm test` | **52 files, 914 passed, 1 skipped, 0 failed** — identical |

The patch was reverted with `git checkout src/domain/match-location.ts`; the working tree carries no
production change from this phase.

Two consequences, both stronger than §3.3 claimed:

1. `docs/retrieval-open-work.md`'s "would have to be **inverted**" is **falsified**. The roadmap
   claim must be corrected, not carried forward.
2. The blindness is total, not partial: **not one of the 914 committed tests** distinguishes the
   current formula from the leading candidate. The fixture and probe are entry conditions, confirmed
   by execution rather than by argument.

---

## 4. A challenge to the diagnosis itself (read before choosing a formula)

`docs/retrieval-open-work.md:139-143` says:

> *"it sums an in-chunk IDF weight over **distinct** terms, so a dense early cluster of common query
> words (`customer`, `charge`, `charged`) outscores the region holding the one rare, discriminating
> term. Measured on the §6 chunk: the answer sits beside `refund` (2 occurrences, at offsets 1253
> and 1316) while the winning cluster holds four distinct terms at offsets 43-202."*

The recorded measurement gives `f(refund) = 2`. **It does not give the in-chunk frequency of the
four cluster terms.** That omission is decisive, because the fix depends on it:

- If any cluster term occurs **once** in that chunk (`twice` is the obvious candidate — a word
  unlikely to repeat), then `w(that term) = log(1 + L) > w(refund) = log(1 + L/2)`, i.e. the early
  cluster contains a term that is *in-chunk-rarer than the answer's own term*. Under **(a)
  max-rarity, the early cluster still wins** — the proposed fix does not fix the motivating case.
- The framing "a dense early cluster of **common** query words" is therefore an assumption, not a
  measurement. `customer`/`charge`/`charged` are common *in English* and *in a payments corpus*;
  the current formula has no way to know that (§1.3 — no corpus statistics at all).

**The real defect may not be `sum` vs `max`. It may be that in-chunk frequency is a bad rarity
proxy on chunks of ~1900 characters**, where most query terms occur once or twice and `w` is
therefore nearly flat across the whole query — reducing the score to "how many distinct terms are
nearby", i.e. pure density. Design.md's justification (`:199-202`) was argued for stopwords, where
in-chunk frequency really does track corpus frequency; it was never argued for
*moderately-common domain nouns*, which is exactly the population Open problem 3 is about.

If that reframing is right, the honest lever is **corpus document frequency**, which is a materially
larger change: `match-location.ts`'s header comment declares it *"Pure: no I/O, no SQLite, no
injectable dependency (design.md Decision 8)"*, so corpus DF would either need a new port, a
precomputed DF map threaded from `SearchDocuments`, or FTS5 `bm25()`-derived weights — the last of
which `design.md:214-215` already rejected for `match-centred-excerpt` ("needs `bm25()` per term …
and it weights *documents*, not positions"). That rejection was made against a *different* question
and deserves re-examination rather than inheritance, but it is a much bigger cycle than "change one
aggregation operator".

**A second, more uncomfortable challenge.** The doc's own example is
`billing-rules.md § 9. Refunds`, whose window landed on the audit-log paragraph. It then says the
actual answer ("within three business days of detection") lives in **§ 6 Capture collision** — a
*different chunk*, which ranked 8th. So: **does § 9 Refunds contain refund-timing content at all?**
If it does not, no centring rule can produce a helpful excerpt from it, and Open problem 3's
motivating instance is a case where the correct behaviour is "this chunk has nothing useful" — a
ranking problem (Open problem 1) wearing an excerpt problem's clothes. **Unverified. This is the
single cheapest measurement in this document and it can invalidate the cycle.** Command in §7.5.

---

---

## 4.5 The two blocking measurements — **executed 2026-09-06, both falsify the roadmap**

The exploration phase declared itself blocked on the two measurements in §4. The orchestrator ran
them before the proposal phase. Instrument: a one-off probe importing compiled `dist/`
(`SqliteIndexStore.getChunksByDocument`, `tokenizeQuery`, `locateSpans`, `selectMatchCentre`,
`buildExcerpt`) against the pre-existing hybrid index of `C:\Users\Raul\Workspace\DocuTests2`
(`store.hasVectors() === true`, so this is the same database the roadmap's trace was taken from).
Offsets below are **raw `chunk.content`** coordinates; the roadmap's recorded numbers appear to be
flattened coordinates, which explains a uniform ~35-character shift and changes nothing.

Query: `refund time for customer charged twice duplicate charge`
`tokenizeQuery` → `[refund, time, for, customer, charged, twice, duplicate, charge]`

### 4.5.1 M1 — the span multiset of the answer chunk. **§4's challenge is CONFIRMED.**

`demo-docs/reference/billing-rules.md` chunk #8, heading
`6. Settlement reconciliation > Capture collision`, 1468 chars, `L = 16`:

| term | f | `w = log(1+L/f)` | offsets |
|---|---|---|---|
| `charge` | 1 | **2.8332** | 78 |
| `charged` | 1 | **2.8332** | 78 |
| `twice` | 1 | **2.8332** | 225 |
| `refund` | 2 | 2.1972 | 1288, 1350 |
| `for` | 4 | 1.6094 | 101, 231, 509, 794 |
| `customer` | 7 | 1.1896 | 66, 206, 299, 375, 872, 978, 1020 |

The answer — *"the refund must be submitted to the acquirer within three business days of
detection"* — sits at ~1350. The early cluster spans 66-231.

**The early cluster contains three terms of weight 2.8332, strictly greater than `refund`'s
2.1972.** Therefore:

- **(a) max-rarity does NOT fix the motivating case.** `max` over the early cluster is 2.8332;
  `max` over the late region is 2.1972. The early cluster wins under max exactly as it wins under
  sum. Measured `selectMatchCentre(spans, 120) = 85` — inside the early cluster.
- **(c2) rarity-first does not fix it either**, for the same reason.
- **(b) superlinear** cannot fix it: it is monotone in `w`, and `w(charge) > w(refund)` already.

§4's hypothesis was that "a dense early cluster of *common* query words" is an assumption rather
than a measurement. It was. `charge`, `charged` and `twice` are the **rarest** terms in that chunk,
not the commonest. **The roadmap's stated mechanism for Open problem 3 is falsified on its own
motivating example.**

### 4.5.2 A mechanism the roadmap never named: unbounded substring matching

Two independent instances, both measured:

- `charge` and `charged` produce **two spans at the same offset 78** — `locateSpans` matches
  `charge` inside the word `charged`. The early cluster therefore scores **two** distinct terms of
  maximum weight for **one** word occurrence. This is a pure score amplifier for the wrong region
  and it is invisible to any change of aggregation operator.
- In chunk #11 (`9. Refunds`), `time` matches inside `timestamp`:
  `locateSpans("the actor, the timestamp, and the reason", ["time"])` →
  `[{ start: 15, end: 19, term: "time" }]` — measured directly.

Neither is a `sum`-vs-`max` question. Both are `locateSpans` questions. **This is a candidate
mechanism the cycle should evaluate against (a)-(e), and it was not on the exploration's list.**

### 4.5.3 M2 — does `§9. Refunds` hold refund-timing content? **No. And the current rule already
picked its rarest region.**

Chunk #11, heading `9. Refunds`, 869 chars, `L = 11`:

| term | f | `w` | offsets |
|---|---|---|---|
| `time` | 1 | **2.4849** | 635 |
| `for` | 2 | 1.8718 | 682, 740 |
| `refund` | 8 | 0.8650 | 6, 17, 48, 195, 257, 356, 414, 554 |

Full content, read verbatim: refunds return captured funds; may be full or partial; several may run
against one capture but their sum may not exceed the settled amount; may only be issued against a
settled capture; are irreversible; and every transition is appended to an immutable seven-year event
log. **There is no timing content, no SLA, no business-day figure anywhere in this chunk.**

Two consequences, both stronger than §4 anticipated:

1. **No centring rule can make this chunk helpful.** The roadmap's example of "the window landed on
   the wrong paragraph" is a chunk that has no right paragraph. This instance of Open problem 3 is
   Open problem 1 wearing an excerpt problem's clothes, exactly as §4's second challenge suspected.
2. **The current rule already chose the highest-rarity region.** Measured
   `selectMatchCentre(spans, 120) = 660`, a window holding `time` (w 2.4849 — the chunk's maximum)
   and `for`. Under max-rarity the same window wins. The excerpt the roadmap holds up as the
   symptom — *"…the actor, the timestamp, and the reason. The log is retained for seven years…"* —
   is what **rarity-favouring selection already produces**, and it is produced by a spurious
   `time`-in-`timestamp` match (§4.5.2).

### 4.5.4 What the lead budget would have shown

Not asked for, measured in passing, and it reframes the whole problem. On the answer chunk (#8) at
`budget = 1400`, `selectMatchCentre` returns 680 and the excerpt **ends with the answer**:
*"…the refund must be submitted to the acquirer within three business days of detection.…"*

So at rank 1 the current, unmodified code answers the question outright. The failure in the roadmap's
trace is **entirely** ranking (the chunk was at rank 8) plus the 120-character supporting budget —
not match centring.

### 4.5.5 Consequences for this cycle

- Approaches **(a)**, **(b)**, **(c1)**, **(c2)** are all falsified on the motivating case. Under
  §8 question 3 and this project's `bounded-chunk-size` Gate 2 precedent — *"a wrong analysis stops
  the change rather than shipping"* — that is a stop condition for the formula-change framing.
- **(d)** (supporting-tier-only scoping) is unaffected as a *scoping* decision but has nothing left
  to scope: there is no formula on the table that fixes the case.
- **(e)** (corpus DF) is now the only candidate whose mechanism is consistent with the measurement:
  `charge`/`charged`/`twice` are rare *in this chunk* and common *in a payments corpus*, which is
  precisely the population §4 predicted in-chunk frequency would misjudge. It remains the expensive
  option that breaks `match-location.ts`'s purity declaration.
- A **new candidate (f)** exists that the exploration never considered: fix `locateSpans`'
  unbounded substring matching (`charge` ⊂ `charged`, `time` ⊂ `timestamp`). It is cheap, it is
  independently defensible, and on chunk #8 it removes one of the two 2.8332-weight terms from the
  early cluster. Whether it flips the selection is **unmeasured** — it does not on its own, since
  `twice` remains at 2.8332 > 2.1972.
- `docs/retrieval-open-work.md`'s Open problem 3 needs correcting on three counts: the inversion
  claim (§3.4), the "common query words" mechanism (§4.5.1), and the `§9. Refunds` example
  (§4.5.3).

---

## 4.6 Candidate (f) investigated and costed — **measured 2026-09-06**

Prompted by §4.5.2, the orchestrator investigated the substring-matching mechanism the exploration
never listed. Probes kept beside this document: `boundary-probe.mjs`, `strict-cost.mjs`.

### 4.6.1 The mechanism

`locateSpans` (`src/domain/match-location.ts:77`) is `foldedRaw.indexOf(foldedTerm)` with
`searchFrom = idx + 1` — a plain substring scan with **no word-boundary condition on either end**.

Measured over the whole `DocuTests2` corpus (888 chunks) with the roadmap's own failing query,
classifying every span by whether a letter/digit abuts it:

| class | spans | share |
|---|---|---|
| exact word match | 1 539 | **28.1%** |
| prefix of a longer word | 2 009 | 36.6% |
| interior of a word | 1 935 | 35.3% |
| suffix of a longer word | 1 | 0.0% |

**71.9% of spans are not word matches.** `for` inside *enforced*, *performing*, *before*,
*platform*; `time` inside *timestamp*, *timers*.

### 4.6.2 The structural argument — this is a divergence, not a precision knob

`toFtsQuery` (`src/infrastructure/sqlite/sqlite-index-store.ts:572-576`) emits
`"term" OR "term"` — quoted, no `*` prefix — against an FTS5 table tokenized
`unicode61 remove_diacritics 2`, which has **no stemmer**. Measured directly against a scratch FTS5
table holding `"Refunds may be full or partial and the timestamp is logged"`:

| MATCH | rows |
|---|---|
| `"refund"` | **0** |
| `"refunds"` | 1 |
| `"time"` | **0** |
| `"timestamp"` | 1 |
| `"charge"` | **0** |

So the retriever matches **whole tokens**; the excerpt locator matches **substrings**. The excerpt
is pointing at matches the search never made.

`sqlite-index-store.ts:562-566` states the intended invariant: *"the terms the excerpt locator hunts
for are, by construction, the terms the lexical leg searched with — one definition of 'what a query
term is,' not two that can silently drift apart."* The **term list** is shared. The **matching
semantics** never were. This is that documented invariant being half-true.

Canonical IR practice is that a highlighter runs the index's own analysis chain (Lucene/Elasticsearch
highlighters match analyzed token positions; FTS5 ships `highlight()`/`snippet()` over its own
tokenizer output). Substring highlighting is not a variant of that practice.

### 4.6.3 The candidate

Require a non-word character (or string edge) on both sides of a span, using the **same
`[^\p{L}\p{N}]` class `tokenizeQuery` already splits on** (`match-location.ts:25`). Not a new rule
and not language-specific — the rule already in the file, applied to the other side of the
comparison. It works identically for Spanish and English because, like FTS5, it knows no morphology.

The apparent cost — losing `refund` → `refunds` — is **not a loss**: that plural never contributed
to retrieval. Dropping it makes the excerpt honest about why the chunk was returned.

### 4.6.4 The real cost, measured on two corpora in two languages

The genuine risk is fragments falling to zero spans, which lose match-centring entirely and revert
to a start-anchored prefix. `strict-cost.mjs` drives the **real pipeline** (`createContainer`,
hybrid, default `k`), resolves each fragment's chunk by `(path, section)`, and — where a heading is
ambiguous — measures **every** candidate rather than excluding the fragment (the exclusion that
would otherwise have silently dropped 20% of the `DocuTests2` population).

| corpus | queries | fragments | with ≥1 span | **would lose ALL spans** | spans retained |
|---|---|---|---|---|---|
| `ejemplos/` (Spanish, its 22 goldenset queries) | 22 | 110 | 110 | **0 (0.0%)** | 1 692 / 3 035 = 55.7% |
| `DocuTests2` (English, 81 docs, 10 queries) | 10 | 50 | 48 | **0 (0.0%)** | 459 / 1 239 = 37.0% |

**Not one fragment on either corpus loses match-centring.** Between 44% and 63% of spans are
spurious and disappear; every fragment keeps at least one genuine span. The Spanish corpus, where
plural loss was the stated fear, shows the *higher* retention.

### 4.6.5 What this does NOT claim

- It does **not** fix the motivating case. On chunk #8 it removes `charge` (⊂ `charged`) from the
  early cluster, but `twice` remains at w 2.8332 > `refund`'s 2.1972, so selection does not move.
  **This is a correctness fix with an independent justification, not a fix for Open problem 3.**
- The retention percentages are **not** a quality measurement. They count spans dropped, not
  excerpts improved. Whether the resulting excerpts read better is unmeasured.
- Two corpora and 32 queries is not a corpus-wide guarantee. The gate must re-measure.
- `foldForMatch` is deliberately narrower than FTS5's `remove_diacritics 2`. Aligning boundary
  semantics does not align folding semantics; that residual divergence stays open.

## 5. Candidate approaches, compared

All assume the fixture (§2.3) and probe (§6.1) exist first. "Rank-0 blast radius" is the column
that matters most: `excerpt.ts:30-33` records that the graduated budget is only sound *because rank
0 is reliably good*.

### (a) `max` over distinct terms instead of `sum`

`distinctScore` becomes `max_{t ∈ window} w(t)`. Requires replacing the incremental accumulator
with a max over the live `windowCounts` keyset (the sliding window can no longer maintain a max in
O(1) on removal without a multiset/monotonic structure — a real, if small, complexity cost).

- **Fixes**: the abstract shape in §2.1 *only when every cluster term is strictly more frequent
  in-chunk than the rare term*. Per §4, that is **unverified for the motivating case and may be
  false**.
- **Risks**: collapses to the `distinctLength` tie-break far more often (every equal-rarity input,
  which on short chunks is most inputs — see §4's flatness argument), so "earliest + longest term"
  becomes the *de facto* rule. That is first-occurrence-in-disguise creeping back in through the
  tie-break door rather than through the score. Stopword-packing itself stays defeated (`w` still
  penalises frequency).
- **Rank-0 change on every corpus**: yes, unbounded — any chunk where the winning window held ≥2
  distinct terms can move. Magnitude **unmeasured**; §6.1's D3 counter is what measures it.
- **Gate cost**: medium — fixture + probe + before/after digests.

### (b) Rarity-weighted sum with a superlinear weight (`Σ w(t)^p`, p > 1)

- **Fixes**: **nothing, on this shape.** Hand-derived: raising every term's weight to the same
  power `p` preserves the ordering between "3 terms of weight `a`" and "1 term of weight `b`"
  whenever `3a^p > b^p`, i.e. whenever `b/a < 3^{1/p}`. With `a = log(1+L/3)`, `b = log(1+L)` and
  `L = 10`: `b/a = 2.40/1.47 = 1.63`; `3^{1/p} > 1.63` for all `p < 2.25`. So it "fixes" the shape
  only for aggressive `p`, and at aggressive `p` it approximates (a) while adding a magic constant
  with no principled value. **Weak candidate; include for completeness, expect the proposal to
  reject it.**
- **Risks**: an unjustifiable tuning parameter in a codebase whose stated virtue is "RRF — no
  weights to tune" (`AGENTS.md`).

### (c) Hybrid — distinct-term count as a floor, rarity as tiebreak

Two readings, opposite effects; the proposal must not conflate them:

- **(c1) count-first, rarity-second** (the literal reading of "count as a floor"): entrenches the
  early cluster *harder* than today, because it removes rarity's ability to overcome a count
  deficit at all. **Makes Open problem 3 strictly worse.** Reject.
- **(c2) rarity-first, count-second**: identical to (a) with `distinctLength` demoted below
  distinct-count. Fixes the same cases (a) fixes, and additionally keeps `{beta,gamma}` beating
  `{alpha}` in `match-location.test.ts:151-158` *on principle* rather than by the accident of term
  length — arguably the more honest version. Same rank-0 blast radius as (a).

### (d) Do nothing at the lead tier — narrow the change to rank ≥ 1 only

Apply the new rule when `budget === SUPPORTING_EXCERPT_CHARS`, leave rank 0 on the current rule.

- **Rationale is real, not a dodge**: §2.1 shows the defect shape needs E and R separated by more
  than `budget`. At 1400 characters, on ~1900-character chunks, the shape is nearly geometrically
  impossible; at 120 characters it is routine. **The defect is overwhelmingly a supporting-tier
  phenomenon.** (Unmeasured — §6.1's probe reports the D1 denominator split by rank, which settles
  it.)
- **Fixes**: the supporting-tier instances, which per the above are most of them.
- **Risks**: introduces the first *budget-dependent* behavioural branch in
  `selectMatchCentre`, which currently takes `budget` purely as a geometric constraint. That is a
  new kind of coupling and it is the sort of thing this repo's own notes keep flagging ("one
  mechanism, one rule"). It also makes rank 0 and rank 1 answer the same question differently — the
  exact pattern `AGENTS.md`'s S1/S2 fence bullet records as a regretted divergence.
- **Rank-0 change on every corpus**: **none**. This is its entire value.
- **Gate cost**: lowest — the probe only needs the rank ≥ 1 population, and `excerpt-window.test.ts`
  Gates 1/3 (rank-0 only) are guaranteed untouched, which is itself strong evidence of containment.

### (e) Named but out of scope here: corpus document frequency

Per §4. Materially larger; breaks `match-location.ts`'s purity declaration; re-opens
`design.md:214-215`. Recorded so a later cycle does not have to rediscover it. **Not a candidate
for this cycle** unless §4's measurement shows (a)/(c2) cannot fix the motivating case — in which
case this cycle has no viable candidate and should be re-scoped rather than shipped.

### Summary

| # | Fixes the shape? | Fixes the *motivating case*? | Changes rank 0 everywhere? | Reintroduces §3 modes? | Effort | Gate cost |
|---|---|---|---|---|---|---|
| (a) max | yes, conditionally | **unknown — §4** | **yes** | stopword: no; first-occurrence: **risk via tie-break** | Medium | Medium |
| (b) superlinear | barely, with a magic `p` | unlikely | yes | same as (a) | Medium | Medium |
| (c1) count floor | **worsens it** | no | yes | no | Low | — |
| (c2) rarity-first | yes, conditionally | unknown — §4 | **yes** | as (a), slightly better | Medium | Medium |
| (d) supporting-tier only | yes, where it actually occurs | partially | **no** | no (rank 0 untouched) | Low-Medium | **Lowest** |
| (e) corpus DF | yes, on the right grounds | plausibly | yes | needs full re-verification | **High** | High |

No recommendation is made here — §4's two measurements decide between (a)/(c2)/(d)/(e), and both
are cheap. Choosing a formula before running them is exactly the failure this project's standing
rules exist to prevent.

---

## 6. The gating problem

`src/application/evaluate-search.ts` computes rank from `response.results.map(r => r.path)` and
**never reads `.excerpt`** (confirmed by the archived exploration's own verification pass,
`supporting-excerpt-anchoring/exploration.md:51-52`, and restated as a standing rule at
`docs/retrieval-open-work.md:213-217`). `compendio eval` is therefore structurally blind: this
change moves *which passage inside a chunk* is shown without moving *which document* ranks where.
Running `eval` is still worth doing — as a **non-gating** invariance check that the change did not
accidentally touch ranking — but a green `eval` is not evidence of anything this cycle claims.

### 6.1 Proposed probe: `scripts/match-centre-probe.mjs`

Family: `supporting-anchor-probe.mjs` / `excerpt-fence-drop-probe.mjs` / `vector-reach.mjs`.
Binding constraints inherited from that family, each for a reason already paid for:

- Import from **`dist/`**, never `src/` (`node dist/cli.js`, never a bare `compendio`).
- Drive the **real pipeline** through `createContainer`; never re-implement fusion, `capPerDocument`
  or excerpt construction inside the probe (`supporting-anchor-probe.mjs:4-11`).
- Observe the excerpt the pipeline produced; **never recompute one to compare against itself**.
- Index **hybrid**, not `--lexical`, and never pass `k` — a different `k` measures a different
  population.
- Excerpts are **query-time**: a before/after pair needs `npm run build` between runs, **not** a
  reindex.

**Counters** (order matters; each has one and only one job):

- **D0 — chunk identity.** A result's `(path, section)` must resolve to exactly one stored chunk.
  Checked **first**; anything else is excluded from every counter and reported.
  Failure ⇒ `CANNOT IDENTIFY THE MEASURED CHUNK`.
- **D1 — the anti-vacuity denominator: fragments exhibiting the discriminating shape.** Computed
  from `locateSpans` output **independently of any scoring formula**, so it cannot move when the
  formula changes:
  for a fragment's chunk, over the flattened spans, D1 counts it iff there exists a budget-wide
  window holding ≥3 distinct terms **and** a term `r` outside that window with
  `f(r) < min_{t ∈ that window} f(t)` **strictly**. Reported **split by rank** (rank 0 vs rank ≥ 1)
  — this is the number that settles approach (d).
  `D1 === 0` ⇒ `GATE IS VACUOUS`.
- **D2 — of D1, fragments whose excerpt contains the rare term `r`.** Before: expected low. After:
  must be higher, and on the committed fixture must be **100%**.
  Post-change `D2 < D1` on the fixture ⇒ `THE FIX DID NOT LAND`.
- **D3 — blast radius: fragments NOT in D1 whose excerpt changed between runs.** Requires an
  excerpt-hash digest. This is the *only* number that bounds "changes rank-0 behaviour on every
  corpus", and it must be reported for `ejemplos/` **and** a second, larger corpus. It is
  **reported, not gated** — there is no defensible threshold, and inventing one would be the kind
  of tolerance-band theatre `bounded-chunk-size`'s Gate 2 note warns against.
- **D4 — stopword-packing canary at corpus scale.** Fragments whose excerpt window is centred
  within the neighbourhood of the chunk's **most frequent** query term while a strictly-rarer term
  exists elsewhere in that chunk. Must be **0 after**; reported before.
  `D4 > 0` post-change ⇒ `STOPWORD PACKING REGRESSED`.
- **D5 — ordered digest** of `(query, rank, path, section)` in emission order, plus a per-fragment
  excerpt hash. `--compare-digest` requires **tuple-for-tuple** identity of the first component (a
  rank-slot swap can hold D1 steady while corrupting every rate over it — the defect
  `supporting-anchor-probe.mjs:66-74` exists to catch), while the hash component is what D3 reads.
  Mismatch ⇒ `POPULATION DRIFTED BETWEEN RUNS`.

**Five distinct, never-conflated failure messages**:
`CANNOT IDENTIFY THE MEASURED CHUNK` · `POPULATION DRIFTED BETWEEN RUNS` · `GATE IS VACUOUS` ·
`THE FIX DID NOT LAND` · `STOPWORD PACKING REGRESSED`.

### 6.2 How the probe is verified RED — non-negotiable

*"A gate never observed failing has not been verified"* (`retrieval-open-work.md:218-222`), and the
same document records that the previous attempt to prove a gate red **ran a probe that did not
exist in the reverted tree and read `exit 1` as success**. So:

1. **RED against the unmodified tree**, on the new fixture: must exit non-zero with
   `THE FIX DID NOT LAND` — and the transcript must show that message, not merely `exit 1`.
   The probe script must be **present in both tree states** (revert only
   `src/domain/match-location.ts`, never the probe — that is what the tasks must specify).
2. **VACUOUS against a shape-free corpus** — run against `ejemplos/`; if D1 is 0 there (expected,
   unmeasured), it must exit non-zero with `GATE IS VACUOUS` in **both** tree states. If D1 is
   *not* 0 on `ejemplos/`, that is a finding in its own right (the shape occurs in production
   corpora more than assumed) and a second known-vacuous corpus must be constructed.
3. **D4 RED**: verified by running the probe against a deliberately first-hit-patched
   `selectMatchCentre` (return the earliest cluster's centre unconditionally) — it must fire
   `STOPWORD PACKING REGRESSED`, proving the canary can detect the mode it names.

---

## 7. Blast radius

### 7.1 Production

| File:lines | What | Why affected |
|---|---|---|
| `src/domain/match-location.ts:106-171` | `selectMatchCentre` — score, accumulator, tie-breaks, doc comment `:96-105` | **the change itself**. The doc comment states the formula verbatim and must move with it. |
| `src/domain/excerpt.ts:78` | the only call site | unchanged in shape; changed in outcome for every chunk with ≥2 distinct terms in the winning window. |
| `src/application/search-documents.ts:133` | the only production caller of `buildExcerpt` | unchanged; listed so the chain is complete. |
| `src/server.ts` tool descriptions | prose about excerpt centring | check only — the anchoring cycle already rewrote these; the wording may already be formula-agnostic. **Unverified**, grep in the proposal phase. |

`selectMatchCentre` has **one** production caller and `buildExcerpt` has **one**. `read_doc` and
`docs_overview` never build excerpts. The surface is genuinely narrow — the risk is behavioural
reach, not code reach.

### 7.2 Tests

| File | Status under (a)/(c2) |
|---|---|
| `test/domain/match-location.test.ts:142-149` (stopword trap, minimal) | **green** — verified §3.4 |
| `test/domain/match-location.test.ts:151-158` | **green, contrary to `retrieval-open-work.md:157`** — verified §3.4 |
| `:160-170` (scattered singletons) | **green** — verified §3.4 |
| `:172-178`, `:180-186` (tie-breaks) | **green** — verified §3.4 |
| `:188-196` (determinism) | **green** — verified §3.4 |
| `test/application/excerpt-window.test.ts` Gates 1 & 3 | **green** — verified §3.4 |
| `test/application/search-documents-spans.test.ts:138-169` (`block quetzal`) | **green** — verified §3.4 |
| `test/domain/excerpt.test.ts` (all Decision-5/6 window tests) | **green** — verified §3.4 |
| `test/application/vector-only-excerpt.test.ts` | **green** — empty-spans path, never reaches the scorer |
| **NEW** unit tests on the discriminating shape | **must be added** — nothing existing can fail |
| **NEW** integration test on the new fixture | **must be added** |

Under (d), add: no rank-0 test can move *by construction*, which is a checkable property the tasks
should assert directly rather than infer.

### 7.3 Specs

`openspec/specs/search/spec.md` contains **no** excerpt/window/centre requirements (grep: zero
matches for `centre|rarity|distinct|excerpt`). All of it lives in `mcp-contract`:

- **MODIFIED — `Requirement: Match Selection Is Not Positional`**
  (`openspec/specs/mcp-contract/spec.md:723-751`). Current text: *"Selection MUST prefer the region
  containing the query's distinctive terms, at every rank."* Under (a)/(c2) this needs a scenario
  distinguishing "several moderately-distinctive terms" from "one more-distinctive term" — the
  distinction the current wording collapses. Under (d) it additionally needs the rank scoping made
  explicit, since (d) makes the two tiers behave differently and the requirement currently says
  *"at every rank."*
- **Possibly ADDED** — a requirement naming the rarity-over-count preference and its two
  non-guarantees (the equal-rarity fall-through to term length; the in-chunk-frequency proxy's
  blindness to corpus frequency, per §4).
- Untouched: the budget requirement (`:606-612`), the supporting-window requirement (`:627-665`),
  and the ellipsis contract (`:667-707`) — none of them mention *how* the centre is chosen. Worth
  stating in the delta so a reviewer does not have to re-derive it.

### 7.4 Documentation

- `AGENTS.md` — the "excerpt budget is graduated by rank" bullet and the
  `supporting-excerpt-anchoring` bullet both describe centring; a new bullet is needed, in
  `AGENTS.md`'s house style (measured numbers, named non-guarantees, the greppable revisit
  trigger).
- `docs/retrieval-open-work.md` — Open problem 3 must be updated with the outcome, **including the
  §3.4 correction, which is executed and holds**. Leaving a falsified claim in the roadmap is how
  the previous deferral had to be rediscovered by a whole new cycle.
- **A new manual gate section in `AGENTS.md`**, matching the five existing ones, with the
  before/after table and the three RED verifications.

### 7.5 Commands the later phases MUST run

```bash
# §4 challenge 1 — the actual span multiset of the motivating chunk (external corpus)
node dist/cli.js --root C:/Users/Raul/Workspace/DocuTests2 search \
  "refund time for customer charged twice duplicate charge" --k 10
#   then: a one-off script driving locateSpans over that chunk, printing
#   (term, f, offsets) — this is what decides between (a), (c2), (d) and (e).

# §4 challenge 2 — does §9 Refunds contain refund-timing content at all?
#   read_doc is MCP-only; follow the scripts/section-lookup.mjs precedent.

# non-gating ranking invariance
node dist/cli.js --root ejemplos eval        # expect byte-identical before/after

# the new gate (after the fixture and probe exist)
node dist/cli.js --root test/fixtures/<new-fixture> index
node scripts/match-centre-probe.mjs test/fixtures/<new-fixture> --digest <before>
npm run build                                 # NOT a reindex — excerpts are query-time
node scripts/match-centre-probe.mjs test/fixtures/<new-fixture> --compare-digest <before>
node scripts/match-centre-probe.mjs ejemplos  # must exit non-zero: GATE IS VACUOUS, both states
```

Already executed by the orchestrator (§3.4): the sum-to-max patch plus
`npx vitest run test/domain/match-location.test.ts test/application/excerpt-window.test.ts test/domain/excerpt.test.ts test/application/search-documents-spans.test.ts`
and the full `npm test`. Result: 914 passed, 1 skipped, 0 failed — identical to the reverted baseline.

---

## 8. Open questions for the proposal phase (product-level)

1. **Is the excerpt the right place to spend this cycle at all?** `retrieval-open-work.md`'s own
   suggested order puts ranking (problem 1) first and Lever C third, on the reasoning that
   everything is downstream of ranking. §4's second challenge sharpens this: the motivating
   instance may be a ranking failure. Is this cycle being run out of order, and is that deliberate?
2. **What is the product promise for a supporting fragment?** The contract says a supporting
   fragment "routes between results rather than answers". If that is the promise, then approach (d)
   — fixing only the tier where routing happens — is not a compromise but the *correct scope*, and
   rank 0's risk need never be taken.
3. **Is a formula that is right on principle but unfixing on the motivating case acceptable?** If
   §4's measurement shows (a)/(c2) do not fix `billing-rules.md`, does the cycle ship the more
   principled formula anyway, or stop? This project's record favours stopping — `bounded-chunk-size`
   Gate 2 exists precisely so *"a wrong analysis stops the change rather than shipping."*
4. **How much unexplained corpus-wide excerpt churn (D3) is acceptable with no way to judge its
   quality?** D3 counts fragments that changed; nothing tells us whether they changed for the
   better. Is a large D3 a reason to prefer (d), which makes D3 zero at rank 0 by construction?
5. **Does the beta status change the calculus?** There are no installed users whose excerpts would
   regress — which argues for taking the broader change *now*, while it is cheap, rather than the
   contained one.
6. **`matchedTerms` (Open problem 5) overlaps this.** If a caller could see which query terms a
   chunk holds, would the centring choice matter less? It is the cheaper change and it addresses
   the same underlying question. Should it be sequenced first?

---

## 9. Ready for proposal — **status changed 2026-09-06**

The two blocking measurements were run (§4.5). They are answered, so the phase is no longer blocked
on evidence. What they produced instead is a **scope decision the proposal must take first**, not a
formula choice:

1. **The formula-change framing is falsified on its own motivating example.** Every rarity-favouring
   candidate — (a) max, (b) superlinear, (c1), (c2) — selects the same early cluster the current sum
   selects, because that cluster holds the chunk's *rarest* terms (`charge`/`charged`/`twice` at
   w 2.8332) and the answer's term is *commoner* (`refund` at w 2.1972). §4.5.1.
2. **The `§9. Refunds` symptom is not an excerpt defect.** That chunk holds no refund-timing content
   at all, and the current rule already centres on its rarest region. §4.5.3.
3. **Two mechanisms the roadmap never named are real and measured**: unbounded substring matching in
   `locateSpans` (`charge` ⊂ `charged`, `time` ⊂ `timestamp`, §4.5.2), and the fact that at
   `budget = 1400` the unmodified code **already** shows the answer (§4.5.4) — making the trace a
   ranking failure plus a budget consequence.

The three standing prerequisites also hold, two of them now by execution rather than argument:
**no committed fixture reproduces the shape** (§2.2), **`compendio eval` cannot gate this** (§6),
and **not one of the 914 committed tests can detect the change** (§3.4) — including
`match-location.test.ts:151-158`, which the roadmap says would have to be inverted and which stays
green.

`bounded-chunk-size`'s Gate 2 precedent — *"a wrong analysis stops the change rather than
shipping"* — applies to the analysis this cycle was opened on. The proposal phase should decide
between re-scoping to (e)/(f), narrowing to the substring-matching defect alone, or closing the
cycle and correcting `docs/retrieval-open-work.md`. It should not choose an aggregation operator.
