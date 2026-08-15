# Verify Report: overview-counter-safety

Phase: verify. Artifact store: openspec (Engram unavailable this cycle).
Branch: fix/overview-counter-safety. Verified independently, not from apply-progress.md claims alone.

## Verdict: PASS

No CRITICAL or WARNING findings. One SUGGESTION (non-blocking). All 5 spec scenarios are covered by
tests that assert what the scenario says, the fix uses the correct (defining, not assigning)
conversion, the anti-vacuity guard is present and empirically confirmed load-bearing, the forbidden
predicate is absent from all live assertions, the two pre-existing test files are confirmed unmodified
via git diff main, and the "strongest trap" (a corpus whose only type/module is the hostile value,
which renders byte-identical to a genuinely empty corpus pre-fix) is genuinely distinguished by the
shipped gates via direct value/descriptor assertions.

## Commands run, actual output

### npm test
```
 Test Files  47 passed (47)
      Tests  765 passed (765)
   Duration  12.89s
```

### npm run typecheck
```
> tsc --noEmit && tsc -p tsconfig.test.json
(no output -- clean)
```

### npm run build
```
> tsc
(no output -- clean)
```

### git diff --stat main -- src/ test/ CLAUDE.md
```
 CLAUDE.md                             |   1 +
 src/application/get-overview.ts       |  26 +++-
 test/application/get-overview.test.ts | 257 ++++++++++++++++++++++++++++++++++
 3 files changed, 278 insertions(+), 6 deletions(-)
```
Well under the ~80-180 forecast band's upper bound and the 400-line exception threshold. No
size:exception needed, matching apply-progress's own accounting.

## Independent evidence -- not taken on trust

### 1. Reproduced the RED state myself
Checked out src/application/get-overview.ts at the commit immediately before the fix (d613b9c^),
ran `npx vitest run test/application/get-overview.test.ts` against it:

```
Test Files  1 failed (1)
     Tests  7 failed | 20 passed (27)
```

The 7 failures are exactly the ones apply-progress claims (Scenarios 1-5, Gate 1b hostile-corpus
case, Gate 2 twin-corpus differential), for exactly the stated reasons:
- descriptor undefined for __proto__ (Scenarios 1, 3)
- typeof received "string" vs expected "number" for constructor, with the actual received value
  "function Object() { [native code] }1" (Scenarios 2, 4)
- self-consistency mismatch: rendered By type: line lacks "__proto__ (1)" while the per-document
  segment shows it (Gate 1b)
- By module: line entirely absent for the hostile corpus (Gate 2)

File restored with `git checkout HEAD -- src/application/get-overview.ts` immediately after;
`git status --porcelain` confirmed clean before continuing, and the full suite (765/765) was re-run
green afterward.

### 2. Confirmed the anti-vacuity guard is load-bearing, not decorative
Per the task's specific instruction, I mutated test/application/get-overview.test.ts's
assertByTypeSelfConsistency helper (temporarily) to force docLines = [] (simulating a broken
line-parse) and ran only that describe block:
- With the guard (expect(docLines.length).toBe(overview.documents.length)) present: both tests in
  that block failed (expected +0 to be 3 / expected +0 to be 2) -- the guard caught the broken
  parse immediately.
- With the guard line removed (mutated to a comment): the same broken-parse helper made both tests
  pass (2/2 green) -- a helper that parses zero lines is vacuously "self-consistent" without it.

This directly confirms design.md Decision 5's claim that the guard is what keeps the gate from being
noise. File restored via `git checkout HEAD -- test/application/get-overview.test.ts` immediately
after each mutation; `git status --porcelain` confirmed clean, full suite re-run green (765/765).

## Scenario-by-scenario mapping (spec specs/mcp-contract/spec.md)

| # | Scenario | Test | Verdict |
|---|---|---|---|
| 1 | __proto__ type not silently dropped | get-overview.test.ts:321 "counts a __proto__ type value as a genuine own entry, not an omitted bucket (Scenario 1)" | Matches exactly -- asserts the returned object has a real data-property descriptor with value: 1, and the render contains "__proto__ (1)" |
| 2 | constructor type renders as a count, not garbled text | :337 "counts a constructor type value as a number, not garbled function source text (Scenario 2)" | Matches exactly -- asserts typeof === "number", value 1, render contains "constructor (1)", render does not contain "native code" |
| 3 | __proto__ module via folder name | :354 "...reached via a folder name through the production route... (Scenario 3)" | Matches exactly, and stronger than the spec's minimum: uses createConventionPolicy(...).resolver against a plain path string (no fixture directory on disk), confirms meta.module === "__proto__" genuinely came from the production inferModule route before seeding the store |
| 4 | constructor module via folder name | :381 "...(Scenario 4)" | Matches exactly, same production-route pattern |
| 5 | Hostile value does not affect an ordinary value's count | :407 "does not let a __proto__/constructor type affect an ordinary value's count in the same corpus (Scenario 5)" | Matches -- mixed corpus (__proto__, constructor, guide), asserts all three counts independently correct. Spec Scenario 5 only requires byType; the test does not extend this to byModule, which is fine since the spec itself is byType-only here |

