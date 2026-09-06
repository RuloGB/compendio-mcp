# Apply Progress: Retrieval-Ranking Evidence

**Mode**: Strict TDD
**Delivery**: single-pr, `size:exception` accepted 2026-09-06
**Branch**: `feat/retrieval-ranking-robustness`

This is the first (and only planned) apply batch — no prior apply-progress existed.

## Completed Tasks

- [x] 1.1 RED — `test/application/search-trace.test.ts`
- [x] 1.2 GREEN/REFACTOR — `src/application/search-trace.ts`, `src/application/search-documents.ts`
- [x] 2.1 RED — `test/domain/retrieval-evaluation.test.ts`
- [x] 2.2 GREEN/REFACTOR — `src/domain/retrieval-evaluation.ts`
- [x] 3.1 RED — `test/retrieval-baseline.test.ts` (containment/traversal/collision/non-Markdown/inertness/no-subprocess)
- [x] 3.1a RED — `test/retrieval-baseline.test.ts` (WAL/hash-drift/mutation/prerequisite/digest-independence)
- [x] 3.2 GREEN/REFACTOR — `scripts/retrieval-baseline.mjs`, `scripts/retrieval-baseline.d.mts`
- [x] 4.1 — `.compendio/evaluation/README.md` (untracked by design, see Deviations)
- [x] 4.2 — full-suite verification run (see below)

## Blocked Tasks (not silently skipped — see Risks)

- [ ] 3.3 — Prepare/review the 60-query goldenset. **Requires a human reviewer** to read real
  corpus content and write/approve answer evidence, quotes, and chunk fingerprints. An apply
  agent has no authority to invent "reviewed" evidence — doing so would fabricate the exact
  thing this change exists to make trustworthy.
- [ ] 3.4 — Run real-corpus baselines (larger prepared corpus + `ejemplos/`) and compare
  observer on/off / pre/post instrumentation. **Blocked by 3.3** (no goldenset yet) and,
  independently, by this environment not having the `Xenova/multilingual-e5-small` model
  staged locally (a hybrid baseline would need a cold download, which `AGENTS.md`'s own
  manual-verification notes treat as out-of-band for automated runs). `assertModelPrerequisites`
  is implemented and unit-tested (throws `SecurityError` on a missing/empty model dir) so the
  runner will refuse cleanly rather than silently downgrading, the moment this is attempted.

Per the task instructions: every other task (1.1 through 4.2, 9 of 11) is complete in full.
Only 3.3 and 3.4 are left out, and both require inputs (human review, a corpus/model this
sandbox does not have) that cannot be produced by an apply agent.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1/1.2 | `test/application/search-trace.test.ts` | Unit | N/A (new file); ran `search-documents-spans.test.ts` + `index-and-search.test.ts` (53/53) after the change as regression net | ✅ Written — confirmed failing: 13/16 failed with `TypeError: Cannot read properties of undefined (reading 'attempts')` before `search-trace.ts` existed | ✅ 16/16 passing | ✅ 16 cases: observer-off parity, no-extra-inference, no-trace-when-absent, copied arrays, throwing observer, filter-retry, noMatchReason, 5 vector-leg branches, RRF tie, cap removal, missing chunk row | ✅ Extracted `notify()` to isolate observer-callback failure from the response path |
| 2.1/2.2 | `test/domain/retrieval-evaluation.test.ts` | Unit (pure domain) | N/A (new file) | ✅ Written — confirmed failing: `Cannot find module '../../src/domain/retrieval-evaluation'` | ✅ 20/20 passing | ✅ 20 cases across validateLabel, summarizeAnswerMetrics, summarizeDocumentMetrics, runFalsifiabilityGates, compareResults | ✅ None needed — module written directly against the full RED test surface |
| 3.1/3.1a/3.2 | `test/retrieval-baseline.test.ts` | Unit (pure + static source audit) | N/A (new file) | ✅ Written — confirmed failing: `Cannot find module '../scripts/retrieval-baseline.mjs'` | ✅ 28/28 passing (27 executed + 1 environment no-op, see Risks) | ✅ 28 cases: containment, traversal, symlink-escape (env-limited), Markdown-only, inertness, output collision, static no-subprocess/no-dangerous-op audit, WAL states, hashing, prerequisite refusal, logical-digest stability/sensitivity | ✅ Reworded header comment after RED audit tests failed on their own prose (see Issues Found) |

