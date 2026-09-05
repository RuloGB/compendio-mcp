# Exploration — supporting-fragment excerpt anchoring

**Change**: `supporting-excerpt-anchoring`
**Date**: 2026-09-05
**Phase**: `sdd-explore`
**Artifact store**: openspec
**Status**: done — ready for proposal (verification cycle executed; see §11)

## Origin

`search_docs` grades excerpts by rank (`AGENTS.md`, "The excerpt budget is graduated by rank"):
rank 0 gets `LEAD_EXCERPT_CHARS` (1400) as a match-centred window; rank 1+ gets
`SUPPORTING_EXCERPT_CHARS` (120) as a start-anchored prefix. When the real answer sits at rank 2+,
agents chain `read_doc` calls to find it. The originally proposed fix — raise
`SUPPORTING_EXCERPT_CHARS` to 300–400 — has already been **falsified by measurement** (see below).
This exploration investigates the three separable levers that measurement exposed instead of
re-litigating the raise.

## Evidence status

This exploration is built on:

1. **The orchestrator's MEASURED INPUT** (M1–M6, reproduced verbatim from the task prompt, not
   re-derived): a probe replicating `SearchDocuments.runSearch`, self-checked byte-identical to the
   real pipeline (0 mismatches / 105 queries / 525 result rows) over an external 81-doc corpus
   (Corpus A) and this repo's own `ejemplos/` (Corpus B, 11 docs / 29 chunks, real 22-question
   goldenset). These are cited, never re-derived, per the task's explicit constraint.
2. **New MEASURED-by-code-reading claims** in this exploration — exact line numbers, exact test
   assertions, exact archived design text, all read directly from this repository's current
   `src/` and `test/` trees and one archived change (`2026-08-06-match-centred-excerpt`). Labeled
   **MEASURED (static)** below to distinguish "I read the literal code/test" from "I ran something."
3. **INFERRED claims** — hand-traced behavior of `computeWindow`/`selectMatchCentre` under
   hypothetical inputs, not executed. Labeled explicitly. A companion "Requests for the orchestrator"
   section lists the exact commands that would convert these to MEASURED.

No Bash tool was available to this exploration; nothing below required executing code, and every
runtime claim is either cited from the orchestrator's measured input or explicitly marked INFERRED
with a proposed probe to close the gap.

### Orchestrator verification pass (added after the sub-agent returned)

Every load-bearing citation in §1b, §2c and §4 was checked against the live tree before this
artifact was persisted. All hold:

- `2026-08-06-match-centred-excerpt/design.md:287-301` — Decision 7 quoted verbatim, confirmed.
- `test/application/search-documents-spans.test.ts:37` — test title confirmed verbatim.
- `test/application/index-and-search.test.ts:192-198` — the "Deliberately still +1, not +2" comment
  and both assertions confirmed verbatim.
- `test/domain/excerpt.test.ts:352` — `LEAD_EXCERPT_CHARS > SUPPORTING_EXCERPT_CHARS * 5` confirmed.
- `test/domain/match-location.test.ts:151-158` — fixture and expected centre `512` confirmed.
- `src/application/evaluate-search.ts` — contains no occurrence of `excerpt`; §7's blindness claim
  confirmed.
- `src/server.ts:119-121` — the prose *"the rest carry short ones from the start of their section"*
  is real, but is split across two concatenated string literals (`"...from the start of " +
  "their section, ..."`), so it does not exist as a contiguous substring in the file. A grep for the
  full phrase returns nothing. Recorded here because that is exactly the shape of verification
  failure this project has been burned by before: the first orchestrator grep reported the citation
  as hallucinated, and it was the grep that was wrong.

---

## 1. Exact blast radius

### 1a. Production code

| File | Symbol | Touched by |
|---|---|---|
| `src/application/search-documents.ts:119-128` | the `rank === 0 ? locateSpans(...) : []` guard | **Lever A** (removes/changes the guard) |
| `src/domain/excerpt.ts:35-37` | `excerptBudget(rank)` | **Lever B** (changes `SUPPORTING_EXCERPT_CHARS`, possibly per-rank) |
| `src/domain/excerpt.ts:56-83,122-155` | `buildExcerpt`, `computeWindow` | **Lever A** (called with non-empty spans at rank 1+ for the first time); unaffected by B in shape, only in budget value |
| `src/domain/match-location.ts:106-171` | `selectMatchCentre` | **Lever C** (changes the scoring function itself); **Lever A** calls it more often but does not change it |
| `src/domain/flatten-map.ts` | `flattenWithMap`, `trackedReplace`, I1–I4 | **Untouched by every lever.** No candidate here changes flattening, so the map invariants (I1–I4, `2026-08-06-match-centred-excerpt` Decision 3) apply unmodified — this is the same "inherits the argument for free" pattern the `excerpt-fence-drop-generalization` exploration already used for `trackedReplace`. |
| `src/server.ts:119-121` | tool-description prose: *"the rest carry short ones from the start of their section"* | **Lever A** (this sentence becomes false the moment rank 1+ is a window, not a prefix) |
| `AGENTS.md`, MCP tools §2 | *"the rest get `SUPPORTING_EXCERPT_CHARS` (120) as a start-anchored prefix"* | **Lever A** (same reason) |

**Lever C is the only lever with zero production-file overlap with A/B** beyond the shared
`selectMatchCentre` call site inside `buildExcerpt` — it changes the function's internals, not its
signature or call sites. This means A and C compose cleanly (§5) but a Lever-C-only cycle would not
touch `search-documents.ts` at all.

