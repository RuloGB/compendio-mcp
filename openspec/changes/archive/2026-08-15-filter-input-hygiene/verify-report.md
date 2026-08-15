# Verify Report: Filter Input Hygiene

**Verdict: PASS**

Independent verification, not a review of apply-progress.md's claims. Every finding below was
checked against the code and the running test suite directly. Git state was restored after each
mutation used to test a hypothesis (documented under "Mutations performed and restored").

## Commands run, actual output

### npm test

```
 RUN  v4.1.10 C:/Users/Raul/Workspace/compendio-mcp

 Test Files  48 passed (48)
      Tests  768 passed (768)
   Start at  19:16:37
   Duration  13.29s (transform 4.21s, setup 0ms, import 16.34s, tests 20.79s, environment 10ms)
```

### npm run typecheck

```
> compendio-mcp@1.3.2 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
```
Clean exit, no diagnostics.

### npm run build

```
> compendio-mcp@1.3.2 build
> tsc
```
Clean exit, no diagnostics.

## 1. Scenario-by-scenario mapping (spec.md, 2 requirements, 6 scenarios)

| # | Scenario | Covering test | Verdict |
|---|---|---|---|
| 1 | Empty or whitespace-only module is treated as absent | Gate 1 (case A) test, index-and-search.test.ts lines 582-605 | Matches exactly. Asserts module: "" and module: "   " both deep-equal the module-omitted call |
| 2 | Module matching is case-preserving, never lowercased | Gate 4 test, lines 625-651. module: "identity" against a document declaring "Identity" returns [] | Matches exactly |
| 3 | A blank module filter against a module-less corpus produces no configuration advice | Gate 3 (case B) test, lines 607-623 | Matches exactly, including the precondition that pins the module-less shape |
| 4 | A tag with surrounding whitespace matches its stored form | Gate 2 test, lines 658-686, the padded assertion | Matches exactly |
| 5 | A mixed array keeps valid entries and drops blank ones | Same test, the mixed assertion (tags: ["api", "  "]) | Matches exactly |
| 6 | An array that becomes empty after trimming is treated as absent | Gate 2 corollary test, lines 688-698 | Matches exactly |

All 6 scenarios have a covering test, and each test asserts what the scenario states, not
something adjacent. No orphan scenario, no test asserting a weaker or different claim.

## 2. Module-less-corpus hazard

Checked. Gate 1's test (line 591) asserts
expect(collectFacets(store.listDocuments()).modules).not.toEqual([]) as a precondition,
before trusting the "before" behavior it claims to reproduce. Gate 3's test (line 615) pins
the opposite: .toEqual([]). Both preconditions are real assertions, not comments, and both were
observed to hold when I reproduced the RED state myself (section 4 below). This closes the hazard
the task brief warned about.

## 3. Tags seeding hazard

Checked, and reproduced independently. seedDoc (index-and-search.test.ts:520-550) throws when
normalizeTags(tags).join(" ") !== tags.join(" ") — a real "throw new Error(...)", not a comment.
I verified the throw actually fires by evaluating the guard expression against the three relevant
inputs with npx tsx against the real src/domain/tags.ts:

```
non-canonical [" api"] wouldThrow: true
canonical ["api"] wouldThrow: false
mixed ["api","  "] wouldThrow: true
```

So a test seeding tags: [" api"] (the exact hazard case named in the brief) is rejected at the
seed, not silently accepted. No test in the shipped suite attempts this seed (correctly — the
canonical form tags: ["api"] is what's seeded, and the padding is applied only in the query, not
the seed), so the throw exists as a structural guard against a future regression rather than being
exercised by name in this suite. That is exactly what the design specifies (Decision 6): the
mitigation is that a bad seed cannot be written silently, not that one is demonstrated failing.

## 4. Reproduced the RED state independently

Checked out src/application/search-documents.ts from main into the working tree
(git checkout main -- src/application/search-documents.ts), leaving everything else
(including the new gate tests) at the fix's state, and ran the new gate tests against it:

