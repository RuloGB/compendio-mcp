# Archive Report: Filter Input Hygiene

**Change**: `filter-input-hygiene` (Finding 1.3 from code-review-findings-1.3-1.5)
**Archived**: 2026-08-15
**Cycle Status**: COMPLETE
**Verification**: PASS (0 CRITICAL, 0 WARNING, 2 non-blocking SUGGESTION)

## Cycle Summary

The change addresses a three-field asymmetry in `SearchDocuments.buildFilters` where `type` receives trim-and-empty-drop normalization while `module` and `tags` do not, causing empty/whitespace-only filter values to reach SQL and produce misleading diagnostics. Internal precedent motivated the fix: `resolveTags` already applies the exact normalization at indexing time, and `type`'s handling in `buildFilters` is the model for `module`.

**Duration**: proposal → design → implementation → verification → archive
**Merged**: PR #32, main branch at `e0985eb` (full suite 792/792 green)
**Commits**: 4 (feat domain:add-tag-normalization, refactor domain:resolveTags-delegate, fix search:buildFilters-normalize, docs:CLAUDE.md)

## Spec Merge

**Delta source**: `openspec/changes/2026-08-15-filter-input-hygiene/specs/search/spec.md`
**Merge target**: `openspec/specs/search/spec.md`

### Requirements Added to Main Spec

Two new ADDED requirements were merged into `openspec/specs/search/spec.md` between the existing "Open `type` Filtering" requirement and "Config-Driven `excludedStatuses`" requirement:

1. **Open `module` Filtering** (3 scenarios)
   - Empty or whitespace-only `module` treated as absent
   - Module matching is case-preserving (never lowercased)
   - Blank module filter against module-less corpus produces no configuration advice

2. **Tags Filtering Trims Entries And Drops Empties** (3 scenarios)
   - Tag with surrounding whitespace matches its stored form (trimmed)
   - Mixed array keeps valid entries and drops blank ones
   - Array that becomes empty after trimming treated as absent

**Merge type**: Additive only. All 5 requirements from the main spec (3 pre-existing + 2 new) are now in place, with no deletions or modifications to existing requirements.

## Spanish Vocabulary Verification

Checked `openspec/specs/search/spec.md` for residual Spanish contract vocabulary. **Result: CLEAN**.

Searched for and confirmed absence of: `ruta`, `tipo`, `modulo`, `estado`, `etiquetas`, `seccion`, `omitidos`, `indexados`, `avisoEmbeddings`, `convencion`, `estadosExcluidos`, `camposFrontmatter` (except where the text quotes the `ejemplos/` corpus, which is deliberately Spanish).

Confirmed: all contract vocabulary is English (`type`, `module`, `tags`, `status`, `convention`, `excludedStatuses`, `frontmatterFields`, etc.).

## Implementation Facts

- **Scope addition**: `src/domain/tags.ts` (new shared `normalizeTags` module) + `src/domain/frontmatter.ts` delegation
- **Behavioral fix**: `src/application/search-documents.ts` (single enforcement point in `buildFilters`)
- **Documentation**: `CLAUDE.md` entry recording the chokepoint
- **Test gates**: 4 gates (module-blank, module-case, tags-padded, tags-mixed) with RED/GREEN evidence
- **Falsifiers**: `test/domain/frontmatter.test.ts` unmodified (11/11 green), `test/cli.test.ts` unmodified
- **Tripwires**: `src/cli.ts` and `src/server.ts` byte-unchanged (confirmed by verification)

## Task Completion

All 22 tasks completed and checked in `tasks.md`:
- Phase 1 (shared normalization): ✅ 1.1, 1.2
- Phase 2 (indexing delegation): ✅ 2.1, 2.2
- Phase 3 (query-side fix + gates): ✅ 3.1–3.7
- Phase 4 (contract docs): ✅ 4.1, 4.2, 4.3
- Phase 5 (spec + docs): ✅ 5.1, 5.2
- Phase 6 (final verification): ✅ 6.1–6.4

