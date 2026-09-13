# Archive Report: `read_doc` Returns a Section Outline for Large Documents

**Change**: read-doc-large-outline
**Archived**: 2026-09-13
**Artifact store**: openspec
**Verdict carried forward from verify**: PASS WITH WARNINGS (the one WARNING is marked resolved)

## Summary

`read_doc({ path })` without `section` previously returned the whole document body with no size check,
overrunning Claude Code's ~10k-token tool-output warning on three live documents in this repo and its
~25k hard limit on at least one archived document. This change adds an additive `outline` response
variant: above a 6,000-estimated-token threshold, with 2 or more addressable heading rows, `read_doc`
returns a bounded outline (H2/H3 rows, short flags, a legend, and — when the outline itself would be too
large — a degradation ladder with omission notices) instead of the document body. The MCP tool surface
stays exactly 3 tools; the outline is an additive variant of the existing no-`section` response, not a
new tool or parameter.

The change went through two design revisions. Revision 0 (55 tasks) shipped first but was falsified at
scale by its own stress probe: the rendered outline reached 65-117% of the document it was meant to
replace, and a changelog shape at 5,000 headings threw `RangeError`/OOM. Revision 1 (design.md decisions
R1-R6) replaced the same-bucket-only collapse with a position-ordered occurrence table and two-pass row
classification (R1), replaced prose annotations with short flags and a legend (R2), replaced
heading-line-containment overlap detection with an own-sections interval rule (R3), added a lazy
2,000-candidate gate cap and an 8,000-character row budget with a 3-step degradation ladder (R4), bounded
per-row work to rendered rows only with no retained joined text (R5), and moved the stress probe into the
shipped repo as `scripts/outline-stress-probe.mjs` with enforced budgets (R6). All 68 revision-1 tasks
are complete; the task-completion gate for this archive found no unchecked implementation tasks.

## Final Verification Numbers (independently re-run by sdd-verify, not trusted from apply-progress)

- **Tests**: 1050 passed / 0 failed / 1 skipped (57 test files), `npm test`, 19.0s.
- **Typecheck**: 0 errors, `npm run typecheck`.
- **Build**: clean, `npm run build`.
- **Stress probe** (`node scripts/outline-stress-probe.mjs` against a fresh `dist/` build): 15/15
  shape×size combinations (apiRef/flat/changelog × 105/500/1000/2000/5000) stayed within the 2,300-token
  outline budget; changelog/5000 completed without throw or OOM (`docTokens 278531`, `outlineTokens
  2106`). Max median exec time ~62ms (changelog/5000). Re-run twice with matching results.
- **`ejemplos/` golden-set eval**: hybrid MRR **0.943**, recall@5 1.00 — unchanged from the pre-change
  baseline.
- **Pre-apply / final re-check** (task 12.5, re-measured against the final built `dist/`):
  `docs/design-decisions.md` (13,395 tokens) and `openspec/specs/indexing/spec.md` (17,321 tokens) both
  resolve to `omitted.kind: "none"` (level `full`), matching design.md's Acceptance table prediction.

## Post-Verify Edits

`sdd-verify`'s report recorded one WARNING and no CRITICAL issues. Two edits were made after the verify
report, both reflected in the delta spec merged below:

1. **Probe completeness (the verify WARNING)**: `scripts/outline-stress-probe.mjs` previously only
   failed a row for exceeding the 2,300-token budget; it did not machine-assert that a rendered outline
   stays below its own document's token count. The probe now also fails any `outline`-type row where
   `outlineTokens >= docTokens`, and `docs/manual-gates.md` lists the check alongside the existing budget
   check. RED verification: a scratch copy of the probe with the threshold tightened to `docTokens / 100`
   printed 10 failing rows and exited 1; the shipped probe prints 15/15 `ok` and exits 0. The verify
   report's WARNING entry is marked resolved with this note.
