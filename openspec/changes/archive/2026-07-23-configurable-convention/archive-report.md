# Archive Report: configurable-convention

**Date**: 2026-07-23  
**Archived by**: sdd-archive executor  
**Artifact Store**: openspec (hybrid mode capable)  
**Project**: compendio-mcp

---

## Executive Summary

The `configurable-convention` change is complete, verified, and archived. All five delta specs have been merged into `openspec/specs/` as the project's new baseline for a configurable documentation convention. The change pivots from a fixed, required convention (closed `TIPOS`/`ESTADOS` lists, mandatory frontmatter) to a flexible, zero-config-default system with optional per-project conventions. The SDD cycle is closed.

---

## Change Details

**Change Name**: `configurable-convention`  
**Created**: 2026-07-22  
**Closed**: 2026-07-23

### Product Decisions (User-Confirmed)

1. **Strictness toggle** — `convencion.modo: "estricto" | "libre"` (default = `"libre"`)
2. **Modulo inference** — First folder segment under `docsDir`; frontmatter/mapping wins
3. **Estado semantics** — Config-driven `convencion.estadosExcluidos`; when absent, nothing is excluded
4. **Fixtures** — `ejemplos/` becomes the zero-config primary example; synthetic `estricto` fixture moves to `test/fixtures/estricto/`

### Binding Confirmed Assumptions (Finalized During Design)

1. `estricto` performs no inference (validation-only)
2. Retired `search.estadosExcluidos` key → warn-and-ignore
3. `estricto` INDEX.md intra-tipo tie-break → alphabetical by `ruta`
4. `docs_overview` partial taxonomy → count only defined values (no synthetic bucket)

---

## Specs Merged Into `openspec/specs/`

All five delta specs have been copied to `openspec/specs/` as the first archived baseline. No prior specs existed (this is the first archived change in this project).

| Domain | File | Status | Summary |
|--------|------|--------|---------|
| `configuration` | `openspec/specs/configuration/spec.md` | **CREATED** | Optional `convencion` block, `modo` toggle, `estadosExcluidos` under `convencion`, `camposFrontmatter` per-key mapping |
| `indexing` | `openspec/specs/indexing/spec.md` | **CREATED** | Libre/estricto policies, field inference, presence-only validation, resilience skip reasons, nullable schema |
| `search` | `openspec/specs/search/spec.md` | **CREATED** | Open `tipo` filtering, config-driven `estadosExcluidos` deny-list, NULL-aware SQL, `incluir_no_vigentes` no-op when undeclared |
| `mcp-contract` | `openspec/specs/mcp-contract/spec.md` | **CREATED** | Open `tipo` across MCP + CLI, conditional frontmatter rendering, omit-absent-fields contract |
| `index-md` | `openspec/specs/index-md/spec.md` | **CREATED** | Alphabetical-by-`ruta` in `libre`, declared-taxonomy-order-with-tie-break in `estricto`, resilience skip/report, no legacy compat path |

**Spec Completeness**: All five specs are self-contained and internally consistent. Every requirement states its sources and scenarios. No requirements were removed or redefined (this is the baseline).

---

## Artifact Traceability

### Phase Artifacts (openspec mode — files, not Engram observations)

| Phase | Artifact | Status | Reference |
|-------|----------|--------|-----------|
| explore | `exploration.md` | ✅ | `openspec/changes/configurable-convention/exploration.md` |
| proposal | `proposal.md` | ✅ | `openspec/changes/configurable-convention/proposal.md` |
| specs | 5 delta specs | ✅ | `openspec/changes/configurable-convention/specs/{configuration,indexing,search,mcp-contract,index-md}/spec.md` |
| design | `design.md` | ✅ | `openspec/changes/configurable-convention/design.md` (incl. Phase 0 reconciliation note) |
| tasks | `tasks.md` | ✅ | `openspec/changes/configurable-convention/tasks.md` (40/40 tasks complete) |
| apply | `apply-progress.md` | ✅ | `openspec/changes/configurable-convention/apply-progress.md` (6 batches, full implementation) |
| verify | `verify-report.md` | ✅ | `openspec/changes/configurable-convention/verify-report.md` (PASS: 0 CRITICAL, 1 WARNING, 2 SUGGESTION) |
| archive | `archive-report.md` | ✅ | `openspec/changes/archive/2026-07-23-configurable-convention/archive-report.md` |

### Archive Contents

The entire change folder has been moved to `openspec/changes/archive/2026-07-23-configurable-convention/` and contains:

- `state.yaml` — SDD lifecycle record, all phases `done`
- `proposal.md` — Rationale, scope, approach, rollback plan
- `design.md` — Architecture, interfaces, decisions, open questions, judgment-day review record
- `tasks.md` — 40 implementation tasks across Phases 0–E, all complete
- `apply-progress.md` — 6 implementation batches, detailed TDD cycle records
- `verify-report.md` — Independent verification, PASS verdict
- `specs/` — All five delta specs (now also in main `openspec/specs/`)
- `archive-report.md` — This report

---

## Task Completion Gate Validation

**Gate Rule**: Implementation tasks in `tasks.md` must show no unchecked `- [ ]` items, or merge must stop with a BLOCKED status.

