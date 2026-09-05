# Verify Report: Anchor Supporting Excerpts on the Match

Recorded as apply proceeds, per tasks.md's instruction that Gate A/B/G2 evidence cannot be produced
after the fact.

## Phase 1 — Probe script, Gate B, Gate A baseline

Build: `npm run build` — clean, no errors.

Index (hybrid, once, reused through Phase 5):

```
node dist/cli.js --root ejemplos index
...
Indexed 11 documents (29 chunks) in 4250 ms [mode hybrid]
```

### Gate B — vacuity guard, verified failing (task 1.8)

```
node scripts/supporting-anchor-probe.mjs ejemplos --query "qwertzuiop plughxyzzy frobnicate" --query "blorptastic wibblefrotz"

Queries: 2
C7 (ambiguous chunk resolution): 0
C2 (flattened-text anti-vacuity denominator): 0
C1 (zero query terms visible, of C2): 0 (n/a)
C3 (both-ellipsis, of C2): 0 (n/a)
C4 (mean distinct terms visible, of C2): NaN
C5 (hard mid-word edge, of C2): 0 (n/a)
C5 impossible (idx === -1, of C2): 0
C6 (excluded from C2 — term in raw content only): 0
Digest (8 tuples) written to ...\ejemplos\.compendio\gate-a.digest

GATE IS VACUOUS
EXIT: 1
```

Required: exit 1, `GATE IS VACUOUS`, C2 = 0. **Matches.**

### Gate A — baseline on unmodified code (task 1.9)

```
node scripts/supporting-anchor-probe.mjs ejemplos --digest ejemplos/.compendio/gate-a-before.digest

Queries: 22
C7 (ambiguous chunk resolution): 0
C2 (flattened-text anti-vacuity denominator): 88
C1 (zero query terms visible, of C2): 8 (9.1%)
C3 (both-ellipsis, of C2): 0 (0.0%)
C4 (mean distinct terms visible, of C2): 2.40
C5 (hard mid-word edge, of C2): 0 (0.0%)
C5 impossible (idx === -1, of C2): 0
C6 (excluded from C2 — term in raw content only): 0
Digest (88 tuples) written to ...\ejemplos\.compendio\gate-a-before.digest

THE FIX DID NOT LAND
EXIT: 1
```

Required: C2 = 88, C1 = 8 (9.1%), C3 = 0, C4 = 2.40, C5 = 0, C6 = 0, C7 = 0, exit 1,
`THE FIX DID NOT LAND`. **Exact match to design's predicted table.** Digest saved as
`gate-a-before.digest` for the Phase 5.3 population-identity comparison.

## Phase 2 — Canary inversions, G2 mandatory pre-change red run (task 2.4)

Both canaries rewritten to assert the NEW (post-fix) behaviour, then run against **unmodified**
`src/application/search-documents.ts`. Both fail, as required — this is the evidence that they
discriminate rather than having been silenced.

```
npx vitest run test/application/search-documents-spans.test.ts test/application/index-and-search.test.ts

FAIL test/application/index-and-search.test.ts > index + hybrid search over the ejemplos corpus
  > spends the excerpt budget on the lead result and keeps the rest as signposts
AssertionError: expected false to be true // Object.is equality
  at test/application/index-and-search.test.ts:206:63
  > expect(supporting.some((r) => r.excerpt.startsWith("…"))).toBe(true);

FAIL test/application/search-documents-spans.test.ts
  > SearchDocuments — spans are computed for every rank
  > a supporting (non-rank-0) result's excerpt centres on the match, not a start-anchored prefix
AssertionError: expected 'word word word word word word word wo…' to contain 'zulu'
  at test/application/search-documents-spans.test.ts:63:35
  > expect(supporting!.excerpt).toContain("zulu");

Test Files  2 failed (2)
     Tests  2 failed | 48 passed (50)
```

G2 satisfied for both canaries.

## Phase 3 — New spec-scenario tests, red pre-change (task 3.5)

Appended a new `describe` block to `test/application/search-documents-spans.test.ts` with 3 tests.
Run against unmodified `src/`:

```
npx vitest run test/application/search-documents-spans.test.ts

FAIL > supporting-excerpt-anchoring — new spec scenarios
    > a supporting fragment centred away from both edges carries both ellipses within its own budget
AssertionError: expected false to be true
  > expect(supporting!.excerpt.startsWith("…")).toBe(true);

FAIL > supporting-excerpt-anchoring — new spec scenarios
    > the same preference for the distinctive term over an early high-frequency neighbourhood holds for a supporting fragment
AssertionError: expected 'block block block ...' to contain 'quetzal'
  > expect(supporting!.excerpt).toContain("quetzal");

FAIL > supporting-excerpt-anchoring — new spec scenarios
    > a term present only in a stripped heading is treated as unreachable, even at a supporting rank
AssertionError: expected 'word word word ...' to contain 'zibbowatt'
  > expect(control!.excerpt).toContain(term);

Test Files  1 failed (1)
     Tests  4 failed | 1 passed (5)   [1 of the 4 is canary #1, already recorded above]
```

