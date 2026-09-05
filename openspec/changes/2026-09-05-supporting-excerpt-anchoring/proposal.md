# Proposal: Anchor Supporting Excerpts on the Match

## Intent

**Remove the `rank === 0` guard at `src/application/search-documents.ts:123` so every result's
excerpt is centred on the span that matched, not just the lead's.** The budgets do not move:
`LEAD_EXCERPT_CHARS` stays 1400, `SUPPORTING_EXCERPT_CHARS` stays 120. Only *where inside those 120
characters the window sits* changes.

Today a supporting fragment is a start-anchored prefix, which has no relationship to where the query
actually matched. Measured over this repository's own `ejemplos/` corpus and an external 81-document
corpus (exploration §11.4):

| Criterion | `ejemplos/` before → after | demo-docs before → after |
|---|---|---|
| **C1** — supporting excerpts showing **zero** query terms | 9.1% → **0.0%** | 45.1% → **0.0%** |
| **C4** — mean distinct query terms visible per fragment | 2.40 → **4.00** | 1.84 → **5.29** |
| `compendio eval` (hybrid recall@5 / MRR) | 1.00 / 0.943 → **unchanged** | n/a |

Nearly half of the external corpus's supporting fragments were showing the caller prose with no
connection to their question at all. The supporting tier's documented job is routing — "enough to
judge whether the lead is the right one" (`src/domain/excerpt.ts:9-14`). A fragment showing zero
query terms cannot perform that job; it is 120 tokens spent on nothing.

### What this change does NOT fix — stated up front so it is not oversold

**The case that started this investigation stays broken.** The billing-rules trace fails for two
compounding reasons, and this change touches neither: RRF put the answer-bearing chunk at rank 1
(ranking is upstream of excerpt policy and untouched here), and `selectMatchCentre` prefers the early
4-distinct-term cluster over the late rare term (exploration §4, deferred as Lever C below).
Exploration §2a measured that even a **400-character centred window on the correct chunk** does not
reach that answer.

What this change fixes is the common, corpus-wide failure the motivating case happens to be a
compound instance of. Anyone reading this proposal as "the billing-rules bug is fixed" has read it
wrong.

### The archived decision this reverses, and why it is safe to reverse it

`2026-08-06-match-centred-excerpt`'s Decision 7 declined exactly this change, on a cost argument:
*"costs one locator run per search rather than k."* That claim was never measured. It is now
(exploration §11.2):

| Corpus | Before | After | Delta |
|---|---|---|---|
| `ejemplos/` (29 chunks) | 0.901 ms/search | 1.283 ms/search | +0.382 ms (**+42.4%**) |
| demo-docs (888 chunks) | 1.685 ms/search | 1.884 ms/search | +0.199 ms (**+11.8%**) |

Decision 7's concern is **directionally real and absolutely negligible**: under 0.4 ms per search,
against an alternative (a sectioned `read_doc` round trip) costing hundreds of tokens plus a model
round trip. Note the inversion worth recording — the *relative* penalty is larger on the **small**
corpus, because on a large index FTS5/vector/fusion work dominates and `locateSpans` is a smaller
share. A reader who assumed the cost grows with corpus size has it backwards.

Decision 7's other, stronger property — *"one branch serves all three"* (lexical, vector-only,
fold-miss) — is **preserved, not broken**. This change runs that same single branch more often; it
adds no second branch.

### The SECOND recorded rationale — a quality argument the exploration missed

Added by the orchestrator during the proposal gate, because both prior artifacts got this wrong.

Exploration §2c concluded: *"the stated rationale was a cost argument… **not a quality argument**
against windowing supporting fragments."* **That conclusion is false.** §2c read design.md Decision 7
and stopped there. `openspec/specs/mcp-contract/spec.md:630-634` carries a second, independent
rationale that neither the exploration nor the first draft of this proposal quotes:

> Deliberate, not an oversight: a supporting fragment routes between results rather than answers,
> and a prefix stays legible against `path`/`section` in a way a stripped-context window would not.

That is a quality claim, and it makes a **prediction**: a windowed supporting fragment loses
legibility because it is stripped of context. The measurement in exploration §11.4 is direct
evidence on exactly that prediction, and the connection must be made rather than left as an
unrelated line item — **"cost 1" below is not a new cost discovered by measurement. It is the
documented failure mode of the decision this change reverses, materializing at 84.4%.**

**The rebuttal, stated so a reviewer can attack it:**

