## Verification Report

**Change**: sync-deleted-paths
**Version**: N/A (delta spec, not versioned)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 36 |
| Tasks complete | 36 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: PASSED
```
npm run build -> tsc, no output, exit 0
```

**Tests**: 1062 passed / 0 failed / 1 skipped (pre-existing Windows-8.3-only skip, unrelated)
```
npm test -> 57 files passed, 1062 tests passed, 1 skipped
npx vitest run test/infrastructure/discover-markdown-roots.test.ts test/composition.test.ts -> 2 files, 43 tests passed (17 + 26)
```

**Typecheck**: PASSED
```
npm run typecheck -> tsc --noEmit && tsc -p tsconfig.test.json, no output, exit 0
```

**Coverage**: Not available (no coverage tool configured in this project) - skipped, not a failure.

### Spec Compliance Matrix (openspec/changes/sync-deleted-paths/specs/indexing/spec.md)
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Nested Roots Are Not Created Independently | Nested folders stay under the parent root | pre-existing, unaffected | COMPLIANT (unchanged) |
| Nested Roots Are Not Created Independently | A nested symlink does not create a discovered root | pre-existing, unaffected | COMPLIANT (unchanged) |
| Discovery Mode Distinguishes a Deleted Root From an Unreadable One | A discovered root deleted from disk is purged on the next sync | composition.test.ts: "purges a discovered roots documents on sync when the root is deleted from disk (ENOENT)" (asserts report.deleted and store.listDocuments()) | COMPLIANT |
| Discovery Mode Distinguishes a Deleted Root From an Unreadable One | A discovered root deleted from disk is purged by a full reindex | composition.test.ts: "rebuilds without a deleted roots documents on a full reindex" | COMPLIANT |
| Discovery Mode Distinguishes a Deleted Root From an Unreadable One | Unreadable existing root aborts sync without mutation | composition.test.ts: "fails closed on a non-ENOENT unreadable discovered root before mutating healthy roots" (file-replaces-folder trigger, non-ENOENT) | COMPLIANT |
| Discovery Mode Distinguishes a Deleted Root From an Unreadable One | Deleting every discovered root empties the index without error | composition.test.ts: "leaves an empty index when a full reindex runs after every discovered root is deleted" and "purges every discovered roots documents in a freshly reconstructed container when all roots disappear" (covers sync too) | COMPLIANT |
| Discovery Mode Distinguishes a Deleted Root From an Unreadable One | serve recovers on its next throttled pass after a root is deleted | composition.test.ts: "purges a deleted discovered root on the next throttled sync pass through the scheduler" (calls syncScheduler.maybeSync() directly, asserts purge, lastReport.deleted, and absence of the string incident sync failed on console.error) | COMPLIANT |

Compliance summary: 7/7 scenarios compliant, each backed by a passing test that exercises the real code path (verified independently, not by trusting apply-progress.md).

Why each test would fail on regression:
- The sync-purge test asserts report.deleted equals the deleted paths and the surviving store only contains the healthy roots documents; if ENOENT were treated as fail-closed again, syncIndex.execute() would reject instead of resolving.
- The full-reindex test asserts report.indexed and store.listDocuments() exclude the deleted root; a regression to throw-on-ENOENT rejects the execute() call.
- The fail-closed regression test uses a file-replaces-folder (non-ENOENT) trigger and asserts the promise rejects, and healthy root documents are untouched; this is the canary that must start failing if the ENOENT check is ever widened to a catch-all (confirmed true by mutation testing below).
- The empty-index tests assert store.listDocuments() is empty and getOverview().totalDocuments is 0; a regression that still throws on any missing root fails these outright.
- The scheduler test calls the real SyncScheduler.maybeSync() (not a mock), asserts store state, lastReport.deleted, and that no failure string reaches console.error - this is the actual serve recovery path exercised end-to-end.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|---|---|---|
| validateDiscoveredRootAlias returns undefined on code === ENOENT, throws otherwise | Implemented | src/infrastructure/fs/discover-markdown-roots.ts line 72, uses (error as NodeJS.ErrnoException).code, not string matching (verified by mutation test below) |
| DynamicDiscoveryDocumentSource.discover() skips undefined aliases | Implemented | src/infrastructure/fs/dynamic-discovery-document-source.ts lines 28-29 |
| composite-document-source.ts untouched | Confirmed | No diff; doc comment reviewed and remains accurate (a deleted root is never selected before this class runs) |
| SyncReport / MCP contract byte-identical | Confirmed | grep for SyncReport in src/domain/ports.ts and src/server.ts shows no diff-relevant hits; git status shows neither file touched |
| MCP surface stays exactly 3 tools | Confirmed | server.test.ts three-tools assertion is part of the 1062 passing tests |

