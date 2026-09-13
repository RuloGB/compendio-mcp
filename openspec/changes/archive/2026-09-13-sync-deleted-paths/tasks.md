# Tasks: Deleting a Discovered Root Purges Its Documents

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~230-310 (src ~13, test ~200-280, docs ~15) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Whole change (discovery-layer fix + fail-closed regression proof + tests + docs) | PR 1 | Single cohesive slice; two files change in `src/`, tests dominate the diff, well under 400 lines |

## Phase 1: Characterize current fail-closed behavior (RED proof before touching src/)

- [x] 1.1 In `test/infrastructure/discover-markdown-roots.test.ts`, add `describe("validateDiscoveredRootAlias")` with a real temp-directory fixture (mirror the existing `discoverMarkdownRootDetails` test setup).
- [x] 1.2 [RED] Test: alias directory present → returns a result with `trustedRealPath` matching `await realpath(...)`.
- [x] 1.3 [RED] Test: alias path is a file, not a directory → throws `/is not a directory/`.
- [x] 1.4 [RED] Test: alias path is a junction/symlink → throws `/symlink or junction/`.
- [x] 1.5 [RED] Test (`vi.doMock("node:fs")`, existing mocking pattern in the file): `lstatSync` throws `EACCES` → throws `/could not be inspected/`.
- [x] 1.6 [RED] Test: `lstatSync` throws `EPERM` → throws `/could not be inspected/`.
- [x] 1.7 [RED] Test: `lstatSync` throws an error with no `code` but "ENOENT" in the message text → throws `/could not be inspected/` (proves the check is `error.code`, not message matching).
- [x] 1.8 [RED] Test: `lstatSync` succeeds but `realpathSync.native` throws `ENOENT` → throws `/could not be resolved/`.
- [x] 1.9 Run 1.2-1.8 against the current (unmodified) `validateDiscoveredRootAlias` — confirm 1.3/1.4/1.5/1.6/1.7/1.8 are already green (characterization, no RED expected) and 1.2 is already green. Record in this session's scratchpad that these pin existing behavior, not new behavior.

## Phase 2: RED — the new ENOENT-is-deleted behavior

- [x] 2.1 [RED] `test/infrastructure/discover-markdown-roots.test.ts`: alias directory deleted from disk → `validateDiscoveredRootAlias` returns `undefined` (not a throw).
- [x] 2.2 [RED] `test/infrastructure/discover-markdown-roots.test.ts`: alias deleted then recreated as an empty directory before validation runs → returns a result (validated, not skipped) — the delete-then-recreate race from the design's "Migration / Rollout"/exploration risk list.

## Phase 3: GREEN — discovery-layer fix

> Ordering (orchestrator gate, 2026-09-13): execute Phase 5's RED steps (5.1–5.7 and the RED run in 5.9) BEFORE starting 3.1, so every rewritten or new `composition.test.ts` test is seen failing against the unmodified source. The "temporarily revert Phase 3" fallback in 5.9 is then unnecessary. Phase 5.8 and 5.10 still run after Phase 3.

- [x] 3.1 `src/infrastructure/fs/discover-markdown-roots.ts`: change `validateDiscoveredRootAlias`'s return type to `DiscoveredMarkdownRoot | undefined`; in the `lstatSync` catch block, check `(error as NodeJS.ErrnoException).code === "ENOENT"` and return `undefined` in that case; every other error keeps rethrowing unchanged. Update the JSDoc to state `undefined` means the alias was deleted.
- [x] 3.2 `src/infrastructure/fs/dynamic-discovery-document-source.ts`: in `discover()`, when `validateDiscoveredRootAlias` returns `undefined`, skip that alias (do not add it to selected roots) instead of propagating an error; add a one-line comment noting the path-presence diff purges it downstream.
- [x] 3.3 Run 1.2-1.8 (still green, unmodified behavior) and 2.1-2.2 (now green) with `npx vitest run test/infrastructure/discover-markdown-roots.test.ts`. Run `npm run typecheck`.

## Phase 4: Prove the fail-closed regression tests can actually fail (sabotage-and-revert)

- [x] 4.1 Temporarily sabotage `validateDiscoveredRootAlias` in a scratch copy or via a local uncommitted edit (e.g. make it swallow every `lstatSync` error and return `undefined`, or match `error.message.includes("ENOENT")` instead of `error.code`). Run 1.5/1.6/1.7 (EACCES, EPERM, message-only-ENOENT) and confirm they fail RED against the sabotaged version. Record the failure output in the session scratchpad.
- [x] 4.2 Revert the sabotage; confirm 1.5/1.6/1.7 are green again against `src/infrastructure/fs/discover-markdown-roots.ts` as committed in Phase 3.

## Phase 5: `test/composition.test.ts` — invert, retarget, extend (RED first)