No scenario is uncovered or covered by an adjacent-but-different assertion.

## Specific checks (per the verify brief)

1. Scenario mapping -- done above, all 5 match precisely.

2. Object.fromEntries, not an assigning loop -- confirmed by reading
   src/application/get-overview.ts:59-73 directly: the return statement uses
   `byType: Object.fromEntries(byType)` and `byModule: Object.fromEntries(byModule)`.
   Byte-for-byte match to design.md Decision 1's normative block, including both comments (the
   accumulator-hazard comment and the "Do NOT simplify" conversion comment). No assigning loop
   anywhere in the diff.

3. Anti-vacuity guard present and load-bearing -- present at
   test/application/get-overview.test.ts:442 (expect(docLines.length).toBe(overview.documents.length)).
   Empirically confirmed load-bearing above (mutation test): without it, a helper parsing zero lines
   passes vacuously.

4. Forbidden predicate absent from live assertions -- grepped the whole repo for
   hasOwnProperty('__proto__') === false. It appears only inside prose/comments in tasks.md,
   design.md, proposal.md, and the test file's own comment block explicitly marking it forbidden
   (test/application/get-overview.test.ts:291-295) -- never as a live expect(...) call anywhere in
   src/ or test/.

5. Gate 4 -- two pre-existing test files unmodified:
   - `git diff main -- test/application/index-and-search.test.ts` returns an empty diff, file
     untouched.
   - `git diff main -- test/application/get-overview.test.ts` diff is additions only: two new
     import lines, one new LOOSE const, and 257 new lines appended after the last pre-existing
     describe block. Every pre-existing line/assertion is byte-identical, confirmed by reading the
     diff hunk headers (@@ -1,10 +1,17 @@ touches only the import block; @@ -250,3 +257,253 @@ is a
     pure append at the end of file).

6. The __proto__-only-corpus trap -- genuinely distinguished, not vacuous. Scenario 1's test (:321)
   and Scenario 3's test (:354) each seed a corpus whose only declared type/module value is the
   hostile one (single document). Pre-fix, this corpus is provably byte-identical in its rendered
   output to a genuinely empty-taxonomy corpus (formatCounts returns null in both cases -- confirmed
   by the independent pre-fix run above, where Scenario 1's test failed with
   "expected undefined to be defined" rather than a render-string mismatch, i.e. the bucket is
   structurally absent, not just differently formatted). These two tests do not rely on comparing
   against a second corpus to detect the loss -- they assert the exact expected value/descriptor
   directly against the single hostile corpus, which is a strictly stronger discriminator than a
   before/after diff and is not fooled by formatCounts's null-on-empty behavior. The byModule
   twin-corpus differential (Gate 2) additionally covers the same single-hostile-value shape
   (hostileStore seeds exactly one document with module: "__proto__") using the differential pattern
   design.md describes. Both approaches independently close the trap.

## apply-progress.md's tasks.md-defect diagnosis -- assessed, found correct

The claim: tasks.md 2.1-2.4, as literally worded, assert the absence of the hostile bucket and
expect that assertion to fail pre-fix -- but on the actual pre-fix runtime (Annex B [[Set]] against
a non-object value through the __proto__ accessor is a silent no-op), that absence assertion is true
pre-fix, so it would pass immediately rather than fail, triggering tasks.md's own declared STOP
condition.

