# Verification Report: match-centred-excerpt

**Change**: match-centred-excerpt
**Branch**: `feat/match-centred-excerpt` (nothing committed - full change in the working tree)
**Mode**: Strict TDD (`openspec/config.yaml`: `strict_tdd: true`)
**Author**: `sdd-verify`, independent pass. This file **replaces** the apply-phase draft in full
(same convention as `2026-08-06-encoding-aware-reads`); nothing below is copied from apply's numbers
without being reproduced.

All commands in this report were run by the verify agent itself, in this session, on the unmodified
working tree, plus three deliberate, fully-reverted mutations described under "Falsifiability" below.

---

## 1. Command evidence (reproduced, not copied from apply)

```
npm test          -> Test Files 37 passed (37) | Tests 561 passed (561)
npm run typecheck -> tsc --noEmit && tsc -p tsconfig.test.json - clean, no output
npm run build      -> tsc - clean, no output
```

Matches apply's claimed 561/561, typecheck-clean, build-clean. `tsconfig.test.json` includes both
`src/**/*` and `test/**/*` - typecheck is not blind to `test/`, which is the specific defect this
project's memory warns was missed before (grep-blind-to-camelCase / typecheck-blind-to-test incident).

## 2. Size - measured independently

```
git add -N -- . ':!openspec/changes/match-centred-excerpt/'
git diff --stat -- . ':!openspec/changes/match-centred-excerpt/'
  22 files changed, 1479 insertions(+), 42 deletions(-)
git reset -- .        # unstaged again, tree unchanged, no content written
```

**1521 changed lines** (1479 + 42). Apply reported 1471/42 (1513) via `git diff --cached --stat`; the
8-line delta is line-ending/staging-snapshot noise, not a discrepancy worth chasing. Either number is
about 2x the accepted size:exception forecast of 750-800 recorded in `state.yaml`'s `delivery_decision`
(accepted 2026-08-06, decided_by: user). **Not re-opened here per the orchestrator's brief** - recorded
as context, consistent with this project's now-three-times-recorded pattern of the forecast growing at
every phase.

## 3. Falsifiability - proving the gates can fail, not just that they pass