- [x] 5.1 Grep `test/composition.test.ts` for every test name/comment mentioning ENOENT, "disappear", "unreadable", or the deleted-root scenario (not only the three named in design.md at ~L347/L384/L451) to confirm no other test silently depends on today's throw-on-ENOENT behavior.
- [x] 5.2 [RED] Rewrite the test at ~L347 ("aborting sync when a discovered root disappears with ENOENT"): two discovered roots, `rm(root, { recursive: true })` on one, `sync` now resolves (not rejects), `deleted` includes that root's paths, the healthy root's documents are unchanged. Rename the test to describe the new (purge) behavior.
- [x] 5.3 [RED] Rewrite the test at ~L384 ("...freshly reconstructed container"): same deletion, reconstruct the container from scratch, `sync` resolves with the store purged of the deleted root's documents; this also covers "deleting every root leaves the index empty" when both discovered roots are removed.
- [x] 5.4 [RED, then confirm still-green] Retarget the test at ~L451 ("fails closed on any unreadable discovered root before mutating healthy roots") from `rm` to a non-ENOENT trigger: `rm` the alias directory then `writeFile` a plain file at the same path (file replaces folder). Expect `/openspec.*not a directory/s` (or the alias name in scope), and assert the healthy root's documents are untouched. This must fail if the ENOENT check is ever widened to a catch-all — verify that claim per Phase 4's method against a scratch catch-all mutation, then revert.
- [x] 5.5 [RED] New test: `index` (not `sync`) after deleting one of two discovered roots rebuilds successfully without that root's documents.
- [x] 5.6 [RED] New test: every discovered root deleted, then `index` resolves with an empty index (`getOverview().totalDocuments === 0`, no rows in any table).
- [x] 5.7 [RED] New test: `serve` recovery path — index, `rm` a discovered root, call `container.syncScheduler.maybeSync()` directly (the first call always runs per existing scheduler semantics), assert the store is purged, `lastReport.deleted` contains the removed paths, and nothing is written to `console.error` matching `/incremental sync failed/`.
- [x] 5.8 Confirm ~L331 (single-root file-replaces-folder) and ~L478 (junction) are unchanged and still pass — do not touch them.
- [x] 5.9 Run 5.2, 5.3, 5.5, 5.6, 5.7 and confirm RED against the still-unmodified `discover-markdown-roots.ts`/`dynamic-discovery-document-source.ts` from before Phase 3 — if Phase 3 is already applied, instead re-verify RED by temporarily reverting Phase 3's src changes, then reapplying them.
- [x] 5.10 [GREEN] Run all of `test/composition.test.ts` (`npx vitest run test/composition.test.ts`) against Phase 3's implementation; fix any gap in `discover-markdown-roots.ts` or `dynamic-discovery-document-source.ts` surfaced by 5.2-5.7.

## Phase 6: Full suite and manual gate

- [x] 6.1 Run `npm test` (full suite, `pool: "forks"`), `npm run typecheck`, `npm run build` — all green.
- [x] 6.2 Manual gate in the session scratchpad, built CLI only (`node dist/cli.js`, never bare `compendio`), reusing `C:/Users/Raul/AppData/Local/Temp/claude/C--Users-Raul-Workspace-compendio-mcp/d41993c5-d27b-470f-9a5c-d1479beb67d2/scratchpad/repro` (`mk.sh`, `run.sh`, `dbstate.cjs`):
  - Rebuild fixture with `mk.sh`; discovery mode; delete one top-level root (`guides/`); run `node dist/cli.js --root <fixture> sync` → exit 0, `"... N deleted"`, `dbstate.cjs` shows zero rows for the deleted root.
  - Delete every remaining discovered root; run `sync` or `index` → exit 0, empty index (`dbstate.cjs` shows zero document rows).
  - Fresh fixture; replace a root directory with a plain file; run `sync` → still exit 1, error mentions the alias, `dbstate.cjs` shows the pre-existing rows preserved (fail-closed intact).
  - Record exact commands and output in the scratchpad.
- [x] 6.3 `ejemplos/` eval unchanged: `node dist/cli.js --root ejemplos index` then `node dist/cli.js --root ejemplos eval` — same numbers as before this change.

## Phase 7: Documentation and spec closure

- [x] 7.1 `docs/design-decisions.md`: rewrite the last sentence of "Unreadable roots fail closed in discovery mode" (keep the section title and anchor) per design.md's File Changes entry — ENOENT on `lstat` means deleted-and-purged on `sync`/`index`; every other failure (EACCES, EPERM incl. delete-pending, EIO, symlink/junction, non-directory, realpath failure, escape) still fails closed; a mid-pass race aborts one pass and self-heals the next; add the "why ENOENT is authoritative" argument and the 2026-09-13 reversal note.
- [x] 7.2 `AGENTS.md`: edit the existing one-line "unreadable roots fail closed" bullet in place (no new paragraph) to add the clause: "...except a root whose `lstat` reports `ENOENT`, which is purged." Keep the anchor link intact.
- [x] 7.3 `src/infrastructure/fs/composite-document-source.ts`: re-read its doc comment; edit only if its current wording claims every discovery-mode failure aborts (it should describe the narrower condition after this change). No edit if the wording already only refers to `failOnRootError` generically.
- [x] 7.4 Confirm `openspec/specs/indexing/spec.md` (already written in `sdd-spec`) needs no further edits; this phase only touches prose docs, not the spec delta.

## Phase 8: Final verification gates

- [x] 8.1 `npm test`, `npm run typecheck`, `npm run build` green one more time after Phase 7 doc edits (docs-only changes should not affect these, but confirm no stray syntax issue).
- [x] 8.2 Confirm `SyncReport` shape and the MCP contract are byte-identical (no new fields) — grep `src/domain/ports.ts` / `src/server.ts` for `SyncReport` usages, diff against pre-change.
- [x] 8.3 Confirm the MCP surface is still exactly 3 tools (existing `server.test.ts` assertion, re-run as part of 8.1).

---

## Follow-ups (out of scope, not tasks)

- Align explicit mode's `reason.includes("ENOENT")` string match (`FileDocumentSource.walk`) to `error.code` — different mode, its own tests, deferred.
- Windows case-only root rename selecting both aliases — not addressed by this change.