1. The spec's own framing is *routing*, not answering — and Lever A does not try to make supporting
   fragments answer. It leaves the 120-char budget untouched precisely so they stay signposts. The
   question the spec raises is therefore narrow and answerable: **does a centred window route better
   or worse than a prefix?**
2. On the only routing evidence anyone has measured, it routes **better**. A supporting fragment's
   whole job is to let an agent judge whether the lead is the right one. Today 45.1% of them
   (demo-docs) show zero query terms — they carry no information correlated with the query at all.
   After the change that is 0%, and mean distinct query terms visible rises 1.84 → 5.29 (demo-docs)
   and 2.40 → 4.00 (`ejemplos/`).
3. The spec's "legible against `path`/`section`" concern is real but **partially misaddressed**:
   `path` and `section` are returned as separate fields and are unaffected by this change. What a
   window strips is the chunk's *opening prose*, which is a poor routing signal when the query
   matched elsewhere — that is the entire finding of exploration §11.4.

**What the rebuttal does NOT cover, and is therefore the genuine open risk of this change:** the
spec's claim is about human/agent *legibility*, and points 2-3 answer it with a *term-coverage*
proxy. Nobody has observed an agent routing better or worse with windowed supporting fragments. The
84.4% both-ellipsis rate is the spec's predicted failure mode with a number attached, and the
argument above is a reasoned case that the trade is favourable — not a measurement that it is.
Recorded as unproven. If this change is ever reverted, this is the paragraph to re-read first.

## Scope

### In Scope

- **Delete the `rank === 0 ?` guard** at `src/application/search-documents.ts:123`, so
  `locateSpans(chunk.content, terms)` runs for every emitted result. No signature change to
  `buildExcerpt`, `locateSpans` or `selectMatchCentre`. The comment at lines 119-122, which states
  the removed policy, changes with it.
- **Invert the two canary tests, with intent.** Both were left by the ancestor change specifically to
  catch this edit, and both carry comments naming it. They are to be rewritten to assert the new
  behaviour, **never patched into silence**:
  - `test/application/search-documents-spans.test.ts:63` — "a supporting (non-rank-0) result's
    excerpt stays a start-anchored prefix, never a window"
  - `test/application/index-and-search.test.ts:198` — asserts `excerpt.length <=
    SUPPORTING_EXCERPT_CHARS + 1` (not `+ 2`) and `startsWith("…") === false` for every supporting
    result
- **Rewrite the two false contract sentences** (see *Affected Areas* for the exact text and the grep
  trap on one of them).
- **Promote the exploration's probe into `scripts/supporting-anchor-probe.mjs`**, following the
  `excerpt-fence-drop-probe.mjs` / `vector-reach.mjs` precedent. It ran from a scratchpad during
  exploration; the gate is worthless if it cannot be re-run on the next excerpt change.
- **Replace the `mcp-contract` requirement that states the opposite** — "Supporting Excerpts Remain
  Start-Anchored Prefixes" (`openspec/specs/mcp-contract/spec.md:627-641`) is a **destructive
  delta**, and the archive rule requires warning before it merges.

### Out of Scope — each with its reason and its deferral target