### Test Summary

- **Total tests written**: 64 (16 + 20 + 28)
- **Total tests passing**: 64/64 in their own files; full suite 986/987 (1 pre-existing skip, unrelated to this change)
- **Layers used**: Unit (64), Integration (0 new — reused existing `search-documents-spans.test.ts`/`index-and-search.test.ts` as safety net), E2E (0)
- **Approval tests** (refactoring): None — `search-documents.ts` was extended, not refactored; its pre-existing 53 tests served as the safety net and stayed green throughout
- **Pure functions created**: `src/domain/retrieval-evaluation.ts` (10 exported functions, zero I/O), plus 12 exported pure/near-pure helpers in `scripts/retrieval-baseline.mjs`

## RED Evidence (actual observed output, not a claim)

**1.1** (`npx vitest run test/application/search-trace.test.ts`, before `search-trace.ts` existed):
```
FAIL test/application/search-trace.test.ts > ... > embed() throws: embed-failed ...
TypeError: Cannot read properties of undefined (reading 'attempts')
...
Test Files  1 failed (1)
     Tests  13 failed | 3 passed (16)
```
(3 passed trivially because the observer argument was simply ignored by the pre-change `execute()` signature — those 3 assertions did not depend on trace content.)

**2.1** (`npx vitest run test/domain/retrieval-evaluation.test.ts`, before the module existed):
```
FAIL  test/domain/retrieval-evaluation.test.ts [ test/domain/retrieval-evaluation.test.ts ]
Error: Cannot find module '../../src/domain/retrieval-evaluation' imported from ...
Test Files  1 failed (1)
     Tests  no tests
```

**3.1/3.1a** (`npx vitest run test/retrieval-baseline.test.ts`, before the script existed):
```
FAIL  test/retrieval-baseline.test.ts [ test/retrieval-baseline.test.ts ]
Error: Cannot find module '../scripts/retrieval-baseline.mjs' imported from ...
Test Files  1 failed (1)
     Tests  no tests
```

**Additional RED verification (gate-never-observed-failing rule)**: after 3.2 was implemented and
green, `assertContained`'s body was temporarily replaced with an early `return;` (a deliberately
broken, known-bad state) to prove the traversal-escape test can actually fail, not just pass by
construction:
```
FAIL test/retrieval-baseline.test.ts > ... > rejects a `..` traversal that escapes the canonical root
AssertionError: expected function to throw an error, but it didn't
     Tests  1 failed | 11 passed | 16 skipped (28)
```
The file was restored immediately after and re-verified green (28/28).

## Deviations from Design

- `.compendio/evaluation/README.md` (task 4.1) lives exactly where the task names it, but
  `.compendio/` is Git-ignored at the repository root — so this file is **not part of the PR
  diff** and will not appear in review. This mirrors design.md's own instruction to store
  goldenset/snapshots/results there; the workflow doc followed the same rule. If a reviewer
  needs to read it, it exists locally at that path after this apply run.
- `scripts/retrieval-baseline.d.mts` (a co-located `.d.mts` declaration file) was added and is
  **not listed in design.md's File Changes table**. It exists solely so `tsconfig.test.json`
  can typecheck `test/retrieval-baseline.test.ts`'s import of the plain-JS `.mjs` script — no
  production behavior depends on it. Noted here rather than silently added.
