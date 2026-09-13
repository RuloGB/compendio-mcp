# Apply Progress: `read_doc` Returns a Section Outline for Large Documents

**Phase**: apply · **Artifact store**: openspec · **Mode**: Strict TDD
**Delivery**: single-pr with `size:exception` (resolved 2026-09-12, restated for revision 1) — not
committed; left in the working tree.

## Status

68/68 tasks marked `[x]` in `tasks.md` (revision 1). Revision 0's 55 tasks (Phases 1-3, 10 kept
verbatim; Phases 4-9 and 11's docs task superseded and rewritten below) plus revision 1's Phases
4-9, 11 (reopened), 12 (reopened) are all complete. `stress-probe.mjs` (the script that falsified
revision 0) has been moved into the shipped repo as `scripts/outline-stress-probe.mjs` and confirms
revision 1 stays within budget at every shape/size, including the changelog/5000 case that OOM'd
under revision 0.

---

## Revision 0 (superseded, kept for history)

55/55 tasks were implemented and verified green under revision 0's design (D1-D9, same-bucket-only
collapse, heading-line-containment overlap, prose annotations). That implementation shipped, was
left uncommitted in the working tree, and was then falsified at scale by `stress-probe.mjs`: the
rendered outline reached 65-117% of the document it was meant to replace, and a changelog shape at
5,000 headings threw `RangeError`/OOM. Root causes (fully diagnosed in `design.md`'s "Revision 1:
read this first"): unbounded prose annotations, a same-bucket-only collapse that left hundreds of
identical H3 rows each resolving to the whole document, and per-row retained joined content making
both memory and the overlap check quadratic in document size.

Revision 0's own TDD Cycle Evidence table, files-changed list, and manual smoke verification are
preserved in this change folder's git history (the version of this file prior to revision 1's
rewrite) and are not repeated here to avoid describing behavior this revision replaces. What
revision 0 got right and revision 1 kept without change: D1 (row source, `headingLinesIn`), D2's
core size formula, D3 (shared matcher), D4's strict-subset addressable definition, D5 (placement),
D6/D7 (`meta` carried, intro excluded), the 6000-token threshold, CRLF/fence handling, and the
server-contract wording (tool descriptions, `SERVER_INSTRUCTIONS`, 3-tool surface) — Phases 1-3 and
10 below are marked `[x]` "KEPT" for exactly this reason, with no revision-1 rewrite needed.

---

## Revision 1: R1-R6 (this apply run)

