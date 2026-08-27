# Archive Report

**Change**: `skip-db-when-no-docs`
**Mode**: `openspec`
**Archived**: 2026-08-27
**Verification verdict**: PASS WITH WARNINGS

## Completion

- All 13 implementation tasks were marked `[x]` in `tasks.md`.
- `npm test`: 870 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- No CRITICAL verification issues were reported.

## Specs Synced

- `indexing`: added lazy database creation and empty-reindex behavior; updated startup sync and missing-root semantics while preserving existing requirements.
- `search`: added well-formed empty responses when no database exists.
- `mcp-contract`: added no-docs/no-index behavior for `serve` and all three tools.
- `index-md`: added header-only output behavior for empty discovery without database creation.

All delta requirements were merged into the corresponding main specs before archival. Existing requirements not covered by this change were preserved.

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (4 delta specs)
- `design.md` ✅
- `tasks.md` ✅ (13/13 implementation tasks complete)
- `verify-report.md` ✅

## Warnings

- Actual `serve` startup/scheduler readiness with no documents is only indirectly covered.
- Empty `IndexDocuments` stale-row reset is covered at store level rather than end-to-end.
- `:memory:` stores remain eagerly opened by design; this does not create filesystem artifacts.

## Source of Truth

The synced main specifications are:

- `openspec/specs/indexing/spec.md`
- `openspec/specs/search/spec.md`
- `openspec/specs/mcp-contract/spec.md`
- `openspec/specs/index-md/spec.md`

The active change directory was moved to this archive path after synchronization:
`openspec/changes/archive/2026-08-27-skip-db-when-no-docs/`