**Verification Status**: PASS
- npm test: 768 tests passed (48 files)
- npm run typecheck: clean
- npm run build: clean
- Gate 4 tests all pass independently: 9 passed | 38 skipped (gates only)

## Archive Contents

Artifacts preserved in this archive:

- ✅ `proposal.md` — initial problem statement and intent
- ✅ `design.md` — fork decision, technical approach, findings against inputs
- ✅ `specs/search/spec.md` — delta spec with 2 ADDED requirements
- ✅ `tasks.md` — complete 6-phase task breakdown (all 22 checked)
- ✅ `apply-progress.md` — implementation evidence and test results
- ✅ `verify-report.md` — independent verification with gate evidence
- ✅ `archive-report.md` — this file

## Source of Truth Updated

`openspec/specs/search/spec.md` now reflects the complete search filtering contract:
1. Open `type` Filtering
2. **Open `module` Filtering** (NEW)
3. **Tags Filtering Trims Entries And Drops Empties** (NEW)
4. Config-Driven `excludedStatuses`
5. `includeExcluded` Is a No-Op Without Declared Exclusions

No downstream changes to CLI, server, or infrastructure adapters required — the fix is contained in domain logic and documentation.

## Notable Design Decisions

1. **Single enforcement point** (Decision 1): `SearchDocuments.buildFilters` is the only producer of `SearchFilters` in production code; normalization happens once, before reaching SQL.

2. **Module trim mirrors type** (Decision 2): `module` receives the same four-line normalization pattern as `type`, not a new variant.

3. **Shared tag normalization** (Decision 3): `normalizeTags` domain module imported by both `resolveTags` (write side) and `buildFilters` (read side), making the rule single-source.

4. **Documentation at type level** (Decision 4): Both `SearchFilters` and `SearchQuery` interface comments promoted to clarify the empty-is-absent contract.

5. **Silent normalization** (Q2 resolved): Blank filters are omitted without emitting a diagnostic — they are normalized to absent, not reported as unmatchable.

6. **Structural guard against dirty seeds** (Decision 6): `seedDoc` test helper throws when seeded `tags` aren't already canonical per `normalizeTags`, preventing false-green test hazards.

7. **Normalize then check length** (Decision 7): `buildFilters` trims/lowercases/drops first, then checks `length > 0` before setting the filter — order matters for empty-array collapse.

## Historical Context

This change is one of three split from the same exploration (`openspec/changes/archive/2026-08-15-code-review-findings-1.3-1.5/`):
- Finding 1.3: Filter input hygiene (this change) ✅ archived
- Finding 1.4: Read-doc fence-aware sections (parallel, separate)
- Finding 1.5: Overview counter safety (parallel, separate)

The three changes share an origin document and nothing else — different spec capabilities, different files, zero shared code.

## Verification Findings

**Verdict**: PASS

No CRITICAL or WARNING findings. Two SUGGESTION-level observations (non-blocking):

1. **SUGGESTION**: `seedDoc` canonical-tags throw exists structurally but is not exercised by name in the shipped suite (confirmed to fire by direct expression evaluation during verification).
2. **SUGGESTION**: `apply-progress.md` quoted "47 passed (47)" for isolated file run; full suite consistent but isolated count not independently re-verified beyond gate-subset reruns.

Both do not block archive.

## Risks and Notes

- **No residual implementation tasks**: All tasks checked in `tasks.md`; apply and verify phases confirmed completion.
- **No destructive changes**: Spec merge is purely additive; no existing requirements removed or rewritten.
- **Scope revertibility**: `src/domain/tags.ts` and `resolveTags` delegation are separate commits from the behavioral fix, allowing independent rollback per design.
- **Pre-existing corpus compatibility**: Existing indexed documents unaffected; the change normalizes query-time inputs only, not stored data.

## Cycle Closure

The `filter-input-hygiene` change has been fully planned, designed, implemented, verified with PASS verdict, and archived. The merged spec accurately reflects the implemented behavior. All artifacts are preserved for audit trail and future reference.

**Ready for next change.**
