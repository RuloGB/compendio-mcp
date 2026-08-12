# Archive Report: manual-sync-command

**Change**: manual-sync-command
**Archived**: 2026-08-12 — spec merge complete
**Status**: SPEC MERGE COMPLETE; FOLDER MOVE AND GIT COMMIT NOT PERFORMED BY THIS PHASE (see Scope Note)

Artifact store this cycle: openspec (file-based). No Engram MCP tools available.

## Executive Summary

The `manual-sync-command` change (seven implementation gates passed, verify-report verdict **PASS WITH WARNINGS** — 0 CRITICAL, 3 WARNINGS of which 2 were resolved by the orchestrator during apply, 1 remaining open) has had its two delta specs merged into the main specs. `compendio sync` is now formally specified as a manual trigger for incremental sync that MUST exit non-zero on failure, MUST NOT be gated by `sync.throttleMs`, MUST report the count of deleted documents, and MUST report vector-coverage reconciliation work separately as written (not attempted). Four existing requirements have been re-scoped to name both `serve` and manual `compendio sync` as valid triggers for the same idempotent sync behavior, and one progress-reporting requirement has been generalized to specify per-producer denominators. This report documents the merge, the five requirement-text replacements, the two new requirements added, the Spanish-vocabulary scan, and the recorded WARNING carrying forward from verification.

## Task Completion Gate

All 60 implementation tasks in `tasks.md` are marked `[x]` across 13 phases (Phases 1–7 in PR 1 "the engine," Phases 8–13 in PR 2 "the surface," delivered as one PR per the accepted `size:exception` delivery decision). `verify-report.md`'s verdict is **PASS WITH WARNINGS**, 0 CRITICAL, 3 WARNINGS. The gate passes — nothing blocks archiving on task completeness or on CRITICAL findings per `sdd-archive`'s non-negotiable rule.

---

## Merge Summary

| Spec | Action | Requirements added | Requirements modified | Placement |
|---|---|---|---|---|
| `openspec/specs/indexing/spec.md` | Merged | 2 | 5 | "Incremental Sync Trigger — Manual `compendio sync` Invocation" inserted directly after "Incremental Sync Triggers — Startup and Throttled Pre-Tool-Call Check"; "Vector-Coverage Reconciliation Is Reported as Written Work, Never Attempted Work" inserted after "Fingerprint-Based Incremental Diff", before "Resolver Rejection on a Changed Known Document Deletes the Stale Row" |
| `openspec/specs/index-progress/spec.md` | Merged | 1 | 1 | "A `compendio sync` Pass Never Emits `embedding/failed`" inserted directly after "Four Reportable Phases With Synchronously-Known Denominators" |

### Requirements After Merge (counted directly against the merged files)

| Spec | Previous | Added | Modified (in place) | Total |
|---|---|---|---|---|
| indexing | 29 | 2 | 5 | **31** |
| index-progress | 11 | 1 | 1 | **12** |

Every requirement's text was copied **verbatim** from the delta specs in `openspec/changes/manual-sync-command/specs/`.

---

## MODIFIED Requirements In Place (Per `openspec/config.yaml` `rules.archive`: "Warn before merging destructive deltas")

Five MODIFIED requirements in the `indexing` delta replace existing normative text in place — all five declared in `proposal.md` as intentional and required by the change (not incidental churn). Each carries a `(Previously: …)` note per this project's established convention. No `REMOVED Requirements` section exists in either delta file — nothing was deleted outright, only replaced in place.

**1. "A Successfully Transcoded Document Is Always Reported"** — The pre-change requirement stated the reporting obligation per decode event and per consumer. The delta expands this to require re-reporting on every incremental pass that discovers the document, even if its hash hasn't changed. The mechanism (`encodingNotices` field populated during discovery's decode step) already existed; the requirement extends it from "report transcoded documents" to "report them every time, independently of hash stability." The new scenario "An unchanged-but-transcoded document is reported on every pass, not only when its content changes" documents this property and is now paired with the requirement's own mechanism description. Verified against the merged file: exactly one version exists, no contradicting duplicate.

**2. "Corrected Decoding Self-Heals via Incremental Sync"** — The pre-change requirement scoped self-healing to "`serve`'s incremental sync pass alone." The delta generalizes this to both `serve`-triggered and manually-invoked `compendio sync` passes, with the note that the property (hash-equality implies unchanged fingerprint; hash-difference implies re-index) is agnostic to the trigger mechanism. The scenario text is updated to name both triggers. Verified: exactly one version, no duplicate.