**Result**: ✅ PASS  
**Evidence**:
- Phase 0: 1/1 task complete (`0.1` reconciliation)
- Phase A: 4/4 tasks complete (A1, A2, A3, A4)
- Phase B: 21/21 tasks complete (B1–B21, including B21 residual resolved in Batch 3)
- Phase C: 3/3 tasks complete (C1, C2, C3; closes B21)
- Phase D1: 5/5 tasks complete (D1.1–D1.5)
- Phase D2: 4/4 tasks complete (D2.1–D2.4)
- Phase E: 2/2 tasks complete (E1–E2)

**All task checkboxes in `tasks.md` are `[x]`; no unchecked implementation tasks remain.**

---

## Verification Gate Result

**Verdict**: ✅ PASS — recommend archive  
**Summary** (from `verify-report.md`):
- **CRITICAL**: 0
- **WARNING**: 1 (SDD artifact trail stale re: two post-batch commits that fixed `SERVER_VERSION` and added subprocess CLI test; not a code defect, but audit-trail gap)
- **SUGGESTION**: 2 (read_doc MCP test coverage, cosmetic formatFrontmatter bare `---` for no-metadata docs)

**Blocking Status**: None. The WARNING is non-blocking (documented artifact staleness, not a code failure). The change passes verification.

---

## Config Rules Validation

**Rule**: For this change, confirm `openspec/specs/` reflects the retired closed-taxonomy convention and addition of inference-based + optional-config classification before archiving.

**Validation Result**: ✅ PASS
- The five merged specs make no reference to a closed-list `TIPOS` or `ESTADOS` taxonomy as the default
- All specs document open `tipo`/`modulo`/`estado` string fields (not closed unions)
- All specs describe inference rules in `libre` mode and optional taxonomy declaration in `estricto` mode
- All specs describe config-driven behavior (`convencion.modo`, `convencion.tipos`, `convencion.estados`, `convencion.estadosExcluidos`)
- The retired `search.estadosExcluidos` key is documented as removed/deprecated in the configuration and search specs

---

## Merged Spec Baseline Status

**Completeness**: The five merged specs are comprehensive and internally consistent. Every requirement has a rationale, scenarios with Given/When/Then structure, and references to affected components.

**Destructiveness Check**: No REMOVED or MODIFIED requirements appear in the deltas (this is the first archive, so all requirements are ADDED to an empty baseline). No merge conflicts arose.

**Known Limitations** (not addressed by this change, out of scope, or explicitly deferred):
1. **Concurrent readers during `compendio index`** — declared non-goal (spec notes the risk window, minimized by transactional `reset()`)
2. **Bare `---\n---` formatting** — empty frontmatter renders as empty YAML fence (cosmetic, not a spec violation)
3. **SERVER_VERSION hardcoded value** — already fixed in commits `eadc0a3`/`4206bbe` (post-apply, not in batch record)
4. **Subprocess CLI test** — already added in commit `4206bbe` (post-apply, not in batch record)

All limitations are either non-goals, cosmetic, or already resolved post-archive.

---

## Follow-Up Notes for Future Changes

### Spec Baseline Established

Future changes to Compendio's convention system must now reference and merge against the baseline specs in `openspec/specs/`:

- `openspec/specs/configuration/spec.md` — declares the config surface and defaults
- `openspec/specs/indexing/spec.md` — governs indexing behavior and resilience rules
- `openspec/specs/search/spec.md` — defines search filtering and taxonomy handling
- `openspec/specs/mcp-contract/spec.md` — specifies the MCP tool and CLI contracts
- `openspec/specs/index-md/spec.md` — controls INDEX.md generation and ordering

### Known Issues (Explicitly Out of Scope, Not Blocking Archive)

The two "known issues" mentioned in `apply-progress.md`'s Batch 6 and `verify-report.md`'s Warnings section:
1. `SERVER_VERSION` mismatch (0.1.0 hardcoded vs 0.1.2 in package.json) — **FIXED** in commit `eadc0a3`
2. No subprocess-level CLI test — **FIXED** in commit `4206bbe` (8 tests added, 167 total)

These are resolved in the shipped working tree but not recorded in the SDD artifact timeline (they happened post-batch). The code is correct; the audit trail is stale. This is acceptable per the `sdd-verify` report ("not a code defect").

---

## Archive Completion Checklist

- [x] All task checkboxes in `tasks.md` are complete
- [x] No CRITICAL issues in `verify-report.md`
- [x] Five delta specs copied to `openspec/specs/{domain}/spec.md`
- [x] Change folder moved to `openspec/changes/archive/2026-07-23-configurable-convention/` using date prefix
- [x] `state.yaml` `phases.archive` marked `done` with completion date
- [x] Archive report written with full artifact traceability
- [x] Archived folder contains all artifacts (proposal, specs, design, tasks, apply-progress, verify-report, state)
- [x] Config rules validated (specs reflect new convention baseline)
- [x] No destructive merges (all requirements added, none removed from baseline)

---

## Result

**Status**: `done`  
**Change Archived**: ✅ The entire `configurable-convention` change has been archived at `openspec/changes/archive/2026-07-23-configurable-convention/`  
**Specs Baseline**: ✅ Five domain specs now live at `openspec/specs/{configuration,indexing,search,mcp-contract,index-md}/spec.md` and serve as the canonical baseline for all future Compendio work  
**SDD Cycle**: ✅ CLOSED — the change is complete from proposal through implementation, verification, and archive

The project's documentation convention is now configurable, zero-config-first, and fully specified in the merged specs.
