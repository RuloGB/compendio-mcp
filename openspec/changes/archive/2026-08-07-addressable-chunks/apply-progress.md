# Apply Progress: A Chunk Heading Is Never Empty

**Mode**: Strict TDD
**Status**: 35/35 tasks complete. Ready for `sdd-verify`.

Single PR, `size:exception` (per `state.yaml`'s `delivery_decision`). Work Unit 1 (write side, Phases
1–5) landed first and checkpointed green before Work Unit 2 (read side, Phases 6–8) began, per the
design's cut line preserved as the review structure inside this one PR.

## Completed Tasks

All 35 tasks across 12 phases are complete and marked `[x]` in `tasks.md`.

- [x] 1.1 `VECTOR_REACH_DOCS` export in `test/helpers/build.ts`
- [x] 2.1–2.5 Baseline tests (Phase 2), run and recorded on unmodified `src/` first
- [x] 3.1–3.5 `documentHeading`/`withNonEmptyHeadings` (RED/GREEN) + segment filter + 2.2(b) inversion
- [x] 4.1–4.2 `index-pipeline` seam wiring + Gate 2 inversion
- [x] 5.1–5.3 Gate 1/3 inversion + `-.md` round-trip case + Work Unit 1 checkpoint
- [x] 6.1–6.4 `read-document.ts` `no-sections` variant (RED/GREEN)
- [x] 7.1–7.3 `formatReadResult` export/retype/new-case (RED/GREEN, Gate 4) + Work Unit 2 checkpoint
- [x] 8.1–8.2 Contract text (`server.ts` tool descriptions)
- [x] 9.1 Spec cross-check — no file edit needed, every scenario already satisfied
- [x] 10.1–10.4 Gate 5 scope falsifiers — all four confirmed identity
- [x] 11.1–11.3 Gate 6 docs — `CLAUDE.md` three additions
- [x] 12.1–12.2 Recorded observations — `verify-report.md`

## Phase 2 baseline run (the observation that makes Gate 1 capable of failing)

Ran on **unmodified** `src/`, with only the four new baseline tests added (no production code
touched yet):

```
Test Files  38 passed (38)
     Tests  567 passed (567)
```

All four baselines passed, confirming the fixture reproduces the reported defect rather than a
fixture bug. Full transcript and per-gate results are in `verify-report.md`.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `src/domain/chunking.ts` | Modified | Added `UNTITLED_HEADING`, `documentHeading`, `withNonEmptyHeadings`; filtered empty path segments before the `" > "` join |
| `src/application/index-pipeline.ts` | Modified | Computed the fallback and wrapped both chunk producers in `withNonEmptyHeadings` at the seam |
| `src/application/read-document.ts` | Modified | Added the `no-sections` `ReadResult` variant; filtered empty members out of `availableSections` |
| `src/server.ts` | Modified | Exported + retyped `formatReadResult` (now takes `ReadResult`); added the `no-sections` case with a defensive second filter; two tool-description edits (document-region wording) |
| `CLAUDE.md` | Modified | New non-obvious-decisions bullet (heading invariant, fallback chain, reindex consequence); caveat next to the Gate 1b table |
| `test/helpers/build.ts` | Modified | `VECTOR_REACH_DOCS` export |
| `test/domain/chunking.test.ts` | Extended | `emptyTitleOutline()` helper; 3 new tests (2.1, 2.2a stay `""` forever by design; 2.2b inverted to `"Parent"`) |
| `test/domain/heading-fallback.test.ts` | Created | 9 tests: `documentHeading` all 4 levels + `withNonEmptyHeadings` postconditions |
| `test/application/index-pipeline.test.ts` | Extended | 3 new tests: Gate 2 both branches (inverted from baseline) + unit `documentHeading("","")` |
| `test/application/heading-less-round-trip.test.ts` | Created | 2 tests: Gate 1/3 over `manual-extenso.md`, Gate 3 over the `-.md` punctuation case |
| `test/application/read-document.test.ts` | Extended | 2 new tests: `no-sections` seeded directly, `availableSections` filter with mixed headings |
| `test/server/format-read-result.test.ts` | Created | 8 tests: literal output for all 5 `ReadResult` variants including the defensive-filter edge cases |
| `openspec/changes/addressable-chunks/tasks.md` | Modified | All 35 tasks marked `[x]` |
| `openspec/changes/addressable-chunks/verify-report.md` | Created | Gate 1–6 results, Phase 12 observations |

