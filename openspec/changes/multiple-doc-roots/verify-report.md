# Verification Report

**Change**: multiple-doc-roots
**Version**: N/A (openspec deltas, not yet merged into base specs - merge happens at archive)
**Mode**: Strict TDD

## Scope of this verification

This change ships as a 4-PR chain. PR 1, PR 2, and PR 3 (tasks.md Phases 1-13) are implemented
and are verified rigorously below. PR 4 (Phases 14-17 - combined INDEX.md, read_doc tolerance
tests, scripts/vector-reach.mjs, README/CLAUDE.md) is deliberately not started, exactly as
apply-progress.md records. Its requirements are reported as outstanding-by-plan, not as
defects.

Artifact store this cycle: openspec (file-based). Engram MCP tools were confirmed unavailable
again this batch - no mem_* calls made.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total (whole 4-PR chain) | 70 |
| Tasks complete (PR 1-3, Phases 1-13) | 51/51 |
| Tasks incomplete (PR 4, Phases 14-17) | 19/19 - not started, by design (base branch for the next sdd-apply batch) |

PR 1-3's 51/51 checkboxes in tasks.md were spot-checked against the actual repository state, not
taken on trust - see "Cross-checks performed" below for what was independently re-derived.
## Build & Tests Execution

**Build**: PASS
```text
$ npm run build
> compendio-mcp@1.2.9 build
> tsc
(no output, exit 0)
```

**Typecheck**: PASS
```text
$ npm run typecheck
> compendio-mcp@1.2.9 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
(no output, exit 0)
```

**Tests**: PASS - 639 passed / 0 failed / 0 skipped
```text
$ npm test
 Test Files  43 passed (43)
      Tests  639 passed (639)
   Duration  7.36s
```
Matches apply-progress.md's claimed final count exactly (identity), re-run independently rather
than quoted.

**Coverage**: Not available - no coverage tool configured in this project (vitest.config.ts has
no coverage provider wired, no --coverage script). Reported cleanly per Strict TDD module rules,
not treated as a failure.

## Manual Gates - re-measured independently, not quoted from apply-progress

### Gate 1 - goldenset identity, before/after re-addressing

Indexed ejemplos/ fresh (model cache warm, no download):
```
node dist/cli.js --root ejemplos index
Indexed 11 documents (29 chunks) in 3335 ms [mode hybrid]
```
All 11 paths carried the docs/ prefix, same set/count as pre-change + docs/.

**Before** (goldenset.yaml swapped to its pre-2f6e1de content via git show 2f6e1de^:..., then
restored):
```
mode      recall@5   MRR      failures
--------------------------------------
hybrid    0.00       0.000    22
lexical   0.00       0.000    22
```
Independently reproduces the design's predicted MRR 0.000 / recall 0.00 exactly, and matches
apply-progress.md's claim.

**After** (real, re-addressed goldenset restored):
```
mode      recall@5   MRR      failures
--------------------------------------
hybrid    1.00       0.943    0
lexical   0.95       0.856    1
```
Identity with CLAUDE.md's documented pre-change baseline (hybrid MRR 0.943) and with
apply-progress.md's figures. git status confirmed clean after restoring ejemplos/goldenset.yaml
via git checkout --; no leftover diff.

### Gate 2c - the motivating case, on this repository

Temporary compendio.config.json ({ "docsDir": ["docs","openspec"], "exclude": ["INDEX.md",
"openspec/changes/archive"] }), compendio index --lexical, then queried .compendio/compendio.db
directly with better-sqlite3:
```
Indexed 17 documents (299 chunks)
archived count (path LIKE 'openspec/changes/archive/%'): 0
total: 17
unprefixed rows (path NOT LIKE 'docs/%' AND NOT LIKE 'openspec/%'): []
```
Zero archived paths (would read 79 if exclude matched the wrong path - the Approach 5 failure
mode). Every path prefixed. Temp config and .compendio/ deleted afterward; git status confirmed
clean.

### Gate 3 - module is a folder signal, not a root name