Implements `design.md`'s revision-1 decisions (R1 occurrence table + two-pass classification, R2
short flags + legend, R3 own-sections + `+other` replacing the overlap rule, R4 lazy-capped gate +
row budget ladder, R5 bounded-cost rendering, R6 the probe moved into the shipped repo) per the
revised `specs/mcp-contract/spec.md` and regenerated `tasks.md` Phases 4-9, 11, 12.

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/application/read-document.ts` | Rewritten (outline portion) | Replaced `OutlineBuilderNode`'s same-bucket map with a position-ordered occurrence table (`buildOccurrenceTable`: `k`, level, title, norm, chunk index, parent norm, per-chunk `firstOwner`/`lastOwner`, `endOf`); replaced the collapse with R1's two-pass `classifyRows` (top/child/`repeated`, precedence and position rules); replaced the D4 eager count with `evaluateGate` (lazy, `MAX_GATE_CANDIDATES = 2000` cap); replaced `overlaps()`'s O(rows²) line-containment scan with R3's `ownsChunk`/`includesOtherContent` interval math; added `OUTLINE_ROWS_BUDGET_CHARS = 8000`, `pessimisticCost`, `realRow`, and the 3-step `buildOutline` ladder; moved `formatOutlineRow` here from `server.ts` (D5); deleted `ComputedRow.content` (no joined text retained, R5); deferred building the whole-document string until the outline/document decision is made (arithmetic `docLen` from chunk lengths). `OutlineSection` gained `occurrences: number` and renamed `overlapsOtherSection` → `includesOtherContent`; added `OutlineOmission`. |
| `src/domain/tokens.ts` | Modified | Added `tokensForLength(n)`; `estimateTokens` now delegates to it (the chars/4 formula stays in one place, per design.md File Changes). |
| `src/server.ts` | Modified | Deleted `OVERSIZED_ANNOTATION`, `OVERLAP_ANNOTATION`, `formatOutlineSection`; rewrote the `"outline"` case of `formatReadResult` to build the header, the new instructions line, a `Flags:` legend (only for flags in use among rendered rows), the `omitted` notice (`subheadings`/`truncated` wording, `String(n)` throughout), the rows via `formatOutlineRow`, and the `repeated` group under its own label. |
| `src/index.ts` | Modified | Added `export type { OutlineOmission }` alongside the existing `OutlineSection` export. |
| `test/domain/tokens.test.ts` | Created | `tokensForLength`/`estimateTokens` delegation tests (7.1). |
| `test/application/read-document.test.ts` | Rewritten (outline portion) | Deleted the two revision-0 D9 describe blocks (identical-title collapse + gate ordering; overlap annotation) whose assertions directly contradicted R1/R3. Added: "R1 occurrence table and row classification" (4.1-4.6), "D4 gate: lazy evaluation with a bounded candidate cap" (5.1-5.2), "formatOutlineRow — R2 flags and R4's exact per-row cost bound" (7.3-7.4), "R4 row budget ladder" (7.5-7.8), "R3 own-sections and the +other flag" (6.1-6.9, all 4 worked examples a-d plus both consequences), a `repeated`-group round-trip case (9.1), a terse-changelog integration test (8.3), an oversized-childless-split integration test through the real chunker (8.4), the spec-delta fixture's assertion rewritten to check the `too large` flag and a real-chunker-fused first child vs. a later dedicated-chunk child (8.2), and a scale/no-OOM describe block (9.2-9.5: apiRef/flat/changelog at 2000 headings bounded to ≤2300 tokens, changelog/5000 completes without throwing under a 10s timeout). Kept D1/D2/D3/D4-fallback/D8-oversized/ejemplos describe blocks unmodified (Phases 1-3, 10). |
| `test/server/format-read-result.test.ts` | Rewritten (outline literals) | Replaced the two revision-0 prose-literal tests with 4 new literal tests: full example with the `repeated` group and legend (matching design.md's literal changelog example), no-frontmatter/no-flags rendering, `subheadings` omission notice with a partial legend, `truncated` omission notice with no children/no repeated group. |
| `scripts/outline-stress-probe.mjs` | Created | Moved from `openspec/changes/read-doc-large-outline/stress-probe.mjs`: repo root from `import.meta.url`, bench dir under `os.tmpdir()`, exits non-zero on a >2300-token outline or a thrown/OOM run. Same 3 shapes × 5 sizes as the original probe. |
| `openspec/changes/read-doc-large-outline/stress-probe.mjs` | Deleted | Superseded by the shipped script above (9.9; no `probe1/2/3.mjs` scratch files existed in the repo root to delete). |
| `docs/manual-gates.md` | Modified | Added "Gate: outline stress probe" section: command, budgets (≤2300 tokens, no OOM/crash, ≤300ms median at 5000), and measured results confirming every shape/size passes. |
| `docs/design-decisions.md` | Rewritten (outline section) | Replaced the revision-0 "read_doc returns an outline for large documents" section with revision 1's R1-R5 description, the falsified-non-guarantee removal, and the new row-budget-driven non-guarantees. |
| `AGENTS.md` | Modified | Edited the existing one-line `read_doc` bullet in place to state the ≤2,300-estimated-token bound (no new paragraph). |
| `openspec/changes/read-doc-large-outline/tasks.md` | Modified | All 68 tasks marked `[x]`. |

### TDD Cycle Evidence (revision 1)

Implemented as coherent per-phase RED→GREEN batches (same granularity note as revision 0): each
phase's failing tests were written first and observed failing against the still-revision-0
production code (or, for Phase 7/9, against code with no budget ladder at all), then the
corresponding rewrite of `read-document.ts`/`server.ts`/`tokens.ts` was added and the batch was run
to green.

| Task(s) | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 7.1-7.2 (`tokensForLength`) | `test/domain/tokens.test.ts` | Unit | N/A (new file) | ✅ Written against a function that did not exist | ✅ Passed | ✅ Multiple lengths incl. the 6000-token boundary | ➖ None needed |
| 4.1-4.8 (R1 occurrence table + classification) | `test/application/read-document.test.ts` | Unit | ✅ 67 pre-existing outline tests green before starting the rewrite | ✅ Written against the still-revision-0 collapse (old same-bucket rule) | ✅ Passed after `buildOccurrenceTable`/`classifyRows` landed (2 iterations: an early fixture's substring collisions made "Dup" itself non-addressable, defeating its own gate premise — fixed by adding an unrelated addressable heading) | ✅ Promotion, precedence, repeated-group, gate-ordering, pooled-children cases | ➖ None needed |
| 5.1-5.4 (D4 lazy + capped gate) | same file | Unit | ✅ | ✅ Written (2000-candidate NO_CHUNKING-shaped fixture) | ✅ Passed (1 iteration: initial `padTo` totalLen was smaller than the generated heading text itself, throwing at fixture-build time, not at assertion time — fixed by removing the redundant `padTo` call) | ✅ Cap-triggered fallback vs. ordinary early-addressable regression guard | ➖ None needed |
| 6.1-6.11 (R3 own-sections, `+other`) | same file | Unit | ✅ | ✅ Written against the still-revision-0 `overlaps()` heading-line scan | ✅ Passed after `ownsChunk`/`includesOtherContent` landed (3 iterations: the D2-exceeds-parent fixture's own parent title was itself a substring of the "wider" chunk's heading, defeating its premise; the substring-of-document-title fixture used an empty `heading: ""` intro chunk, which the real indexer never persists — AGENTS.md's own "no chunk has an empty heading" rule — fixed to carry the document title, as design.md's worked example (d) specifies) | ✅ All 4 worked examples (a-d), both consequences (pooled-H2, changelog-Added), union-not-intersection | ➖ None needed |
| 7.3-7.14 (R2 flags, R4 ladder, rendering) | same file + `test/server/format-read-result.test.ts` | Unit | ✅ | ✅ Written against code with no `formatOutlineRow`/ladder | ✅ Passed (2 iterations: the step-2/step-3 ladder fixtures needed enough real content-size weight, not just pessimistic-cost weight, to produce a non-trivial hidden/shown count once real per-row costs replaced the worst-case placeholder) | ✅ All 3 ladder steps, flag-order/legend-conditionality, exact-cost-bound property test (7.3) across 5 flag combinations | ➖ None needed |
| 8.1-8.7 (integration: real chunker) | same file | Integration | ✅ | ✅ Written (terse-changelog fusion, real-chunker oversized-childless split, spec-delta flag rewrite) | ✅ Passed (1 iteration: the spec-delta fixture's very first child is genuinely fused with the wrapper's own heading line by `chunkOutline`'s non-descend rule for the first piece, so it IS correctly `+other`-flagged — the test was checking `children[0]`, the wrong child; fixed to check the last child, which gets its own dedicated chunk) | ✅ Split section + merged tiny H2 (unmodified from revision 0), spec-delta, terse changelog, oversized-childless-split | ➖ None needed |
| 9.1-9.11 (property, scale, no-OOM, probe) | same file + `scripts/outline-stress-probe.mjs` | Unit + manual | ✅ | ✅ Written (2000-heading × 3 shapes, changelog/5000 no-OOM) | ✅ Passed | ✅ 3 shapes at 2000, plus the `repeated`-group round-trip case | ➖ None needed |
| 11.1-11.3 (docs) | `docs/design-decisions.md`, `AGENTS.md`, `src/index.ts` | N/A (documentation + one export) | N/A | N/A | N/A | N/A | N/A |
| 12.1-12.6 (final verification) | full suite | N/A | N/A | N/A | ✅ `npm run typecheck` (0 errors), `npm test` (1050 passed, 1 pre-existing skip), `npm run build`, `node scripts/outline-stress-probe.mjs` against `dist/` (all 15 shape×size combinations within the 2300-token budget, no throw, max median exec 117ms at changelog/5000), `node dist/cli.js --root ejemplos eval` (MRR 0.943 hybrid, unchanged), pre-apply/final re-check of `openspec/specs/indexing/spec.md` and `docs/design-decisions.md` both resolving to `omitted.kind: "none"` (`full`, matching the Acceptance table's prediction, re-measured after 11.1's rewrite changed `design-decisions.md`'s own size) | N/A | N/A |

### Test Summary

- **Total tests added/rewritten (revision 1)**: ~45 in `test/application/read-document.test.ts`
  (net new describe blocks + 2 rewritten integration assertions), 4 in
  `test/server/format-read-result.test.ts` (replacing 2 deleted), 4 in the new
  `test/domain/tokens.test.ts`.
- **Total tests passing (full suite)**: 1050 passed, 1 skipped (pre-existing, unrelated).
- **Layers used**: Unit (majority), Integration (real `IndexDocuments` chunker: split-section,
  terse-changelog fusion, oversized-childless split, spec-delta fixture, `ejemplos/` golden-set
  harness), manual (the stress probe against a built `dist/`).
- **Approval tests**: N/A — the occurrence-table/classification rewrite is covered by new
  behavioral tests asserting the R1-R6 contract directly, not by pinning revision-0's prior output.
- **Pure functions created/moved**: `buildOccurrenceTable`, `classifyRows`, `evaluateGate`,
  `ownsChunk`, `includesOtherContent`, `pessimisticCost`, `realRow`, `tokensForIndices`,
  `formatOutlineRow` (moved from `server.ts`), `tokensForLength` — all pure, no side effects.

## Manual Smoke Verification

- `node scripts/outline-stress-probe.mjs` against the built `dist/`: 15/15 shape×size
  combinations (apiRef/flat/changelog × 105/500/1000/2000/5000) stay within the 2300-estimated-token
  budget where an outline is returned, none throws, median exec time at 5,000 headings tops out at
  117ms (changelog) — well under the 300ms manual budget, and the changelog/5000 case that OOM'd
  revision 0 now completes cleanly.
- `node dist/cli.js --root ejemplos eval`: hybrid MRR 0.943, recall@5 1.00 — identical to the
  pre-change baseline (no regression from `tokensForLength`'s refactor or the outline rewrite).
- `openspec/specs/indexing/spec.md` (17,321 tokens) and `docs/design-decisions.md` (13,395 tokens,
  re-measured after 11.1's own rewrite) both resolve to `outline` with `omitted.kind: "none"`
  (level `full`), matching the Acceptance table's predictions.

## Deviations from Design

None found. Every R1-R6 decision in `design.md` was implementable as specified; the "Open Questions"
section's real-document level predictions were confirmed exactly (both `full`) rather than needing a
design update.

## Issues Found

None outstanding. Three test-fixture-only mistakes were found and fixed during RED→GREEN iteration
(documented in the TDD Cycle Evidence table above): a gate-cap fixture whose own substring
collisions made its intentionally-non-addressable candidate accidentally the ONLY non-addressable
one (defeating the >=2,000 cap test's premise until an unrelated addressable heading was added), an
`exceeds-parent` fixture whose parent title was itself a substring of the "wider" sibling (making
both rows report identical, not different, sizes), and a substring-of-document-title fixture that
used an empty `heading: ""` intro chunk — a shape the real indexer never persists — instead of the
document-title fallback design.md's own worked example (d) specifies. None of these were production
defects; all were caught by the tests behaving unexpectedly, not by silent false positives.

## Workload / PR Boundary

- Mode: single PR with `size:exception` (accepted 2026-09-12, restated for revision 1).
- Current work unit: the entire revision-1 rewrite (source + tests + docs + the probe's move into
  the shipped repo), left uncommitted in the working tree per instruction.
- Boundary: starts from revision 0's already-uncommitted working tree; ends with all 68 tasks
  implemented, tested, and documented.
- Estimated review budget impact: high, as forecast (`tasks.md`'s Review Workload Forecast
  estimated ~1,150-1,650 total changed lines across both revisions) — consistent with this
  project's own honesty note that its forecasts have undershot by ~2x on prior changes.

## Status

68/68 tasks complete. Ready for `sdd-verify`.
