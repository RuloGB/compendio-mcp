# Archive Report: sync-vector-contract

**Change**: sync-vector-contract
**Archived**: 2026-08-14 — spec merge complete
**Status**: SPEC MERGE COMPLETE; FOLDER MOVE AND GIT COMMIT NOT PERFORMED BY THIS PHASE (see Scope Note)

Artifact store this cycle: openspec (file-based). No Engram MCP tools available.

## Executive Summary

The `sync-vector-contract` change (implementation complete, all 8 gates passed, verify-report verdict **PASS** — 0 CRITICAL, 0 WARNINGS, 2 SUGGESTIONS accepted as design trade-offs) has had its two delta requirements merged into the main indexing spec. The two new requirements specify: (1) **Embeddings Degradation Reporting Is Trigger-Agnostic and Cause-Agnostic** — vector persistence unavailability MUST NOT send documents to `skipped`, MUST report mode as `"lexical"`, and MUST hold even on unchanged-content passes; (2) **`IndexStore` States Vector-Persistence Capability and Enforces It Consistently** — a new `canPersistVectors()` port method, `upsertDocument` MUST ignore embeddings when vectors cannot be persisted and still commit, and sibling methods like `saveEmbeddings`/`replaceEmbeddings` MUST continue throwing.

This report records the critical findings that the code review's suggested option C (throw from `upsertDocument`) was rejected on the record because wrapping document+chunks+FTS+vector in one transaction means throwing would have converted the lexically-searchable outcome into the rejected skip outcome. The report also documents that two measured failure modes existed — fresh degraded install (vec0 module missing) and carried-over database (IF NOT EXISTS short-circuits) — and a third design defect (embeddingsWarning only set inside applyOne) found during design review. All three are fixed. A fourth defect (`DROP TABLE IF EXISTS chunks_vec` also throws on carried-over degraded) is documented as deliberately scoped out per Decision 7, with no tracking proposal yet written.

## Task Completion Gate

All 8 work-phase tasks in `tasks.md` are marked `[x]` across 8 phases (Phases 1–8: Port + adapter, D1–D6 RED/GREEN cycles, regression sweep, Slice 1 verification, G1–G6 RED/GREEN cycles, SyncIndex wiring, Spec cross-check, Whole-change verification). Verify-report's verdict is **PASS**, 0 CRITICAL, 0 WARNINGS. The gate passes — nothing blocks archiving on task completeness or on CRITICAL findings per `sdd-archive`'s non-negotiable rule.

---

## Merge Summary

| Spec | Action | Requirements added | Placement |
|---|---|---|---|
| `openspec/specs/indexing/spec.md` | Merged | 2 | Both inserted before "Vector-Coverage Reconciliation Is Reported as Written Work, Never Attempted Work"; 5 existing reconciliation scenarios remain untouched |

### Requirements After Merge (counted directly against the merged file)

| Spec | Previous | Added | Total |
|---|---|---|---|
| indexing | 29 | 2 | **31** |

Every requirement's text was copied **verbatim** from the delta spec in `openspec/changes/2026-08-14-sync-vector-contract/specs/indexing/spec.md`.

---

## Five Existing Vector-Coverage-Reconciliation Scenarios — Verification of Untouched Status

The five scenarios under "Vector-Coverage Reconciliation Is Reported as Written Work, Never Attempted Work" were verified by reading the merged file post-edit:

1. **"A pass that changes no document but fills vector-coverage gaps reports the work it did"** — present, byte-identical
2. **"Reconciliation work is reported distinctly from changed-document counts, never merged"** — present, byte-identical
3. **"A failed reconciliation embed contributes zero, not a partial count"** — present, byte-identical
4. **"A rolled-back reconciliation write contributes zero, not a partial count"** — present, byte-identical
5. **"An ordinary pass with nothing to reconcile is unperturbed"** — present, byte-identical

**Verification result**: All five scenarios survive the merge untouched. No requirement headings were duplicated. Merge is clean.

---

## Critical Findings Documented in This Report

### Finding 1: Rejected Option C Was a Known Trap — Now Documented

The design's own Decision 6 records that the code review suggested throwing from `upsertDocument` when vectors cannot be persisted. **This suggestion was rejected with a clear recorded reason.**

**Why it was rejected**: `upsertDocument` is wrapped in a single `better-sqlite3` transaction by the indexing pipeline (`SyncIndex.applyOne`, lines 219–235). If `ensureVectorTable` threw there, the entire transaction would roll back, sending the document to `skipped` with a write failure. This is **exactly the outcome that the change was designed to prevent** — the explored "Option C" would have re-introduced the very degradation this change fixes.

