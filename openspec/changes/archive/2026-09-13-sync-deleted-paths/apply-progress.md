# Apply Progress: sync-deleted-paths

Status: all 8 phases / 36 tasks complete (first and only batch). `tasks.md` checkboxes updated to `[x]`.

## Baseline (safety net, before touching src/)

- `npx vitest run test/infrastructure/discover-markdown-roots.test.ts test/composition.test.ts` → 2 files, 31 tests passed.
- `node dist/cli.js --root ejemplos index` → 11 documents, 29 chunks, mode hybrid.
- `node dist/cli.js --root ejemplos eval` → hybrid recall@5=1.00 MRR=0.943 failures=0; lexical recall@5=0.95 MRR=0.856 failures=1. (Baseline to match post-change — matched, see below.)

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.9 | `test/infrastructure/discover-markdown-roots.test.ts` (`describe("validateDiscoveredRootAlias")`) | Unit (real tmp + `vi.doMock`) | ✅ 31/31 (pre-existing) | ✅ Written (7 characterization + 1 new-behavior) | N/A — see Phase 2 | ✅ 7 cases beyond the target scenario | N/A |
| 2.1-2.2 | same file | Unit | — | ✅ Written; run against unmodified source: only "returns undefined when the alias directory was deleted (ENOENT)" failed (RED, correct reason — old code threw ENOENT). All 7 characterization tests + the recreate-empty test (2.2) were already green (matches design table: "No RED expected"). | ✅ Passed after 3.1 | ✅ 9 total cases in the describe block | ✅ Clean (single small function change) |
| 3.1-3.2 | `src/infrastructure/fs/discover-markdown-roots.ts`, `src/infrastructure/fs/dynamic-discovery-document-source.ts` | — | ✅ 31/31 | (implementation, not test) | ✅ 17/17 in discover-markdown-roots.test.ts | — | ✅ JSDoc + one comment added |
| 3.3 | — | — | — | — | ✅ `npx vitest run test/infrastructure/discover-markdown-roots.test.ts` 17/17; `npm run typecheck` clean | — | — |
| 4.1-4.2 | sabotage-and-revert (2 rounds) | — | — | ✅ Round 1: catch-all in the lstat `catch` block → 1.5/1.6/1.7 (EACCES, EPERM, message-only-ENOENT) failed RED as expected. Round 2 (for 5.4's claim): whole-function catch-all sabotage → "fails closed on a non-ENOENT unreadable discovered root" failed RED (promise resolved instead of rejecting, openspec purged instead of aborting). Both reverted; `git diff src/` confirmed only the intended two-file fix remains. | ✅ Confirmed green again after each revert | — | — |
| 5.1 | grep audit | — | — | ✅ Only 4 pre-existing spots reference ENOENT/disappear/unreadable/deleted in `test/composition.test.ts` (L331, L347, L384, L451) — no hidden dependents. | — | — | — |
| 5.2 | `test/composition.test.ts` — rewrote L347 test (now "purges a discovered root's documents on sync when the root is deleted from disk (ENOENT)") | Integration (real fs) | ✅ | ✅ Written and run against unmodified src → RED (threw ENOENT as before) | ✅ Passed after Phase 3 | — | — |
| 5.3 | rewrote L384 test (now "purges every discovered root's documents in a freshly reconstructed container when all roots disappear") — extended to 2 roots so it also proves the full-purge-on-sync case | Integration | ✅ | ✅ RED against unmodified src | ✅ Passed after Phase 3 | — | — |
| 5.4 | retargeted L451 test (now "fails closed on a non-ENOENT unreadable discovered root...") from `rm` to file-replaces-folder | Integration | ✅ | Stayed green throughout (non-ENOENT path unaffected by the fix) — verified per Phase 4 round 2 that it fails against a whole-function catch-all sabotage | ✅ | — | — |
| 5.5 | new test "rebuilds without a deleted root's documents on a full reindex" | Integration | ✅ | ✅ RED against unmodified src | ✅ Passed after Phase 3 | — | — |
| 5.6 | new test "leaves an empty index when a full reindex runs after every discovered root is deleted" | Integration | ✅ | ✅ RED against unmodified src | ✅ Passed after Phase 3 | — | — |
| 5.7 | new test "purges a deleted discovered root on the next throttled sync pass through the scheduler" | Integration (`SyncScheduler.maybeSync`) | ✅ | ✅ RED against unmodified src (store still had the deleted doc) | ✅ Passed after Phase 3; asserts `lastReport.deleted`, purge, and no `incremental sync failed` on `console.error` | — | — |
| 5.8 | L331 (single-root file-replaces-folder) and L478 (junction) | — | ✅ | Unchanged, confirmed still passing throughout | ✅ | — | — |
| 5.9 | RED batch run | — | — | ✅ `npx vitest run test/composition.test.ts` against unmodified src: 5 failed (5.2, 5.3, 5.5, 5.6, 5.7) for the expected reason (old ENOENT-throws behavior), 21 passed (including 5.4/5.8) | — | — | — |
| 5.10 | GREEN batch run | — | — | — | ✅ `npx vitest run test/composition.test.ts` → 26/26 passed after Phase 3 | — | — |

### Test Summary
- Total tests written/rewritten: 9 (discover-markdown-roots) + 7 (composition: 2 rewritten, 1 retargeted, 3 new, plus the existing 8.3 assertion untouched) = 16 new/changed test bodies.
- Total tests passing at close: discover-markdown-roots.test.ts 17/17, composition.test.ts 26/26, full suite 1062/1063 (1 skipped — Windows-8.3-only test, pre-existing skip condition, unrelated to this change).
- Layers used: Unit (9, real-tmp + `vi.doMock`), Integration (7, real filesystem via `mkdtemp`/`rm`/`writeFile`).
- Approval tests: none — this is new/inverted behavior, not a refactor of unchanged behavior.
- Pure functions touched: `validateDiscoveredRootAlias` (already pure; signature narrowed to include `undefined`).

## Phase 6 — Full suite and manual gate

- `npm test`: **57 files passed, 1062 tests passed, 1 skipped** (pre-existing Windows-8.3-only skip, unrelated).
- `npm run typecheck`: clean (`tsc --noEmit && tsc -p tsconfig.test.json`).
- `npm run build`: clean.

### Manual gate (built CLI only, `node dist/cli.js`, scratchpad fixtures under `.../scratchpad/repro`)

| Scenario | Command | Exit | Result |
|---|---|---|---|
| Delete one top-level discovered root (`guides/`) | `sync` on fixture `sdd` (6 docs, roots `docs`+`guides`) after `rm -rf sdd/guides` | 0 | stdout: `Synced 0 documents (0 chunks), 2 deleted in 53 ms [mode hybrid]`; db: 4 rows left, all under `docs/` |
| Delete every remaining discovered root | `index` on same fixture after also `rm -rf sdd/docs` | 0 | stdout: `Indexed 0 documents (0 chunks) ... Nothing to index.`; db: 0 document rows, 0 chunks, 0 fts rows |
| Replace a root directory with a plain file (fail-closed regression) | fresh fixture `sdd2` (6 docs), `rm -rf sdd2/guides && echo "not a directory" > sdd2/guides`, then `sync` | 1 | stderr: `previously discovered documentation root "guides" is not a directory`; db: all 6 pre-existing rows preserved |

### ejemplos eval — unchanged vs. baseline

- Before (pre-change baseline) and after (post-change, re-run at close) both produced: hybrid recall@5=1.00, MRR=0.943, 0 failures; lexical recall@5=0.95, MRR=0.856, 1 failure (`"¿Qué endpoint hay que llamar para crear un lead?"` → position 11). **Identical.**

## Phase 7 — Documentation and spec closure

- `docs/design-decisions.md`: rewrote the last sentence of "Unreadable roots fail closed in discovery mode" (title/anchor unchanged) — added the 2026-09-13 reversal clause, the full list of failures that still fail closed, the mid-pass-race self-heal note, and the "why ENOENT is authoritative" argument.
- `AGENTS.md`: added one clause to the existing bullet in place — "...discovery mode fails closed before any store mutation, except a root whose `lstat` reports `ENOENT`, which is purged." No new line, anchor unchanged.
- `src/infrastructure/fs/composite-document-source.ts`: reviewed the `failOnRootError` doc comment — no edit needed; it already refers to `failOnRootError` generically and stays accurate (a deleted root is never selected before `CompositeDocumentSource` runs).
- `openspec/specs/indexing/spec.md`: confirmed no further edits needed — already written in `sdd-spec`.

## Phase 8 — Final verification gates

- `npm test`, `npm run typecheck`, `npm run build` re-run after doc edits: all green, no stray syntax issues.
- `SyncReport` / MCP contract: `git diff --stat src/domain/ports.ts src/server.ts` is empty (no changes); `grep -n "SyncReport"` in those files finds no diff-relevant hits — shape is byte-identical.
- MCP surface: `server.test.ts`'s 3-tools assertion is part of the 1062 passing tests above (unchanged, no new tool registered).

## Deviations from design

None. Implementation matches design.md exactly: `validateDiscoveredRootAlias` returns `DiscoveredMarkdownRoot | undefined`, `DynamicDiscoveryDocumentSource.discover()` skips `undefined`, `error.code === "ENOENT"` check (never message matching), `composite-document-source.ts` untouched, `realpathSync.native` untouched.

One test-design deviation from the task list's literal wording, noted for transparency: task 2.2 was labeled `[RED]` but per design.md's own testing table this scenario was expected to be a characterization case ("No" RED). Confirmed: it was already green pre-Phase-3 (recreating the alias before validation runs behaves like any other present directory — no ENOENT path is hit). No behavior gap; recorded as characterization rather than RED, consistent with design.md.

## Files changed (`git diff --stat`)

```
 AGENTS.md                                          |   2 +-
 docs/design-decisions.md                           |   2 +-
 src/infrastructure/fs/discover-markdown-roots.ts   |  12 +-
 .../fs/dynamic-discovery-document-source.ts        |   6 +-
 test/composition.test.ts                           | 102 +++++++++++--
 .../infrastructure/discover-markdown-roots.test.ts | 167 ++++++++++++++++++++-
 6 files changed, 277 insertions(+), 14 deletions(-)
```

291 total changed lines — within the forecasted 230-310 budget (Low risk, single PR, no chaining needed).

## Status

36/36 tasks complete. Ready for `sdd-verify`. Nothing committed — per instructions, the user tests locally before anything reaches git.