Same run's overview output:
```
node dist/cli.js overview
By module: transversal (1), changes (9), specs (6)
```
Byte-identical to apply-progress.md's PR 3 transcript. Verified byModule has no docs/openspec
bucket (true), and cross-checked which document sits at module IS NULL directly via SQL:
openspec/testing-capabilities.md - a root-level file under openspec/ with no frontmatter,
correctly inferring no module.

**Finding - see WARNING #2 below.** apply-progress.md's PR 3 manual verification narrative
attributes the "root-level, no module" case to docs/documentation-convention.md. That is incorrect:
docs/documentation-convention.md carries pre-existing frontmatter module: transversal
(confirmed pre-dating this change via git log -p), which correctly wins over inference (per the
"Frontmatter wins over inference" requirement) - it is not the file demonstrating the no-module
case. The real demonstrating document is openspec/testing-capabilities.md. The reported counts
(17 total, transversal(1)/changes(9)/specs(6), no docs/openspec bucket) are all correct and
independently reproduced; only the prose attribution of which specific document is wrong. The
underlying implementation is correct - confirmed both by this direct SQL query and by the isolated
unit test (IndexDocuments - alias-aware module inference across roots, index-and-search.test.ts)
which uses a synthetic fixture free of this confound.
### Gate 4b - the silent-data-loss guard (empirically re-falsified, not taken on trust)

Per the task's explicit instruction, flipped the property under test rather than trusting the
apply-progress claim:

```
$ git status --short   # clean before
$ sed -i 's/path: root\.prefix,/path: root.declared,/' src/infrastructure/fs/composite-document-source.ts
$ npx vitest run test/infrastructure/composite-document-source.test.ts
FAILED: "a failed root's ReadError.path is its ALIAS, never its declared string..."
   Expected: "docs"  Received: "packages/app/docs"
$ npx vitest run test/application/sync-index.test.ts -t "Gate 4b"
FAILED: "end to end through the real CompositeDocumentSource over a nested, differently-aliased root..."
   AssertionError: expected [ 'docs/a.md', 'docs/nested/b.md' ] to deeply equal []
$ git checkout -- src/infrastructure/fs/composite-document-source.ts
$ git status --short   # clean after
$ npx vitest run test/application/sync-index.test.ts test/infrastructure/composite-document-source.test.ts
 Test Files  2 passed (2)
      Tests  28 passed (28)
```

Confirmed genuine, not a vacuous or reasoning-only claim. Breaking root.prefix -> root.declared
in composite-document-source.ts makes exactly two tests fail - the direct unit assertion in
composite-document-source.test.ts and the end-to-end assertion wired through the real composite in
sync-index.test.ts's Gate 4b block - while the two other Gate 4b tests (which hand-construct
readErrors directly and don't exercise production code) correctly stay green, as expected. Property
restored, git status confirmed clean both before and after.

## Cross-checks performed (source inspection + git history, not inferred)