### Coherence (Design)
| Decision | Followed | Notes |
|---|---|---|
| Return undefined on ENOENT, not a discriminated union or typed exception | Yes | Matches design.md Architecture Decision 1 exactly |
| ENOENT test via error.code, never message matching | Yes | Confirmed by source inspection and by mutation testing (message-match mutation turns a test red) |
| Race where root vanishes mid-pass stays fail-closed, self-heals next pass | Yes | No code touches FileDocumentSource; unchanged per design |
| composite-document-source.ts comment | Yes, no edit needed | Reviewed per task 7.3; wording already accurate |
| realpathSync.native / canonicalRealPath untouched | Yes | No diff in that region |
| Docs anchor kept, only the closing clause of the paragraph rewritten | Yes | Anchor unreadable-roots-fail-closed-in-discovery-mode confirmed present in docs/design-decisions.md and linked from AGENTS.md |
| AGENTS.md bullet edited in place, no new line | Yes | git diff numstat AGENTS.md shows 1 insertion 1 deletion, net zero lines added |

### TDD Compliance
| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | Found in apply-progress | Full TDD Cycle Evidence table present, all 8 phases covered |
| All tasks have tests | 36/36 | Every implementation task backed by RED/GREEN evidence; docs-only tasks 7.1-7.4 correctly show no test requirement |
| RED confirmed (tests exist) | 17/17 (discover-markdown-roots) + 26/26 (composition) verified to exist and pass | Both test files read in full; all reported new/changed tests are present in the working tree |
| GREEN confirmed (tests pass) | 1062/1062 excluding 1 pre-existing skip | Re-ran independently, not trusting the report |
| Triangulation adequate | 9 cases for validateDiscoveredRootAlias beyond the target scenario, 7 for composition scenarios | Matches apply-progress claims |
| Safety Net for modified files | 31/31 pre-existing tests confirmed green before Phase 3 per apply-progress; re-verified via full suite run | Confirmed |

TDD Compliance: 6/6 checks passed

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit | 9 | 1 (discover-markdown-roots.test.ts, real tmp dirs plus vi.doMock of node:fs) | vitest |
| Integration | 7 (2 rewritten, 1 retargeted, 3 new, plus unaffected pre-existing ones) | 1 (composition.test.ts, real filesystem via mkdtemp/rm/writeFile, real SyncScheduler) | vitest |
| E2E | 0 (manual gate covers CLI end-to-end, outside the automated suite) | - | node dist/cli.js manual gate |
| Total | 16 new/changed test bodies | 2 | |

---

### Mutation Testing (adversarial verification, independent of apply-progress claims)

Baseline hash of git diff src/ before mutation: 1b24b479e2afea7a07e27a15f3a78046. Same hash confirmed after every mutation was reverted (restored via manual patch after an initial git checkout accidentally discarded the legitimate diff for one file mid-session; recovered by reapplying the captured diff and reconfirming the hash before proceeding).

| Num | Mutation | Result | Tests turned red |
|---|---|---|---|
| A | error.code === ENOENT changed to String(error).includes(ENOENT) | Caught | 1: the message-only-ENOENT test (no-code-but-ENOENT-in-message) |
| B | lstat catch returns undefined for every error, dropping the code check entirely | Caught | 3: EACCES test, EPERM test, message-only-ENOENT test |
| C | Removed the validated-not-undefined skip guard in dynamic-discovery-document-source.ts, throw instead when validated is undefined | Caught | 5: sync-purge test, reconstructed-container test, full-reindex-purge test, empty-index-after-full-delete test, scheduler-recovery test |