### 1b. Tests — exact assertions each lever breaks, and why

**MEASURED (static)** — read directly, not inferred.

| Test file | Assertion | Broken by | Why |
|---|---|---|---|
| `test/application/search-documents-spans.test.ts:37-68` | "a supporting (non-rank-0) result's excerpt stays a start-anchored prefix, never a window" — asserts `supporting!.excerpt` is byte-identical to `buildExcerpt(supportingContent, SUPPORTING_EXCERPT_CHARS, [])` and `not.toContain("zulu")` | **Lever A** | This test is the canary Decision 7 left behind specifically to catch this exact change. It must be inverted, not patched. |
| `test/application/index-and-search.test.ts:185-204` | "spends the excerpt budget on the lead result and keeps the rest as signposts" — for every supporting result: `excerpt.length <= SUPPORTING_EXCERPT_CHARS + 1` (not `+2`) and `excerpt.startsWith("…") === false`, with an inline comment: *"Deliberately still +1, not +2: supporting fragments stay start-anchored prefixes (design.md Decision 7) — never a window, so never a leading ellipsis. Asserted explicitly (not left to drift) so a later edit that starts centring supporting fragments too fails loudly here instead of silently."* | **Lever A** | Same canary role, at the integration layer over the real `ejemplos/` corpus. The comment names exactly what this exploration is examining. |
| `test/domain/excerpt.test.ts:342-354` | `excerptBudget` — `expect(LEAD_EXCERPT_CHARS).toBeGreaterThan(SUPPORTING_EXCERPT_CHARS * 5)` | **Lever B**, only for a raise ≥ 280 | `1400 > 280*5=1400` is already false at exactly 280, and strictly false above it. A raise to 400 (the falsified proposal) or even 300 requires this assertion to be deliberately revised, not silently left — its multiplier (5×) is an arbitrary anti-convergence guard, not a law, but changing it must be a stated design choice. |
| `test/domain/match-location.test.ts:151-158` | `selectMatchCentre`: "prefers a cluster of two distinct late terms over one distinct early term" — `alpha` (1 occurrence, early) loses to `beta`+`gamma` (1 occurrence each, late, together) | **Lever C** | This is the *same shape* as M3's failure (several equally-weighted distinct terms beat one rare term) — it is the existing test that currently *codifies* the additive-sum behavior M3 blames. A rarity-favoring rewrite of Lever C would need to either invert this test's expectation or prove the two shapes are distinguishable (they are not, as stated — see §4). |
| `test/domain/match-location.test.ts:142-149,160-170` | "prefers a single rare late term over a frequent early term (stopword trap)"; "scattered singletons: the rarest term wins" | **Unaffected** by any reasonable Lever C redesign | Both fixtures have exactly one distinct term present in every candidate window, so sum-of-distinct and max-of-distinct agree trivially. These do not discriminate between the current formula and a Lever C rewrite — a new fixture is needed to test the actual behavior change (§7). |
| `test/application/excerpt-window.test.ts` (Gates 1 & 3) | rank-0-only fixtures (`window.md`, `stopword-trap.md`) | **Not directly broken** by any lever, but is the ONLY existing integration coverage of `selectMatchCentre` end-to-end, and both fixtures happen to be single-distinct-term-per-window shapes (§ above) — they cannot serve as a Lever C regression gate as they stand. |
| `test/application/vector-only-excerpt.test.ts:33-68` | Gate 5 — vector-only chunk, no lexical match, empty spans → prefix path, `startsWith("…") === false`, `endsWith("…") === true` | **Unaffected by any lever** | This exercises the *empty-spans* branch (no query terms present at all in the chunk), which stays the fallback path under every lever discussed here — Lever A only changes what happens when `locateSpans` *does* find something at rank 1+, and this fixture's content deliberately shares no vocabulary with the query. Recorded to confirm it stays green, not because it needs a change. |
| `test/domain/excerpt.test.ts:11-186` (the six pre-window tests + Decision-5/6 window tests) | Various `buildExcerpt` unit tests | **Unaffected** | None of these tests pin behavior specific to *which rank* calls `buildExcerpt` — they call it directly with explicit `maxChars`/`spans` arguments, so they remain valid regardless of which lever changes the call site in `search-documents.ts`. |

