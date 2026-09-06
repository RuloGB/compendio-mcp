# Proposal: Match Query Terms on Word Boundaries, Not Substrings

## Intent

**`locateSpans` and the lexical retriever disagree about what "a query term matched" means.** This
change makes them agree, by requiring a word boundary at both ends of every located span.

`locateSpans` (`src/domain/match-location.ts:77`) is `foldedRaw.indexOf(foldedTerm)` with
`searchFrom = idx + 1` — a plain substring scan with **no condition on either end**. The retriever it
is supposed to be explaining does the opposite: `toFtsQuery`
(`src/infrastructure/sqlite/sqlite-index-store.ts:572-576`) emits `"term" OR "term"` — quoted, no
`*` — against an FTS5 table tokenized `unicode61 remove_diacritics 2`, which has **no stemmer**.
Measured directly against a scratch FTS5 table holding
`"Refunds may be full or partial and the timestamp is logged"` (exploration §4.6.2):

| MATCH | rows |
|---|---|
| `"refund"` | **0** |
| `"refunds"` | 1 |
| `"time"` | **0** |
| `"timestamp"` | 1 |
| `"charge"` | **0** |

**The retriever matches whole tokens; the excerpt locator matches substrings. The excerpt points at
matches the search never made.** Classified over the whole `DocuTests2` corpus (888 chunks, the
roadmap's own failing query, exploration §4.6.1):

| class | spans | share |
|---|---|---|
| exact word match | 1 539 | **28.1%** |
| prefix of a longer word | 2 009 | 36.6% |
| interior of a word | 1 935 | 35.3% |
| suffix of a longer word | 1 | 0.0% |

**71.9% of spans are not word matches.** `for` inside *enforced*, *performing*, *before*,
*platform*; `time` inside *timestamp*; `charge` inside *charged*.

### This is a half-true invariant, not a precision knob

`sqlite-index-store.ts:562-566` states the intended invariant verbatim:

> the terms the excerpt locator hunts for are, by construction, the terms the lexical leg searched
> with — one definition of "what a query term is," not two that can silently drift apart

The **term list** is shared (`tokenizeQuery` is the single definition, and `toFtsQuery` delegates to
it). The **matching semantics** never were. Canonical IR practice is that a highlighter runs the
index's own analysis chain — Lucene/Elasticsearch highlighters match analyzed token positions; FTS5
ships `highlight()`/`snippet()` over its own tokenizer output. Substring highlighting is not a
variant of that practice.

The apparent cost — losing `refund` → `refunds` — is **not a loss**: that plural never contributed to
retrieval (measured above: `"refund"` returns 0 rows). Dropping it makes the excerpt honest about why
the chunk was returned.

## What this change does NOT claim — read this before the scope

**It does not fix `docs/retrieval-open-work.md`'s Open problem 3, and it is not being shipped as a
fix for it.** Measured on the motivating chunk (`billing-rules.md` chunk #8, exploration §4.6.5):
removing `charge` (⊂ `charged`) from the early cluster leaves `twice` at `w = 2.8332`, still strictly
above `refund`'s `2.1972`. **Selection does not move.**

Three further findings from the same measurement pass, each of which the roadmap gets wrong and none
of which this change addresses:

1. Every rarity-favouring formula — max, superlinear, rarity-first — picks the *same* early cluster
   the current sum picks, because that cluster holds the chunk's **rarest** terms, not its commonest
   (§4.5.1). The roadmap's stated mechanism is falsified on its own example.
2. The `§9. Refunds` symptom is not an excerpt defect at all: that chunk contains no refund-timing
   content, and the current rule already centres on its rarest region (§4.5.3).
3. At `budget = 1400` the **unmodified** code already shows the answer (§4.5.4). The trace is a
   ranking failure plus a 120-character budget consequence.

**The justification for this cycle is independent correctness — one definition of "a term matched",
not two — and nothing else.** The previous cycle in this area (`supporting-excerpt-anchoring`) had to
state twice that it did not fix the billing-rules case, and the roadmap still records it as the
motivating symptom. This proposal is not making that framing again: the symptom is not the reason.

## Scope

### In Scope

- **`locateSpans` requires a non-word character (or a string edge) on both sides of every emitted
  span**, using the **same `[^\p{L}\p{N}]` class `tokenizeQuery` already splits the query on**
  (`match-location.ts:25`). Not a new rule and not language-specific — the rule already in the file,
  applied to the other side of the comparison. It works identically for Spanish and English because,
  like FTS5, it knows no morphology.
- **Invert one existing canary.** `test/domain/match-location.test.ts:96-107` ("finds overlapping
  terms from different query terms": `the` and `theta` both matching at offset 0 of `"theta value"`)
  asserts today's substring behaviour explicitly, with a comment saying so. It must be rewritten to
  assert the new behaviour positively — **never patched into silence.** *(Note the contrast with the
  candidates this cycle rejected: exploration §3.4 measured that not one of the 914 committed tests
  detects a sum→max change. This change is different — the suite does see it.)*
- **New unit tests** on prefix / interior / suffix / exact classes, and on the fold interaction
  (`dirección` ← `direccion`, `DUPLICADO` ← `duplicado`, both currently pinned at
  `match-location.test.ts:109-121` and both exact word matches that MUST survive).
- **Ship `scripts/word-boundary-probe.mjs`** — the falsifying gate. See *Success Criteria*.
- **`mcp-contract` spec delta** — the meaning of "a locatable query term" narrows. See *Capabilities*.
- **`AGENTS.md`**: a new non-obvious-decision bullet in house style (measured numbers, named
  non-guarantees) and a new manual-gate section matching the five existing ones.

### Out of Scope — each with its reason

| Item | Verdict | Reason |
|---|---|---|
| **`selectMatchCentre`'s scoring formula** (sum vs max vs superlinear vs rarity-first) | **Not deferred — falsified** | §4.5.1 measured every rarity-favouring candidate selecting the same early cluster on the motivating example. `bounded-chunk-size` Gate 2's precedent, *"a wrong analysis stops the change rather than shipping"*, applies to the analysis this cycle was opened on. Nothing in `selectMatchCentre` is touched: not the score, not the accumulator, not the tie-breaks |
| **Corpus document frequency** (candidate (e)) | Deferred, named | The only candidate whose mechanism is consistent with §4.5.1's measurement, and materially larger: it breaks `match-location.ts`'s "Pure: no I/O, no injectable dependency" declaration and re-opens `match-centred-excerpt`'s design.md:214-215 |
| **Open problem 1 (ranking)**, **2 (budget by confidence)**, **4 (the ellipsis measurement)**, **5 (`matchedTerms`)** | Out | Separate cycles. Problem 1 is upstream of everything here and is the roadmap's own first priority |
| **Budget values (1400 / 120)**, the graduated-by-rank policy, `computeWindow`, `flatten-map.ts` | Untouched | Stated explicitly so a reviewer need not re-derive it |
| **Correcting `docs/retrieval-open-work.md`** | **External dependency, not a task here** | The orchestrator is doing it separately, outside this cycle. See *Dependencies* |
| **Migrations, schema markers, compatibility shims** | Out | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`) |

### Does this need a reindex? No

`locateSpans` runs inside `runSearch` at **query time** (`search-documents.ts:128`), from already-
stored chunk content. No span, excerpt or offset is persisted. The SQLite schema is untouched, no
FTS5 MATCH string changes, and `toFtsQuery`'s emitted string is byte-identical (it never consults
`locateSpans`). A running `compendio serve` picks the change up on restart. `npm run build` between
a before/after probe pair — **not** a reindex.

## Capabilities

### New Capabilities

- None. Span location is an existing internal of the `search_docs` response.

### Modified Capabilities — `mcp-contract`

| Requirement | Change |
|---|---|
| **Supporting Excerpts Are Centred On the Matched Span, With a Start-Anchored Fallback** (`spec.md:627-665`) | **Narrowed.** Its fallback keys on "no locatable query term". "Locatable" today means *substring*; it must mean *whole token*, so a chunk containing only `timestamp` against the term `time` now takes the start-anchored fallback. The existing flattened-vs-raw clause is unaffected and stays |
| **Lead Excerpt Is a Window Centred on the Matched Span** (`spec.md:614-625`) | Same narrowing, same reason, lead tier |
| **Possibly ADDED — span location agrees with the lexical leg** | A requirement stating that a located span MUST correspond to a whole token as the lexical index tokenizes it, with its named non-guarantees (below). Spec's call whether this is one new requirement or a clause on each of the two above |
| **Match Selection Is Not Positional** (`spec.md:723-751`) | **Unchanged.** No scoring change is in scope |
| **Truncation Is Marked at Either Edge** (`spec.md:667-707`), **Graduated Excerpt Budget** (`:600-612`), **Vector-Only Results** (`:709-721`) | **Unchanged.** Stated so a reviewer does not have to check |

`openspec/specs/search/spec.md` carries no excerpt/window/centre requirements — all of it is in
`mcp-contract` (exploration §7.3, grep-verified).

## Approach

The mechanism is fixed here because it is one predicate; what design owns is where the predicate is
evaluated and how the residuals are recorded.

1. **The predicate.** Reject a span unless the character immediately before its start and the
   character at its end are both absent (string edge) or non-`[\p{L}\p{N}]`.
2. **Which coordinate space the test runs in — a real design decision, not a detail.**
   `locateSpans` matches in **folded** coordinates and maps back to raw via `foldRawWithMap`. The
   boundary test can run on either side of that mapping, and they are not equivalent: a bare
   combining mark folds away entirely and emits no map entry, so raw `"cafés"` and folded
   `"cafes"` place the neighbouring character differently. **Design must choose, state the reason,
   and pin the choice with a test.** The default recommendation is folded coordinates, consistent
   with where the match itself was made.
3. **The doc comment at `match-location.ts:57-65`** states the current semantics and must move with
   them, as `AGENTS.md`'s house rule requires.
4. **`src/server.ts` prose — grepped during this phase, no change needed.** Lines 119-124 read
   *"centred on the part of the document that matched"*; the wording is already
   mechanism-agnostic. Recorded so apply does not re-check it and so a reviewer knows it was checked.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/match-location.ts:66-88` + doc comment `:57-65` | **Modified** | `locateSpans`. The entire production change |
| `src/domain/match-location.ts:106-171` (`selectMatchCentre`) | **Untouched** | Explicitly. Its inputs change; its logic does not |
| `src/domain/excerpt.ts:78`, `src/application/search-documents.ts:128` | Unchanged in shape, changed in outcome | The only call sites in the repository |
| `test/domain/match-location.test.ts:96-107` | **Inverted** | The one existing test that detects this change |
| `test/domain/match-location.test.ts:109-121` (fold tests) | **Must stay green** | Exact word matches. If either goes red, the predicate is wrong, not the test |
| `scripts/word-boundary-probe.mjs` | **New** | ~180-220 lines, `dist/`-importing |
| `openspec/specs/mcp-contract/spec.md` | Modified | Narrowing delta, non-destructive |
| `AGENTS.md` | Modified | New bullet + new manual-gate section |
| `src/server.ts` | **No change** | Verified by grep this phase |
| `openspec/changes/word-boundary-term-matching/{boundary-probe,strict-cost,chunk-span-probe}.mjs` | **Kept as prior art, not shipped** | The measurement instruments behind §4.6. They stay in the change folder; the shipped gate is a new script derived from `strict-cost.mjs` (see below) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Fragments fall to zero spans and lose match-centring**, reverting to a start-anchored prefix — the only genuine functional cost | Low, **measured 0/110 and 0/50** (§4.6.4) | **Not inherited.** Re-measured by the gate as blocking counter W3. §4.6.4 is two corpora and 32 queries, not a guarantee |
| **The canary is patched into silence** rather than inverted | **High** — path of least resistance under a red test | The rewritten test must assert the new behaviour positively (`the` yields no span in `"theta value"`, `theta` yields one) and be demonstrated failing against the pre-change build |
| **The probe passes vacuously** — W1's denominator is 0 | Med | W1 > 0 guard, plus the vacuity guard demonstrated firing in **both** tree states |
| **The RED verification is faked** by running a probe absent from the reverted tree and reading `exit 1` as success | Med — **this exact failure is already recorded** (`retrieval-open-work.md:218-222`) | Revert **only** `src/domain/match-location.ts`; the probe is present in both states; the transcript must show the message, never merely the exit code |
| **Boundary coordinate space chosen wrong** (raw vs folded) | Med | Design decision 2, pinned by a test on a decomposed-accent input |
| **Someone reads this as fixing Open problem 3** | **High** — the roadmap still records it that way | Stated in *Intent*, in *What this change does NOT claim*, and again in *Success Criteria* |
| Delivery exceeds the 400-line budget | Med | See *Delivery size* |

## Rollback Plan

1. Revert the change commits and `npm run build`.
2. **No reindex, in either direction. No data at risk.** Spans and excerpts are computed at query
   time from stored chunk content and are never persisted; the SQLite schema, the FTS5 tokenizer and
   the emitted MATCH string are all untouched.
3. A running `compendio serve` picks up the revert on restart.
4. The probe script, the spec delta and the docs revert with the commits. Nothing outside the
   repository holds state from this change.

The blast radius stops at the process boundary. Being wrong here is cheap.

## Dependencies

- **Zero new npm dependencies.** The change adds a predicate.
- **`docs/retrieval-open-work.md`'s correction is EXTERNAL to this cycle** and owned by the
  orchestrator. Open problem 3 needs correcting on three measured counts — the "would have to be
  inverted" claim (§3.4), the "common query words" mechanism (§4.5.1), and the `§9. Refunds` example
  (§4.5.3). **This proposal does not claim it as a task and must not be verified against it.**
- **One external corpus cited but NOT reproducible here**: `DocuTests2` (81 documents, 888 chunks)
  supplies the 71.9% classification and the FTS5 table. It is corroborating evidence; **the committed
  gate is `ejemplos/`-only**, and its numbers are the ones apply must reproduce.

## Success Criteria

Each blocking gate can fail and stop the change. A gate that cannot fail is not a gate.

### The gate instrument

`compendio eval` is **structurally blind** to this change: `EvaluateSearch` computes rank from
`response.results.map(r => r.path)` and never reads `.excerpt` (exploration §6). It is used here as a
**non-gating ranking-invariance check only** — and note that invariance is expected *by construction*,
since `locateSpans` never reaches retrieval. A green `eval` is evidence of nothing this cycle claims.

**The shipped gate is a NEW script, `scripts/word-boundary-probe.mjs`, derived from
`strict-cost.mjs`** — hardened on three counts, because `strict-cost.mjs` as it stands cannot gate:
it **simulates** the fix with its own `strict()` filter instead of **observing** the pipeline's real
output (the family's own binding rule: *never recompute one to compare against itself*), it carries
no digest, and it has no failure messages at all. `boundary-probe.mjs` is a corpus-wide
classification instrument that bypasses the pipeline entirely; its classification logic is folded in
as a reported counter, but it is **not** the gate. Both stay in the change folder as prior art.

Family constraints inherited, each already paid for: import from `dist/`, never `src/`; drive the
real pipeline through `createContainer`; index **hybrid**, never `--lexical`, never pass `k`;
`npm run build` between runs, **not** a reindex.

### Counters — order matters, one job each

| # | Counter | Gated? | Failure message |
|---|---|---|---|
| **W0** | A result's `(path, section)` must resolve to exactly one stored chunk. Checked first; anything else is excluded from every counter and reported | **Yes** | `CANNOT IDENTIFY THE MEASURED CHUNK` |
| **W1** | **Anti-vacuity denominator**: spans the pipeline emits whose start or end abuts a `[\p{L}\p{N}]` character. Must be `> 0` in the BEFORE run, or there is nothing to falsify against | **Yes** | `GATE IS VACUOUS` |
| **W2** | Of the pipeline's emitted spans in the AFTER run, those that are not exact word matches. Must be **0** | **Yes** | `THE FIX DID NOT LAND` |
| **W3** | **The functional cost, re-measured not inherited**: fragments with ≥1 span BEFORE that have **0** spans AFTER — i.e. that lose match-centring and revert to a start-anchored prefix. Must be **0** | **Yes** | `MATCH CENTRING WAS LOST` |
| **W4** | Ordered digest of `(query, rank, path, section)` in emission order, plus a per-fragment excerpt hash. `--compare-digest` requires **tuple-for-tuple** identity of the first component | **Yes** | `POPULATION DRIFTED BETWEEN RUNS` |
| **W5** | Span retention %, class breakdown (exact/prefix/interior/suffix), and the count of fragments whose excerpt text changed | **Reported, not gated** | — |

Five distinct, never-conflated failure messages. W5 is deliberately ungated: there is no defensible
threshold for "how many excerpts should change", and inventing one would be the tolerance-band
theatre `bounded-chunk-size`'s Gate 2 note warns against.

### Gate A — The fix lands (BLOCKING)

- [ ] BEFORE, unmodified tree, `ejemplos/` hybrid: **W1 > 0** — expected non-zero given `for`/`de`
      -class terms in the goldenset. If W1 is 0, the query set must be widened before proceeding
- [ ] AFTER: **W2 === 0**
- [ ] W4 digest matches tuple-for-tuple — the population did not drift between the two runs
- [ ] W5 recorded in `verify-report.md` with real numbers, both corpora where available

### Gate B — The functional cost is zero, measured HERE (BLOCKING)

- [ ] **W3 === 0** on `ejemplos/` (its 22 goldenset queries). §4.6.4's `0/110` is prior evidence, not
      this gate's result, and must be reproduced rather than cited
- [ ] W3 also reported for `DocuTests2` where the machine has it; **not blocking**, since it is not
      committed and a reviewer cannot re-run it
- [ ] If W3 > 0, the change **stops** for re-analysis. A fragment losing match-centring is the one
      outcome this change has no argument for

### Gate C — Every gate is verified RED (BLOCKING)

*"A gate never observed failing has not been verified."*

- [ ] **W2 RED**: revert **only** `src/domain/match-location.ts`, `npm run build`, re-run. The probe
      **must already exist in that tree state.** The transcript must show `THE FIX DID NOT LAND` —
      the message, not merely `exit 1`
- [ ] **W1 RED**: run against a query set whose terms produce only exact word matches (or which match
      nothing), and confirm `GATE IS VACUOUS`, exit non-zero, in **both** tree states
- [ ] **W3 RED**: run against a deliberately over-strict patch (e.g. boundary **plus** a minimum term
      length that zeroes out short-term fragments) and confirm `MATCH CENTRING WAS LOST` fires,
      proving the criterion can detect the loss it names

### Gate D — Blast radius closes with no residue (BLOCKING)

- [ ] `npm test` green; `npm run typecheck` and `npm run build` pass
- [ ] Exactly **one** existing test file changed: `test/domain/match-location.test.ts`. Any second
      file needing an edit falsifies this proposal's blast-radius claim and must stop the change
- [ ] The inverted canary demonstrated failing against the pre-change build
- [ ] `compendio eval` on `ejemplos/`: hybrid recall@5 **1.00**, MRR **0.943** — identity, not a
      tolerance band. Non-gating for the claim; **gating as a scope falsifier**: any movement means
      the change breached its own scope

### Gate E — The record is honest (BLOCKING)

- [ ] `AGENTS.md` carries a new bullet stating the change, the 71.9%/0-loss measurements, and the
      residual divergences below
- [ ] `AGENTS.md` carries a new manual-gate section matching the five existing ones, with the
      before/after table and the three RED verifications
- [ ] The `mcp-contract` delta narrows "locatable" and states explicitly which excerpt requirements
      are **unchanged**
- [ ] Nothing in the shipped artifacts claims this fixes Open problem 3

## Residual divergences left open — named, not closed

Boundary alignment is not full alignment. Each of these stays open **by design** and must appear in
`AGENTS.md` and the spec's non-guarantees, so a later cycle does not rediscover them:

1. **`foldForMatch` is narrower than FTS5's `unicode61 remove_diacritics 2`**
   (`match-location.ts:39-44` says so already). Aligning boundary semantics does **not** align
   folding semantics.
2. **`[^\p{L}\p{N}]` is `tokenizeQuery`'s class, not `unicode61`'s token boundary.** This aligns the
   locator with *our* tokenizer, which is the one that produced the term list — not byte-for-byte
   with SQLite's tokenizer. The two can still disagree on exotic code points.
3. **No stemming, in either direction.** `refunds` will not match the term `refund`. This is
   alignment, not regression: FTS5 does not match it either (measured above).
4. **A combining mark adjacent to a span may read as a word boundary**, depending on Approach
   decision 2's coordinate choice. Design must state which way it falls and pin it.

## Open questions for spec and design

1. **Raw or folded coordinates for the boundary test?** (Approach 2.) The only genuinely open
   mechanism question. Recommendation: folded.
2. **One new `mcp-contract` requirement, or a clause narrowing the two existing window
   requirements?** Spec's call. Either way the non-guarantees above must land somewhere greppable.
3. **W1's population**: spans over the returned fragments only (`strict-cost.mjs`'s shape) or over
   every stored chunk (`boundary-probe.mjs`'s shape)? They measure different things; the proposal
   assumes the former for gating and the latter as W5 colour. Design should confirm.
4. **Is `ejemplos/` alone a sufficient committed gate corpus**, given that the strongest evidence
   (71.9%) comes from a corpus that cannot be committed? The proposal's position: yes, because W3 —
   the only counter with a functional cost behind it — is measured on committed data, and W1 guards
   against the gate being empty there.

## Delivery size

| Driver | Lines |
|---|---|
| `locateSpans` predicate + doc comment | ~25 |
| Canary inversion + new unit tests | ~60 |
| `scripts/word-boundary-probe.mjs` | ~180-220 |
| `mcp-contract` spec delta | ~60 |
| `AGENTS.md` bullet + manual-gate section | ~60 |

Roughly **385-425 changed lines** — **at the 400-line budget, not comfortably inside it**. This
project has a recorded pattern of the forecast growing at every phase (`bounded-chunk-size`: 240-420
at explore, 555-695 at tasks, 773 actual), so treat this as a lower bound and expect
`sdd-tasks` to forecast **Medium-to-High** budget risk.

**The probe dominates**, at seven to nine times the production change. The natural cut line if one is
needed: production change + canary inversion + spec delta in PR #1, probe + `AGENTS.md` gate section
in PR #2 — **but that ships the production change without its own falsifying gate**, which in this
area is the specific trade `retrieval-open-work.md:218-222` warns against. Prefer a single PR with an
accepted `size:exception` over splitting the gate away from the change it gates.