## TDD Cycle Evidence

| Task(s) | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `test/helpers/build.ts` | N/A (fixture export, one possible output) | N/A (new) | ➖ N/A | ➖ N/A | Triangulation skipped: structural export, no logic | ➖ None needed |
| 2.1 | `chunking.test.ts` | Unit | ✅ 18/18 pre-edit | ✅ Written (approval-test baseline, asserts CURRENT `""` behavior) | ✅ Passed on unmodified `src/` | ➖ Single scenario (intro-only heading-less outline) | ➖ None needed — stays a permanent regression test, never inverted (design task 3.5) |
| 2.2a | `chunking.test.ts` | Unit | ✅ (same run) | ✅ Written (baseline, empty top-level `##` among real sections) | ✅ Passed on unmodified `src/` | ➖ Single scenario | ➖ None needed — stays permanent (design task 3.5) |
| 2.2b | `chunking.test.ts` | Unit | ✅ (same run) | ✅ Written (baseline `"Parent > "`), later re-RED when inverted to `"Parent"` before 3.4 landed | ✅ Passed after 3.4 (segment filter) | ✅ 2 states (before/after the join filter) forced the real logic, not a hardcode | ➖ None needed |
| 2.3 | `index-pipeline.test.ts` | Integration | ✅ 2/2 pre-edit | ✅ Written (baseline, `-.md` both branches, `heading === ""`) | ✅ Passed on unmodified `src/` | ✅ 2 branches (`chunkOutline`, `wholeDocumentChunk`/`NO_CHUNKING`) | ➖ None needed (later inverted in 4.2) |
| 2.4 | `heading-less-round-trip.test.ts` (new) | Integration (full `IndexDocuments`→`SearchDocuments`→`ReadDocument`) | N/A (new file) | ✅ Written (baseline, `manual-extenso.md`, all-empty headings) | ✅ Passed on unmodified `src/` | ➖ Single scenario at this stage (triangulated later by the `-.md` case in 5.2) | ➖ None needed |
| 2.5 | — | — | — | Full-suite run recorded above and in `verify-report.md` | ✅ 567/567 | — | — |
| 3.1–3.2 | `heading-fallback.test.ts` (new) | Unit | N/A (new file) | ✅ Written, calling `documentHeading`/`withNonEmptyHeadings` before they existed — confirmed `TypeError: ... is not a function` | ✅ 9/9 passed after 3.3 | ✅ 9 cases: 4 `documentHeading` levels (incl. whitespace-only title, `("","")`) + 5 `withNonEmptyHeadings` postconditions (replace/preserve/uniform/untouched-fields/mixed) | ✅ None needed — both functions are minimal one-liners by construction |
| 3.3–3.4 | `src/domain/chunking.ts` | Unit (production) | ✅ 18/18 `chunking.test.ts` pre-edit | (see 3.1–3.2) | ✅ | — | — |
| 3.5 | `chunking.test.ts` (invert 2.2b) | Unit | ✅ 27/27 pre-edit | ✅ Re-asserted `"Parent > "` was RED once 3.4 landed | ✅ Inverted assertion to `"Parent"`, passed | ➖ Single scenario | ➖ None needed |
| 4.1 | `src/application/index-pipeline.ts` | Integration (production) | ✅ 5/5 `index-pipeline.test.ts` pre-edit | (see 4.2) | ✅ | — | — |
| 4.2 | `index-pipeline.test.ts` (invert Gate 2) | Integration | ✅ (same) | ✅ Inverted 2.3's baseline to `heading === "-.md"` before 4.1 landed — RED | ✅ Passed after 4.1 | ✅ 3 cases (`chunkOutline` branch, `NO_CHUNKING` branch, unit `documentHeading("","")`) | ➖ None needed |
| 5.1 | `heading-less-round-trip.test.ts` (invert Gate 1) | Integration | ✅ 1/1 pre-edit | ✅ Inverted baseline to `"Manual extenso"` — RED before 4.1 landed, GREEN after | ✅ Passed | ➖ Single scenario (already covered by 2.4) | ➖ None needed |
| 5.2 | same file, Gate 3 (`-.md` case, new) | Integration | ✅ (same) | ✅ Written — new isolated-corpus test, temp dir + real `IndexDocuments`/`SearchDocuments`/`ReadDocument` | ✅ Passed | ✅ 2 documents (`manual-extenso.md`, `-.md`) exercising the round trip through two different fallback levels (title-derived vs. path-derived) | ➖ None needed |
| 5.3 | — | — | — | Work Unit 1 checkpoint: `npm test` (39 files/578 tests), `npm run typecheck` | ✅ Both green | — | — |
| 6.1–6.2 | `read-document.test.ts` (extended) | Integration (seeded `SqliteIndexStore(":memory:")`) | ✅ 13/13 pre-edit | ✅ Written, asserting `result.type === "no-sections"` / filtered `availableSections` before the variant existed — confirmed failing (`section-not-found` returned instead / `['', 'Real section']` contained `''`) | ✅ 15/15 passed after 6.3 | ✅ 2 cases (all-empty-heading store → `no-sections`; mixed empty+real headings → filtered `section-not-found`) | ➖ None needed |
| 6.3 | `src/application/read-document.ts` | Integration (production) | (see 6.1–6.2) | — | ✅ | — | — |
| 6.4 | — | — | — | — | ✅ 15/15 | — | — |
| 7.1 | `format-read-result.test.ts` (new) | Unit | N/A (new file) | ✅ Written, importing `formatReadResult` before it was exported — confirmed `TypeError: formatReadResult is not a function` (8/8 failing) | ✅ 8/8 passed after 7.2 | ✅ 8 cases across all 5 `ReadResult` variants, including the 3 defensive-filter edge cases (`['']`, `['', 'A']`, `[]`) Decision 5 exists for | ➖ None needed |
| 7.2 | `src/server.ts` | Unit (production) | (see 7.1) | — | ✅ | — | — |
| 7.3 | — | — | — | Work Unit 2 checkpoint: `npm test` (40 files/588 tests), `npm run typecheck` | ✅ Both green | — | — |
| 8.1–8.2 | `src/server.ts` (prose only) | N/A (tool-description text, no branching logic) | N/A | N/A | N/A | Triangulation skipped: pure string literals, no logic to force out | N/A |
| 9.1 | spec cross-check | N/A (verification, no diff) | — | — | — | — | — |
| 10.1–10.4 | Gate 5 verification | N/A (diff-check + full-suite + build + eval, no new tests) | ✅ 588/588 + typecheck + build + eval identity | — | ✅ | — | — |
| 11.1–11.3 | `CLAUDE.md` (docs only) | N/A | — | — | — | — | — |
| 12.1–12.2 | `verify-report.md` (manual observation) | N/A | — | — | — | — | — |