**Correction found and fixed during Phase 4's post-fix green run**: the "non-positional selection"
fixture's neutral gap (originally `"word ".repeat(20)`, 100 chars) was too narrow — the sweep found a
window straddling both the tail of the "block" cluster AND "quetzal" scored higher (sum of both
distinct weights) than "quetzal" alone, so the post-fix excerpt legitimately contained "block" too
(the algorithm behaving correctly, the fixture failing to isolate what it meant to test). Widened the
gap to `"word ".repeat(40)` (200 chars) so no single 120-char window can straddle both clusters. Both
red-pre-change and green-post-change were re-verified against the corrected fixture (below); the
verbatim failure output above is from the original (narrower) fixture and stays representative of the
same assertion failing for the same reason, only with less repeated filler.

Re-verified against the corrected fixture, by stashing only the production edit and restoring it:

```
# unmodified src/application/search-documents.ts, corrected fixture
FAIL > the same preference ... holds for a supporting fragment
AssertionError: expected 'block block block block block block b…' to contain 'quetzal'
  at search-documents-spans.test.ts:164

# with the production edit restored
Test Files  2 passed (2)
     Tests  53 passed (53)
```

For the heading-only test (3.4), the control and subject assertions were additionally verified in
isolation by temporarily reordering the assertions and re-running with `-t`: with the subject
assertions evaluated first, they **pass** against unmodified `src/` (`not.toContain(term)` and
`startsWith("…") === false` both green), and only the control assertion (`toContain(term)`) fails —
confirming "the control assertion MUST fail while the subject assertion passes" (task 3.5) rather
than both failing together for an unrelated reason. The reordering was reverted immediately after
this check; the committed test asserts control before subject, as specified.

## Phase 4 — Production fix, green (task 4.3)

`npx vitest run test/application/search-documents-spans.test.ts test/application/index-and-search.test.ts`
after the guard removal: **2 files passed, 53 tests passed, 0 failed.** Both canaries and all 3 new
spec-scenario tests are green; nothing else in those files moved.

## Phase 5 — Post-fix verification (Gate A after / Gate B again / Gate C)

`npm run build` — clean. **No reindex** — the `ejemplos/.compendio` database from Phase 1.8 is reused.

### Gate A — after, with the population-identity digest compare (task 5.2, 5.3)

```
node scripts/supporting-anchor-probe.mjs ejemplos --compare-digest ejemplos/.compendio/gate-a-before.digest

Queries: 22
C7 (ambiguous chunk resolution): 0
C2 (flattened-text anti-vacuity denominator): 88
C1 (zero query terms visible, of C2): 0 (0.0%)
C3 (both-ellipsis, of C2): 69 (78.4%)
C4 (mean distinct terms visible, of C2): 4.00
C5 (hard mid-word edge, of C2): 8 (9.1%)
C5 impossible (idx === -1, of C2): 0
C6 (excluded from C2 — term in raw content only): 0
Digest (88 tuples) written to ...\ejemplos\.compendio\gate-a.digest
EXIT: 0
```

Required: C1 = 0, C2 = 88 (identical population), C7 = 0, exit 0. **Matches exactly.** No
`POPULATION DRIFTED BETWEEN RUNS` message — the digest compared identical, tuple for tuple, against
`gate-a-before.digest`. Recorded (not gated): C3 = 69 (78.4%), C4 = 4.00, C5 = 8 (9.1%), C6 = 0 — an
exact match to design's predicted post-fix table.

### Gate B — again, after the fix (task 5.4)

```
node scripts/supporting-anchor-probe.mjs ejemplos --query "qwertzuiop plughxyzzy frobnicate" --query "blorptastic wibblefrotz"

C2 = 0, GATE IS VACUOUS, EXIT: 1
```

The anti-vacuity guard fires identically in both tree states, as required.

### Gate C — retrieval scope unmoved (task 5.5)

```
node dist/cli.js --root ejemplos eval

mode      recall@5   MRR      failures
--------------------------------------
hybrid    1.00       0.943    0
lexical   0.95       0.856    1
```

Required identity: hybrid 1.00 / 0.943, lexical 0.95 / 0.856. **Exact match** — `evaluate-search.ts`
never reads `.excerpt`, and none of it moved.

### C7's underlying shape, measured directly against the database (task 5.6)

```
chunks: 29 | duplicate (document_id, heading) pairs: 0 | largest chunk: 1332 chars
```

Confirms design's CLOSED open question (the "Review response" section): 0 duplicate pairs, largest
chunk (1332 chars) well under the ~1920-char (480-token) split threshold, so the C7 shape cannot occur
on this corpus. Matches the design's own independently-measured figures exactly.

## Phase 6 — Prose, citations, full suite (Gate D / Gate E)