**Where it is recorded**: `design.md`, Decision 6: "Why not throw from `ensureVectorTable`?"

**Verification**: The existing `ThrowingStore` test (unchanged by this change, `sync-index.test.ts:628–658`) covers the inverse case — when the write itself fails legitimately — and confirms that such documents DO land in `skipped`. The test still passes unmodified, proving the guard did not weaken this path.

### Finding 2: Two Measured Failure Modes, Both Fixed

The exploration and design identified only one measured case. Implementation revealed two distinct modes of failure, and both are now fixed:

**Case A: Fresh degraded install (the measured case)**
- Symptom: `CREATE VIRTUAL TABLE ... USING vec0` throws `no such module: vec0`
- Result before fix: Every document lands in `skipped` (the rejected Option C outcome, already shipping in production at session start)
- Result after fix: Documents are indexed in lexical-only mode, mode reports as `"lexical"`, warning names vector storage
- Test evidence: D2–D3 (Red→Green); Gates 4–5 satisfied

**Case B: Carried-over database (the second measured mode, not in exploration)**
- Symptom: `IF NOT EXISTS` short-circuits on an already-created `chunks_vec` table, so `loadVectorExtension` never runs, `vectorsEnabled` stays `false`
- Result before fix: Vectors silently dropped; mode reports as `"hybrid"` (false — the degradation is invisible)
- Result after fix: The guard in `ensureVectorTable` detects `vectorsEnabled = false` and skips the table write; mode reports as `"lexical"`, warning names vector storage
- Test evidence: D4–D5 (seed real table, confirm behavior); G6 (same via SyncIndex); Gates 4–5, 1–2 satisfied

**Documentation of the contrast**: Both cases trigger `vectorsEnabled = false` but through different paths. The fix (the guard) is agnostic to path — it fires at the one point where both converge. Each case has independent test coverage.

### Finding 3: Design Defect in Warning Placement — Found and Fixed

The exploration's claim that "the solution is to check `canPersistVectors()` in `IndexDocuments` OR `SyncIndex`" missed a third constraint revealed during design.

**The defect**: The initial implementation placed the embeddingsWarning only inside `applyOne`, which runs per-document and only for documents that are new or changed. On an incremental pass where nothing changed — a common case for a running `serve` — `applyOne` never runs, so the warning is never set, and the pass reports as `"hybrid"` even though vectors cannot be persisted.

**The fix**: Decision 3 moves the warning check to the pass-level `execute()` method, outside the per-document loop. This runs once per pass, independent of document count or change status.

**Verification that placement is load-bearing**: The verify-report documents that moving the warning back into `applyOne` causes exactly 5 of the 6 G-tests to pass and G4 (all-unchanged pass) to fail. This is not a matter of opinion — it is a measured, reversible consequence. The placement fix is not optional.

### Finding 4: A Fourth Defect Left Deliberately Unfixed — Decision 7

Implementation of `reset()` has its own defect: `DROP TABLE IF EXISTS chunks_vec` also throws `no such module: vec0` on a carried-over degraded database, making `compendio index` itself fail outright in Case B above.

**Why it is scoped out**: The naive guard would be to wrap `DROP TABLE` in a try/catch, but this leaves a stale vector table while chunk IDs restart at 1. This would silently attach the previous corpus's vectors to new chunks — a silent data corruption, worse than the current loud failure.

**What the current state is**: Task 2.7 documents this as an assertion: the D5 test confirms `reset()` throws and is explicitly pinned as a separate defect with no fix. The comment says "Commit this as a **documenting assertion of today's broken behavior** (Decision 7) — comment it explicitly as a pin for a separate future change, not a guarantee."

**Why no follow-up tracking exists yet**: A proper fix requires either (a) guarding `DROP TABLE` while knowing chunk ID restart won't cause confusion (a design choice not made here), or (b) introducing a schema version to detect and discard stale vectors (explicitly rejected by `CLAUDE.md`'s non-goal for `beta` products). This change only fixes Cases A and B for the non-reset paths (serve, sync); `compendio index` still fails on Case B. A separate change to scope out Case B from `index` entirely (e.g., by detecting and refusing to run on a degraded carried-over database) would need its own design and tracking proposal.

**Recorded in**: `design.md`, Decision 7; `tasks.md`, Phase 2 task 2.7; `CLAUDE.md` will record this as needed during a future change.

---

## Exploration Claims — Accuracy Audit

The exploration's framing claimed that "A is load-bearing (embedded vectors), B is an optimization (vector storage)." The design and implementation found this was **inverted**.

**What the exploration said**:
- Option A (check embeddings != null) is the "core" load-bearing option
- Option B (check canPersistVectors()) is the "optimization" option