### Test Summary

- **Total tests written this session**: 27 (chunking.test.ts +3, heading-fallback.test.ts +9,
  index-pipeline.test.ts +3, heading-less-round-trip.test.ts +2, read-document.test.ts +2,
  format-read-result.test.ts +8)
- **Total tests passing**: 588/588 (full suite; 561 pre-existing + 27 new)
- **Layers used**: Unit (20), Integration (7)
- **Approval tests** (baselines characterizing current behavior before the fix): 6 — `2.1`, `2.2a`,
  `2.2b`, `2.3`×2 (both branches), `2.4`. Two of these (`2.1`, `2.2a`) are deliberately **never**
  inverted — they pin `chunkOutline`'s own remaining limit (a single-empty-segment path still
  collapses to `""` at that layer) that only `withNonEmptyHeadings` at the seam closes, per design
  task 3.5's explicit instruction not to duplicate the invariant into `chunkOutline`.
- **Pure functions created**: 3 — `documentHeading`, `withNonEmptyHeadings`
  (`src/domain/chunking.ts`), `formatNoSections` (`src/server.ts`, extracted so the `no-sections`
  prose has one source of truth for both the dedicated variant and the filtered-to-empty
  `section-not-found` fallthrough)

## Gate Results (full detail in `verify-report.md`)