- `runFalsifiabilityGates`' `relevance-miss` failure kind and `summarizeAnswerMetrics`/
  `summarizeDocumentMetrics`'s exact field names are this apply batch's own design choice,
  filling in specifics design.md left at the requirement level ("gate reasons", "Hit@5/mean/
  all-three/nullable first-answer rank"). See `src/domain/retrieval-evaluation.ts`'s doc
  comments for the reasoning behind each choice (e.g., why an invalid label is excluded from
  the answer-metrics denominator rather than counted as a miss).
- `scripts/retrieval-baseline.mjs`'s `main()` CLI flow (root/goldenset/output resolution,
  snapshot copy, mode/k loop, manifest, report writing) is implemented per design.md's Data
  Flow and Interfaces sections, but has **never been executed end-to-end** — only its exported
  pure/near-pure primitives are unit-tested (that is genuinely everything task 3.1/3.1a ask
  for). Running `main()` for real is task 3.4's job, and it is blocked (see above).

## Issues Found

- The script's own header comment originally spelled out the literal forbidden identifiers it
  promises never to use (`.reset(`, `SyncScheduler`, `child_process`) — which made the static
  source-audit tests fail against the DOCUMENTATION, not the code, the moment they were written.
  Fixed by rewording the comment to describe the guarantees without repeating the banned
  substrings, and noting in the comment itself why (so a future editor does not "helpfully" put
  them back).
- `isMainModule`'s original draft used `new URL(import.meta.url).pathname` directly, which is
  known-wrong on Windows (leading `/C:/...`, never equal to a `realpathSync` result) — this
  project's own `AGENTS.md` documents the correct pattern (`fileURLToPath` +
  `realpathSync(argv[1])`, `src/cli.ts`'s entry-point guard) and it was applied here instead
  before this ever shipped, not caught by a failing test (no test exercises `main()` directly).
- A co-located `.d.ts` file does not satisfy TypeScript's module resolution for a `.mjs` source
  file's type declarations — it must be named `.d.mts`. Discovered by `npm run typecheck`
  continuing to fail after the first `.d.ts` attempt; confirmed by renaming.

## Risks