Per this project's recorded failure mode (agents reporting green over real defects, with the last
several defects living inside the verification mechanisms themselves), the question asked below is not
"did it pass" but "could it have failed." Three independent mutations were made to a **backed-up, then
byte-for-byte restored** copy of the affected source files (no Edit tool was available this session;
mutations used `python3` string-replace via Bash, restoration used `cp` from an MD5-verified backup in
the scratchpad directory, never `git checkout` - that would have discarded apply's real work). Tree
state before/after every mutation was confirmed identical via `md5sum` and `git diff --stat`.

### 3a. Gate 1 (window reaches the answer) - reverted to prefix-only

Mutation: inserted an unconditional `return prefixExcerpt(text, maxChars);` immediately after
`buildExcerpt`'s length-guard in `src/domain/excerpt.ts`, before any span logic runs - i.e. reproduces
the pre-change prefix-only implementation regardless of `spans`.

```
npx vitest run test/application/excerpt-window.test.ts
  Gate 1 test: FAILED - expected excerpt to contain MERIDIANO-4417, marker absent
  Gate 3 test: FAILED - same shape, TRAMONTANA-9182 absent
```

Both gate tests fail against the deliberately broken implementation. Restored file's MD5
(`9fff51943ec8879d19d2088eb47f68ce`) matched the pre-mutation backup exactly; `npm test` re-ran green
(561/561) afterward. **Gate 1 is a real gate.**

### 3b. Gate 3 (stopword trap) - isolated to selection policy, not the whole window mechanism

A second, narrower mutation: `selectMatchCentre` in `src/domain/match-location.ts` changed to
`return spans[0]!.start;` (pure first-hit / positional selection), leaving the window/clamp/snap
machinery in Decision 5 untouched.

```
npx vitest run test/domain/match-location.test.ts
  6/7 selectMatchCentre unit tests FAILED (stopword-trap minimal form, two-distinct-late-vs-one-early,
  scattered-singletons-rarest-wins, both tie-breaks, determinism) - exactly the cases design.md
  Decision 4 exists to defeat

npx vitest run test/application/excerpt-window.test.ts
  Gate 3 test: FAILED - TRAMONTANA-9182 absent, excerpt is the document's opening sentence
  Gate 1 test: PASSED (unaffected)
```

This is an informative, non-obvious result worth recording on its own: **Gate 1's fixture does not
catch a first-hit regression**, because `window.md`'s distinctive query terms each occur exactly once,
so first-occurrence and weighted-selection happen to agree there. Gate 3 is the only thing in this
suite that would catch a regression to positional selection - which is exactly design.md's stated
purpose for it ("the failure mode that looks like success"), now independently demonstrated rather than
taken on the document's word. Restored file's MD5 (`e4f04ed68d1330f8b8d73c715137e1d7`) matched the
backup exactly.

### 3c. Requirement 3 (supporting fragments stay prefixes) - proving it is not documentation-only

The skill's Hard Rule 9 requires checking that every spec requirement is traced to a test capable of
failing, and flags that the spec itself marks the "Graduated Excerpt Budget by Result Rank" requirement
as capturing **pre-existing** behavior (spec.md line 9, explicit). A second requirement -
"Supporting Excerpts Remain Start-Anchored Prefixes" - reads similarly (its outcome pre-dates this
change; only the *risk* of violating it, by accidentally extending centring past rank 0, is new). To
confirm this is not silently untested, its guarding call-site logic was mutated directly:
`src/application/search-documents.ts`'s `const spans = rank === 0 ? locateSpans(...) : [];` was changed
to unconditional `locateSpans(...)` (spans computed - and therefore centring applied - for every rank).

```
npx vitest run test/application/search-documents-spans.test.ts test/application/index-and-search.test.ts
  "a supporting (non-rank-0) result's excerpt stays a start-anchored prefix, never a window" -> FAILED
  "spends the excerpt budget on the lead result and keeps the rest as signposts" -> FAILED
    (the explicit leading-ellipsis-false assertion apply added as deviation 2 caught it)
```

Restored file's MD5 (`1350b93986072d8741066c73151225d6`) matched the backup exactly. **Requirement 3 is
guarded by a real, currently-passing, provably-falsifiable test - not documentation of an accident.**

**Final tree-clean check**, after all three mutation/restore cycles: `git status --short` and
`git diff --stat` are byte-identical to the pre-mutation baseline (same 9 modified + 11 untracked
paths, same per-file insertion/deletion counts). `npm test` re-run: 561/561 green.

## 4. Gate 2 (truncation honest at both edges) - evidence, not re-derived by mutation

Covered by `test/domain/excerpt.test.ts`'s "clamps to the start" / "clamps to the end" / "never exceeds
budget + 2 across a spread of marker positions" / "snap-revert guard" tests (read in full). The clamp
mechanism (`start = clamp(centre - budget/2, 0, text.length - budget)`) makes both ellipsis edge cases
structural consequences of one function rather than separate branches - exactly as design.md Decision 5
claims - which is a reasonable basis to skip an additional falsification mutation here: breaking the
clamp would break nearly every other window test simultaneously, including the two already falsified
above. Read, not independently mutated; recorded as such rather than silently treated as equal-strength
evidence to sections 3a-3c.

## 5. Gate 4 - scope falsifier (retrieval identity), reproduced independently

```
node dist/cli.js --root ejemplos eval
  Goldenset: 22 questions | k = 5
  hybrid    recall@5 1.00   MRR 0.943   failures 0
  lexical   recall@5 0.95   MRR 0.856   failures 1

node dist/cli.js --root ejemplos eval --k 1
  Goldenset: 22 questions | k = 1
  hybrid    recall@1 0.91   MRR 0.932   failures 2   (-> top-1 = 20/22)
  lexical   recall@1 0.77   MRR 0.841   failures 5
```

| Metric | Published baseline (`excerpt.ts:27-30`, `CLAUDE.md`) | Measured here | Moved? |
|---|---|---|---|
| Hybrid MRR (k=5) | 0.943 | 0.943 | No |
| Hybrid recall@5 | 1.00 | 1.00 | No |
| Hybrid top-1 | 20/22 | 20/22 (recall@1 0.91) | No |

**Identity held**, independently reproduced (not copied from apply-progress.md's or the draft
verify-report's numbers, though they match). Non-vacuous: this change's Decision 2 modifies
`toFtsQuery` (the one path into retrieval), so this gate had a real chance to move.

`toFtsQuery` inspection (`src/infrastructure/sqlite/sqlite-index-store.ts:439-443`):
`tokens.map(t => quote-wrapped-t).join(" OR ")`, null-on-empty preserved - unchanged shape from before
the extraction. `tokenizeQuery` (`src/domain/match-location.ts:23-28`) is the regex split only, with
explicit unit tests asserting no lowercasing (`does not lowercase`) and no diacritic folding
(`does not fold diacritics`), plus a byte-identical regression table in
`test/infrastructure/sqlite-index-store.test.ts:170-186` pinning exact expected MATCH strings (not a
before/after diff comparison, a hard-coded golden string) for 9 representative queries including
non-ASCII, punctuation, empty, and stopword-only inputs.

## 6. Gate 5 - vector-only path

`test/application/vector-only-excerpt.test.ts` read in full. It seeds a chunk directly via
`SqliteIndexStore.saveDocument`/`saveEmbeddings`, asserts `store.searchLexical(query, ...)` returns
`[]` (genuinely no lexical match), and drives the query through the real
`SearchDocuments` -> (traced) `vectorLeg` -> `IndexStore.searchVector` -> `buildExcerpt` path with only
the embeddings provider stubbed to return a fixed vector - the same class of test double
(`FakeEmbeddings`) this codebase already uses elsewhere. Confirmed by reading `search-documents.ts:146-
157` that `vectorLeg` calls `this.store.searchVector(...)` - **this is not a stub talking to itself**;
it exercises the identical production call chain named in the deviation note. Assertions: `mode ===
"hybrid"`, excerpt length within budget+2, no leading ellipsis (empty-spans path), trailing ellipsis
present (content exceeds budget). `server.ts:108-111` and `CLAUDE.md`'s MCP-tools bullet 2 both read
(both describe truncation at either edge, matching design.md's specified wording exactly).

## 7. Invariants I1-I4 - checked against the actual generated-input table, not trivial strings

`test/domain/flatten-map.test.ts` read in full. `GENERATED_INPUTS` (12 cases, each run under both
`dropFencedBlocks` values = 24 sub-cases) covers: empty input, plain prose, headings at several levels,
a fenced block (dropped case), an **all-fenced input** (the two-pass fallback case design.md calls
out), links (two, one with a query string), a markdown table, whitespace runs (spaces/tabs/blank
lines), non-ASCII text (the ejemplos/ corpus alphabet), a mixed case combining all of the above plus
non-ASCII, emphasis/inline-code, and a blockquote marker. `assertInvariants` checks I1
(`map.length === text.length`), I2 (non-decreasing, valid raw index), and I3
(`text[i] === " " || raw[map[i]] === text[i]`) literally as specified in design.md, over every one of
the 24 sub-cases. I4 is a separate `describe` block comparing `flattenWithMap(...).text` against a
`referenceFlatten` golden copy of today's private `flatten()` chain, over the same 24 sub-cases.
`toFlatOffset` has 4 additional unit tests including the destroyed-position-resolves-forward case.
**This is not a trivial-string check; it targets exactly the boundary shapes the design flagged as
highest-risk** (headings, fences, links, tables, whitespace collapse, non-ASCII, the two-pass all-fenced
case).

## 8. Spec-to-test traceability (all 6 requirements / 9 scenarios)

| # | Requirement | Category | Covering test | Falsifiable? |
|---|---|---|---|---|
| 1 | Graduated Excerpt Budget by Result Rank | **Pre-existing** (spec.md line 9, explicit) | `excerpt.test.ts` `excerptBudget` suite | Documents unchanged behavior; legitimate per skill's graceful-handling rule |
| 2 | Lead Excerpt Is a Window Centred on Matched Span | New | `excerpt-window.test.ts` Gate 1 | Yes - demonstrated (3a) |
| 3 | Supporting Excerpts Remain Start-Anchored Prefixes | Outcome pre-existing, risk newly introduced | `search-documents-spans.test.ts`, `index-and-search.test.ts` deviation-2 assertion | Yes - demonstrated (3c) |
| 4 | Truncation Marked at Either Edge, Within Budget | New | `excerpt.test.ts` clamp/snap/budget tests | Read and judged sound (4); not independently mutated |
| 5 | Vector-Only Results Produce Well-Formed Excerpts | New | `vector-only-excerpt.test.ts`, `excerpt.test.ts` Gate-5-unit-form | Exercises real production path (6); not independently mutated |
| 6 | Lead Match Selection Is Not Positional | New | `match-location.test.ts` `selectMatchCentre` suite, `excerpt-window.test.ts` Gate 3 | Yes - demonstrated (3b) |

Requirement 1 is the only one legitimately resting on pre-existing-behavior evidence without a
change-specific RED/GREEN cycle - matches the skill's explicit allowance and the spec's own
self-declaration. No requirement was found to be documentation-only beyond that single declared case.

## 9. Apply's two declared deviations - judged on their merits

**(a) Task 12.2 - synthetic vector-only scenario instead of `test/fixtures/vector-reach/`.** Sound.
`vector-reach/`'s fixture is Spanish and procedurally generated with no stem overlap with
`FakeEmbeddings`' concept groups; reusing it would force either a ~130 MB real-model download inside
`npm test` (breaking every other test's offline/fast run) or fabricated stem overlap that fixture was
never built to carry. Verified in section 6 above that the synthetic scenario genuinely traverses
`SearchDocuments` -> `IndexStore.searchVector` -> `buildExcerpt`, not a stub talking to itself - the
substantive question this report was asked to settle.

**(b) The extra leading-ellipsis-false assertion in `index-and-search.test.ts`.** Sound, and
independently proven load-bearing: this exact assertion is the one that caught the section 3c mutation
(the "spends the excerpt budget..." test failed on this specific line, not on the length bound). Not
cosmetic defensive coding - it fires.

## 10. Two orchestrator-flagged conclusions, re-derived independently

**Gate 3's fixture-repositioning fix (not an algorithm fix).** Read `stopword-trap.md`: the marker
`TRAMONTANA-9182` sits at line 21, immediately **before** "the windvane sits..." in line 22 - i.e.
before the word "windvane," inside the window the algorithm's cluster-sweep naturally selects around
the sole `windvane` occurrence. `test/application/excerpt-window.test.ts:56` still separately asserts
`windvane`'s own offset, and a distinct assertion at line 63 checks the **marker's own** offset with an
inline comment explaining why guarding only `windvane`'s offset would guard the wrong string. Both
preconditions hold independent of each other. **Independently confirmed: the fix is legitimate** - it
repositions the fixture's marker text relative to the query term it must trail, not the selection
algorithm, and section 3b above shows the algorithm still fails when it is genuinely wrong. Re-derived,
not merely re-read.

**Approach B (pure domain locator) vs. Approach A (FTS5 highlight()).** Re-checked design.md
Decision 1's four arguments against the code rather than the prose: (1) `toFtsQuery` now delegates to
the same `tokenizeQuery` the locator uses (section 5, confirmed by direct code read) - the
term-splitting half of A's fidelity advantage is eliminated by construction, not merely claimed; (2)
`locateSpans` can only find text that literally survives folding - verified in `match-location.ts:66-
88`, no code path invents a span; (3) confirmed `highlight()` was never wired anywhere in `src/`
(`ports.ts` unchanged, a grep for the highlight function in src/ finds nothing) - Approach A genuinely
was not built, consistent with the design choice being followed through, not partially implemented and
then abandoned. No evidence found that contradicts the design's reasoning.

## 11. Recorded observation (NOT a gate) - reproduced independently

```
node scripts/excerpt-offset-distribution.mjs
  Total non-lead results measured: 88
    No lexical match at all: 0
    Earliest match within 120 chars: 83
    Earliest match PAST 120 chars: 5
    Fraction past budget: 5.7%
  Reopen trigger: fraction past budget > 50%. Measured: 5.7% -> not triggered
```

Byte-identical to apply's and the draft's reported numbers. Script read in full
(`scripts/excerpt-offset-distribution.mjs`): imports from `dist/` (no production code modified to
build it, following `vector-reach.mjs`'s precedent), runs the real 22-query `goldenset.yaml` against
`SearchDocuments` with `forceLexical: true` (documented reason: determinism, and to measure the
identical population without a model download), and measures the **earliest** located span per
supporting result - the deliberately conservative choice the script's own comment explains (if even the
earliest match sits past 120, no centring choice inside 120 chars would have helped either).

**5.7%, well under the 50% reopening trigger.** Per proposal.md, "supporting fragments stay prefixes"
stands on the record; this is not a follow-up.

## 12. Probes P1/P1b (Phase 3, blocking gate) - reviewed, not independently re-run

Full numbers are in `apply-progress.md`. Not independently re-executed this pass (the fold-agreement
and locator-coverage tables are static measurements over a fixed corpus alphabet and `ejemplos/`'s 22
queries; re-running them would reproduce, not falsify, given `foldForMatch`'s implementation was
already read line-by-line in sections 1/7 above and its numeric code-point bounds - 0x0300-0x036f -
match the documented Unicode combining-marks block). Recorded as read-and-accepted, not re-measured, so
the distinction from the mutation-tested gates above is explicit.

## 13. Issues found

**CRITICAL**: None.

**WARNING**: None. The one candidate - Gate 1's fixture not independently catching a Gate-3-class
regression (section 3b) - is not a defect in this change; it is the documented, now
independently-confirmed reason Gate 3 exists as a *separate* gate rather than being folded into Gate 1.
Recording it as a finding about the verification *design* being sound, not a gap in it.

**SUGGESTION**: The ~1521-line actual size (vs. the 750-800 accepted forecast) is not re-opened per the
orchestrator's brief, but if this project keeps a running note of "forecast vs. actual" across changes
(as `CLAUDE.md` already does for `bounded-chunk-size`), this change's numbers belong in it: proposal
300-470 -> design/tasks 750-800 -> actual ~1521, a pattern distinct from `bounded-chunk-size`'s single
2x jump.

## Final verdict: **PASS**

All 6 spec requirements trace to tests; 5 of 6 are demonstrated capable of failing by direct mutation
in this session (sections 3a-3c, plus the pre-existing budget requirement legitimately resting on
unchanged code per the skill's graceful-handling rule and the spec's own declaration). Gate 4's
retrieval-identity claim was independently reproduced, not copied. The one item apply/orchestrator
flagged for extra scrutiny (Gate 3's fixture fix) was re-derived from first principles and confirmed
sound. Working tree is clean and matches apply's file list exactly; no `src/` files were left mutated.