```
npx vitest run test/application/index-and-search.test.ts -t "Gate"
 Test Files  1 failed (1)
      Tests  4 failed | 5 passed | 38 skipped (47)
```

The four failures were exactly Gates 1, 3, 2, and the Gate-2 corollary, with diffs matching
apply-progress.md's recorded "before" strings verbatim:

- Gate 1: noMatchReason containing: no document has module "" (declared: "identity", "leads").
- Gate 3: filterWarning containing: Ignored the "module" filter ... convention.frontmatterFields ...
- Gate 2: noMatchReason containing: no document carries " api" (declared: "api").
- Gate 2 corollary: noMatchReason containing: no document carries "" (declared: "api").

Gate 4 (module case-preservation etc.) passed even pre-fix, as expected — it tests invariants
that were never broken.

Restored immediately after: git checkout HEAD -- src/application/search-documents.ts.
Confirmed via git status --short that the working tree returned to clean (only the
pre-existing untracked sibling-change directories and code-review-src-2026-08-14.md remain,
none of which belong to this change). Re-ran the gate tests post-restore: 9 passed | 38 skipped.

## 5. Two declared tripwires

- git diff main -- src/cli.ts -> empty. Confirmed by reading the diff output directly (no
  output at all), not by counting lines.
- git diff main -- test/domain/frontmatter.test.ts -> empty. Confirmed the same way.
- As a corollary, test/domain/frontmatter.test.ts run in isolation: 11 passed (11), matching
  apply-progress.md's claim exactly.
- Also checked (not explicitly requested, but load-bearing on the same claim):
  git diff main against src/server.ts, src/domain/search-diagnostics.ts,
  src/infrastructure/sqlite/sqlite-index-store.ts, test/domain/search-diagnostics.test.ts,
  test/cli.test.ts -> empty for all five, matching every "byte-unchanged" claim in
  apply-progress.md.

Both tripwires hold.

## 6. The scope addition (src/domain/tags.ts)

resolveTags (src/domain/frontmatter.ts:30-37) now delegates:
  return { tags: normalizeTags(raw) };
normalizeTags (src/domain/tags.ts):
  values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0)
This is character-for-character identical to resolveTags' pre-fix inline expression
(raw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0), quoted in the proposal).
Behavior preservation is genuine, not just asserted — confirmed by the frontmatter.test.ts
falsifier (11/11, zero edits) and by direct comparison of the two expressions.

buildFilters delegates to the same function (search-documents.ts:5,144). Both call sites
confirmed by reading the import and call sites directly.