**Net count**: Lever A requires deliberate edits to exactly 2 test files (`search-documents-spans.test.ts`, `index-and-search.test.ts`) whose failing assertions are both *intentional* trip-wires, not incidental breakage — both carry comments anticipating this exact change. Lever B (any raise ≥ 280) requires 1 test file edit (`excerpt.test.ts`'s multiplier assertion). Lever C requires at minimum 1 existing test inversion (`match-location.test.ts:151-158`) plus new fixtures, since no committed fixture currently discriminates between "sum over distinct terms" and a rarity-favoring alternative on the shape that actually fails (§4).

---

## 2. Lever A — anchor supporting fragments

**Mechanism**: drop the `rank === 0` guard at `search-documents.ts:123` so `locateSpans(chunk.content,
terms)` runs for every rank, and `buildExcerpt` receives real spans at rank 1+ too. No signature
change to `buildExcerpt`, `locateSpans`, or `selectMatchCentre` — this lever is pure call-site
wiring plus the two test inversions in §1b.

**Cost**: CPU only, not tokens. `locateSpans` is a fold-and-scan over one chunk's own text
(bounded ~1900 raw chars by `chunk.maxTokens: 480`), run once per *result* instead of once per
*search*. For `k=5` this is at most 4 extra `locateSpans` calls per search, each over a
sub-2000-character string — MEASURED to be architecturally cheap by inspection, but the actual
wall-clock delta was never separately measured by anyone (INFERRED negligible, not proven — see §9
request 4).

### 2a. Does this fix M1? Does it fix M2?

**Fixes M1 directly, by construction.** M1's core finding — 44.8% (Corpus A) / 8.0% (Corpus B) of
supporting fragments showing zero query terms, because a start-anchored prefix has no relationship
to where the match actually is — is exactly what anchoring eliminates: `buildExcerpt` only falls
back to `prefixExcerpt` when `flatSpans` is empty (`excerpt.ts:74,77`), i.e. when the chunk
genuinely contains no located term at all. Every fragment that *does* contain ≥1 query term gets
centred on it.

**Does not fix M2.** M2's billing-rules case fails not because rank 1's excerpt is a bad prefix, but
because the answer-bearing chunk never reaches rank 0 or rank 1 at all — its position is set by RRF
fusion, upstream of and untouched by excerpt policy (`selectMatchCentre` at 400 chars still finds
centre 125, not the answer at ~1380, per M2). Anchoring rank 2+ would help *if* the correct chunk
landed there with the right span visible — but M2's own measurement shows even a **400-char centred
window at the correct chunk** doesn't find the answer, because `selectMatchCentre`'s scoring favors
the early 4-distinct-term cluster over the late 1-term answer region (M3). So Lever A alone leaves
the exact motivating case unfixed; it fixes the more common, more universal problem (M1) that the
motivating case happens to be a compound instance of (wrong-rank AND wrong-cluster-choice).

### 2b. `computeWindow` at 120 chars — degeneration check (INFERRED, hand-traced)

Requested by the task: does a 120-char centred window degenerate compared to 1400?

- **Window can never be narrower than the chosen cluster.** MEASURED (static, deductive):
  `selectMatchCentre`'s two-pointer sweep (`match-location.ts:130-143`) only considers clusters
  whose span (`sorted[right].end - sorted[left].start`) fits within `budget`; anything wider is
  shrunk from the left before scoring. So by construction the returned centre always corresponds to
  a cluster ⊆ budget, and `computeWindow` always produces a window of exactly `min(budget,
  text.length)` chars before snapping (`maxStart = text.length - maxChars`, `end = min(start +
  maxChars, text.length)`). **This specific concern is unfounded** — the window is never
  "too small for the match," at any budget.

- **Both ellipses present, more often at 120 than at 1400.** INFERRED, not measured: given M4's
  supporting-tier mean chunk length (1050 chars Corpus A, 712 Corpus B) and a 120-char window, the
  window sits fully inside the chunk (`start > 0 AND end < text.length`) unless the match falls
  within the first or last ~60 characters. Roughly estimating uniformly-distributed match positions,
  that is on the order of 85–90% of matches producing **both** a leading and trailing ellipsis at
  120 chars, versus 12.0%/0% *any* truncation at all for the 1400-char lead budget (M4). This
  directly erodes the tested invariant at `index-and-search.test.ts:198` (`startsWith("…") ===
  false` for every supporting result today) — under Lever A that assertion would need to become
  "mostly true," which is a materially different, weaker guarantee. This is a genuine, if modest,
  UX regression in the truncation *signal* even as it improves the truncation *content* — flagged
  for the measurement plan (§7), not assumed.

- **Word-boundary snapping degrades only when the matched cluster is wide relative to the budget.**
  INFERRED: the snap-revert guard (`excerpt.ts:136-152`) rejects a snap that would push
  `candidateStart` past `clusterStart` (leading) or `candidateEnd` before `clusterEnd` (trailing).
  For a single-term match (cluster width = term length, typically < 20 chars) inside a 120-char
  window there is ~100 chars of margin on both sides combined — snapping should behave normally.
  For a multi-term query whose occurrences spread across, say, 80–100 of the 120 available chars,
  margin shrinks to a few characters per side and the guard reverts more often, producing more
  hard mid-word cuts than the 1400-char budget ever needs to. This is data-dependent (multi-term,
  widely-spread queries only) rather than universal — worth measuring (§7), not asserting as certain.

### 2c. The archived rationale — quoted verbatim, and whether it still holds

`2026-08-06-match-centred-excerpt/design.md`, Decision 7, in full:

> **Rank 0 only.** Supporting fragments stay prefixes (proposal, Resolved decisions), so the call
> site computes spans only when `results.length === 0`. This makes a decision that would otherwise
> be an emergent property *visible in the code*, and costs one locator run per search rather than k.
>
> **There is no vector-only branch.** The locator runs on the chunk's own text and knows nothing
> about which leg surfaced it. A chunk the vector leg found alone still gets centred if it happens
> to contain query terms — usually it does, since semantic neighbours share vocabulary — and falls
> back to the prefix when it does not. So the vector-only case *is* the empty-spans case, which is
> also the backward-compatibility case, which is also the fold-miss case. **One branch serves all
> three**, which is why the six existing tests already cover it...
>
> **Consequence, recorded because the exploration flagged the opposite**: `lexicalIds` / `vectorIds`
> are available but deliberately **not consumed**. They would be needed only under an A+B escalation.

**CORRECTION (orchestrator, proposal gate, 2026-09-05): the assessment below is FALSE as written.** This section read `design.md` Decision 7 and stopped. `openspec/specs/mcp-contract/spec.md:630-634` carries a SECOND, independent rationale that is explicitly a quality argument: *"a supporting fragment routes between results rather than answers, and a prefix stays legible against `path`/`section` in a way a stripped-context window would not."* It predicts the exact failure mode §11.4 then measured at 84.4% (both-ellipsis fragments). See the proposal's "The SECOND recorded rationale" section for the engagement this exploration owed it. The cost-argument assessment below remains true on its own narrow terms — it is incomplete, not wrong about Decision 7.

**Assessment: the stated rationale was a cost argument ("one locator run per search rather than
k"), not a quality argument against windowing supporting fragments.** It is not fully invalidated by
this exploration, but its practical weight was never separately measured — `locateSpans` is a
bounded string scan, not a network call or an embedding, and the "k times the cost" concern is real
but likely small in absolute terms (§9 asks the orchestrator to measure this rather than assume it).
**So Lever A is not free in the sense Decision 7 anticipated — it is exactly the change Decision 7
named as the alternative cost, deliberately declined at the time in favor of simplicity.** The
"one branch serves all three" simplicity property is *preserved*, not broken, by Lever A: the same
`locateSpans`/`buildExcerpt` pair still handles lexical, vector-only and fold-miss cases uniformly —
Lever A just runs that one branch more often, it does not add a second branch. That is a genuine
point in Lever A's favor that Decision 7's own framing does not contradict.

---

## 3. Lever B — budget

**Given M5's break-even (a flat raise to 400 must prevent a sectioned `read_doc` in ≥68% of ALL
`search_docs` calls to pay for itself) and M2's falsification (400 does not even reach the
motivating case), is there any defensible flat budget?**