1. The un-skip is honest (instruction point 2). git log -p on
   test/application/index-and-search.test.ts across 2f6e1de (PR 2, parks the test) and 13d4ae2
   (PR 3, restores it) shows: the PR 3 diff touches only the it.skip(...) -> it(...) line and
   removes the deviation comment block - the test body (filter by module: "informes", assert every
   result's path starts with the module folder) is untouched by that commit. Diffed the test body
   itself against its pre-PR-2 form (before 2f6e1de): identical assertion structure, only the
   literal path gained the docs/ prefix (informes/ -> docs/informes/), consistent with
   Decision 14's "addresses only" scope. Not weakened.

2. Collision guard coverage (instruction point 3). Confirmed dedicated tests exist for: nested
   outer-first, nested inner-first (the one-directional-sweep escape), duplicate, case-differing
   duplicate (it.skipIf(process.platform !== "win32")), and alias clash - at both the
   resolveRoots unit level (test/infrastructure/config.test.ts, 12 cases) and the container level
   (test/composition.test.ts, 7 cases). Gap found: no test exists anywhere in the suite for the
   ".."-prefixed nested-directory-name edge case (docs vs docs/..cache) that design.md's P1
   section specifically measured and reasoned about (relative('C:\A\docs','C:\A\docs\..cache') ->
   "..cache"). The implementation code is correct - verified by direct inspection of
   config.ts:198: !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`), the strict
   form the design called for - but this specific case has zero automated coverage. See WARNING #1.

3. No architectural leakage (instruction point 4). grep "^import" across every file in
   src/domain/ shows every import resolves to another file inside src/domain/ - zero SQLite,
   transformers.js, or filesystem imports. inferModule(path, rootPrefixes?: readonly string[]) and
   createConventionPolicy(cfg, rootPrefixes?) receive the alias list purely as data (a plain
   readonly string[] parameter threaded from composition.ts), never as an infrastructure import.

4. Declared deviations (instruction point 5) - all four checked and confirmed real, harmless, and
   honestly described:
   - The naive-inferModule intermediate state surfacing in index-and-search.test.ts (skipped) and
     read-document.test.ts (single assertion updated) - confirmed via git log -p on both files;
     the choice of skip-vs-update is justified (skip avoids a vacuous pass where every document would
     share the same inferred value; update preserves real, unrelated coverage in the same test).
   - read-document.test.ts's inverted test premise - confirmed read-document.ts itself has zero
     diff across the whole PR 1-3 chain (git diff HEAD~4 -- src/application/read-document.ts is
     empty), matching Decision 12's "a test, not an edit."
   - The two extra files (test/fixtures/strict/compendio.config.json,
     test/cli-subprocess.test.ts) - both confirmed real and necessary: the fixture's docsDir was
     still the pre-array-only string form (rejected unconditionally by resolveRoots), and the CLI
     subprocess test's three literal assertions (docs/guide-service-onboarding.md,
     docs/test-plan-inventory-alerts.md x2) are confirmed present and correctly prefixed.
   - The 29-vs-26 literal recount - consistent with the design's own corrected figure; low
     materiality, not independently re-counted line-by-line but the direction and shape (an estimate
     revised upward once actually run) matches this project's recorded forecasting pattern.

5. Unchanged-by-design files, asserted not assumed. git diff HEAD~4 -- src/application/sync-index.ts
   src/infrastructure/sqlite/sqlite-index-store.ts src/application/read-document.ts src/domain/ports.ts
   - zero lines across the whole PR 1-3 chain (4 feature commits). file-document-source.test.ts:99's
   original test body (lines 99-110) confirmed byte-identical to its pre-PR-1 form; the new
   non-empty-prefix companion test was added immediately after it (lines 112-123), not folded in.

6. No union type survives anywhere. Targeted grep for docsDir combined with a string | string[]
   shape returns zero matches in src/. ContainerOptions.docsDir?: string (single-valued,
   for --dir) is the only string-typed docsDir-adjacent field, and it is unchanged by design
   (Decision 10) - normalization to a one-element array happens at the composition.ts call site.

7. PR 4 confirmed genuinely not started. selfPath is absent from
   generate-index-md.ts/composition.ts (only a deferral comment); the three dead INDEX_FILE
   equality checks (lines 41, 46, 77) are unretargeted; scripts/vector-reach.mjs:204 still does the
   pre-array-only resolve(root, config.docsDir, markerChunk.path) join, which throws under an array
   docsDir; README.md:132 still shows "docsDir": "docs"; CLAUDE.md has no array/prefix
   language yet. All exactly as apply-progress.md's "Remaining Tasks" section states.
## Spec Compliance Matrix (PR 1-3 scope)

| Requirement (delta file) | Scenario | Test | Result |
|---|---|---|---|
| configuration: docsDir Is a Non-Empty Array | No-config default ["docs"], still prefixed | goldenset-addresses.test.ts (Gate 1b) + manual Gate 1 | COMPLIANT |
| configuration: docsDir Is a Non-Empty Array | One-element array behaves like any other | config.test.ts normalization case | COMPLIANT |
| configuration: docsDir Is a Non-Empty Array | Two-root array derives one alias per root | config.test.ts, composition.test.ts | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Nested, outer-first | config.test.ts, composition.test.ts | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Nested, inner-first (the escape case) | config.test.ts, composition.test.ts | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Duplicate entries | config.test.ts, composition.test.ts | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Case-differing duplicate (win32) | config.test.ts, composition.test.ts (skipIf) | COMPLIANT (platform-conditional, runs on this dev machine) |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Alias clash | config.test.ts, composition.test.ts | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Empty array | config.test.ts, composition.test.ts | COMPLIANT |
| configuration: Colliding/Nested/Duplicate/Empty Rejected | Fresh project, no .compendio/ after rejection | composition.test.ts | COMPLIANT |
| configuration: exclude Matches a Directory Prefix | Directory-prefix, prefixed path | file-document-source.test.ts, manual Gate 2c | COMPLIANT |
| configuration: exclude Matches a Directory Prefix | Exact-match/basename unchanged | file-document-source.test.ts (pre-existing) | COMPLIANT |
| indexing: Root-Alias-Prefixed path, Always | Path carries root alias | manual Gate 2, goldenset-addresses.test.ts | COMPLIANT |
| indexing: Root-Alias-Prefixed path, Always | Same-basename files, different roots, no collision | composite-document-source.test.ts, index-and-search.test.ts multi-root case | COMPLIANT |
| indexing: Removing a Root Purges Documents | Sync-pass delete-on-absence, unmodified | sync-index.test.ts (pre-existing coverage, unaffected) | COMPLIANT (no new mechanism needed) |
| indexing: Retrieval Evaluation Corpus Stays Addressable | Re-addressed, re-measured | manual Gate 1 before/after | COMPLIANT |
| indexing: Read Failures Protect the path Subtree (MODIFIED) | One of several roots unreadable | composite-document-source.test.ts, manual Gate 4 | COMPLIANT |
| indexing: Read Failures Protect the path Subtree (MODIFIED) | Sole root fails = all fail, still throws | composite-document-source.test.ts | COMPLIANT |
| indexing: Read Failures Protect the path Subtree (MODIFIED) | Every root fails | composite-document-source.test.ts, manual Gate 4 | COMPLIANT |
| indexing: Read Failures Protect the path Subtree (MODIFIED) | Failed root's path is its alias, protects subtree | sync-index.test.ts Gate 4b - empirically re-falsified in this verification | COMPLIANT |
| indexing: Field Inference in loose Mode (MODIFIED) | module relative to containing root | convention.test.ts, index-and-search.test.ts byModule test, manual Gate 3 | COMPLIANT |
| index-md: One Combined INDEX.md | - | - | NOT YET IMPLEMENTED - PR 4 (Phase 14), by design |
| index-md: INDEX.md Never Lists Itself | - | - | NOT YET IMPLEMENTED - PR 4 (Phase 14), by design |
| mcp-contract: Root-Prefixed path Flows Through Tools | Prefixed paths visible in search_docs/docs_overview, round-trip via read_doc | manual Gate 2e (real corpus), index-and-search.test.ts multi-root round trip | COMPLIANT (general mechanism; PR 4 has no additional obligation here) |
| mcp-contract: read_doc Tolerates One Extra Leading Segment | Exact hit / over-prefixed hit | read-document.test.ts (Batch 2's deviation, landed early) | COMPLIANT |
| mcp-contract: read_doc Tolerates One Extra Leading Segment | Aliased-collision residual case, bare-basename miss | - | NOT YET IMPLEMENTED - PR 4 (Phase 15), by design |

**Compliance summary**: 22/26 scenarios compliant (PR 1-3 scope); 4 correctly deferred to PR 4 and
reported as outstanding-by-plan, not as failures.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| resolveRoots ordered-pair sweep, both directions, via path.relative | Implemented | config.ts:189-204, matches Decision 5 verbatim |
| Alias-clash sweep | Implemented | config.ts:206-216 |
| Seven validation messages | Implemented | Verified against design's table; wording matches |
| CompositeDocumentSource - merge, sort, per-root tolerance, aggregate rethrow | Implemented | Zero node: imports confirmed |
| ReadError.path is the alias | Implemented, empirically re-verified | See Gate 4b section above |
| inferModule alias-aware, "first match wins" | Implemented | convention.ts:53-58 |
| Container guard before new SqliteIndexStore | Implemented | composition.ts:63-67, confirmed by the "no .compendio/" test assertions actually depending on this ordering |
| --dir normalizes to one-element array | Implemented | composition.ts:65 |
| GenerateIndexMd.selfPath | Not implemented | PR 4 scope, deferral comment present at composition.ts:104-106 |
| Three dead INDEX_FILE equality checks retargeted | Not implemented | PR 4 scope, confirmed still literal INDEX_FILE |
| scripts/vector-reach.mjs array-aware | Not implemented | PR 4 scope, confirmed still pre-array-only join at line 204 |

## Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| 1 - seeded prefix, isRoot replaces prefix === "" | Yes | file-document-source.ts, PR 1 |
| 2 - primitive throws, composite owns tolerance | Yes | file-document-source.test.ts:99 unchanged, verified byte-identical |
| 3 - composite merges/sorts, never rewrites a path | Yes | Zero node: imports in composite-document-source.ts |
| 4 - ReadError.path is the alias | Yes | Empirically re-falsified in this verification, not taken on trust |
| 5 - ordered-pair sweep, path.relative, both directions | Yes | Inner-root-first and case-differing-duplicate cases both tested |
| 6 - guard runs before new SqliteIndexStore | Yes | composition.ts:59-67 |
| 7 - inferModule takes optional rootPrefixes via factory | Yes | No ConventionConfig/FrontmatterInput change |
| 8 - exclude is three clauses, one rule | Yes | PR 1, file-document-source.ts:84-86-equivalent |
| 9 - GenerateIndexMd.selfPath | PR 4, not yet | Correctly deferred |
| 10 - --dir stays single-valued | Yes | ContainerOptions.docsDir?: string unchanged |
| 11 - vector-reach.mjs calls resolveRoots | PR 4, not yet | Correctly deferred |
| 12 - ReadDocument is a test, not an edit | Partial - exact/over-prefixed done; residual/bare-basename PR 4 | read-document.ts zero diff confirmed |
| 13 - harness prefixes via resolveRoots | Yes | test/helpers/build.ts:98,103 |
| 14 - goldenset re-addressed, gated by goldenset-addresses.test.ts | Yes | Confirmed genuine RED-then-GREEN via git log -p and independent re-measurement |
## TDD Compliance (Strict TDD module)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes | Present in apply-progress.md for all 3 batches, with per-task RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR columns |
| All tasks have tests | Yes | 51/51 PR 1-3 tasks have an identifiable covering test file |
| RED confirmed (tests exist) | Yes | Spot-checked: composite-document-source.test.ts, sync-index.test.ts Gate 4b block, config.test.ts's resolveRoots block, composition.test.ts - all exist and match their described scope |
| GREEN confirmed (tests pass) | Yes | 639/639 on this run |
| Triangulation adequate | Yes | Composite source: 9 cases over fakes; resolveRoots: 12 cases; collision guard: 7 container-level cases |
| Safety Net for modified files | Yes | Full-suite reruns recorded at each phase boundary in apply-progress.md, cross-checked against this run's identical final count |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution (informational)

| Layer | Approx. Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~40 (config, composite-source, convention, file-document-source) | 4 core files for this change | Vitest, fakes only |
| Integration | ~20 (sync-index Gate 4b, index-and-search multi-root, read-document) | ~6 files | Vitest, real SqliteIndexStore(":memory:") |
| Container | ~9 (composition.test.ts, goldenset-addresses.test.ts) | 2 new files | Vitest, real createContainer |
| Total (whole suite) | 639 | 43 | |

No E2E/browser layer in this project (CLI + MCP server over stdio); test/cli-subprocess.test.ts
is the closest analog and is exercised as part of the re-addressed-literals deviation.

---

### Assertion Quality

Spot-checked test/infrastructure/composite-document-source.test.ts (9 tests, all new/rewritten
this change) in full: every test calls production code (composite.discover()), asserts concrete
values (not tautologies), no ghost loops, no ratio of mocks to assertions. test/composition.test.ts
and the config.test.ts resolveRoots block were read in full with the same result.

**Assertion quality**: No CRITICAL or WARNING issues found in the sampled files. A full line-by-line
audit of all ~29 re-addressed literals and every touched test file was not performed exhaustively
given the scope (51 tasks across 3 PRs); the sample covered the highest-risk new files (the composite
source and the collision guard, both silent-data-loss-adjacent).

---

### Changed File Coverage

Not available - no coverage tool configured in this project. Reported cleanly, not a failure per
Strict TDD module rules.

---

### Quality Metrics

**Linter**: Not available - no lint script configured (confirmed in CLAUDE.md: "There is no lint
script configured").
**Type Checker**: No errors (npm run typecheck clean, re-run independently).
## Issues Found

**CRITICAL**: None in PR 1-3 scope.

**WARNING**:
1. The ".."-prefixed nested-root edge case has zero automated test coverage. design.md's P1
   section specifically measured and reasoned about a nested root whose directory name begins with
   two dots (docs vs docs/..cache, relative('C:\A\docs','C:\A\docs\..cache') -> "..cache"),
   and the implementation correctly uses the strict predicate
   (rel !== ".." && !rel.startsWith(`..${sep}`), config.ts:198) rather than the looser
   rel.startsWith("..") that would misclassify it. The implementation is verified correct by direct
   code inspection, but no test in config.test.ts or composition.test.ts exercises this specific
   case. Recommend adding it before archive, since it is exactly the kind of subtle correctness
   property this project's own practice says should be pinned by a test rather than left to reasoning
   alone.
2. apply-progress.md's PR 3 manual Gate 3 verification narrative misattributes which document
   demonstrates the "root-level, no module" case. It names docs/documentation-convention.md; the
   real demonstrating document (confirmed via direct SQL query against a fresh index of this
   repository) is openspec/testing-capabilities.md. docs/documentation-convention.md carries
   pre-existing frontmatter module: transversal (confirmed to pre-date this change via git log -p)
   that correctly wins over inference - it was never a no-module example, with or without this
   change. All reported numbers (17 total, the three named buckets, no docs/openspec bucket) are
   correct and independently reproduced byte-for-byte; only the prose "which document" claim is wrong.
   Does not affect implementation correctness (independently confirmed via SQL and via the isolated,
   confound-free unit test), but is exactly the kind of "verify the verifier" gap this project has
   been burned by before - recommend correcting the narrative in apply-progress.md or noting it here
   permanently, which this report now does.
3. The design's spec-delta guidance for a --dir requirement did not make it into
   specs/configuration/spec.md. design.md's "Spec delta guidance" table calls for a new
   configuration requirement: "--dir replaces the corpus with one directory, normalized to a
   one-element root set with the same prefixed path shape." No such requirement or scenario exists in
   the delta file. This is an sdd-spec-phase gap predating apply, not an apply defect - the
   underlying behavior (Decision 10) is implemented and covered by the "unchanged, asserted" file list
   (ContainerOptions.docsDir?: string), just not pinned by a normative spec scenario. Low severity;
   does not block PR 1-3 archive readiness, but should be closed before the whole change archives.

**SUGGESTION**: None beyond the above. PR 4's outstanding items are correctly scoped, correctly
unimplemented, and correctly documented as the base for the next sdd-apply batch.

## Verdict

**PASS WITH WARNINGS** - for PR 1-3 (tasks.md Phases 1-13, the currently-implemented scope).

Zero CRITICAL findings. All 639 tests pass, build and typecheck are clean, the two headline
silent-data-loss guards (Gate 2c's exclude directory-prefix match, Gate 4b's alias-vs-declared
ReadError.path) were independently re-verified by this report rather than taken on trust - Gate 4b
specifically by breaking the property, confirming the exact two tests that catch it, and restoring
clean state. Three WARNINGs recorded (an untested edge case, a narrative misattribution in
apply-progress with no functional consequence, and a missing spec scenario from an earlier phase) -
none block archiving PR 1-3's scope, but should be tracked before the whole 4-PR chain closes.

PR 4 (Phases 14-17) is correctly not started and is not counted against this verdict.