Separable revert: confirmed via git log. The scope addition is two standalone commits —
8661c6d (feat(domain): add shared tag normalization, touches only src/domain/tags.ts +
test/domain/tags.test.ts) and 95dc630 (refactor(domain): delegate resolveTags to
normalizeTags, touches only src/domain/frontmatter.ts) — both strictly before and independent
of c5262b1 (fix(search): normalize module and tags filters in buildFilters, the behavioral
fix). Reverting the first two alone (and inlining the 2-line expression back into buildFilters,
exactly as design.md's Open Question 1 describes) would not touch the query-side fix. This matches
the design's own stated reversal path.

## 7. Case B — no configuration advice on a blank filter against a module-less corpus

Confirmed. Gate 3's test (index-and-search.test.ts:607-623) seeds a corpus with no module on
either document, pins collectFacets(...).modules to [] as a precondition, then asserts
blank (the module: "" call) deep-equals omitted (the module-omitted call) — which by
construction has no filterWarning field, since dropImpossibleFilters never fires when nothing
is filtered. Independently reproduced RED in section 4 shows the pre-fix filterWarning naming
convention.frontmatterFields was real; the post-fix response carries no such field.

## 8. Silence, as decided

Checked filterWarning's only production write site: search-documents.ts:70,
retry.filterWarning = describeDroppedFilters(droppedFields), reached only through
dropImpossibleFilters when droppedFields.length > 0. Since buildFilters now omits blank
module/tags/type from SearchFilters entirely (never sets them to "" or []), they never
reach dropImpossibleFilters as a declared-but-unmatchable filter, so filterWarning is never
emitted for a blank-filter normalization. Grepped src/ for every filterWarning write: exactly
one, and it is unrelated to this change's normalization path. No new noMatchReason string was
added either — confirmed by reading explainEmptyResult and search-documents.ts in full; no
new diagnostic branch exists. Matches Q2's settled answer: silent, no third variant.

## Mutations performed and restored

One mutation was made to test the RED-state claim (section 4): src/application/search-documents.ts
was checked out from main, gate tests were run against it, and the file was restored via
git checkout HEAD -- src/application/search-documents.ts immediately after. git status --short
confirmed the working tree returned to its original state (only the three untracked,
out-of-scope sibling-change artifacts remain, unrelated to this change). No other file was
modified during verification.

## Findings

None rise to CRITICAL or WARNING. Two SUGGESTION-level observations, neither blocking:

1. SUGGESTION — No test in the shipped suite exercises seedDoc's canonical-tags throw by
   name (e.g. expect(() => seedDoc(..., { tags: [" api"] })).toThrow()). The guard is real and
   was confirmed firing by direct evaluation of its expression (section 3), but a one-line
   it("seedDoc rejects a non-canonical tag seed") would make that guarantee self-evident to a
   future reader without requiring an external check like the one this report performed. Not
   blocking: the design explicitly frames this as a structural guard against a future mistake, not
   a behavior under test today, and the guard was independently confirmed to work.
2. SUGGESTION — apply-progress.md's GREEN evidence quotes "47 passed (47)" for
   index-and-search.test.ts run in isolation; the full-suite run performed here reports the same
   file contributing correctly within "768 passed (768)" — consistent, just noting the isolated
   count was not independently re-verified beyond the RED/GREEN gate-only reruns already reported
   above ("9 passed | 38 skipped" for the -t "Gate" filter, which is a subset).

## Tasks vs. code state

All 22 checked tasks in tasks.md correspond to code and test artifacts that actually exist and
behave as described:
- Phase 1 (normalizeTags): present, tested, matches.
- Phase 2 (resolveTags delegation): present, frontmatter.test.ts unmodified and green.
- Phase 3 (buildFilters fix + gates): present, matches design.md's Decision 7 line-for-line
  (normalize first, then check length — confirmed by reading the shipped buildFilters body).
- Phase 4 (contract docs): SearchFilters and SearchQuery comments promoted to interface level
  as described; search-diagnostics.ts/server.ts/cli.ts/sqlite-index-store.ts confirmed
  byte-unchanged.
- Phase 5 (spec + CLAUDE.md): spec delta matches shipped behavior; one CLAUDE.md entry added,
  read in full, accurately describes the chokepoint.
- Phase 6 (final verification): npm test/typecheck/build independently re-run, all green;
  git diff confirmed additions-only on test files (the seedDoc widening adds optional
  parameters and one guard, does not modify any existing assertion).

No discrepancy found between what apply-progress.md claims and what the repository actually
contains.

## Verdict

PASS. All 6 spec scenarios are covered by tests that assert exactly what the scenario states.
Both named false-green hazards (module-less-corpus, dirty tag seed) are closed structurally, not
just by comment, and both were independently confirmed rather than taken on trust. The RED state
was reproduced firsthand and matches the recorded evidence verbatim. Both declared tripwires
(cli.ts, frontmatter.test.ts) are empty diffs against main. The scope addition
(src/domain/tags.ts) is genuinely behavior-preserving and cleanly revertible on its own. Case B
produces no configuration advice. The implementation is silent on blank-filter normalization, with
no new diagnostic variant. npm test (768/768), npm run typecheck, and npm run build all pass
cleanly under independent re-execution.