All three required mutations were caught by the existing test suite, turning at least one test red each, and each mutation was fully reverted with the post-revert git diff src/ hash verified identical to the pre-mutation baseline.

---

### Changed File Coverage
Coverage analysis skipped - no coverage tool detected in this project (no coverage script, no c8/nyc/istanbul config found).

---

### Assertion Quality
Scanned all new/changed test bodies in test/infrastructure/discover-markdown-roots.test.ts and test/composition.test.ts.

- No tautologies found.
- No orphan empty-collection assertions without a companion non-empty test: every deleted assertion has sibling tests asserting the surviving documents, and the empty-index tests are paired with the one-root-survives tests.
- No type-only assertions used alone - every test asserts specific values (toEqual arrays, toThrow with a regex, specific report.deleted contents).
- No ghost loops (no for/forEach over queryAll or filter results in the new tests).
- No smoke-test-only patterns (this is a Node backend project, not applicable).
- No implementation-detail coupling; the scheduler test asserts lastReport.deleted and console.error calls, which are the documented public contract of SyncScheduler and serve, not internals.
- Mock/assertion ratio: the four vi.doMock tests each contain exactly one mock call and one expect, well under the 2x threshold. The scheduler test uses vi.spyOn on console.error, inspecting a real observable side effect (the bug this proposal fixes), not a mock substituting real logic.

Assertion quality: all assertions verify real behavior.

---

### Quality Metrics
Linter: not available, no lint script configured in this project, per AGENTS.md.
Type Checker: no errors, npm run typecheck is clean.

### Manual Gate and Regression Baseline
| Check | Result |
|---|---|
| ejemplos index | 11 documents, 29 chunks, mode hybrid, matches baseline |
| ejemplos eval | hybrid recall at 5 is 1.00, MRR 0.943, failures 0; lexical recall at 5 is 0.95, MRR 0.856, failures 1 (position 11 for the endpoint question) - identical to the baseline recorded in apply-progress.md, re-run independently |
| Docs anchor unreadable-roots-fail-closed-in-discovery-mode | Present in docs/design-decisions.md; linked correctly from AGENTS.md; paragraph rewritten to state the ENOENT reversal, not the old blanket disappeared claim |
| AGENTS.md net line growth | 0 (1 insertion, 1 deletion, edited in place) |
| Stale disappear or fails-closed claims elsewhere | None found outside this changes own artifacts and unrelated code (a cli.ts comment about a symlink target, a split-text.ts chunk-splitting comment, a sqlite-index-store.ts FTS-page comment, and sync-index.test.ts pre-existing test about a path disappearing from disk - all unrelated to root discovery) |
| Out-of-scope drift | None, git status shows exactly the 6 files listed in tasks.md and design.md File Changes table, plus the new openspec change directory |
| SyncReport / MCP contract | Byte-identical, no diff in src/domain/ports.ts or src/server.ts; 3-tool surface confirmed via passing server.test.ts |

### Issues Found
CRITICAL: None
WARNING: None
SUGGESTION: The follow-ups explicitly deferred in tasks.md (aligning explicit modes ENOENT string match to error.code; Windows case-only root rename selecting both aliases) remain open and out of scope - no action needed for this change, noted for future work as tasks.md already states.

### Verdict
PASS
All 36 tasks complete with verified TDD evidence; all 7 spec scenarios have passing, non-vacuous covering tests independently re-run; 3 of 3 targeted mutations were caught and cleanly reverted with hash verification; the full suite (1062 tests), typecheck, and build are green; the ejemplos eval baseline is reproduced exactly; documentation and AGENTS.md changes are surgical and accurate; no out-of-scope drift; SyncReport and the 3-tool MCP surface are unchanged.