I did not take this on trust. The pre-fix RED run performed independently above used the tests
actually committed (which assert the spec-required presence, matching design.md's Testing Strategy
table's "After" row) and confirmed all 7 assertions genuinely fail pre-fix and pass post-fix --
consistent with the diagnosis. Separately, plain-object property assignment via the __proto__
accessor with a non-object RHS being a silent no-op (never creating an own property) is standard,
well-documented ECMAScript Annex B.3.1 behavior, independent of this repo -- the diagnosis is not a
novel or dubious claim, it is a correct application of a known language quirk that this repo's own
design.md traces in its ASCII diagram and that matches what I observed directly.

The substitution made (asserting presence plus correct type/value, matching
specs/mcp-contract/spec.md's literal wording -- "includes a __proto__ (1) entry, not an omitted
bucket") is sound: it is what the spec's acceptance criteria actually require, and treating the spec
as authoritative over a tasks.md wording defect is the correct resolution per the apply skill's
stated precedence rule. This is noted as a deviation, not silently made -- apply-progress.md
documents it prominently with the empirical node -e proof, and the note itself does not change what
the design or spec require.

## Framing check

PASS. Grepped for "prototype pollution" / "security" / "attacker" / "exploit" / "CVE" across src/,
test/application/get-overview.test.ts, and the added CLAUDE.md clause. The only occurrence inside
runtime/test code is test/application/get-overview.test.ts:262-263's own comment explicitly stating
"data-integrity, not security... so a later reader cannot re-file this change as a security fix" --
the opposite of overselling. The CLAUDE.md clause added is neutral, mechanism-only prose ("never
lost or garbled by the string value it is keyed by... accumulated in a Map... converted... with
Object.fromEntries") with no security-vocabulary overreach. proposal.md and design.md explicitly and
repeatedly disclaim prototype-pollution framing with measured evidence (Object.prototype provably
untouched, Gate 3). No finding.

## Tasks vs code state

All 24 tasks in tasks.md are marked [x]. Spot-checked against actual code/test state (not just the
checkbox) for every task category: Task 1 (Gate 3) present and passes both pre/post-fix (verified
structurally -- Gate 3 does not depend on the accumulator implementation, only on Object.prototype's
own integrity, which neither the buggy nor fixed code ever touches). Tasks 2/3 (red/green) verified
independently via the pre-fix checkout above. Task 4.1-4.3 (Gate 1b, Gate 2, Gate 4) verified by
reading the code and by git diff. Task 5 (CLAUDE.md clause) verified by
`git diff main -- CLAUDE.md`. Task 6 (final verification, diff-stat, commit sequencing,
unrelated-file check) verified independently above -- git diff --stat matches apply-progress's
reported numbers exactly, and
`git diff main -- src/domain/convention.ts src/server.ts src/cli.ts src/composition.ts openspec/specs/mcp-contract/spec.md`
returned no output, confirming all five files apply-progress claims as untouched genuinely are
untouched relative to main.

Commit sequence (git log --oneline -5) matches tasks.md 6.3's plan:
```
d88434a docs(sdd): add overview-counter-safety change artifacts
6c96002 docs: note docs_overview bucket-value safety in CLAUDE.md
d613b9c fix(application): make GetOverview's byType/byModule accumulation safe for any key value
c35256b test(application): pin GetOverview prototype-integrity as non-regression (Gate 3)
```

## SUGGESTION (non-blocking)

Spec Scenario 5 is byType-only; the implementation and Decision 1's fix are symmetric across
byType/byModule, and Gate 2's twin-corpus differential already covers a mixed-value question for
byModule indirectly (control vs. hostile, not a true 3-way mix). There is no test seeding a single
corpus with module: "__proto__", module: "constructor", and an ordinary module value together, the
way Scenario 5's test does for byType. This is not a spec gap (the spec's own Scenario 5 only
requires it for byType), so it is not a finding against the contract -- but a future editor extending
this pattern to a new field should know the byModule 3-way-mix case is inferred from symmetry with
byType, not directly tested.

## Files reviewed / commands run (paths)

- openspec/changes/2026-08-15-overview-counter-safety/specs/mcp-contract/spec.md
- openspec/changes/2026-08-15-overview-counter-safety/tasks.md
- openspec/changes/2026-08-15-overview-counter-safety/apply-progress.md
- openspec/changes/2026-08-15-overview-counter-safety/design.md
- openspec/config.yaml
- src/application/get-overview.ts
- test/application/get-overview.test.ts
- CLAUDE.md (diff only)
- git diff main -- test/application/index-and-search.test.ts (empty -- confirmed unmodified)

No file was left mutated: both temporary mutations (implementation checkout to pre-fix commit; test
helper anti-vacuity-guard removal) were reverted with `git checkout HEAD -- <path>` immediately after
use, each confirmed clean via `git status --porcelain`, and the full suite was re-run green after each
restoration.
