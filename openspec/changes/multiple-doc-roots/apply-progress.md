# Apply Progress: Multiple Documentation Roots

Artifact store: **openspec** (Engram MCP tools unavailable this cycle, per `proposal.md`'s
Resolved Decisions table — confirmed unavailable again this batch).

Delivery: `auto-chain` / `feature-branch-chain`. Tracker branch `feat/multiple-doc-roots` (off
`main`, draft/no-merge, never merges alone). PR 1 branch `feat/multiple-doc-roots-01-exclude-prefix`
(off the tracker), targeting the tracker per Feature Branch Chain naming.

## Batch 1 — PR 1 (this batch)

**Scope**: `tasks.md` §"PR 1 — `exclude` directory-prefix and the enabling refactor" — Phase 1,
Phase 2, Phase 3. Nothing from PR 2 (`docsDir` array, `resolveRoots`, composite source, prefixing,
goldenset/harness re-addressing) was touched, per explicit scope instruction.

### Completed Tasks

- [x] 1.1 [RED/baseline] Landed a test asserting today's exact-equality-only `exclude` behavior
      (`exclude: ["sub"]` does not exclude `sub/x.md`). Confirmed passing on unmodified code before
      any production edit (10/10 pre-existing tests green, new test green).
- [x] 1.2 [GREEN] Rewrote `isExcluded` to the three-clause directory-prefix form: `entry === path ||
      entry === basename || path.startsWith(entry + "/")`, with a trailing-slash strip on `entry`
      first.
- [x] 1.3 [invert] Inverted 1.1's test (`sub/x.md` now excluded) and triangulated: trailing-slash
      entry form (`"sub/"`) matches identically; `"docs"` does not exclude `docs-old/x.md` (explicit
      `/` boundary).
- [x] 2.1 Added optional third constructor argument `pathPrefix: string = ""`; `discover()` seeds
      `walk(this.docsDir, this.pathPrefix, true, ...)`; `walk` gained an explicit `isRoot: boolean`
      parameter replacing the `prefix === ""` root-detection check. No production caller passes a
      prefix yet — behaviour-preserving on its own, confirmed by the full pre-existing suite staying
      green.