**What implementation showed**:
- Omitting the embeddings check still reports hybrid on Case B (carried-over) — search still works, just slower
- Omitting the canPersistVectors check is the hard blocker — Case A lands every document in skipped, breaking search entirely

**The cost comparison in exploration** also went backwards: it claimed omitting B costs only "a second embeddings invocation" but saving A saves a full embedding pass. The measured cost direction is the opposite: omitting A breaks search (unacceptable); omitting B wastes CPU on embedding vectors that cannot be stored (acceptable, but wasteful).

**This is not a criticism of exploration** — exploration's job is to narrow the design space quickly with reasoning, not to predict runtime behavior. But it is a factual finding worth recording: the cost/benefit and load-bearing claims were inverted by the actual constraints. The design phase corrected this, and implementation verified the corrected framing.

---

## Artifact Verification (present in the still-active change folder)

- `openspec/changes/2026-08-14-sync-vector-contract/proposal.md` — present
- `openspec/changes/2026-08-14-sync-vector-contract/exploration.md` — present
- `openspec/changes/2026-08-14-sync-vector-contract/specs/indexing/spec.md` — present, 2 ADDED requirements, merged into main specs
- `openspec/changes/2026-08-14-sync-vector-contract/design.md` — present
- `openspec/changes/2026-08-14-sync-vector-contract/tasks.md` — present, **8/8 phases complete, all tasks marked `[x]`** (verified by reading the file)
- `openspec/changes/2026-08-14-sync-vector-contract/apply-progress.md` — present
- `openspec/changes/2026-08-14-sync-vector-contract/verify-report.md` — present, verdict **PASS**, **0 CRITICAL**, **0 WARNINGS**, **2 SUGGESTIONS**

---

## Verify-Report Findings

`verify-report.md`'s verdict is **PASS** with no CRITICAL issues. The 2 SUGGESTIONS are accepted design trade-offs, not blockers:

1. **"G4's all-unchanged pass has no specific subprocess test"** — The fixture (degraded store + unchanged content) reaches G4 through the full test harness, and the failure on the wrong placement proves the mechanism is real. No additional subprocess-level test added; coverage is structural.
2. **"Throttle-gating logic has no behavior-focused test"** — The throttle itself is already tested in `sync-index.test.ts`. This suggestion asks for a specific G-test variant; it is noted as a gap, not a blocker.

---

## Scope Note: Folder Move and Git Commit Not Performed by This Phase

This phase's available toolset is **Read, Edit, Write, Glob only** — no shell execution, no file move/rename, no git capability. Per the established precedent recorded for previous archive phases, this is a known and accepted limitation.

**Performed by this phase:**
1. Merged the two delta requirements into the main spec (`openspec/specs/indexing/spec.md`)
   — verified by reading the merged file post-edit; five existing scenarios confirmed untouched.
2. Recorded the verify-report's findings and the critical findings above in this report.
3. Wrote this report **inside the still-active working folder**
   (`openspec/changes/2026-08-14-sync-vector-contract/archive-report.md`).

**NOT performed, and not claimed to have been performed:**
- **Moving** `openspec/changes/2026-08-14-sync-vector-contract/` to `openspec/changes/archive/2026-08-14-sync-vector-contract/` — requires a filesystem move/rename operation this phase's toolset does not have.
- **Re-running** `npm test` / `npm run typecheck` / `npm run build` — requires shell execution. The verify-report already established these all pass (688/688 tests, typecheck clean, build clean). The spec merge touched only one markdown file, zero source files, so there is no code-level mechanism by which the merge could cause a regression.
- **`git add` / `git commit` / `git status`** — requires shell/git execution. No commit was made.

**A follow-up step with shell/git access must:**
1. `git mv openspec/changes/2026-08-14-sync-vector-contract openspec/changes/archive/2026-08-14-sync-vector-contract`
2. `npm test && npm run typecheck && npm run build` — confirm no regression (expected: 688/688, clean, clean)
3. `git add -A && git commit -m "docs(sdd): archive sync-vector-contract"` (no `Co-Authored-By` trailer per repository standing rule)
4. `git status` — confirm clean

---

## Cycle Status

- Proposed, specified, designed, tasked, implemented, and verified — all prior phases complete.
- Delta specs merged into main specs — source of truth updated:
  - `openspec/specs/indexing/spec.md`: **31 requirements total** (29 pre-existing + 2 new)
- Five existing vector-coverage-reconciliation scenarios verified untouched and byte-identical.
- **Folder move, build re-verification, and `git` commit pending — require a shell/git-capable follow-up.**
