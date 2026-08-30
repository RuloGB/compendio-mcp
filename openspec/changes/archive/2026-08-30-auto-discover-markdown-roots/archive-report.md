# Archive Report: auto-discover-markdown-roots

## Change

`auto-discover-markdown-roots` — replaces the hidden zero-config `docsDir: ["docs"]` default with
filesystem-driven Markdown root discovery, while preserving explicit `docsDir`/`--dir` behavior,
root-alias-prefixed paths, `exclude` semantics, and the three-tool MCP surface.

## Preconditions Verified

- Task Completion Gate: all 17 tasks in `tasks.md` were checked (`- [x]`) before this archive ran.
- Verify verdict: **PASS** — 0 CRITICAL, 0 WARNING, 2 SUGGESTION-level findings.
- SUGGESTION 2 (root-replacement junction test's win32 warn-and-return) was remediated post-verify:
  the silent early return was removed from `test/composition.test.ts`, the assertion now throws on
  every platform, and non-vacuity was proven against a deliberately broken regex before being
  reverted. Recorded in `verify-report.md`'s "Post-Verify Remediation" section.
- SUGGESTION 1 (no dedicated discovery-mode `exclude` test) remains **open, accepted debt** — carried
  forward below, not silently dropped.
- `npm run typecheck` PASS and `CI=true npm test` PASS (52 files, 908 tests, 1 skipped) re-run after
  the remediation, independently confirmed by the orchestrator before this archive ran.

## Specs Synced

Four delta specs were merged into their corresponding main specs under `openspec/specs/`. Deltas were
integrated coherently rather than appended blindly: beyond the explicitly declared `MODIFIED`/`ADDED`
blocks, several *sibling* scenarios in the main specs assumed the retired "`docsDir` defaults to
`["docs"]`" behavior and were reconciled in the same pass so the merged specs do not contradict
themselves. Each reconciliation is called out below with its reasoning.

| Domain | Action | Details |
|---|---|---|
| `configuration` | Updated | 1 requirement renamed and modified (`docsDir Is a Non-Empty Array of Declared Roots` → `docsDir Is an Explicit Array of Declared Roots`), 1 requirement added (`Missing docsDir or Empty docsDir Enables Discovery Mode`), 1 requirement narrowed and renamed (`Colliding, Nested, Duplicate, or Empty Declared Root Sets Are Rejected at Construction` → `Colliding, Nested, or Duplicate Declared Root Sets Are Rejected at Construction`, empty-array rejection case and its scenario removed), 1 stale scenario reworded (`exclude` directory-prefix "default single-root set" scenario) |
| `indexing` | Updated | 1 requirement modified in place (`Root-Alias-Prefixed Document path, Always`, delta text merged with preserved pre-existing scenarios rather than replacing them outright), 4 requirements added (discovery root selection, discovery-mode `exclude` semantics, whole-OpenSpec-corpus coverage, nested-roots-not-independent), 5 stale "`docsDir` defaults to `["docs"]`" scenario phrasings reworded to explicit-array wording across "Field Inference in loose Mode" and "Read Failures Protect the Affected path Subtree From Deletion" |
| `index-md` | Updated | 1 requirement modified (`INDEX.md Never Lists Itself, Under Any Root Count`, extended to discovery mode), 1 requirement added (`Discovery Mode Writes Project-Root INDEX.md`), 2 existing requirements re-scoped to explicit mode by name (`One Combined INDEX.md Across All Declared Roots` → `... (Explicit Mode)`, `Empty Discovery Writes a Header-Only INDEX.md` widened to name both write targets) since discovery mode now has its own write-target requirement |
| `mcp-contract` | Updated | 1 requirement modified (`Root-Alias-Prefixed path Flows Through search_docs, read_doc, and docs_overview, Always`, delta scenarios merged alongside preserved pre-existing scenarios), 1 requirement added (`MCP Zero-Config Expectations Reflect Discovery Mode`), 1 stale "default single-root set" scenario reworded |

### Reconciliation Note: Empty `docsDir` Is No Longer a Construction-Time Rejection Case

The `auto-discover-markdown-roots` delta for `configuration` states as its `MODIFIED` requirement that
"When `docsDir` is absent, omitted, or declared as `[]`, the system MUST switch to discovery mode" —
but did not explicitly restate the pre-existing `configuration` requirement "Colliding, Nested,
Duplicate, or Empty Declared Root Sets Are Rejected at Construction", whose case (e) rejected
`docsDir: []` at construction. These two requirements directly contradicted each other for the same
input. Verified against `design.md` (root-mode selection happens *before* `resolveRoots`/root-set
validation runs) and `test/infrastructure/config.test.ts` (which asserts `docsDir: []` and an absent
config file both resolve `rootSelection: { mode: "discovery" }`, not a thrown error) that the delta's
intent is authoritative: an empty declared array now routes to discovery mode before ever reaching the
construction-time rejection logic, so case (e) is dead and its scenario was removed from the merged
main spec rather than left as a stale, unreachable, and contradictory requirement. This is a merge-time
coherence correction, not new behavior — the code and tests already implemented and verified this; the
main spec was updated to stop contradicting them.

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `design.md` ✅
- `specs/{configuration,indexing,index-md,mcp-contract}/spec.md` ✅ (4 delta specs)
- `tasks.md` ✅ (17/17 tasks complete)
- `apply-progress.md` ✅ (includes 4 remediation addenda)
- `verify-report.md` ✅ (PASS, includes Post-Verify Remediation section)
- `archive-report.md` ✅ (this file)

## Source of Truth Updated

The following specs now reflect the new behavior:

- `openspec/specs/configuration/spec.md`
- `openspec/specs/indexing/spec.md`
- `openspec/specs/index-md/spec.md`
- `openspec/specs/mcp-contract/spec.md`

Verified after merging that none of these four main specs contains any path reference into
`openspec/changes/auto-discover-markdown-roots/` or the archived folder — they are pure behavioral
specs with no change-folder links, so no dangling reference exists post-move.

## Carried-Forward Debt

- **SUGGESTION 1 (open, accepted)**: The indexing spec's requirement that existing `exclude` semantics
  still apply to discovery-selected roots has no dedicated discovery-mode `exclude` test. Compliance
  rests on `FileDocumentSource.isExcluded` being shared, unconditional code across both modes —
  structurally guaranteed rather than independently tested. Low risk since the sharing is structural,
  not incidental, but a future refactor that special-cases discovery exclude handling would have no
  direct regression test to catch a mistake. Recommended follow-up: add a focused discovery-mode
  `exclude` test (exact/basename/directory-prefix forms) in `test/composition.test.ts` or
  `test/infrastructure/file-document-source.test.ts`.

## Known Limitation of This Archive Operation

This execution environment's toolset for the archive phase was limited to `Read`/`Edit`/`Write`/`Glob`
— no file-move or file-delete capability was available. The full contents of
`openspec/changes/auto-discover-markdown-roots/` were copied byte-for-byte (via `Read` + `Write`) into
`openspec/changes/archive/2026-08-30-auto-discover-markdown-roots/`, matching this repository's
existing `YYYY-MM-DD-{change-name}` archive convention. **The original
`openspec/changes/auto-discover-markdown-roots/` folder could not be deleted by this agent and still
exists on disk alongside the new archive copy.** A human or an agent with filesystem delete
capability MUST remove `openspec/changes/auto-discover-markdown-roots/` (the pre-archive location) to
complete the move; until then, the change technically has two copies of its artifacts on disk, though
only the archived copy and the four merged main specs are the source of truth going forward.

## SDD Cycle Complete (Pending Manual Cleanup)

The change has been fully planned, implemented, verified, and archived — specs merged, archive folder
populated. The one remaining mechanical step (deleting the stale pre-archive folder) requires a tool
this execution context did not have access to; see "Known Limitation" above.
