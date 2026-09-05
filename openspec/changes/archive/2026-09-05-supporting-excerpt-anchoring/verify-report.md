# Verify Report: Anchor Supporting Excerpts on the Match

**Mode**: Strict TDD. **Verifier**: `sdd-verify` (independent — not the `sdd-apply` agent that wrote
the report below). Repository was on `feat/supporting-excerpt-anchoring` (6 commits off `main`) for
the entire session; no branch switch, no commit, no push.

## Process note on this file's history

This file previously contained ONLY `sdd-apply`'s self-report — apply is not an independent
verifier, so every number in it was treated here as a claim to re-derive, not as evidence. Its
content is preserved verbatim below, under "Apply's self-report (retained as claims)". Everything
above that heading is this verify phase's own, independently produced work: every command was
re-run in this session, against the actual working tree, not copied from the prior report.

---

## Independent Verification (this phase)

### Build / Typecheck / Test — re-run, not copied

```
npm run build        → clean (tsc, no output)
npm run typecheck     → clean (tsc --noEmit && tsc -p tsconfig.test.json)
npm test              → Test Files  52 passed (52)
                         Tests  914 passed | 1 skipped (915)
```

Matches apply's and the orchestrator's reported figures exactly (911 baseline + 3 new = 914,
1 skipped, 52 files — the design's Decision 7 amendment to Gate D).

### Gate A / Gate B / Gate C — re-run against the real tree, not accepted from the report

1. Rebuilt and re-indexed `ejemplos/` in hybrid mode (`node dist/cli.js --root ejemplos index`) —
   11 documents, 29 chunks.
2. Gate B (anti-vacuity), current (fixed) code:
   `C2 = 0`, exit 1, `GATE IS VACUOUS`. **Matches.**
3. Gate A, current (fixed) code:
   `C1 = 0 (0.0%)`, `C2 = 88`, `C3 = 69 (78.4%)`, `C4 = 4.00`, `C5 = 8 (9.1%)`, `C6 = 0`, `C7 = 0`,
   exit 0. **Matches design's predicted post-fix table and apply's report exactly.**
4. Gate C (`node dist/cli.js --root ejemplos eval`): hybrid `1.00 / 0.943`, lexical `0.95 / 0.856`,
   identical to four decimals. **Matches.**

### The mandated red-run trap — done correctly, not the false-pass shortcut

Per this phase's brief: proving the gate goes RED against pre-change code by `git checkout main` is
a **false pass**, since `scripts/supporting-anchor-probe.mjs` does not exist on `main` (`node` exits 1
for a missing file, not because the gate fired). Instead:

1. Backed up `src/application/search-documents.ts`.
2. Reverted **only** line 128 to the pre-change guard:
   `const spans = rank === 0 ? locateSpans(chunk.content, terms) : [];`
3. `npm run build` (clean).
4. `node scripts/supporting-anchor-probe.mjs ejemplos` (probe present, production reverted, **no
   reindex** — same database as every other run):
   ```
   C1 = 8 (9.1%), C2 = 88, C3 = 0 (0.0%), C4 = 2.40, C5 = 0, C6 = 0, C7 = 0
   THE FIX DID NOT LAND
   EXIT-CODE: 1
   ```
   Exact match to design's predicted baseline table and to apply's Phase 1.9 record.
5. Restored `search-documents.ts` from the backup, confirmed `git diff` and `git status` empty for
   that file, rebuilt (`npm run build`, clean), and re-ran Gate B on the restored code to confirm the
   fixed behaviour returned. **Working tree left clean** — the only pre-existing modification in
   `git status` (`apply-progress.md`) predates this session and was not made by this phase.

This independently confirms the gate is falsifiable in the correct sense — it fails for the reason
it exists to catch, not for an unrelated reason misread as success (the exact trap this repository's
own `MEMORY.md` records happening once already on this same change, with `git checkout main`).

### Gate A's population-identity mechanism — read and stress-tested, not merely trusted

Read `scripts/supporting-anchor-probe.mjs` in full. The `--compare-digest` mechanism is real: it
writes an ordered `(query, rank, path, section)` tuple per measured supporting result, and
`--compare-digest <path>` requires **line-for-line** equality against a prior run, not just equal
length — a swapped rank/chunk pair fails with its own message, `POPULATION DRIFTED BETWEEN RUNS`,
checked *before* the vacuity and fix-landed checks (source lines 279-299).

Stress-tested the failure path directly (the claim under scrutiny was "does this mechanism actually
exist and actually fail on a mismatch", not "does it pass"): built a digest file with two adjacent
lines swapped and ran `--compare-digest` against it. Result: `POPULATION DRIFTED BETWEEN RUNS`,
exit 1, with the first differing tuple printed. The mechanism does what design's Review response and
apply's report both claim.

### Canary inversion — substance checked, not just expect-counts

- **Canary #1** (`test/application/search-documents-spans.test.ts`): `expect(` count 8 → 23 (`git
  show main:... | grep -c` vs current), confirming G1 (count must not decrease). Read the full body:
  the old `not.toContain("zulu")` became `toContain("zulu")` on the same expression; the old
  byte-identity-against-prefix assertion became byte-identity-against-the-windowed-reference; the old
  prefix reference is *kept* as a `not.toBe(...)` regression guard. This is a real inversion, not a
  deletion-and-replacement with a fresh, non-adversarial test.
- **Canary #2** (`test/application/index-and-search.test.ts`): `expect(` count 148 → 148 (unchanged,
  as apply reported). Diffed against `main` directly: the per-item loop assertion
  `expect(result.excerpt.startsWith("…")).toBe(false)` (asserted for *every* supporting result) was
  removed and replaced by `expect(supporting.some((r) => r.excerpt.startsWith("…"))).toBe(true)`
  outside the loop — a legitimate, design-acknowledged narrowing (per-item → existential), not
  silencing: the old code path is genuinely gone, and the new assertion is false pre-change and true
  post-change by construction. The one G4-permitted `+1 → +2` length weakening is present and
  commented with its reason, and nothing else in G4's banned-forms list was found.
- **Marginality check on Canary #2's `some(...)` (a named open risk in both the design and the
  verification brief)**: ran `node dist/cli.js --root ejemplos search "email duplicado" --k 5`
  directly against the current index. All **4 of 4** supporting fragments (ranks 1-4) start with
  `…` on this corpus state — not the "near-certain but not certain" 78.4%-corpus-wide estimate,
  observed comfortably clear of the 0-of-4 failure the design worried about. This is still a
  corpus-dependent, probabilistic assertion in principle (a future corpus edit could shift it), but it
  is **not currently marginal** — recorded so a future re-check has a real number rather than a
  restated worry.

### Spec compliance matrix (scenarios re-run to green, not accepted from the report)

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Supporting excerpts centred on match (ADDED) | Supporting fragment centres on the match, not the opening text | `search-documents-spans.test.ts > SearchDocuments — spans are computed for every rank > a supporting (non-rank-0) result's excerpt centres on the match, not a start-anchored prefix` | COMPLIANT |
| Supporting excerpts centred on match (ADDED) | No locatable term falls back to the start-anchored prefix | `vector-only-excerpt.test.ts > Gate 5` (pre-existing, untouched) + `search-documents-spans.test.ts`'s `not.toBe(prefix)` reference | COMPLIANT |
| Supporting excerpts centred on match (ADDED) | A term present only in a stripped heading is treated as unreachable | `search-documents-spans.test.ts > supporting-excerpt-anchoring — new spec scenarios > a term present only in a stripped heading is treated as unreachable, even at a supporting rank` | COMPLIANT |
| Truncation marked at either edge (MODIFIED) | A supporting fragment centred away from both edges carries both ellipses within its own budget | `search-documents-spans.test.ts > ... > a supporting fragment centred away from both edges carries both ellipses within its own budget` | COMPLIANT |
| Truncation marked at either edge (MODIFIED) | Window at start/end omits ellipsis; both-edges within budget (rank-1) | `excerpt.test.ts` (pre-existing Decision 3/5 unit tests, untouched — `computeWindow` frozen per design Decision 3) | COMPLIANT (unchanged coverage, confirmed still passing) |
| Match Selection Is Not Positional (RENAMED/MODIFIED) | High-frequency term near start does not win at rank 0 | `excerpt-window.test.ts` Gate 3 (pre-existing, untouched) | COMPLIANT |
| Match Selection Is Not Positional (RENAMED/MODIFIED) | The same preference holds for a supporting fragment | `search-documents-spans.test.ts > ... > the same preference for the distinctive term over an early high-frequency neighbourhood holds for a supporting fragment` | COMPLIANT |

**Compliance summary**: 7/7 scenarios compliant, each backed by a named passing test re-run in this
session (not by the report's transcript).

### Prose / contract claims — read directly, not grepped blindly

- `src/server.ts:119-121`'s middle literal now reads "...the rest carry short ones, centred on their
  own match, enough to tell whether the top result is the right one" — the false "start of their
  section" phrase is gone. `:123-125`'s ellipsis-contract sentence ("A '…' at either end of an
  excerpt marks content omitted there") is byte-identical to before. **Confirmed by direct read.**
- `AGENTS.md` no longer states supporting excerpts are start-anchored prefixes by default; §2's
  clause now says the 120-char budget is "spent the same way — a window centred on their own matched
  span", with the prefix reserved for the no-locatable-term fallback. The new "Manual gate
  (`supporting-excerpt-anchoring`)" section and the `matchedTerms` deferral bullet are both present.
  **Confirmed by direct read**, not by a keyword grep alone.
- **Non-touch claim** (`git diff --stat main..HEAD -- src/domain/flatten-map.ts
  src/domain/match-location.ts src/domain/ports.ts src/domain/fusion.ts src/infrastructure`):
  empty output, independently re-run. **Confirmed.**
- **Stale-citation fixes** (`src/domain/excerpt.ts:49`, `test/domain/excerpt.test.ts:123`,
  `test/application/vector-only-excerpt.test.ts:60/61`): diffed each against `main` — comment lines
  only, zero assertion or executable-code changes. **Confirmed.**
- **Must-not-touch citations**: diffed `src/composition.ts`, `src/domain/convention.ts`,
  `test/domain/convention.test.ts`, `test/application/read-document.test.ts`, `test/helpers/build.ts`
  against `main` — all byte-identical (empty diffs). `test/application/index-and-search.test.ts` has
  a real diff, but it is confined to the canary-inversion hunk (~line 190); the separate
  `multiple-doc-roots` Decision 7 citation at `:331` does not appear in the diff. **Confirmed.**

### Diffstat — independently recomputed

`git diff --stat main..HEAD -- src test scripts AGENTS.md`: **9 files changed, 559 insertions(+), 35
deletions(-) = 594 changed lines.** Matches apply's reported 594 exactly, recomputed rather than
copied.

### Strict TDD compliance — one format finding

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Partial | No single "TDD Cycle Evidence" table in the canonical RED/GREEN/TRIANGULATE/SAFETY-NET column format the generic skill template expects. Substance is present in a different, project-specific form: `tasks.md`'s phase structure explicitly sequences RED phases (1-3) before the GREEN phase (4), and `verify-report.md`'s "Apply's self-report" section below pastes each mandatory red-run's verbatim failure output (G2). |
| All tasks have tests | Yes | Every implementation task in `tasks.md` maps to a named test in the Traceability table, cross-checked above |
| RED confirmed (tests exist) | Yes | All named test files exist and were read in full this session |
| GREEN confirmed (tests pass) | Yes | `npm test`: 52/52 files, 914/914 non-skipped passing, re-run in this session |
| Triangulation adequate | Yes | 2 inverted canaries + 3 new spec-scenario tests, each targeting a distinct scenario with distinct fixture shapes (short lead vs. long tail, frequency-vs-distinctiveness, heading-vs-body) — no repeated trivial case |
| Safety Net for modified files | Yes | Full suite (914 tests) re-run after the production edit; nothing outside the two canary files' targeted assertions moved |

**Finding (WARNING, not CRITICAL)**: the apply/verify artifacts do not use the generic "TDD Cycle
Evidence" table format this skill's strict-TDD module names as the primary artifact. Downgraded from
the skill's literal CRITICAL default because the substance the table exists to prove — RED existed
before GREEN, GREEN is currently true, triangulation is real, the safety net ran — was independently
reproduced end-to-end in this session (see the red-run trap section above), not merely asserted. This
is a documentation-format gap, not a process gap: recommend `sdd-apply` adopt the canonical table in
future changes so this check does not require full manual reconstruction from prose narrative.

### Assertion Quality Audit (Step 5f)

Scanned every test file with changed or added assertions: `test/application/search-documents-spans.test.ts`
(inverted canary + 3 new tests, read in full), `test/application/index-and-search.test.ts` (inverted
canary), `test/domain/excerpt.test.ts`, `test/application/vector-only-excerpt.test.ts` (comment-only).

- No tautologies (`expect(true).toBe(true)` or equivalent).
- No assertions divorced from production code — every assertion follows a real
  `search.execute(...)` call against a real `SqliteIndexStore` (in-memory or the `ejemplos/` corpus).
- No ghost loops: the two `for (const result of supporting)` / iteration sites are both preceded by
  an assertion that the collection is non-empty (`results.length).toBeGreaterThan(1)` /
  `toBeGreaterThanOrEqual(2)`), so the loop body is guaranteed to execute at least once.
- No smoke-test-only patterns; every test asserts specific string content or byte-identity, not mere
  definedness.
- No CSS-class / implementation-detail coupling (not applicable — no UI in this test layer).
- No mocks used in any of the changed test files (real in-memory SQLite + real `SearchDocuments`), so
  the mock/assertion ratio check does not apply.

**Assertion quality**: All assertions verify real behavior. 0 CRITICAL, 0 WARNING.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 3 new spec-scenario tests + 1 inverted canary #1, in-memory store | 1 | Vitest, `better-sqlite3` in-memory |
| Integration | 1 inverted canary #2, real `ejemplos/` corpus + fake embeddings | 1 | Vitest, `test/helpers/fake-embeddings.ts` |
| E2E | 0 | 0 | — |
| **Total** | **5 new/changed behavior assertions**, within a 914-test suite | 2 | |

### Coverage / Quality Metrics

`openspec/config.yaml` declares `lint_command: null`, `coverage_command: null` — matches `AGENTS.md`'s
"no lint script configured". Coverage analysis skipped — no coverage tool detected. Linter: not
available. Not flagged as a failure per the skill's own rule.

---

## Issues Found (this phase's independent judgment)

**CRITICAL**: None.

**WARNING**:
1. No canonical "TDD Cycle Evidence" table in the generic format this skill's strict-TDD module
   expects — substance independently reconstructed and confirmed (see above), but the format gap
   would force full manual reconstruction on every future change unless `sdd-apply` adopts the table.
2. Canary #2's `some((r) => r.excerpt.startsWith("…"))` assertion remains a corpus-state-dependent,
   probabilistic check by construction (design's own recorded risk). Currently measured comfortably
   non-marginal (4-of-4 on the live query, against a 78.4% corpus-wide base rate), but a future
   `ejemplos/` corpus edit could flip it to 0-of-4 without any production regression — the documented
   mitigation (move to another goldenset query, record both) is sound but untested since it has never
   had to fire.
3. `openspec/changes/.../specs/mcp-contract/spec.md`'s delta is a destructive delta (one REMOVED
   requirement stating the exact opposite of the new one, plus one RENAMED requirement) — flagged
   inside the spec file itself for `rules.archive`'s warning, and not yet merged into
   `openspec/specs/`. This is `sdd-archive`'s job, not a defect, but it must not be missed at archive
   time (surfaced here so the risk is not silently dropped between phases).

**SUGGESTION**:
1. `AGENTS.md`'s "Manual gate" prose documents the gate well but, like every sibling manual gate in
   this file, is not automated in CI — it depends on a human (or the next SDD cycle) actually running
   it before trusting a future chunking/excerpt change. No action needed now; recorded because this
   file's own convention is to name this trade-off explicitly for every gate.
2. The `matchedTerms` deferral is now correctly recorded as "deferral count: 1" against the
   `isFenceDelimiter` precedent's "three strikes" rule — worth a passive watch at the next change that
   touches `SearchResultItem`, not an action here.

---

## Apply's self-report (retained as claims — see the process note above for why these are claims, not evidence, in this file)
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

---

## Final Verdict

**PASS WITH WARNINGS.**

Every gate (A, B, C, D, E), every canary inversion, every new spec-scenario test, the digest-based
population-identity mechanism, and the prose/citation claims were independently re-derived in this
session against the live tree — not accepted from apply's or the orchestrator's prior reports. All
independently reproduced numbers match the design's predictions and apply's transcript exactly,
including the deliberately-adversarial red run against a manually reverted production line (the
correct method, not the `git checkout main` false-pass shortcut this same change's history already
recorded once). No CRITICAL finding. Three WARNINGs are recorded above — a documentation-format gap
in the TDD evidence table, a corpus-dependent probabilistic assertion that is currently healthy but
unproven under future corpus drift, and a destructive spec delta that `sdd-archive` must not miss —
none of which reflect code that is broken or unverified, only risk that should stay visible rather
than be quietly absorbed.
