# Archive Report: Bounded Chunk Size

**Change**: `bounded-chunk-size`
**Branch**: `feat/bounded-chunk-size`
**Mode**: openspec (repo-local, file-based)
**Commits**: `f5ec119` (Gate 1b tooling, zero production code), `8f8fef7` (the splitter, wiring, `480`
default, docs), `21825fc` (closed the two WARNING gaps `sdd-verify` raised)

## Task Completion Gate

`openspec/changes/bounded-chunk-size/tasks.md` read directly before any merge/archive action: all 55
tasks (1.1–1.10, 2.1–2.9, 3.1–3.3, 4.1–4.8, 5.1–5.6, 6.1–6.5, 7.1–7.2, 8.1–8.2, 9.1–9.7, 10.1–10.3) are
checked `[x]`, none `[ ]`. `verify-report.md` independently confirms the same count by re-reading
`tasks.md` in its own session. No stale-checkbox reconciliation was needed.

## Verification Summary (from `verify-report.md`)

- **Verdict**: PASS WITH WARNINGS
- **Tasks**: 55/55 complete
- **Build/Test/Typecheck**: all PASSED — 376/376 tests, clean build, clean typecheck (re-derived
  independently in the verify session, not copied from `apply-progress.md`)
- **CRITICAL issues**: 0
- **Spec compliance**: Indexing spec 15/15 scenarios traced to passing tests or correct documentation
  (0 UNTESTED, 0 FAILING); Configuration spec 0/2 ADDED scenarios had a covering automated test at
  verify time (see Warnings below — both since closed)
- **WARNING 1** (Configuration spec's two ADDED scenarios — default `480` and a declared override
  staying enforced — had no automated runtime-passing test): **fixed by `21825fc`**. Both scenarios
  now have covering tests.
- **WARNING 2** (`README.md:207`'s "How it works" diagram still read "tables are never cut", the exact
  false claim this change exists to correct): **fixed by `21825fc`**. The stale claim is corrected.

Since both WARNINGs are closed and there were never any CRITICAL findings, this change satisfies the
gentle-ai strict archive policy (CRITICAL-free, all tasks genuinely complete) without needing any
user override or intentional-partial-archive note.

## Manual Gate Results

| Gate | Metric | Before | After |
|---|---|---|---|
| Gate 1 (`ejemplos/` eval, hybrid) | recall@5 / MRR / failures | — | 1.00 / 0.943 / 0 (baseline held exactly) |
| Gate 1b (vector-only reachability) | marker chunk rank | 4 of 6 | **1 of 10** |
| Gate 1b | marker cosine vs. filler-band ceiling | 0.8357, inside band [0.8274, 0.8385] | **0.8800**, above ceiling 0.8441 |
| Gate 1b | truncation probe (reported, not gated) | 0.9947 | 0.9447 |
| Gate 2 (full 38-doc corpus) | `ba/manual.md` chunks | 1 | **99** (predicted ~88) |
| Gate 2 | corpus total chunks | 242 | **358** (predicted ~330) |
| Gate 2 | full index wall-clock | 367 s | **~31 s** (predicted ~60 s) |
| Gate 3 | chunks exceeding `maxTokens` in real persisted indexes | — | **0** |

Full suite: 379/379 passing at close (376 at the verify snapshot, plus the tests `21825fc` added to
close WARNING 1).

## Delta Specs Merged Into Main Specs

### `openspec/specs/indexing/spec.md`

- **ADDED** (appended before the final requirement, preserving the file's existing tail position): 6
  requirements — "Chunk Size Is an Unconditional Upper Bound", "Split Preference Cascade With
  Guaranteed Fallback", "A Split Markdown Table's Pieces Stay Valid Markdown", "Every Split Piece
  Retains Its Full Heading Path", "`NO_CHUNKING` Suppresses Heading-Based Splitting Only", "Chunk
  Boundary Changes Require a Full Reindex to Reach Existing Documents".
- **MODIFIED**: "English Contract Preserves the `ejemplos/` Multilingual Retrieval Baseline" —
  replaced in place with the delta's version (original text preserved verbatim, plus a new "Scope of
  the 'hold exactly' clause" paragraph, a `(Previously: ...)` annotation, and a third scenario
  narrowing the exact-hold clause to the frontmatter-key rename alone). Confirmed exactly one
  requirement with this title exists in the merged file (no duplicate).
- All pre-existing requirements in the main spec (Resilience Skip Reasons, `loose`/`strict` mode
  validation, Field Inference, Optional Persisted Metadata, Concurrent Readers, Fingerprint-Based
  Incremental Diff, Resolver Rejection, Per-Document Upsert, Incremental Sync Triggers, Read Failures
  Protect..., In-Process Incremental Sync Concurrency Guarantee) were preserved untouched.