- [x] 2.2 Confirmed `test/infrastructure/file-document-source.test.ts:99` ("still throws when the
      docs root itself cannot be read") passes unchanged — verified via `git diff`, the test's own
      lines (1-109) carry zero changes; only new tests were appended after it.
- [x] 2.3 [new] Added the seeded-prefix trap test beside :99: `FileDocumentSource` constructed with a
      non-empty `pathPrefix` (`"docs"`) against an unreadable root still rejects. Written first as a
      genuine RED — confirmed by `npm run typecheck` failing with `TS2554: Expected 2 arguments, but
      got 3` before the constructor change landed.
- [x] 2.4 Rewrote the Spanish root-failure message to English: `cannot read the documentation
      directory "<dir>": <reason>` (was `no se puede leer el directorio de documentacion "<dir>": ...`).
- [x] 3.1 Cross-checked `specs/configuration/spec.md`'s "`exclude` Matches a Directory Prefix"
      requirement against 1.1-1.3: the three-clause mechanism and its scope ("not glob syntax") match
      exactly. The scenario involving multi-root prefixed paths (`openspec/changes/archive`) is
      mechanism-covered here (directory-prefix matching works on whatever `path` string it receives)
      but only becomes end-to-end demonstrable once PR 2 wires `resolveRoots`/prefixing — expected,
      not a gap in this batch. The exact-match/basename scenario is unchanged pre-existing behavior,
      already exercised elsewhere in the suite (`test/helpers/build.ts`, `index-progress.test.ts` both
      pass `["INDEX.md"]` as `exclude` and rely on the basename clause).
- [x] 3.2 `npm test`, `npm run typecheck` green (see Verification below). PR 1 diff limited to
      `src/infrastructure/fs/file-document-source.ts` + `test/infrastructure/file-document-source.test.ts`
      (confirmed via `git diff --stat`: exactly those two files, 62 insertions / 11 deletions).

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.3 | `test/infrastructure/file-document-source.test.ts` | Unit | ✅ 10/10 (pre-change) | ✅ Written, confirmed passing on unmodified code | ✅ Passed after `isExcluded` rewrite | ✅ 3 cases (basic prefix, trailing slash, sibling boundary) | ➖ None needed — `isExcluded` already minimal |
| 2.1, 2.3, 2.4 | `test/infrastructure/file-document-source.test.ts` | Unit | ✅ 13/13 (post-Phase-1) | ✅ Written referencing a 3-arg constructor that did not exist yet; confirmed RED via `tsc` (`TS2554`) | ✅ Passed (14/14) after `pathPrefix`/`isRoot` refactor | ➖ Single scenario (approval-testing refactor task; existing throw test at :99 is the triangulating counterpart, confirmed unchanged) | ✅ Clean — `reason` extracted once instead of computed twice |

### Test Summary

- **Total tests written**: 4 new (`file-document-source.test.ts` went from 10 to 14 tests)
- **Total tests passing**: 14/14 in the target file (10 pre-existing + 4 new); 593/593 full suite
- **Layers used**: Unit (4)
- **Approval tests** (refactoring): 1 — task 2.1's `isRoot` refactor, safety net = the pre-existing
  13-test file (post-Phase-1) staying green through the refactor
- **Pure functions created**: 0 (both changes are inside the existing `FileDocumentSource` class;
  `isExcluded` and the root-detection branch stayed methods, matching the surrounding style)

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/infrastructure/fs/file-document-source.ts` | Modified | Three-clause `isExcluded`; `pathPrefix` constructor arg + `isRoot` walk parameter; English root-failure message; docstring updated |
| `test/infrastructure/file-document-source.test.ts` | Modified | 4 new tests: directory-prefix exclude, trailing-slash exclude, sibling-boundary non-exclude, seeded-prefix-still-throws |

### Deviations from Design

None — implementation matches `design.md` Decisions 1 and 8 exactly, including the exact error
message text and the three-clause `isExcluded` form.

### Issues Found

None.

### Verification (real output, not inferred)

`npm test` — full suite:

```
Test Files  40 passed (40)
     Tests  593 passed (593)
```

`npm run typecheck`: clean (`tsc --noEmit && tsc -p tsconfig.test.json`, no output, exit 0).

`npm run build`: clean (`tsc`, no output, exit 0).

Manual check requested by the orchestrator: proved the old code could not satisfy the new case.
`entry = "sub"`, `path = "sub/x.md"`, `basename = "x.md"` — under the old two-clause form neither
`entry === path` nor `entry === basename` holds, so the old code could never exclude a directory by
prefix (confirmed by the 1.1 baseline test passing unmodified: `sub/x.md` was discovered). Under the
new three-clause form the same inputs newly satisfy `path.startsWith("sub/")`, and the existing
10 pre-existing exclusion-independent tests (encoding, read-error handling, sorting, etc.) all still
pass unchanged.

### Workload / PR Boundary

- Mode: chained PR slice (`feature-branch-chain`)
- Current work unit: PR 1 — `exclude` directory-prefix matching + the `isRoot` enabling refactor
- Boundary: starts from `main` (via tracker `feat/multiple-doc-roots`); ends with a green, typed,
  built `file-document-source.ts` + its tests. Nothing from PR 2 (array `docsDir`, `resolveRoots`,
  composite source, composition wiring, goldenset/harness re-addressing) is touched.
- Estimated review budget impact: 73 changed lines (62 insertions + 11 deletions) — well inside the
  400-line budget, and well under the design's own ~135-210 forecast for this slice.
- Branches: tracker `feat/multiple-doc-roots` (off `main`, draft/no-merge); child
  `feat/multiple-doc-roots-01-exclude-prefix` (off the tracker, targets the tracker).
- Commits (local only, not pushed): `feat(fs): match exclude entries against a directory prefix`.

### Status

PR 1 (Phase 1-3): **7/7 tasks complete** (1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4 — plus 3.1, 3.2 = 9/9
counting the phase-3 verification tasks). Ready for `sdd-verify` on PR 1's scope, or for the next
`sdd-apply` batch to begin PR 2 (base: this PR 1 branch, per the non-negotiable sequencing constraint
that prefixing and the collision guard must land together in PR 2).

## Remaining Tasks (PR 2, PR 3, PR 4 — not started)

- [ ] Phase 4: `resolveRoots` — baseline, then implement (TDD)
- [ ] Phase 5: `CompositeDocumentSource` — no tolerance yet
- [ ] Phase 6: Composition wiring — one unconditional path
- [ ] Phase 7: Collision guard — container-level test
- [ ] Phase 8: Goldenset + harness re-addressing
- [ ] Phase 9: Spec + verification (PR 2)
- [ ] Phase 10: Composite tolerance + alias-as-`ReadError.path`
- [ ] Phase 11: Gate 4b — a failed root protects its subtree
- [ ] Phase 12: Alias-aware `inferModule`
- [ ] Phase 13: Spec + verification (PR 3)
- [ ] Phase 14: Combined `INDEX.md`
- [ ] Phase 15: `read_doc` tolerance — tests only
- [ ] Phase 16: `vector-reach.mjs` + docs
- [ ] Phase 17: Spec + final verification (PR 4)