`src/server.ts:119-121`'s middle literal rewritten (task 6.1); `:123-125`'s ellipsis-contract sentence
confirmed untouched by reading the diff. `AGENTS.md`'s MCP tools §2 clause, graduated-budget bullet,
new Manual gate section, and `matchedTerms` deferral bullet all added (tasks 6.2-6.5). Exactly 3 stale
`Decision 7` citations fixed, comment-only, zero executable change (task 6.6):
`src/domain/excerpt.ts:49`, `test/domain/excerpt.test.ts:123`,
`test/application/vector-only-excerpt.test.ts:60`. Verified by `git diff` on all three files that no
assertion line changed. Confirmed by `grep -rn "Decision 7" src test` that the other 12 citations
(`multiple-doc-roots`'s own) are untouched.

### Gate D — full suite (task 6.7)

```
npm test
Test Files  52 passed (52)
     Tests  914 passed | 1 skipped (915)

npm run typecheck   — clean
npm run build       — clean
```

Required: `911 + 3` passing (914), 1 skipped, 52 files. **Exact match.**

### Non-touch confirmation (task 6.8)

```
git diff --stat main..HEAD -- src/domain/flatten-map.ts src/domain/match-location.ts \
  src/domain/ports.ts src/domain/fusion.ts src/infrastructure
```

Empty output — confirms design's asserted non-touches.

### Decision 7's two-number blast-radius count (task 6.9)

- **Files with changed EXISTING assertions: exactly 2** —
  `test/application/search-documents-spans.test.ts`, `test/application/index-and-search.test.ts`.
- **Files with additions/comment-only changes**: `src/application/search-documents.ts` (production,
  not a test), `test/application/search-documents-spans.test.ts` (also carries the new
  additions-only `describe` block, on top of its 2 changed assertions above),
  `src/domain/excerpt.ts`, `test/domain/excerpt.test.ts`, `test/application/vector-only-excerpt.test.ts`
  (comment-only, zero executable change), `src/server.ts`, `AGENTS.md` (prose only), plus the new
  `scripts/supporting-anchor-probe.mjs`.

No third file has a CHANGED existing assertion — the blast-radius claim holds.

## Real diffstat vs. forecast

`git diff --stat main..HEAD`:

```
 AGENTS.md                                          |  61 +-
 openspec/changes/.../design.md                     | 713 +++
 openspec/changes/.../exploration.md                | 610 +++
 openspec/changes/.../proposal.md                   | 387 +++
 openspec/changes/.../specs/mcp-contract/spec.md     | 147 +++
 openspec/changes/.../tasks.md                      | 267 +++
 openspec/changes/.../verify-report.md              | 261 +++
 scripts/supporting-anchor-probe.mjs                | 313 +++
 src/application/search-documents.ts                |  15 +-
 src/domain/excerpt.ts                              |   4 +-
 src/server.ts                                      |   4 +-
 test/application/index-and-search.test.ts          |  21 +-
 test/application/search-documents-spans.test.ts    | 160 ++-
 test/application/vector-only-excerpt.test.ts       |   7 +-
 test/domain/excerpt.test.ts                        |   9 +-
 15 files changed, 2944 insertions(+), 35 deletions(-)
```

**The `src`/`test`/`scripts`/`AGENTS.md`/`server.ts` surface a reviewer actually opens a PR
against** — excluding the pre-authored SDD artifacts (`design.md`, `exploration.md`, `proposal.md`,
`spec.md`, `tasks.md`) and this report itself — sums to:

| Driver | Forecast (tasks.md) | Actual |
|---|---|---|
| Production edit (guard + comment) | ~15 | 15 |
| Canary #1 inversion | ~25 | ~31 (in the 160-line spans-file total) |
| Canary #2 inversion | ~20 | 21 |
| New spec-scenario `describe` block | ~110 | ~129 (remainder of the 160-line spans-file total) |
| `scripts/supporting-anchor-probe.mjs` | ~210 | 313 |
| `server.ts` middle literal | ~4 | 4 |
| `AGENTS.md` | ~55 | 61 |
| 3 stale `Decision 7` comments | ~4 | 4+7+9 = 20 (comment blocks turned out longer, to name the ancestor cycle explicitly) |
| **Implementation total** | **~443** (440-480 range) | **594** |

**Actual (594) exceeds the 440-480 forecast by ~24-35%, continuing this project's recorded pattern of
the estimate growing at every phase** (`bounded-chunk-size`: 240-420 → 555-695 → 773 actual, a
comparable ~11-30% overshoot past its own tasks-phase figure). Two concrete drivers account for most
of the gap: the probe (313 vs ~210, +103) grew from the digest/`--compare-digest` binding amendment
(Review response), the C5-impossible bookkeeping, and a fuller header comment than the ~190-line
design estimate anticipated; and the citation fixes (20 vs ~4) grew because disambiguating "Decision
7" from its overloaded sibling meant naming the ancestor change slug in full at each site, not a
one-line re-point. Counting the pre-authored `openspec/` artifacts as well (the full-cycle figure the
proposal flagged as ~590-630 if counted) puts the true total at 2979 changed lines — the
`size:exception` this delivery shipped under.