### `openspec/specs/configuration/spec.md`

- **ADDED** (appended at end of file): "Default `chunk.maxTokens` Is 480 and Is a Guaranteed Upper
  Bound", with its two scenarios (no-config-file default, declared-override still enforced as a
  bound).
- All pre-existing requirements (`convention` block defaults, `convention.mode` toggle,
  `excludedStatuses`, `frontmatterFields` mapping, `sync`/`throttleMs`) were preserved untouched.

Both merges followed `~/.claude/skills/_shared/openspec-convention.md`'s ADDED/MODIFIED rules and
matched the pre-existing structure of `openspec/specs/*/spec.md` (including the project's established
`# Delta for {Domain}` / single `## ADDED Requirements` heading convention already present in these
files from prior archived changes — not altered here, as renaming it was out of scope for this
archive).

## Corrections Made Mid-Cycle (recorded for traceability, not re-litigated here)

1. **Proposal's "splitter fires once on `ejemplos/`" claim** — corrected during apply (Phase 8):
   `## Reglas de negocio` has H3 children, so `chunkOutline` descends to H3 before `splitToBound` is
   ever reached; the splitter never fires on `ejemplos/` at all. Gate 1 proves only that
   already-conforming documents were not broken; Gate 1b is the gate that exercises the splitter.
2. **`CLAUDE.md`'s Gate 2 framing** — corrected to state Gate 2 is blocking and gates on
   *falsification* of the predicted direction/magnitude, not a tolerance band around the point
   estimates (which measured moderately above prediction on chunk counts and well below on
   wall-clock, both with traced mechanisms).

## Reusable Lesson (worth surfacing beyond this change)

Three defects passed through green reports during this cycle before being caught by re-running or
fuzzing from outside the suite, never by reading the reports themselves:

1. An unfalsifiable Gate 1b pass criterion (`containsMarker` was text containment — before the split
   the marker's chunk *is* the whole document, so it could never fail).
2. A measurement script comparing re-embedded chunk vectors against stored `chunks_vec` vectors —
   different populations, because batch padding shifts stored values by ~0.002.
3. A `splitToBound` defect that shipped 9/9 green with a passing mutation proof while silently
   dropping content (an oversized, unterminated fence returned `[]` instead of its content).

All three were found by independent re-execution (re-running gates, fuzzing edge cases), not by
auditing the green report text. This matches the project's existing memory
`compendio-agentes-reportan-verde-falso.md` and reinforces it rather than introducing a new lesson.

## Traceability

| Artifact | Path |
|---|---|
| Exploration | `openspec/changes/bounded-chunk-size/exploration.md` |
| Proposal | `openspec/changes/bounded-chunk-size/proposal.md` |
| Delta spec (indexing) | `openspec/changes/bounded-chunk-size/specs/indexing/spec.md` |
| Delta spec (configuration) | `openspec/changes/bounded-chunk-size/specs/configuration/spec.md` |
| Design | `openspec/changes/bounded-chunk-size/design.md` |
| Tasks | `openspec/changes/bounded-chunk-size/tasks.md` |
| Apply progress | `openspec/changes/bounded-chunk-size/apply-progress.md` |
| Verify report | `openspec/changes/bounded-chunk-size/verify-report.md` |
| This archive report | `openspec/changes/bounded-chunk-size/archive-report.md` |
| Merged main spec (indexing) | `openspec/specs/indexing/spec.md` |
| Merged main spec (configuration) | `openspec/specs/configuration/spec.md` |

Engram (`mem_*`) tools were not available in this execution context, matching the note already
recorded in `verify-report.md`'s Persistence Note for the same reason. Per this task's brief ("Engram
tools may be unavailable; if so, note it and continue — the files are the deliverable"), this file is
the sole persisted artifact for the archive phase.

## Folder Move — Not Performed By This Agent

This agent has no shell tool and did not move, rename, or delete any directory. The move of
`openspec/changes/bounded-chunk-size/` to `openspec/changes/archive/2026-08-05-bounded-chunk-size/`
is the coordinator's responsibility and has NOT happened as part of writing this report. This report
and the spec merges above are complete; the filesystem move is a separate, outstanding step.

## Status

**Specs merged**: done (indexing + configuration, verified byte-by-byte after edit).
**Archive folder move**: NOT performed by this agent — outstanding, coordinator-owned.
**SDD cycle**: implementation, verification, and spec-of-record update are complete; the change is
ready for the coordinator to complete the archival move.