| Item | Verdict | Reason |
|---|---|---|
| **Lever B — raising `SUPPORTING_EXCERPT_CHARS`** | **Rejected outright, not deferred** | Falsified by measurement: 400 characters does not reach the answer in the motivating case, and the break-even requires preventing a sectioned `read_doc` in **>68% of ALL** `search_docs` calls (exploration §3, M2/M5). The failure mode is structural — "stop being a prefix", not "be a bigger prefix". A raise narrows C1; anchoring eliminates it, for CPU instead of tokens-on-every-response-forever |
| **Lever C — `selectMatchCentre` rarity vs. distinctness** | **Deferred to its own SDD cycle** | It changes **rank-0 behaviour on every search, on every corpus**, and `compendio eval` is structurally blind to the regression (it never reads `.excerpt` — exploration §7, re-confirmed §11.3). It also re-opens the central algorithmic decision of the ancestor change, whose two named rejected failure modes (stopword-packing, first-occurrence-in-disguise) would need re-verification. No committed fixture reproduces the discriminating shape; `docs/reference/billing-rules.md` is external and uncommittable |
| **`matchedTerms` metadata signal** (exploration §6) | **Deferred to its own SDD cycle — explicit user decision, 2026-09-05** | Genuinely promising and genuinely cheaper than any budget raise (~25-30 tokens per response vs. M5's +274 at 400 chars), but **unmeasured**, and it widens the MCP response contract. The user's decision is to explore it separately rather than bundle an unmeasured idea into a change that currently rests on complete measured evidence. **Recorded here and in `AGENTS.md` as a named follow-up** — this project has been burned by deferrals surviving only inside archived reports (`isFenceDelimiter`'s third deferral is the standing example) |
| **RRF / ranking** | Out | Upstream of excerpt policy. Untouched by every lever considered |
| **Budget values (1400 / 120)** | Out | Unchanged in both directions. The graduated policy itself is not being re-litigated |
| **Migrations, schema markers, compatibility shims** | Out | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`) |

### Does this need a reindex? No — reasoned, not assumed

**No `compendio index` pass is required, in either direction.** `AGENTS.md` records that chunk-boundary
and heading changes need a full reindex, because those values are *persisted* and incremental sync
fingerprints on content hash alone. Excerpts are the opposite case: `buildExcerpt(chunk.content,
excerptBudget(rank), spans)` runs inside `runSearch` at **query time**
(`src/application/search-documents.ts:128`), from already-stored chunk content, and no excerpt is ever
written to SQLite. Nothing in the schema changes. A running `compendio serve` picks the change up on
restart, with no cache invalidation and no fingerprint churn. `mcp-contract/spec.md:154` already
records this same distinction for the sibling fence change; this change inherits it.

## Capabilities

### New Capabilities

- None. The excerpt is an existing part of the `search_docs` response.

### Modified Capabilities — `mcp-contract`

| Requirement | Change |
|---|---|
| **Supporting Excerpts Remain Start-Anchored Prefixes** (`spec.md:627-641`) | **Replaced** — destructive delta. The new requirement states that a supporting excerpt is a window centred on the matched span within the unchanged 120-character budget, falling back to a start-anchored prefix only when the chunk's flattened content contains no locatable query term |
| **Graduated Excerpt Budget by Result Rank** (`spec.md:600-612`) | **Unchanged** — the 1400/120 split is untouched. Stated explicitly so a reviewer does not have to check |
| **Truncation Is Marked at Either Edge, Within Budget** (`spec.md:643-669`) | **Unchanged in text; newly exercised at scale.** Its scenarios are all rank-1; supporting fragments now routinely hit the both-edges case. Design should decide whether to add a supporting-tier scenario |
| **Lead Match Selection Is Not Positional** (`spec.md:685-698`) | Named "Lead" but now governs every rank. Design's call whether to generalize the title or leave it and note the widened reach |
| **Vector-Only Results Produce Well-Formed Excerpts** (`spec.md:671-683`) | **Unchanged.** The empty-spans fallback is the vector-only path, and it is untouched — measured green (`test/application/vector-only-excerpt.test.ts` did not fail under the throwaway patch) |

## The two real costs, owned rather than buried

Both were 0% before this change. Both are consequences the project accepts, not risks it mitigates.

### 1. Both-ellipsis fragments: 0% → 84.4% (demo-docs) / 78.4% (`ejemplos/`)

**This is the `mcp-contract` spec's own predicted failure mode, not an unrelated side effect** —
see "The SECOND recorded rationale" above for the argument that the trade is favourable, and for what
that argument does not cover.

A precision that matters, because the orchestrator's framing overstates it slightly and the record
should be exact: **the ellipsis contract text does not become false.** `src/server.ts:123-125` already
says *"A '…' at either end of an excerpt marks content omitted there"*, and `AGENTS.md` already says
*"A `…` at either edge is the documented truncation signal"*. Both were written for the lead window
and are already honest about both edges.

What changes is **frequency, and therefore the signal's practical meaning**. Today a supporting
fragment's `…` reliably means "there is more AFTER this". After this change, roughly four in five
supporting fragments carry `…` on both sides, so it means "there is more on both sides" — a weaker
discriminator for an agent deciding whether a `read_doc` is worth it.

**Nobody has measured whether this degrades agent behaviour or only its semantics.** It is accepted
on the reasoning that a fragment which now *shows the matched terms* is a strictly better routing
signal than one that showed unrelated prose with a single trailing `…`. That reasoning is plausible
and unproven, and it is recorded as unproven.

### 2. Hard mid-word cuts: 0% → 3.4% (demo-docs) / 9.1% (`ejemplos/`)

`computeWindow`'s snap-revert guard (`src/domain/excerpt.ts:136-152`) refuses a word-boundary snap
that would cut into the matched cluster. Inside a 120-character budget the margin is thin, so the
guard reverts more often than it ever needs to at 1400. Small, real, and **higher on the Spanish
corpus** — worth a glance during design (is a cheaper softening available at no correctness cost?),
not a blocker.

## Approach

The mechanism is fixed here, not handed to design, because it is one deleted ternary. What design
owns is the surrounding judgment:

1. **The guard removal.** `const spans = rank === 0 ? locateSpans(chunk.content, terms) : []` becomes
   an unconditional `locateSpans(chunk.content, terms)`. `terms` is already hoisted once per search
   (`search-documents.ts:108`).
2. **The comment that replaces lines 119-122.** It currently explains the removed policy and cites
   Decision 7. Its replacement should record that the cost Decision 7 declined this on was measured
   at under 0.4 ms/search, so the next reader does not re-litigate it from the archive.
3. **The two canary inversions.** Each new assertion must be as capable of failing as the one it
   replaces — an inverted canary that merely stops asserting anything is a silent regression in
   coverage, which is precisely the failure mode this repository has recorded eleven times.
4. **The probe's shape** (see *Success Criteria*), including one binding correction below.

### Binding implementation constraint — the anti-vacuity denominator

**From exploration §11.4, where the exploration's own gate specification failed on execution.** Run as
originally specified, C1 measured 1 rather than 0 on demo-docs. The fault was in the gate, not in the
change: the term `hard` occurred in that chunk's raw content **only inside its own heading line**,
which `stripHeadingLines` removes during flattening. It inflated the raw-content denominator while
being unreachable by *any* excerpt policy, anchored or not.

> **`scripts/supporting-anchor-probe.mjs` MUST compute C2's denominator over the FLATTENED chunk text**
> (`flattenWithMap`, with the same empty-result fallback `buildExcerpt` uses), **never over
> `chunk.content`.** A counter **C6** MUST record how many fragments were excluded for this reason, so
> the correction stays visible instead of silently shrinking the denominator.

This is the class of error only execution catches, and it is carried forward here rather than left in
the exploration so that apply cannot re-introduce it.

### Second implementation constraint — index in hybrid mode

The measured before/after table was produced against **hybrid** indexes, deviating from the
exploration's proposed `index --lexical` (§11 preamble). Lexical-only changes which chunks occupy
ranks 1-4, making the numbers non-comparable to the measured baseline. Apply MUST index hybrid when
producing the gate table. The model cache is warm on this machine (`ejemplos/` indexes in ~3.5 s).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/application/search-documents.ts:119-128` | Modified | The guard, and the comment stating the removed policy. **The entire production change** |
| `test/application/search-documents-spans.test.ts:37-68` | **Inverted** | Canary #1. Asserts byte-identity with a prefix and `not.toContain("zulu")` |
| `test/application/index-and-search.test.ts:185-204` | **Inverted** | Canary #2, integration layer over real `ejemplos/`. `+ 1` → `+ 2`; the `startsWith("…") === false` assertion becomes its opposite-or-weaker form |
| `src/server.ts:119-121` | Modified | *"the rest carry short ones from the start of their section"* becomes false. **Grep trap**: this is split across two concatenated string literals (`"...from the start of " + "their section, "`), so it does **not** exist as a contiguous substring. A naive grep for the phrase returns nothing and reports the citation as hallucinated — this already happened once during exploration, and the grep was what was wrong |
| `AGENTS.md`, MCP tools §2 | Modified | *"as a start-anchored prefix"* becomes false |
| `AGENTS.md`, "The excerpt budget is graduated by rank" bullet | Modified | Must record what changed **and what did not**: the 1400/120 split is untouched; only the anchoring within the 120 changes. Plus the two accepted costs, and the `matchedTerms` deferral as a named follow-up |
| `scripts/supporting-anchor-probe.mjs` | **New** | ~150-200 lines, `dist/`-importing, no model download for the probe itself |
| `openspec/specs/mcp-contract/spec.md:627-641` | **Replaced** | Destructive delta — warn before merge |
| `src/domain/excerpt.ts`, `src/domain/match-location.ts`, `src/domain/flatten-map.ts` | **Untouched** | Stated explicitly. No lever in scope changes flattening, so the I1-I4 map invariants apply unmodified |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **A canary is patched into silence instead of inverted** — the assertion is deleted or weakened to `expect(true)` and coverage quietly drops | **High** — it is the path of least resistance under a red test | Each rewritten canary must assert the *new* behaviour positively (a supporting excerpt centred on a term that is absent from the chunk's first 120 characters), and must be shown to fail against the pre-change build |
| **The probe passes vacuously** — C2's denominator is 0 and C1's 0% is meaningless | Med | The C2 > 0 guard, plus §11.5's discipline: the guard MUST be demonstrated firing (`GATE IS VACUOUS`, exit 1) against a query set whose terms appear nowhere in the corpus. A probe never observed failing has not been verified |
| **C2 computed over `chunk.content`** — reintroduces the exact defect §11.4 found | Med | Stated as a binding constraint above, and C6 makes the exclusion visible in the output |
| **The both-ellipsis shift degrades agent routing behaviour** | Low-Med, **unmeasured** | Accepted, not mitigated. Recorded as an open uncertainty; if agent traces later show excess `read_doc` chaining on supporting hits, that is the evidence that reopens it |
| **Someone reads this as fixing the billing-rules case** | Med | Stated twice, in *Intent* and here |
| **The `server.ts` prose is missed** because it does not grep | Med | Called out in *Affected Areas* with the exact literal split, and gated (Gate E) |
| Mid-word cuts at 9.1% on Spanish look worse in practice than as a number | Low | Reported by the probe (C5) and reviewed at design, not gated |

## Rollback Plan

1. Revert the change commits and `npm run build`.
2. **No reindex, in either direction. No data at risk.** Excerpts are computed at query time from
   stored chunk content and are never persisted; the SQLite schema is untouched (see *Does this need a
   reindex?* above).
3. A running `compendio serve` picks up the revert on restart.
4. The probe script and the spec delta revert with the commits; nothing outside the repository holds
   state from this change.

This is the same rollback profile as the ancestor change — the blast radius stops at the process
boundary. Being wrong here is cheap, which is a reason to prefer shipping and measuring in real use
over further up-front design.

## Dependencies

- **Zero new npm dependencies.** The change deletes code.
- **No new fixtures.** The gate runs against the committed `ejemplos/` corpus and its existing
  22-question `goldenset.yaml`.
- **One external corpus cited but NOT reproducible here**: the demo-docs numbers (45.1% → 0%, 84.4%
  both-ellipsis) come from `../DocuTests2/demo-docs`, which is not committed. They are corroborating
  evidence in this proposal; **the committed gate is `ejemplos/`-only**, and its numbers are the ones
  apply must reproduce.

## Success Criteria

Each blocking gate can fail and stop the change. A gate that cannot fail is not a gate.

### Gate A — The anchoring lands (BLOCKING)

Run `scripts/supporting-anchor-probe.mjs` against `ejemplos/` (hybrid index), before and after.

- [ ] **Baseline first**, on unmodified code: C1 > 0 (expected ≈ 8 fragments, 9.1%). If C1 is already
      0, the gate is void and the query set must be widened before proceeding
- [ ] **C2 (flattened denominator) > 0** in every run — expected 88 on `ejemplos/`
- [ ] **After: C1 === 0** — the falsifying condition. Any non-zero count means the anchoring did not
      wire through
- [ ] **C4 rises** — expected 2.40 → 4.00
- [ ] The probe exits non-zero with two distinct messages: `GATE IS VACUOUS` (C2 === 0) and
      `THE FIX DID NOT LAND` (post-fix C1 > 0), never conflating the two

### Gate B — The vacuity guard is itself verified (BLOCKING)

- [ ] The probe run against `ejemplos/` with a query set whose terms appear nowhere in the corpus
      (e.g. `qwertzuiop plughxyzzy frobnicate`) exits **non-zero** with `GATE IS VACUOUS`, both before
      and after the production change

### Gate C — Scope falsifier: retrieval did not move (BLOCKING)

- [ ] `compendio eval` on `ejemplos/`: hybrid recall@5 **1.00**, MRR **0.943**; lexical **0.95** /
      **0.856**. Identity, not a tolerance band — `evaluate-search.ts` never reads `.excerpt`, so any
      movement means the change breached its own scope

### Gate D — Blast radius closes with no residue (BLOCKING)

- [ ] `npm test`: 911 passing, 1 skipped, 52 files — the measured baseline, restored after the two
      canaries are inverted
- [ ] Exactly two test files changed: `search-documents-spans.test.ts` and `index-and-search.test.ts`.
      Any third test needing an edit falsifies the exploration's blast-radius claim and must stop the
      change for re-analysis
- [ ] `npm run typecheck` and `npm run build` pass
- [ ] Each inverted canary demonstrated failing against the pre-change build

### Gate E — The contract text is true (BLOCKING)

- [ ] `src/server.ts:119-121` no longer says supporting excerpts come "from the start of their section"
- [ ] `AGENTS.md` MCP tools §2 no longer says "start-anchored prefix"
- [ ] `AGENTS.md`'s graduated-budget bullet records the change, the unchanged 1400/120 split, both
      accepted costs, and the `matchedTerms` deferral
- [ ] The `mcp-contract` destructive delta is flagged for the archive warning

### Recorded, not gated

- [ ] **C3** (both-ellipsis %), **C5** (hard-cut %), **C6** (heading-only terms excluded from the
      denominator) written into `verify-report.md` with real numbers. Expected on `ejemplos/`:
      0% → 78.4%, 0% → 9.1%, 0

## Resolved decisions

| Question | Decision |
|---|---|
| Which lever ships | **Lever A only** — guard removal. User decision, not open to widening |
| `SUPPORTING_EXCERPT_CHARS` | **Unchanged at 120.** Lever B rejected outright on measurement, not deferred |
| `selectMatchCentre` | **Untouched.** Lever C deferred to its own cycle, with its own fixture and its own excerpt-content gate |
| `matchedTerms` / chunk-length metadata | **Deferred to its own cycle** — explicit user decision, 2026-09-05. Recorded in `AGENTS.md` so it is not rediscovered from scratch |
| The two failing tests | **Inverted with intent.** They are the ancestor's deliberate canaries, each carrying a comment anticipating this edit |
| Reindex | **Not required, in either direction.** Excerpts are query-time, never persisted |
| Both-ellipsis rate rising to ~84% | **Accepted, with its uncertainty named.** The contract text was already honest about both edges; what shifts is frequency. This is the `mcp-contract` spec's own predicted failure mode for windowed supporting fragments, rebutted on term-coverage evidence and recorded as behaviourally unproven |
| Mid-word cuts rising to 3-9% | **Accepted.** Reported by the probe, reviewed at design, not gated |
| C2's denominator | **Flattened text, never `chunk.content`.** Binding on apply (exploration §11.4) |
| Probe index mode | **Hybrid**, not `--lexical` — otherwise the before/after table is not comparable to the measured baseline |
| Migrations / schema markers / shims | **None.** Beta, no installed users |

## Delivery size

Driver-based, a proposal-phase figure:

| Driver | Lines |
|---|---|
| Production change (guard + comment) | ~10 |
| Two canary inversions | ~40 |
| `scripts/supporting-anchor-probe.mjs` | ~150-200 |
| `mcp-contract` spec delta (replaced requirement + scenarios) | ~50 |
| `server.ts` + `AGENTS.md` prose | ~35 |

Roughly **285-335 changed lines**, one PR, comfortably inside the 400-line budget. **The probe
dominates**, at five to twenty times the production change — that ratio is normal for this repository
and is the reason the gate is worth its own review attention.

This project has a recorded pattern of the forecast growing at every phase (`bounded-chunk-size`:
240-420 at explore, 555-695 at tasks, 773 actual). Treat this as a lower bound. The natural cut line,
if one is needed: production change + canary inversions + docs in one PR, probe script in a second —
though splitting means the first PR ships without its own falsifying gate, which is a bad trade here.

## Proposal question round — ANSWERED (user, 2026-09-05)

All four answered with the stated default assumptions. Recorded here rather than left in a
conversation, so spec/design/apply read the decision and not the question.

| # | Question | Answer |
|---|---|---|
| 1 | Both-ellipsis signal: ship on "measured, recorded, accepted", or add an agent trace as a recorded observation? | **Ship on measured evidence.** No agent trace. The behavioural effect stays explicitly unproven — see "The SECOND recorded rationale". This is the change's one accepted unknown, and it is accepted knowingly |
| 2 | Mid-word cuts at 9.1% (`ejemplos/`): accept, or spend a design decision on a cheap softening? | **Accept and report.** Design MUST NOT spend a decision inventing a softening — but MUST NOT silently alter `computeWindow`'s snap-revert guard either. The rate is reported by the probe (C5), reviewed, not gated |
| 3 | Where the `matchedTerms` deferral lives | **`AGENTS.md`**, as a greppable named follow-up, on the `isFenceDelimiter` precedent. An archived report is where deferrals go to be forgotten in this repository |
| 4 | Delivery shape | **One PR**, probe included. Splitting would ship the production change without its own falsifying gate |