No flat number in the 120–800 range is defensible on the evidence gathered. The failure mode is
structural, not a threshold problem: M1's containment table shows the *shape* of the fix needed is
"stop being a prefix," not "be a bigger prefix" — even 600 chars (98.5% containment, Corpus A) is a
prefix that still starts at the wrong place 1.5% of the time and, per M4, is still 100% truncated
in the supporting tier (mean chunk 1050 chars) — it never stops needing the `…` signal, it just
delays it. A raise only *narrows* M1's zero-term-shown problem; anchoring *eliminates* it, for less
cost (CPU vs. tokens on every single search response, forever).

**Non-uniform shapes considered**: M6 measured that a "rank 1 gets a bigger budget, rank 2+ stays
120" ramp would cover only 20% of the cases where the expected document is not at rank 0 (Corpus A:
rank1=2 of 10 non-rank-0 hits; Corpus B: rank1=1 of 2). This is a weak return for the added
complexity of a third budget tier and a third code path to test — not recommended on its own.

**What evidence would be needed to justify any raise at all**: a demonstrated case where anchoring
(Lever A) still truncates the answer's own sentence *and* the answer sits close enough to the edge
of a slightly larger window that a modest raise (not 400 — something like 160–200, evaluated
empirically) would capture it without anchoring alone doing so. This is only meaningful *after*
Lever A ships and is measured, not as an independent lever — recorded as a possible small
follow-on, not a recommendation now.

---

## 4. Lever C — `selectMatchCentre` cluster choice

**M3's mechanism, restated precisely from the code**: `selectMatchCentre` sums an in-chunk IDF
weight `w(t) = log(1 + L/f(t))` over **distinct** terms present in a candidate window. This means
a window holding 4 distinct terms of moderate rarity will almost always outscore a window holding 1
distinct term, *even if that one term is individually rarer*, because the score is additive across
terms, not a maximum. The billing-rules chunk (M2/M3) is exactly this shape: 4 distinct terms early
(customer/charge/charged/twice) vs. 1 distinct term late (refund).