- **Symlink-escape gate untested on this machine.** This Windows environment has no privilege
  to create filesystem symlinks (`EPERM`), so that specific RED test warns and returns rather
  than exercising the real code path — following this repository's own established pattern
  (`test/cli-subprocess.test.ts`'s 8.3-short-path case). The equivalent `..`-traversal case
  IS fully exercised and was confirmed to fail against a deliberately broken implementation
  (see RED Evidence above), and `assertContained` uses `realpathSync` on the resolved path,
  which is the same mechanism that would close the symlink case — but this has not been
  *observed* failing/passing on a real symlink in this session. Flagging this explicitly per
  the "a gate never observed failing has not been verified" rule, rather than claiming full
  coverage.
- **`scripts/retrieval-baseline.mjs`'s `main()` is unexercised end-to-end.** Every safety
  primitive it calls is unit-tested in isolation, and the full production test suite proves
  `SearchDocuments`/`SearchTraceObserver` behave correctly, but the specific sequence inside
  `main()` (copy → open → loop over modes/k → digest → write) has never actually run against a
  real database. The most likely latent issue, if any, is in argument/path plumbing, not in the
  safety logic.
- **Tasks 3.3/3.4 remain genuinely blocked**, as stated above — not narrowed silently.

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/application/search-trace.ts` | Created | Trace/observer types for `SearchDocuments` |
| `src/application/search-documents.ts` | Modified | Optional `observer` param on `execute()`; internal `runSearch`/`vectorLeg` now also report trace data when an observer is present, at zero cost when it is not |
| `test/application/search-trace.test.ts` | Created | 16 tests: parity, no-extra-inference, copied arrays, callback isolation, filter retry, vector-leg branches, ties, cap, missing rows |
| `src/domain/retrieval-evaluation.ts` | Created | Pure label validation, answer/document metrics, falsifiability gates, identity comparison |
| `test/domain/retrieval-evaluation.test.ts` | Created | 20 tests covering every scenario in `specs/retrieval-evaluation/spec.md` |
| `scripts/retrieval-baseline.mjs` | Created | Isolated runner + all threat-gate primitives |
| `scripts/retrieval-baseline.d.mts` | Created | Type declarations so the test file typechecks |
| `test/retrieval-baseline.test.ts` | Created | 28 tests: containment/traversal/collision/Markdown-only/inertness/no-subprocess/WAL/hashing/prerequisites/digest |
| `.compendio/evaluation/README.md` | Created | Operator runbook (untracked — `.compendio/` is Git-ignored) |
| `openspec/changes/retrieval-ranking-robustness/tasks.md` | Modified | Marked 9/11 tasks `[x]`, documented the 2 blocked tasks |

## Verification Run (task 4.2)

```
npm run build       -> clean
npm run typecheck   -> clean (tsc --noEmit && tsc -p tsconfig.test.json)
npm test            -> Test Files  55 passed (55)
                        Tests  986 passed | 1 skipped (987)
```

The 1 skipped test predates this change and is unrelated to it. No pre-existing test was
modified or weakened to make this pass.

## Status

9/11 tasks complete. 2 tasks (3.3, 3.4) blocked on human review and model/corpus prerequisites
this sandbox does not have — see Blocked Tasks above. Ready for `sdd-verify` on the completed
scope; 3.3/3.4 need a follow-up apply batch once their prerequisites are available.

---

## Orchestrator Post-Apply Verification (2026-09-06)

Independent checks run by the orchestrator after the apply batch returned, against this
repository at `C:\Users\Raul\Workspace\compendio-mcp`.

### Defect found and fixed

`src/domain/retrieval-evaluation.ts` embedded **three literal NUL bytes** in `fingerprintKey`'s
template literal (byte offsets 4103/4116/4130). Using NUL as a composite-key separator is a sound
choice — no path or heading can contain one — but writing it as a raw byte made Git classify the
whole file as binary (`Bin 0 -> 11763 bytes`), suppressing its diff entirely: 322 lines of new
domain logic would have reached review as an opaque blob. Replaced with the `\0` escape sequence,
which emits the identical byte at runtime. The file is now `UTF-8 text` and `git diff --numstat`
reports `322 0`. Typecheck clean, all 20 evaluation tests still green.

### Risk 2 CLOSED by measurement, not by claim

`scripts/retrieval-baseline.mjs`'s `main()` was reported as never executed end-to-end. It has now
been run, twice, against `ejemplos/` (lexical mode, a 1-query smoke goldenset, output to a
scratch directory outside the repository):

1. **Refusal path** — with a non-empty WAL sidecar left by `index`, `main()` refused:
   `refusing to read "...\ejemplos\.compendio\compendio.db": its WAL sidecar is non-empty — stop
   every writer and checkpoint first`. Argument parsing, canonical-root resolution, containment
   and the WAL gate all executed.
2. **Happy path** — after checkpointing the source database *externally* (the runner correctly
   refuses to checkpoint it itself), exit code 0, two reports written for independent k=5 and
   k=10. The manifest carries `sourceDbHash`, `goldensetHash`, `configHash`, `codeHash`, `runId`,
   and `logicalDigestBefore === logicalDigestAfter` (`236d411d…4285bd25`), i.e. the run provably
   did not mutate the index. The result carries a real trace (`attempts`) and 5 response items.

This is a smoke proof that the CLI flow executes and its provenance/immutability machinery
reports real values. It is **not** task 3.4: no reviewed goldenset, no hybrid mode, no real
corpus. 3.4 remains blocked.

### Suite state

`npm test` → 985 passed, 1 skipped, **1 failed**: `discover-markdown-roots.test.ts > indexes a
project reached through a Windows 8.3 short path`, failing with `EBUSY: resource busy or locked,
rmdir` during temp-directory cleanup. Verified **not** a regression from this change: the file is
untouched (`git diff main..HEAD` reports 0 lines), and it passes on isolated re-run. Pre-existing
Windows file-lock flake in teardown.

### Open decision for the user

Task 4.1's deliverable, `.compendio/evaluation/README.md`, matches the path `tasks.md` specified,
but `.gitignore:3` ignores `.compendio/` wholesale — so the operator runbook exists only on this
machine and does not survive a fresh clone. `design.md` line 67's Git-ignore rationale covers
measurement *outputs* (goldenset, snapshots, reports), which may carry corpus text; documentation
carries none. Flagged for the user rather than moved unilaterally.