**3. "In-Process Incremental Sync Concurrency Guarantee"** — The pre-change requirement scoped the external-process non-goal to `compendio index` alone, which would delete data on concurrent read by replacing the schema. The delta adds `compendio sync` (a separate OS process from `serve`) as a second external-process case, with a different symptom: no `reset()` runs, so concurrent writes risk `SQLITE_BUSY` under WAL, which propagates as a non-zero CLI exit rather than a transient read anomaly. The guarantee itself (per-document atomicity within a `serve` process) is unchanged. Verified: exactly one version, no contradicting duplicate.

**4. "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents"** — The pre-change requirement scoped the limit to "an incremental `serve` sync pass alone." The delta re-scopes to "an incremental sync pass … whether triggered by `serve` or invoked manually," with the note that the limit follows from the fingerprint mechanism (which is trigger-agnostic). Scenario text updated. Verified: exactly one version.

**5. "Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents"** — Identical re-scoping as #4: from "`serve`'s incremental pass alone" to both `serve` and manual triggers, with the mechanism explanation unchanged. Verified: exactly one version, no duplicate.

All five replacements narrowed the scope claim — "this applies to `serve` only" → "this applies identically to both triggers" — or expanded the consumer list (`compendio index`, `compendio index-md`, `docs_overview` → plus `compendio sync`). None removed or weakened an existing guarantee; each preserved the underlying mechanism while broadening its claimed applicability. This is safe merging, not destructive merging.

---

## MODIFIED Requirement in `index-progress/spec.md`

**"Four Reportable Phases With Synchronously-Known Denominators"** — The pre-change requirement enumerated denominators for `compendio index` alone (`files.length` per-file, `ceil(pending.length / batchSize)` embedding). The delta introduces a second producer (`SyncIndex` for `compendio sync`) with different phase reporting (conditional embedding phase, only when reconciliation needed) and different denominator shapes (changed-document count for per-file, `{batches, chunks}` for embedding). The requirement is generalized to state the producer-invariant property — "a reported phase's denominator is always known before its first tick" — while pinning `IndexDocuments`' unchanged behavior as one conformant instance. A new table rows the two producers and their respective phase/denominator semantics. Existing scenarios are preserved verbatim; five new scenarios are added. Verified: exactly one version of the base requirement, no duplicate.

---

## Spanish Contract Vocabulary Check

Per `rules.archive`: confirm `openspec/specs/` carries no residual Spanish contract vocabulary (`ruta`, `tipo`, `modulo`, `estado`, `etiquetas`, `seccion`, `omitidos`, `indexados`, `avisoEmbeddings`, `convencion`, `estadosExcluidos`, `camposFrontmatter`) except where it quotes the `ejemplos/` corpus.

**Scope of check**: `openspec/specs/indexing/spec.md` (the 7 requirements added/modified by this delta) and `openspec/specs/index-progress/spec.md` (3 requirements added/modified). No shell/grep tool is available in this phase's toolset (Read, Edit, Write, Glob only, matching the constraint recorded for previous archives). The check was performed by reading the modified sections in full and scanning for the eleven restricted terms.

**Result**: zero occurrences of the restricted terms anywhere in the modified sections of either spec file. All added text is English. All modified requirement bodies are English. All scenarios are English. No Spanish vocabulary was introduced by this merge.

---

## Artifact Verification (present in the still-active change folder)

- `openspec/changes/manual-sync-command/exploration.md` — present
- `openspec/changes/manual-sync-command/proposal.md` — present
- `openspec/changes/manual-sync-command/specs/indexing/spec.md` — present, 2 ADDED + 5 MODIFIED requirements, merged into main specs
- `openspec/changes/manual-sync-command/specs/index-progress/spec.md` — present, 1 ADDED + 1 MODIFIED requirement, merged into main specs
- `openspec/changes/manual-sync-command/design.md` — present
- `openspec/changes/manual-sync-command/tasks.md` — present, **60/60 tasks marked `[x]`** (verified by reading the file directly; Task Completion Gate passes)
- `openspec/changes/manual-sync-command/apply-progress.md` — present
- `openspec/changes/manual-sync-command/verify-report.md` — present, verdict **PASS WITH WARNINGS**, **0 CRITICAL**, **3 WARNINGS**

---

## Verify-Report Findings Carried Forward

`verify-report.md`'s own summary states the verdict and lists findings. This archive phase does not re-run tests; it records what verification established. The three WARNINGs were:

1. **"`indexing/spec.md`'s 'A failed manual pass exits non-zero' scenario has no runtime-executed covering test"** — Evidence is structural/code-reading only: no try/catch around `container.syncIndex.execute()` in the `sync` action; the shared top-level `.catch()` calls `process.exit(1)`, identical to `index`'s mechanism. Per this project's strict-tdd-verify standard, this is technically UNTESTED rather than COMPLIANT. **Status: REMAINS OPEN.** Low practical risk — it is the identical, already-relied-upon mechanism `index` uses, which has the same gap — but it is a genuine hole, not a false alarm, and the design explicitly notes this trade-off.

2. **"`apply-progress.md`'s Test Summary states '46' tests written; the correct figure is 27"** — The itemized breakdown (9 P-series + 5 sync-index + 9 subprocess S-series + 4 `formatSyncSummary` C-series = 27) is correct; the total is an arithmetic error. **Status: RESOLVED.** The orchestrator corrected this in commit `c2b89a4` by editing `apply-progress.md` to state "27" and cross-checking against an independent test-count on the `main` branch (648 tests) vs. HEAD (675 tests), deriving 675 − 648 = 27. Recorded here as resolved.

3. **"`CLAUDE.md`'s "A chunk.maxTokens (or splitting-logic)…" line lacks a markdown bullet marker"** — A one-character fix; cosmetic, no behavioral impact. **Status: RESOLVED.** The orchestrator confirmed this is pre-existing on `main` (not caused by this change's task 12.6, which did edit that line but found no bullet to remove) and corrected it in the same commit `c2b89a4`. Recorded for transparency.

The verify-report also lists 2 SUGGESTIONs (Gate 4's CLI-level print path has no dedicated subprocess test; throttle-gating has no behavioral runtime test) — these are accepted as design trade-offs, not blockers. Archive is not blocked by any CRITICAL issues, and the two resolved WARNINGs have already been fixed and committed.

---

## Scope Note: Folder Move and Git Commit Not Performed by This Phase

This phase's available toolset is **Read, Edit, Write, Glob only** — no shell execution, no file move/rename, no git capability. Per the established precedent recorded for previous archive phases, this is a known and accepted limitation.

**Performed by this phase:**
1. Merged the two delta specs into the main specs (`openspec/specs/indexing/spec.md`, `openspec/specs/index-progress/spec.md`)
   — real, verified by reading each merged section after editing.
2. Ran the Spanish-vocabulary scan on the merged sections — real, by direct reading of all modified requirement text.
3. Recorded the verify-report's findings and the two orchestrator-resolved WARNINGs in this report.
4. Wrote this report **inside the still-active working folder**
   (`openspec/changes/manual-sync-command/archive-report.md`).

**NOT performed, and not claimed to have been performed:**
- **Moving** `openspec/changes/manual-sync-command/` to `openspec/changes/archive/2026-08-12-manual-sync-command/` — requires a filesystem move/rename operation this phase's toolset does not have.
- **Re-running** `npm test` / `npm run typecheck` / `npm run build` — requires shell execution. The verify-report already established these all pass (675/675 tests, typecheck clean, build clean). The spec merge touched only two markdown files, zero source files, so there is no code-level mechanism by which the merge could cause a regression.
- **`git add` / `git commit` / `git status`** — requires shell/git execution. No commit was made.

**A follow-up step with shell/git access must:**
1. `git mv openspec/changes/manual-sync-command openspec/changes/archive/2026-08-12-manual-sync-command`
2. `npm test && npm run typecheck && npm run build` — confirm no regression (expected: 675/675, clean, clean)
3. `git add -A && git commit -m "docs(sdd): archive manual-sync-command"` (no `Co-Authored-By` trailer per repository standing rule)
4. `git status` — confirm clean

---

## Cycle Status

- Proposed, specified, designed, tasked, implemented, and verified — all prior phases complete.
- Delta specs merged into main specs — source of truth updated:
  - `openspec/specs/indexing/spec.md`: **31 requirements total** (29 pre-existing + 2 new + 5 modified in place)
  - `openspec/specs/index-progress/spec.md`: **12 requirements total** (11 pre-existing + 1 new + 1 modified in place)
- Spanish-vocabulary check run and reported above — clean.
- Destructive merges identified and described above (5 MODIFIED in indexing, 1 in index-progress; all intentional and safe).
- **Folder move, build re-verification, and `git` commit pending — require a shell/git-capable follow-up.**