| Gate | Result |
|---|---|
| Gate 1 (defect reproduces, then disappears) | **PASSED** |
| Gate 2 (invariant on output, not data source) | **PASSED** |
| Gate 3 (round trip through the public contract) | **PASSED** — both `manual-extenso.md` and the `-.md` punctuation case |
| Gate 4 (failure path says something true) | **PASSED** |
| Gate 5 (scope falsifiers) | **PASSED** — reassembly tests unchanged (diff-confirmed), `SCHEMA_DDL`/`ports.ts`/`model.ts` unchanged (diff-confirmed), `npm test`/`typecheck`/`build` green, `compendio eval` identity (MRR 0.943, recall@5 1.00, top-1 20/22 — all three exactly match the pinned baseline) |
| Gate 6 (operational consequence documented) | **PASSED** — spec requirement (already written by `sdd-spec`) + `CLAUDE.md` |

## Deviations from Design

None. Implementation matches design.md's Decisions 1–6 exactly: the seam wraps both producers in one
`withNonEmptyHeadings` call (Decision 1); the fallback chain is `title → path → UNTITLED_HEADING`
(Decision 2); the seam is crossed by a post-hoc map, not a signature change (Decision 3);
`no-sections` is a new `ReadResult` member, reachable only via a pre-fix, unreindexed corpus
(Decision 4); `formatReadResult` is exported and filters defensively a second time (Decision 5); no
change to `Chunk.content`, so `ejemplos/` eval identity holds (Decision 6, and Gate 1b's cosines are
caveated in `CLAUDE.md` rather than re-measured, per the design's explicit choice not to promote that
to a gate here).

## Issues / Discoveries Found

1. **`npm run typecheck` is NOT actually blind to `test/`, contrary to design.md's Testing Strategy
   note and the apply brief's non-negotiable #4.** Verified: `package.json`'s `typecheck` script is
   `tsc --noEmit && tsc -p tsconfig.test.json`, and `tsconfig.test.json` (`include: ["src/**/*",
   "test/**/*"]`) is a **pre-existing** file, untouched by this change (confirmed via `git log` — last
   touched by an unrelated release commit, not by this cycle). The first half (`tsc --noEmit` against
   the root `tsconfig.json`, `include: ["src/**/*"]`) is indeed blind to `test/`, which is what the
   design's claim is narrowly true of — but the actual `npm run typecheck` command chains a second
   pass that IS test-aware. This did not change how I worked (strict TDD was followed regardless, and
   every new production branch has a real behavioral test), but it means a green `npm run typecheck`
   in this repo is stronger evidence than the design assumed — it would have caught, for instance, a
   test that switched on `ReadResult.type` and missed the new `no-sections` member. Worth correcting
   in `design.md`/future `CLAUDE.md` notes if this surprises the verify phase; not corrected here since
   editing design.md is out of this phase's scope.
2. **Top-1 count (20/22, part of Gate 5) has no CLI flag.** `compendio eval` prints `recall@5`/`MRR`/
   failures only; there is no `--verbose` option exposing per-question rank. Computed instead with a
   disposable script run against the compiled `dist/composition.js` (not committed, deleted after
   use) that reruns every goldenset question and counts `rank === 1`. Documented in `verify-report.md`
   so the method is reproducible, not just the number.

## Workload / PR Boundary

- Mode: single PR, `size:exception` (per `state.yaml`'s `delivery_decision`, decided by the user
  2026-08-07)
- Current work unit: both — Work Unit 1 (write side) and Work Unit 2 (read side) are both complete
  in this apply pass
- Boundary: this batch starts from the unmodified repository and ends with all 35 tasks complete,
  `npm test`/`typecheck`/`build` green, and `compendio eval` identity confirmed
- Estimated review budget impact: over the 400-line PR budget, as forecast at both proposal (290–505)
  and design (540–770) phases and accepted by the user as `size:exception`. Actual diff size not
  measured here (that is a `git diff --stat` the orchestrator/reviewer can run); the design's cut line
  (Work Unit 1 then Work Unit 2) is preserved as the commit/review structure, not as a PR boundary.

## Status

35/35 tasks complete. `npm test` (588/588), `npm run typecheck`, `npm run build` all green.
`compendio eval` on `ejemplos/` is identity (MRR 0.943, recall@5 1.00, top-1 20/22). Ready for
`sdd-verify`.