**This is not a corner case the current design failed to anticipate — it is the design's stated,
tested, deliberate choice.** `match-location.test.ts:151-158` ("prefers a cluster of two distinct
late terms over one distinct early term") asserts precisely this behavior on an equal-rarity input
(`alpha` once early vs. `beta`+`gamma` once each, late — the late cluster wins 2:1 despite equal
per-term weight). Design.md's own Decision 4 explains why: *"Distinct-term count alone loses the
minimal form of Gate 3... Rarity alone loses to a window packed with thirty repetitions of `de`...
Summing `w` over distinct terms defeats both."* The design chose additive-sum specifically to avoid
two named failure modes (stopword-packing, first-occurrence-in-disguise) and M3's failure is the
*same mechanism, applied to an input the design's own test fixtures never modeled*: several
genuinely-distinct, genuinely-non-stopword terms clustered together, competing against one rarer
but genuinely-relevant term elsewhere.

**What would change under a rarity-favoring rewrite** (e.g., score = `max(w(t))` over the window
instead of `sum`, or a diminishing-returns transform that caps the benefit of additional distinct
terms): the billing-rules case would likely resolve correctly (the single `refund` occurrence, being
rarer, could outscore the 4-term early cluster if its individual weight is large enough — this is
NOT guaranteed without re-deriving M3's actual weight numbers, which were not given). But
`match-location.test.ts:151-158` would need its expectation **inverted**, and design.md's own two
originally-rejected failure modes (stopword-packing, first-occurrence-in-disguise) would need
**re-verification** against the new formula, since those are exactly the failure modes additive-sum
was built to prevent. This is not a small tweak — it is re-opening the central algorithmic decision
of the `match-centred-excerpt` change with only one motivating counter-example and no fixture that
isolates it.

**Named regression surface (per task instruction #4): this lever affects rank 0 too, universally,
for every search, on every corpus.** The current design's whole justification for the graduated
policy rests on rank 0 being reliably good ("hybrid retrieval scores MRR 0.943... top-1 20/22... if
that ever regresses, this policy is the first thing to revisit," `excerpt.ts:30-33`). `compendio
eval`/`EvaluateSearch` (`src/application/evaluate-search.ts:48-50`) computes rank purely from
`response.results.map(r => r.path)` — it **never reads `.excerpt`** — so a Lever C regression that
degrades *which passage within the correct chunk* gets shown, without changing *which chunk* ranks
where, is **structurally invisible to the only automated retrieval-quality gate this project has.**
Any Lever C work needs its own excerpt-content gate (§7), not a rerun of `compendio eval`.

---

## 5. Interactions

- **A and C compose without conflict at the call-site level**: A decides *whether* rank 1+ gets
  spans at all; C decides *which centre* those spans (at any rank) resolve to. Shipping A without C
  still improves M1 corpus-wide; shipping C without A only ever affects rank 0, since rank 1+ never
  calls `selectMatchCentre` today.
- **A alone leaves M2 unfixed** (§2a) — the motivating case needs the correct chunk to both (a)
  reach a rank where spans are computed, and (b) have its centre chosen correctly once there. A
  supplies (a) generically; only C (or a rank-fix, out of scope — RRF is untouched by every lever
  here) supplies (b).
- **C alone changes rank-0 behaviour that M4/design.md records as currently good** — recommending C
  in isolation, without A, still carries C's full regression surface for zero improvement to the
  supporting tier it doesn't touch.
- **Ranking by (evidence strength × cost × blast radius)**:

  | Lever | Evidence strength | Cost | Blast radius | Net |
  |---|---|---|---|---|
  | **A** | High — M1 measured, directly closes the 44.8%/8.0% zero-term gap by construction | Low — CPU only, no token cost, no new invariants (flatten-map untouched) | Medium — 2 intentional canary tests to invert, 2 doc/contract sentences to rewrite | **Best of the three** |
  | **B** (any flat raise) | Negative — M2 falsifies the exact motivating case at 400; M5's break-even (≥68% of ALL calls) is a high bar with no measurement supporting it | Medium-High — token cost on every response, permanently | Low-Medium — one constant, one test-multiplier edit | **Rejected as a primary lever**; only viable as a small, evidence-gated follow-on after A ships |
  | **C** | Medium — M3 correctly diagnoses the mechanism, but "fix" is unspecified and untested against the design's own two originally-rejected failure modes | Medium-High — a genuine algorithm redesign, not a parameter change | **High** — affects every rank-0 result on every corpus; the one gate that could catch a regression (`compendio eval`) is structurally blind to it | **Defer** to its own cycle, with a dedicated fixture and a new excerpt-content gate |

---

## 6. The honest alternative: the truncation signal itself

AGENTS.md documents `…` as the contract telling an agent to call `read_doc`. M1's real finding is
narrower than "the budget is too small" — it is that **a start-anchored prefix carries no
information correlated with the query at all** when the match is elsewhere in the chunk. The
question posed: is a cheaper signal than more characters available?

**Yes, plausibly, and it was never measured against M5's cost model.** Two candidates, neither
requiring `locateSpans` to run more often than today (they can even ride on the same spans Lever A
would compute, but do not require Lever A to be adopted):

1. **Surface which query terms the chunk contains**, e.g. a `matchedTerms: string[]` field per
   result, populated from the already-computed lexical match (or a cheap presence check) — costs on
   the order of a handful of short strings (the query's own tokens, already known — `terms` is
   already hoisted once per search at `search-documents.ts:108`), not hundreds of characters of
   excerpt. For a 5-term query this is roughly 5 short words × 4 results ≈ 20 words ≈ 25-30 tokens
   total — an order of magnitude cheaper than M5's measured cost of a flat raise (+274 tokens at
   400, +80 at 200) for *every single search response*.
2. **Surface the chunk's own total length** (already known — `chunk.content.length`), letting an
   agent judge "is there plausibly more here worth a `read_doc` round trip" without spending
   characters on speculative content.

**Cost against M5**: both candidates add a small, fixed number of tokens per *result*, scaling with
`k` and query-term count, not with excerpt budget. They do not compete with Lever A (they are
metadata alongside the excerpt, not instead of it) — they compete with Lever B specifically,
answering the same underlying question ("which supporting fragment is worth a follow-up call")
without the character cost B pays. **This candidate was not measured** (no orchestrator probe
covered it) — recorded as a genuine open alternative for `sdd-propose` to weigh, not a
recommendation to implement without its own measurement.

---

## 7. Measurement plan

### Why `compendio eval` cannot serve as this gate

`EvaluateSearch.execute` (`src/application/evaluate-search.ts:40-53`) computes `rankedDocs =
uniqueInOrder(response.results.map(r => r.path))` and finds `item.expected`'s index in that list —
**it never reads `response.results[i].excerpt`, `.section`, or any span/centre information.** It is
a document-ranking metric (MRR, recall@k, top-1), structurally identical whether excerpts are
prefixes, windows, or empty strings. It cannot detect Lever A's fix, Lever B's cost, or Lever C's
regression — confirmed by reading the source, not inferred from its name.

### Proposed probe: `scripts/supporting-anchor-probe.mjs` (new, following the `excerpt-flatten-probe.mjs` precedent)

Imports compiled output from `dist/` only (`buildExcerpt`, `tokenizeQuery`, `locateSpans`,
`SqliteIndexStore`) — no model download, no production surface widened for a one-off gate.

**Command sequence**:
```
npm run build
node dist/cli.js --root ejemplos index --lexical
node scripts/supporting-anchor-probe.mjs ejemplos ejemplos/goldenset.yaml
```

**What it counts, over every returned supporting-tier (rank ≥ 1) fragment across all 22 goldenset
queries**, run against the current `dist/` (baseline) and again after Lever A lands:

1. **C1 — zero-query-term fraction.** Same computation as M1: does the fragment's flattened text
   contain ≥1 tokenized query term? Before: expected to reproduce M1's Corpus-B-scale number (~8%,
   this corpus is small — 29 chunks — so an exact match to 8.0% is not expected, only the same
   direction). After Lever A: must be 0%. **This is the falsifying condition** — any non-zero
   post-fix count means the anchoring did not actually wire through.
2. **C2 — anti-vacuity denominator.** Count of supporting fragments that contain ≥1 query term in
   their FULL chunk content (not just the excerpt) — the population C1 could possibly detect. If
   this is 0, C1 is vacuous (mirrors `excerpt-fence-drop-probe.mjs`'s C2/C4 pattern) and the probe
   must fail loudly rather than report a meaningless 0%.
3. **C3 — both-ellipses fraction** (§2b's INFERRED claim, made MEASURED). Before: expected 0% by
   the existing tested invariant. After: reported, not gated — this is the named UX trade-off, and
   the point of measuring it is to put a real number on §2b's estimate rather than leave it inferred.
4. **C4 — mean distinct query terms visible per fragment**, mirroring M1's headline metric, computed
   on this repo's own real corpus rather than cited from the external one.
5. **C5 — hard-cut fraction** (snap-revert fired on at least one edge), addressing §2b's snapping
   claim: before Lever A this is inapplicable (rank 1+ never reaches `computeWindow`'s snap logic
   today); after, reported as a number rather than left as a hand-traced estimate.

**Self-check**: exits non-zero unless (C2 > 0) AND (post-fix C1 === 0). Two distinct failure
messages, matching the `excerpt-fence-drop-probe.mjs` precedent: `GATE IS VACUOUS` for a C2 failure
(nothing to falsify against — `ejemplos/` at 29 chunks may need a small supplementary fixture if C2
is too thin), `THE FIX DID NOT LAND` for a post-fix C1 > 0 failure.

**Before/after table shape** (to be filled by the orchestrator's execution, not asserted here):

| | C1 (zero-term %) | C2 (denominator) | C3 (both-ellipsis %) | C4 (mean distinct terms) | C5 (hard-cut %) |
|---|---|---|---|---|---|
| Before (baseline `dist/`) | ? (expected > 0) | ? (must be > 0) | 0% (tested invariant) | (today's prefix mean) | n/a |
| After (Lever A) | must be 0 | same | ? (reported) | must rise | ? (reported) |

### Why this repo cannot directly reproduce M2/M3

`docs/reference/billing-rules.md` does not exist in this repository — confirmed absent by a glob
search. It is part of the external Corpus A (`../DocuTests2/demo-docs`), not committed here. **Any
Lever C measurement plan needs a new, committed fixture** reproducing the discriminating shape
(one chunk with a cluster of ≥3 distinct, moderately-rare query terms early, and one distinct,
individually-rarer term late, at a controlled flattened offset) before Lever C can be gated at all
— following the `test/fixtures/excerpt-window/` self-asserted-precondition pattern
(`excerpt-window.test.ts`'s `window.md`/`stopword-trap.md`). This is scoped to Lever C's own future
cycle, not to this one.

### `compendio eval` as a non-gating regression check for Lever A

Since Lever A touches only excerpt construction and never `searchLexical`, `searchVector`, or RRF,
`compendio eval`'s MRR/recall/top-1 numbers on `ejemplos/` should be byte-identical before and
after. Not a falsifying test for Lever A's actual goal, but a cheap confirmation that nothing
upstream was accidentally disturbed — run once, recorded, not treated as proof of anything about
excerpt quality.

---

## 8. Recommendation

**Primary**: adopt **Lever A** (anchor supporting fragments) now. It is the only lever with
strong measured evidence (M1), zero token cost, a bounded and well-understood blast radius (2
intentional canary tests, 2 prose sentences), and no new invariants to design (it reuses
`locateSpans`/`buildExcerpt`/`flatten-map.ts` exactly as built for rank 0). It closes the more
common failure (zero-term-shown prefixes) even though it does not close the specific motivating
case (M2), which is a compound failure (wrong rank + wrong centre) outside any single lever's reach.

**Secondary, worth costing alongside it in `sdd-propose`**: the matched-terms/chunk-length metadata
signal (§6) — genuinely cheaper than any character-budget change and orthogonal to Lever A, but
unmeasured; flag it for the proposal to scope, not to commit to here.

**Reject as a standalone change**: Lever B (any flat raise) — M2 falsifies it on the motivating
case and M5's break-even was never demonstrated. A small raise (§3) is only defensible *after*
Lever A ships and is measured to still leave a real gap.

**Defer**: Lever C, to its own SDD cycle, with its own committed fixture and its own excerpt-content
gate (since `compendio eval` cannot see it). Do not bundle it with Lever A — it is the higher-risk,
higher-blast-radius change and mixing it with A's cheap, well-understood fix would put a design.md
review of the central algorithmic decision (which the archived change fought hard for, with named
rejected alternatives) on the critical path of a smaller, more clearly beneficial fix.

**This recommendation engages AGENTS.md's graduated-policy rationale directly, not around it**:
the recorded justification for grading by rank ("a flat 240 truncated ~93% of fragments and
withheld ~70% of their content... paid answer prices for router value") argued FOR spending more
characters at rank 0 and accepting a cheap signpost at rank 1+. Lever A does not abandon that
policy — it keeps the same 1400/120 split, spends zero additional characters, and only changes
*where inside the 120-char budget* the signpost points. M4's own numbers (99.7%/100% truncation in
the supporting tier today, unchanged by Lever A) confirm the signpost framing still holds: rank 1+
remains "enough to judge whether rank 0 is right," never "enough to answer with" — Lever A makes
that judgment possible by showing the actual matched term instead of arbitrary starting prose.

---

## 9. Requests for the orchestrator

Exact commands to convert this exploration's INFERRED claims to MEASURED, and to validate the
predicted blast radius before `sdd-propose` commits to a design:

1. `npm run build && npm run typecheck` — baseline, must be green before anything else.
2. `node dist/cli.js --root ejemplos index --lexical` then a temporary local patch removing the
   `rank === 0 ?` guard at `search-documents.ts:123`, rebuilt, to produce a real "Lever A applied"
   `dist/` for probe comparison — **do not commit this patch**, it is throwaway for measurement only.
3. Run `npm test` against that throwaway build and confirm the predicted failures are *exactly*
   `test/application/search-documents-spans.test.ts` and
   `test/application/index-and-search.test.ts` (the "spends the excerpt budget..." test) — and no
   others. Any additional failure means this exploration's blast-radius claim (§1b) is incomplete.
4. Time `SearchDocuments.execute` for a representative query at `k=5` before and after the throwaway
   patch, on `ejemplos/` (small) — closes the "one locator run per search rather than k" cost
   question Decision 7 raised (§2c), which this exploration could not measure without Bash.
5. Author and run `scripts/supporting-anchor-probe.mjs` per §7 against `ejemplos/`, both before and
   after the throwaway patch, to produce the before/after table in §7 with real numbers instead of
   placeholders.
6. `node dist/cli.js --root ejemplos eval` before and after the throwaway patch — confirm MRR/top-1
   identity holds (expected: unchanged, since Lever A never touches ranking).
7. Revert the throwaway patch (`git checkout -- src/application/search-documents.ts` or equivalent)
   before any proposal work begins — nothing in this exploration should leave the working tree
   modified.

---

## 10. Orchestrator note on §9

The seven requests above are the exploration's own follow-up plan. They are recorded here as
written; whether to execute them before `sdd-propose` is the user's call. Requests 2, 3, 5 and 7
form one throwaway-patch cycle and should be run together or not at all — leaving the patch in the
tree is the failure mode request 7 exists to prevent.

---

## 11. Measured addendum (orchestrator, executed 2026-09-05)

**All seven §9 requests were executed.** Read this section before trusting any INFERRED claim above.
The working tree was left clean (request 7 honoured; `git status` shows only this change folder).

**One deviation from §7's proposed command sequence**: the probe was run against **hybrid** indexes,
not `index --lexical`. The model cache was warm (indexing `ejemplos/` costs 3.5 s), and hybrid is the
mode the M1-M6 input measured and the mode users actually run. Lexical-only would have changed which
chunks occupy ranks 1-4 and made the before/after table non-comparable to the measured input.

### 11.1 Requests 1, 3, 7 — blast radius: CONFIRMED EXACTLY

| | Test files | Tests |
|---|---|---|
| Baseline (`npm run build && npm run typecheck` green) | 52 passed | 911 passed, 1 skipped |
| Throwaway Lever A patch | **2 failed**, 50 passed | 2 failed, 909 passed, 1 skipped |
| After revert + rebuild | 52 passed | 911 passed, 1 skipped |

The two failures are **exactly** the two §1b predicted, and no others — the accounting closes with no
residue (909 + 2 = 911):

- `test/application/index-and-search.test.ts:198` — "spends the excerpt budget on the lead result and
  keeps the rest as signposts"
- `test/application/search-documents-spans.test.ts:63` — "a supporting (non-rank-0) result's excerpt
  stays a start-anchored prefix, never a window"

§1b's blast-radius claim is therefore MEASURED, not inferred.

### 11.2 Request 4 — Decision 7's cost argument: measured, and negligible in absolute terms

Decision 7 declined Lever A on cost ("one locator run per search rather than k"), a claim never
measured. Lexical-only `SearchDocuments.execute` at `k=5`, warmed, 880 / 810 searches per run:

| Corpus | Before | After | Delta |
|---|---|---|---|
| `ejemplos/` (29 chunks) | 0.901 ms/search | 1.283 ms/search | **+0.382 ms (+42.4%)** |
| demo-docs (888 chunks) | 1.685 ms/search | 1.884 ms/search | **+0.199 ms (+11.8%)** |

Decision 7's concern is **directionally real** — the cost is measurable and non-trivial in
percentage terms. It is also **absolutely negligible**: under 0.4 ms per search, against an
M5-measured alternative (a sectioned `read_doc` round trip) costing ~400 tokens plus a full model
round trip. Note the inversion: the *relative* penalty is larger on the SMALL corpus (+42%) than the
large one (+12%), because on a bigger index the FTS5/vector/fusion work dominates and `locateSpans`
is a smaller share. A reader who assumed the cost would grow with corpus size would have it
backwards.

### 11.3 Request 6 — `compendio eval`: byte-identical, as predicted

| | hybrid recall@5 | hybrid MRR | lexical recall@5 | lexical MRR |
|---|---|---|---|---|
| Before | 1.00 | 0.943 | 0.95 | 0.856 |
| After | 1.00 | 0.943 | 0.95 | 0.856 |

Confirms Lever A never touches ranking — and simultaneously demonstrates §7's central point:
**a change that moves 45.1% of supporting excerpts from "shows nothing" to "shows the match" does
not move `eval` by a single decimal.** `eval` is structurally blind to this, exactly as §7 argued.

### 11.4 Request 5 — probe results, and a defect in the gate this exploration itself specified

§7 states: *"After Lever A: must be 0%. **This is the falsifying condition** — any non-zero post-fix
count means the anchoring did not actually wire through."* Run as specified, **C1 measured 1, not 0,
on Corpus A — the gate FAILED on its own terms.**

Investigating that single case rather than waving it away found the fault is **in the gate, not in
Lever A**. The case: query `genuinely hard case rest guide`, chunk
`docs/guides/handling-failures.md` section "Why unknown outcomes are hard". The term `hard` occurs in
the chunk's RAW content only inside its own heading line — which `stripHeadingLines` (S1) removes
during flattening. So `hard` is present in the raw chunk (inflating C2's denominator) but **absent
from the flattened text every excerpt is cut from**, and therefore unreachable by *any* excerpt
policy, anchored or not. `locateSpans` finds the span in raw coordinates; `mapSpansToFlat` correctly
discards it as zero-width; `buildExcerpt` correctly falls back to the prefix.

**Gate correction (binding on whoever authors `scripts/supporting-anchor-probe.mjs` during apply)**:
C2's denominator MUST be computed over the **flattened** chunk text (`flattenWithMap`, with the same
empty-result fallback `buildExcerpt` uses), never over `chunk.content`. A new counter **C6** records
how many fragments were excluded for this reason, so the correction stays visible instead of
silently shrinking the denominator.

With the corrected denominator:

| Criterion | BEFORE (`ejemplos/`) | AFTER (`ejemplos/`) | BEFORE (demo-docs) | AFTER (demo-docs) |
|---|---|---|---|---|
| replication drift (must be 0) | 0 | 0 | 0 | 0 |
| **C2** anti-vacuity denominator | 88 | 88 | 326 | 326 |
| **C1** excerpts showing ZERO query terms | 8 (9.1%) | **0 (0.0%)** | 147 (45.1%) | **0 (0.0%)** |
| **C3** both-ellipsis fragments | 0 (0.0%) | 69 (78.4%) | 0 (0.0%) | 275 (84.4%) |
| **C4** mean distinct terms visible | 2.40 | **4.00** | 1.84 | **5.29** |
| **C5** hard-cut (mid-word) edges | 0 (0.0%) | 8 (9.1%) | 0 (0.0%) | 11 (3.4%) |
| **C6** terms only in a stripped heading | 0 | 0 | 1 | 1 |

The baseline column independently reproduces the measured input it was built to check (M1's 44.8%
against this probe's 45.1%; M1's C4 of 1.84 reproduced exactly). The two probes use different
containment methods — M1's mapped `locateSpans` offsets through the flat map, this one folds and
substring-matches — so agreement to within 0.3 points is corroboration by an independent route, not
a tautology.

**§2b's INFERRED estimates, now MEASURED:**

- Both-ellipsis rate: predicted "on the order of 85-90%", measured **84.4%** (Corpus A) / 78.4%
  (Corpus B). The estimate held. This is the named UX trade-off: the truncation ellipsis, today a
  reliable "there is more AFTER this", becomes "there is more on BOTH sides" for roughly four
  fragments in five.
- Hard mid-word cuts: predicted to appear only for multi-term, widely-spread queries. Measured
  **3.4%** (Corpus A) / **9.1%** (Corpus B), against a 0% baseline. Small but real, and higher on the
  Spanish corpus — worth a glance during design, not a blocker.

### 11.5 Anti-vacuity guard — verified against a known-vacuous corpus

Per this project's standing rule (`excerpt-fence-drop-probe.mjs`: a probe never observed failing has
not been verified), the guard was run against `ejemplos/` with queries whose terms appear nowhere in
the corpus (`qwertzuiop plughxyzzy frobnicate`, `blorptastic wibblefrotz`). The vector leg still
returns results, so fragments exist, but no supporting fragment can contain a query term:

```
C2 anti-vacuity denominator: 0
GATE IS VACUOUS
exit=1
```

Confirmed: the guard fires and exits non-zero. C1 = 0 in that run is meaningless, and the gate says
so instead of reporting a false pass.

### 11.6 Net effect on §8's recommendation

Lever A is **strengthened, not weakened**, by execution: the blast radius is exactly as predicted,
`eval` is untouched, C1 goes to 0 on both corpora, C4 roughly doubles (`ejemplos/`) to nearly
triples (demo-docs), and Decision 7's blocking cost argument is measured at under 0.4 ms/search. The
two genuine new costs — an 84% both-ellipsis rate and a 3-9% hard-cut rate, both zero today — are
design inputs for `sdd-propose`, not reasons to reconsider.

The one thing that did fail was **this exploration's own gate specification**. That is the cycle
working: §7 was written without a Bash tool, and the raw-versus-flattened distinction is exactly the
class of error only execution catches.