2. **Whole-document routing wording**: the `read_doc` tool description and `SERVER_INSTRUCTIONS` were
   confirmed/corrected to route whole-document reading through "start from the outline and request the
   sections you need" — never to the agent's own file-reading tool — per the spec's final paragraph on
   this point ("There is no parameter or configuration key to force full-body return... MUST NOT send it
   to the agent's own file-reading tool"). The "too large" flag legend and the `truncated`-ladder notice
   still mention the agent's own file-reading tool as an edge-case escape hatch for a single oversized
   heading or a heavily truncated outline — that remains intentional and is consistent with the spec's
   non-guarantees.

## Spec Merge Performed

Merged `openspec/changes/read-doc-large-outline/specs/mcp-contract/spec.md` (delta) into
`openspec/specs/mcp-contract/spec.md` (main):

- **ADDED**: `### Requirement: read_doc Returns a Section Outline for Large Documents` — the full
  requirement (row identity/collapsing, the "+other" flag, the "too large" flag, the row budget and its
  3-step degradation ladder, non-guarantees) plus its 27 scenarios, inserted into the main spec.
- **ADDED**: `### Requirement: The ejemplos/ Golden-Set Corpus Stays Below the Outline Threshold` and its
  scenario, inserted alongside the requirement above.
- **MODIFIED**: `### Requirement: MCP Zero-Config Expectations Reflect Discovery Mode` — the main spec's
  prior wording ("Tool names, parameters, and response shapes MUST remain unchanged", no carve-out) was
  replaced with the delta's carve-out wording (response shapes unchanged "except that `read_doc` without
  `section` MAY additionally return an outline response... this is an additive variant... not a new
  tool, parameter, or removed shape") plus its new scenario, "A large document under discovery mode
  still returns an outline". All other requirements already present in the main spec (fenced-heading
  handling, excerpt budgets, path prefixing, whole-token matching, etc.) were preserved untouched.

`openspec/specs/mcp-contract/spec.md` is now the source of truth reflecting this change's behavior.

## Files Copied to Archive

All copied byte-for-byte from `openspec/changes/read-doc-large-outline/` into
`openspec/changes/archive/2026-09-13-read-doc-large-outline/`:

- `exploration.md`
- `proposal.md`
- `design.md` (revision 1, decisions R1-R6)
- `tasks.md` (revision 1, 68/68 tasks complete)
- `apply-progress.md` (revision 0 history + revision 1 implementation record)
- `verify-report.md` (PASS WITH WARNINGS, one WARNING resolved per this report's "Post-Verify Edits")
- `specs/mcp-contract/spec.md` (the delta spec, preserved as historical record of what was proposed)
- `archive-report.md` (this file)

## Task Completion Gate

`tasks.md` (revision 1) shows 68/68 tasks marked `[x]`. No unchecked implementation tasks were found;
no exceptional reconciliation was needed.

## SDD Cycle Complete

The change has been fully explored, proposed, specified, designed, planned, implemented, verified, and
archived. The active `openspec/changes/read-doc-large-outline/` folder is removed by the orchestrator
after this archive folder and the main spec merge are confirmed in place.
## Pre-PR review (4R, after archive)

All four lenses returned APPROVE WITH COMMENTS. Fixes applied before the first commit:

- **Reliability (MAJOR):** `[6.2]`, `[8.3]` and `[8.4]` in `test/application/read-document.test.ts` returned early without asserting when the fixture never reached the outline branch. Adding `expect(result.type).toBe("outline")` failed `[6.2]` and `[8.4]`, so the verify report's "compliant" mark for them was wrong. `[6.2]`/`[8.3]` now pad the document with an appendix H2 (`outlinePadding`); `[8.4]` gained a second H2 above `chunk.minTokens` (with one addressable row the document is served whole, per spec). All three now assert the outline and their flag unconditionally.
- **Readability (MAJOR):** unused `estimateTokens` import removed from `read-document.ts`; the stress probe's table printed 7 values under an 8-column header. It now prints a `level` column (`full`/`subheadings`/`truncated`/`document`), matching the expected levels in `docs/manual-gates.md`.
- **Resilience (MAJOR):** the probe now fails when a document above `OUTLINE_THRESHOLD_TOKENS` is served whole (a gate regression would otherwise print `ok` for an unbounded response). RED check: a scratch copy with the threshold lowered to 5000 flagged `flat/105` and `changelog/105` and exited 1.
- **Risk (MINOR):** README's `read_doc` entry now mentions the outline for large documents.

Not addressed (non-blocking): the duplicated accumulate-until-budget loop in `buildOutline` (a refactor with regression risk and no behaviour change); post-gate rendering cost is linear and measured only up to 5,000 headings; a truncated notice can read "first 0 of N" for a single pathologically long H2 title.

Final state: typecheck clean, 1050 passed / 1 skipped, probe 15/15 `ok`.
