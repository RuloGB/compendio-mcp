# Apply progress: `compendio sync` — a manual trigger for the incremental pass

**Mode**: Strict TDD (`openspec/config.yaml` `strict_tdd: true`, `apply.tdd: true`).
**Status**: 60/60 tasks complete (13/13 phases). No prior batch — single continuous apply session.
**Delivery**: single PR with accepted `size:exception` (resolved decision, not re-opened).

## TDD Cycle Evidence

| Task(s) | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1–1.4 (type surface) | n/a (typecheck only) | — | ✅ 19/19 (sync-index) | ➖ Structural (type/comment only) | ✅ `npm run typecheck` clean | ➖ Single | ➖ None needed |
| 2.1–2.4 (diff/applyChanged split, P1/P2) | `sync-progress.test.ts` (new) | Unit | ✅ 19/19 | ✅ Written (P1, P2 fail: `undefined` events) | ✅ Passed after split | — | — |
| 2.5–2.7 (P3, P4, P5, P8) | `sync-progress.test.ts` | Unit | N/A (extends 2.2's file) | ✅ Written | ✅ Passed (no further code change) | ✅ 4 more cases | ➖ None needed |
| 2.8 (baseline diff-check) | `sync-index.test.ts` | Unit | ✅ 19/19 confirmed unmodified | — | — | — | — |
| 3.1–3.3 (Gate 4, encoding notice) | `sync-index.test.ts` | Unit | ✅ 19/19 | ✅ **Approval test**: written and confirmed PASSING against the *unrefactored* code first (see note below), then re-confirmed passing after the split | ✅ Passed both before and after | ➖ Single scenario is the guard | ➖ None needed |
| 4.1–4.2 (P6, P7) | `sync-progress.test.ts` | Unit | ✅ 8/8 (P1–P5, P8) | ✅ Written (P6 fails: `[]` instead of start+tick; P7 trivially holds) | ✅ Passed after `reconcileOne` extraction | ✅ Both cases together | ➖ None needed |
| 4.3–4.5 (`reconcileOne` extraction, no `embedding/failed`) | `sync-index.ts` (production) | — | ✅ 24/24 (sync-index) + 9/9 (sync-progress) | — | ✅ | — | ✅ narrowed `embeddings` once, passed as parameter (no non-null assertion) |
| 5.1–5.3 (`reconciled` field, R1) | `sync-index.test.ts` | Unit | ✅ 20/20 (incl. Gate 4) | ✅ Written (R1 fails: `undefined` instead of `[{path,chunks:1}]`) | ✅ Passed after push site added | — | — |
| 5.4–5.6 (R2, R3, R4 — the two STOP-condition falsifiers) | `sync-index.test.ts` | Unit | ✅ 21/21 | ✅ Written (all 3 fail: `reconciled` was `undefined`) | ✅ Passed, no further code change (push site already correct from 5.3) | ✅ 3 cases covering both failure paths + the non-conflation case | ➖ None needed |
| 5.7–5.9 (P9) | `sync-progress.test.ts` | Unit | ✅ 9/9 | ✅ Written | ✅ **Passed on first run** — confirms 4.3/5.3 were correct, no new mechanism needed | ➖ Single (the load-bearing attempted-vs-written case) | ➖ None needed |
| 6.1–6.3 (out-of-blast-radius fixups) | `get-overview.test.ts`, `sync-scheduler.test.ts` | — | ✅ typecheck baseline captured failing (2× TS2375) | ✅ Failing typecheck is the RED | ✅ typecheck clean after 1-line fixups | ➖ Mechanical | ➖ None needed |
| 8.1 (S8, S9) | `cli-subprocess.test.ts` | Subprocess (real `dist/cli.js`) | ✅ 11/11 pre-existing | ✅ Written (both fail: `unknown command 'sync'`) | ✅ Passed after command registration | — | — |
| 8.2 (register `sync`, no `--dir`) | `cli.ts` (production) | — | — | — | ✅ | — | — |
| 8.3 (S7, `SYNC_HELP_NOTES`) | `cli-subprocess.test.ts` | Subprocess | ✅ 13/13 (post-8.1) | ✅ Written (fails: help body has no caveat text) | ✅ Passed after `addHelpText` wiring | ➖ Single | ➖ None needed |
| 9.1–9.2 (C1–C4, `formatSyncSummary`) | `cli.test.ts` | Unit | ✅ 4/4 (`parseType`) | ✅ Written (4/4 fail: `formatSyncSummary is not a function`) | ✅ Passed after extraction | ✅ 4 cases (common case, reconciled-only, mixed, mixed+skipped) | ➖ None needed |
| 10.1–10.2 (action wiring) | n/a (wiring only) | — | — | — | ✅ typecheck + build clean | — | — |
| 11.1–11.9 (S1–S6, S10) | `cli-subprocess.test.ts` | Subprocess | ✅ 13/13 (post-8.3) | ✅ Written (fail: stub action produces no output) | ✅ **Passed on first run** against Phase 10's wiring — confirmed no wiring bug | ✅ 7 cases across edit/delete/add/fresh-corpus/lexical-mode | ➖ None needed |
| 12.1–12.7 (spec cross-check, README, CLAUDE.md) | n/a (docs + read-only cross-check) | — | — | — | ✅ | — | — |
| 13.1–13.5 (final verification) | full suite | — | — | — | ✅ 675/675, typecheck, build | — | — |

**Note on 3.1's approval-test sequencing** (also recorded in `tasks.md`): the Gate 4 case for "a transcoded-but-unchanged document is reported every pass" is a regression guard for *preserved* behavior, not new behavior. Per `strict-tdd.md`'s Approval Testing pattern, it was written and run against the pre-refactor code first (confirmed passing, 20/20 total), and only then was the `diff`/`applyChanged`/`applyOne` split performed — re-confirmed passing immediately after. It never needed to fail against correct code; it exists to fail against the "natural, wrong-looking-right" refactor that was never shipped.

### Test Summary

- **Total tests written this session**: **27** (9 P-series progress cases + 5 sync-index additions [Gate 4 + R1–R4] + 9 subprocess S-series + 4 `formatSyncSummary` C-series; the 2 one-line `fakeReport` fixups add no cases)
- **Total tests passing**: 675/675 (full suite, up from a **648** baseline on `main` — 27 net new cases; `sync-progress.test.ts` is a new file, the rest are additions to existing files)
- **Layers used**: Unit (18: sync-index + sync-progress + cli.test.ts additions), Subprocess (9: cli-subprocess.test.ts additions)

> **Corrected by the orchestrator after `sdd-verify`.** This block originally read "46" written,
> "662 baseline", and "Unit (37)". All three were wrong and mutually inconsistent — the itemized
> breakdown on the same line sums to 9+5+9+4 = **27**, which contradicted its own total. Two
> independent measurements agree on 27: `sdd-verify` ran the suite on a `main` worktree (648) against
> HEAD (675), and the orchestrator counted the diff directly —
> `git diff main..HEAD -- test/ | grep -c "^+.*[[:space:]]it("` returns **27**, with the
> corresponding removal count returning **0**. That zero independently corroborates Gate 3's
> "additions only, none of the original 19 cases modified" claim by a second route.
>
> Recorded rather than silently overwritten: this file's whole purpose is precise TDD evidence, so a
> quietly patched number would undermine exactly what it exists to prove.
- **Approval tests** (refactoring): 1 (Gate 4's encoding-notice regression guard)
- **Pure functions created**: 2 (`formatSyncSummary`; `SyncIndex.diff` is a private pure method, not separately exported)

## Gate Verification (proposal.md `## Success Criteria`, all seven)

| Gate | Status | Evidence |
|---|---|---|
| 1 — denominator is the changed set | ✅ Satisfied | P2 (unit): 3 indexed then 1 edited → `files/start.total === 1`. S1/S2 (subprocess): `Indexing 1 documents` / `Indexing 0 documents` against a 5-document corpus, never `Indexing 5 documents` |
| 2 — end to end through spawned `dist/cli.js` | ✅ Satisfied | S3 (edit→search), S4 (delete→search), S5 (add→search), S6 (never-indexed project). All assert **stdout content**, not exit code alone |
| 3 — `serve`/`index` untouched | ✅ Satisfied | 19 original `sync-index.test.ts` cases pass unmodified (diff-confirmed additive-only); `sync-scheduler.ts` zero-diff; `progress.ts` diff is comment-only; cross-mode stdout test for `index` still green; `cli.ts`'s `serve` action and `withContainer` untouched (85 insertions / 0 deletions, fully additive) |
| 4 — transcoded-but-unchanged reported | ✅ Satisfied | New Gate 4 case in `sync-index.test.ts`: hash-matched CP1252 document still appears in `report.encodingNotices` |
| 5 — caveat and flags | ✅ Satisfied | S7 (`--help` caveat text), S8 (`sync` in command list), S9 (`--dir` rejected), S10 (`--lexical` mode). Fourth bullet routed to the existing unmodified unit case per Non-negotiable constraint 4 |
| 6 — nothing else moved | ✅ Satisfied | Full suite/typecheck/build green; README's "exactly three ways" claim removed, four-row table in place, no "reindexing" prose in the retitled section; spec grep confirms no `serve`-only scoping survives in the four reworded requirements |
| 7 — reconciliation reported, only when written | ✅ Satisfied | R1 (reported), R2 (embed failure → `[]`), R3 (rolled-back write → `[]`, `skipped`), R4 (never conflated with `indexed`), P9 (attempted batch count ≠ written report), C1–C4 (renderer, including the byte-identical common case) |

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `src/application/sync-index.ts` | Modified | `SyncIndexOptions`, `report()`; `processNewAndChanged` split into `diff`/`applyChanged`/`applyOne`; `reconcileVectors` reports `embedding/start`(conditional)/`tick`, extracted `reconcileOne`; `ReconciledFileReport`, `SyncReport.reconciled` (non-optional), `PassState.reconciled` |
| `src/composition.ts` | Modified | `syncIndexOptions` built with the two-hop `exactOptionalPropertyTypes` conditional; corrected the stale `syncIndex` field comment |
| `src/domain/progress.ts` | Modified | Module comment only — names both `compendio index` and `compendio sync`. `ProgressEvent` union unchanged |
| `src/cli.ts` | Modified | New `sync` command: `SYNC_HELP_NOTES`, `formatSyncSummary` (exported), full action wiring. Fully additive (85 insertions, 0 deletions) — `withContainer`/`index` action untouched |
| `test/application/sync-progress.test.ts` | Created | P1–P9: all progress-emission cases for `SyncIndex`, in its own file per design.md so `sync-index.test.ts`'s diff stays additive-only |
| `test/application/sync-index.test.ts` | Modified (additive) | Gate 4 case; R1–R4; `MutableSource` gains `encodingNotices` field. 19 original cases unmodified |
| `test/application/get-overview.test.ts` | Modified | `reconciled: []` added to `fakeReport` factory (1 line) |
| `test/application/sync-scheduler.test.ts` | Modified | `reconciled: []` added to `fakeReport` factory (1 line) |
| `test/cli.test.ts` | Modified | C1–C4 for `formatSyncSummary` |
| `test/cli-subprocess.test.ts` | Modified | Extended `--help` command-list assertion with `sync`; new dedicated-workdir describe block: S1–S10 |
| `README.md` | Modified | CLI table `sync` row; `## Incremental sync` retitle; four-row trigger table; throttle note |
| `CLAUDE.md` | Modified | Two full-reindex bullets now name both triggers; MCP surface note (`sync` is human-only, no fourth tool) |
| `openspec/changes/manual-sync-command/tasks.md` | Modified | All 60 tasks marked `[x]` with evidence notes |

## Deviations from Design

None — implementation matches `design.md`'s Decisions 1–9, the Interfaces/Contracts section, the Flow notes, and the Testing Strategy table exactly. One clarification worth recording: task 8.1's "the one edit to an existing case, extending the array at `:116`" and the new dedicated-workdir describe block were both implemented as specified — S8 extends the existing `--help` command-list test (which asserts no workdir state, so it carries no fixture-coupling risk), while S1–S7/S9/S10 live in the new dedicated-workdir block.

## Issues Found

None. No contradiction was found between `tasks.md`, `design.md`, and the specs — cross-checked at tasks 7.1, 7.2, 12.1, 12.2, 12.3.

## Line-Count Reconciliation

- Code + tests: **971** changed lines (909 insertions + 62 deletions) — inside the `tasks.md` forecast of 710–1120.
- Code + tests + README/CLAUDE.md: **1001** changed lines — still inside the forecast band.
- Whole branch (including openspec planning artifacts — proposal/design/exploration/specs/tasks, drafted before this apply session): **3314** lines (3239 insertions + 75 deletions), against the corrected ~3400–3800 estimate — landed slightly under, not over. The 3-way fallback split (isolating Phase 5) was never triggered; the single-PR `size:exception` decision held without needing the escape hatch.

## Status

60/60 tasks complete across all 13 phases (both the "PR 1 — engine" and "PR 2 — surface" scopes, delivered as one PR per the resolved delivery decision, with the Engine/Surface boundary preserved as commit structure). `npm test` (675/675), `npm run typecheck`, `npm run build` all green. Ready for `sdd-verify`.
