# Tasks: `read_doc` Returns a Section Outline for Large Documents

**Phase**: tasks (revision 1) · **Artifact store**: openspec · **Skill resolution**: paths-injected (`work-unit-commits`)

Strict TDD (`openspec/config.yaml` `strict_tdd: true`): every implementation task is preceded by its
own failing test task. Test runner `npm test`, typecheck `npm run typecheck`, build `npm run build`.

## Revision 1: what changed and why

Revision 0 (all 55 tasks, `apply-progress.md`) shipped and was then falsified by `stress-probe.mjs` at
scale: the rendered outline reached 65%-117% of the document it was meant to replace, and at 5000
headings `read_doc` threw `RangeError`/OOM and could take the MCP server down with it.

| Shape | Headings | Doc tokens | Outline tokens (rev 0) | Exec ms |
|---|---|---|---|---|
| apiRef | 105 / 1000 / 5000 | 6350 / 56304 / 280304 | 4133 / 36469 / 180850 | 2.5 / 175 / 4065 |
| flat | 500 / 5000 | 27974 / 280974 | 17983 / 180861 | 7 / 518 |
| changelog | 500 / 2000 / 5000 | 27865 / 111365 / - | 32624 / 130749 / **OOM** | 47 / 475 / **OOM** |

Root causes (`design.md` "Revision 1: read this first"): unbounded prose annotations, a same-bucket-only
collapse that left 500 identical `### Added` rows each resolving to the whole changelog, and per-row
retained joined text making both memory and the overlap check quadratic in document size.

`design.md` now carries Revision 1 (decisions R1-R6), reviewed by Judgment Day and patched, and
`specs/mcp-contract/spec.md` has been rewritten to match it. Per `design.md`'s own "Obsolete tasks and
tests" section, this revision of `tasks.md` regenerates Phases 4-9 and the Phase 11 docs task from
R1-R6 and the revised spec. Phases 1-3, 10 and 12 are kept as done only where the revision-0 work still
satisfies revision 1; every other phase and task below is new or rewritten. `oversized` (D8's boolean,
`tokens > OUTLINE_THRESHOLD_TOKENS`) is unchanged data-wise, so the revision-0 domain tests that only
assert that boolean (old 5.1-5.4) are kept and folded into Phase 7 without rewriting; the fields that
changed (`overlapsOtherSection` → `includesOtherContent`, new `occurrences: number`) and every rendering
and grouping test are rewritten or deleted, per phase below.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Baseline (revision 0, already in the uncommitted working tree) | src ~230 lines, tests ~750+ lines, docs ~90 lines (per `apply-progress.md`) |
| Revision 1 delta on top of that diff | src: occurrence table + two-pass classifier + gate cap + R3 interval math + budget ladder + `formatOutlineRow` move, est. +250-400 lines net of the ~120 lines being deleted (`overlaps()`, `ComputedRow.content`, prose constants); tests: full rewrite of Phases 4/6/9's old tests plus new Phase 4/5/6/7/9 material (repeated group, precedence, gate cap, R3 worked examples a-d, budget ladder steps, 2000-heading scale ×3 shapes, changelog/5000 no-OOM, terse-changelog integration), est. +600-900 lines net of ~300 deleted; docs: rewrite of one `design-decisions.md` section (~60-90 lines) + one `manual-gates.md` section (~40-60 lines) + the one `AGENTS.md` line |
| Total estimated changed lines (working tree, revision 0 + revision 1 combined) | ~1,150-1,650 |
| 400-line budget risk | High (already exceeded at revision 0's own diff; revision 1 grows it further) |
| Delivery strategy | `exception-ok` — the user already accepted a single PR with `size:exception` for this whole change (resolved 2026-09-12, restated for revision 1); not re-litigated here |
| Chained PRs | Not proposed. Splitting now would separate the occurrence table from the flag logic that consumes it and from the tests that pin both, which is worse for review than one exception-tagged PR — recorded as a risk below, not as a recommendation |

Honesty note: this project's forecasts have undershot by ~2x before (`bounded-chunk-size`,
`incremental-reindex`), and revision 0's own forecast (590-1100) landed inside range but at the high
end. Treat 1,650 as a floor, not a ceiling, once fixture and scale-test scaffolding is counted.

---

## Phase 1: Domain — level-aware heading scanner (Unit 1) — KEPT

- [x] 1.1-1.6 `headingLinesIn`, `sectionMatcher` extraction and their tests (`test/application/read-document.test.ts`, describe blocks at "headingsIn's fence-aware rewrite"). Unaffected by R1-R6: `design.md`'s Architecture Decisions table keeps D1 (row source) and D3 (shared matcher) verbatim, and `headingLinesIn`'s per-chunk scan is exactly the primitive Phase 4 below composes into the document-wide occurrence table. No change needed.

## Phase 2: Outline builder — boundary, D1-D3 (row source, size, matcher) — KEPT

- [x] 2.1-2.6 Boundary test (6000/6001), row-shape tests (position order, H3 nesting, orphan H3, H4 absence, fence phantom, CRLF), D2 size test (`"Scope"`/`"Out of Scope"`), split-chunk collapse test. These fixtures have no repeated or cross-level-promoted titles, so R1's two-pass classification produces the same rows R1 always produced under revision 0's simpler rule; the tests assert only `.heading`, `.tokens`, `.children` and are unaffected by the new `occurrences` field or the `overlapsOtherSection` → `includesOtherContent` rename (Phase 6). No rewrite needed.

## Phase 3: Addressable gate — D4 (fallback-to-`document` scenarios) — KEPT

- [x] 3.1-3.3 The five D4 fallback fixtures (heading-less, single H2, `NO_CHUNKING`-shaped, one H2 + ten H4s, wrapper + one H3 child) and the strict-subset addressable predicate. `design.md`'s Architecture Decisions table keeps D4 "counted over the R1 candidates" — none of these fixtures has a repeated or promoted title, so R1 classification is a no-op relative to revision 0's collapse, and the same 5 fixtures still fall back to `document`. The gate's *evaluation strategy* (lazy stop-at-2, capped at 2,000 candidates) is new and is NOT exercised by these fixtures; it gets its own coverage in Phase 5 below, which the revised `buildOutline` must satisfy without breaking these five.

---

## Phase 4: R1 — occurrence table and two-pass row classification

Builds the position-ordered occurrence table (`level`, `title`, normalized title, chunk index, global
ordinal `k`) that Phases 5-7 all consume, and replaces revision 0's same-bucket-only collapse with R1's
two-pass classify-then-assemble grouping (design.md R1, spec.md "Row identity and collapsing").

**Deletes/replaces the revision-0 describe block** `"ReadDocument — identical-title collapse and gate
ordering (design.md D9, first half)"` (old tasks 4.1-4.6, `test/application/read-document.test.ts`
lines ~775-877): its case "the same H3 title under two different H2 parents stays two rows" (old 4.3,
line 822) asserts the exact outcome R1 reverses — that shape is now one `repeated` entry, not two rows.
Delete that test; the surviving invariant it protected (two rows are never silently merged across
different parents without the reader being told) is now covered by 4.5 below (`repeated` group +
`occurrences` count). Its sibling cases (identical H2 collapse, identical H3-under-same-parent collapse,
gate-ordering-on-collapsed-candidates) are RE-ASSERTED under R1's rules in 4.3/4.4/4.6, not silently
dropped — R1 keeps the same outward pooling for same-bucket duplicates.

- [x] 4.1 [RED] `test/application/read-document.test.ts`: new describe `"ReadDocument — R1 occurrence table and row classification (design.md R1)"`. Case: an H2 and an H3 sharing the same normalized title become ONE top-level row (no duplicate). Case: no two rows in a rendered outline ever share a normalized title, checked across several fixtures including one with an H2, a same-titled orphan-H3, and a same-titled nested H3 under a different parent, all at once (spec.md "Scenario: No two rows share a normalized title").
- [x] 4.2 [RED] Case: the same H3 title occurring under 2+ *different* H2 parents, with no top-level occurrence anywhere, becomes ONE `repeated`-group entry, listed apart from every parent's `children`, carrying `occurrences` equal to its total H2/H3 line count (spec.md "Scenario: A heading repeated under several parents is listed once with its count"). Assert it is absent from every parent's `children` array.
- [x] 4.3 [RED] Positioning-rule case: a title whose first occurrence is a nested child (under one H2 parent) and whose LATER occurrence is an H2 is rendered once, as a top-level row, positioned at the later top-level occurrence — not at the earlier child position — and the child occurrence pools into that row's `occurrences` count instead of appearing in the parent's `children` (spec.md "Scenario: A title with a child occurrence and a single top-level occurrence is one top-level row").
- [x] 4.4 [RED] Precedence-rule case: a title that is both an H3 under 2+ different H2 parents (qualifying `repeated`) AND also occurs as an H2 (or an orphan H3 before any H2, qualifying top-level) is classified top-level, positioned at its top-level occurrence, and does NOT additionally appear in the `repeated` group (spec.md "Scenario: A title promoted to top-level is excluded from the repeated group"; design.md R1's worked example, the `"Notes"`/P1/P2 case).
- [x] 4.5 [RED] Re-assert, under the new classifier: two identical-text H2 rows collapse into one at the first occurrence, with pooled/deduplicated children in first-occurrence order (revision-0 invariant, old 4.1); two identical-text H3 rows under the SAME H2 parent collapse into one (old 4.2); every collapsed/pooled row carries `occurrences` equal to its true document-wide H2/H3 line count, rendering the `xN` flag data (i.e. `occurrences > 1`) only when that count exceeds 1 (spec.md "Scenario: Identical heading titles collapse into one row with an occurrence count").
- [x] 4.6 [RED] Gate-ordering case (old 4.4's shape, re-expressed): a large document whose only two H2s share identical normalized text, nothing else addressable — R1 classification collapses them into one candidate row first, so the ≥2-addressable gate is never met and the response is `document`, not `outline` (spec.md "Scenario: Two identically-titled H2s with nothing else addressable return in full").
- [x] 4.7 [GREEN] `src/application/read-document.ts`: replace `OutlineBuilderNode`'s same-bucket-only map with the position-ordered occurrence table (`level`, normalized title, chunk index, global ordinal `k`) and the two-pass classifier (pass 1: classify every distinct normalized title as top-level / child-of-one-parent / `repeated`, applying the precedence rule of 4.4; pass 2: assemble `children` only from titles classified as that parent's child in pass 1). Add `occurrences: number` to `OutlineSection` and populate it from the classified table. Do not compute `tokens`/flags here yet (Phases 6-7).
- [x] 4.8 Run 4.1-4.6 green; `npm run typecheck`. Confirm Phase 2's kept row-shape tests (2.1-2.6) still pass unmodified against the new classifier.

## Phase 5: D4 gate — lazy evaluation with a bounded candidate cap

Keeps D4's strict-subset addressable predicate (Phase 3) and its "≥2 addressable rows" threshold, but
changes HOW it is evaluated: lazily over the R1-classified candidate list, stopping at the first 2
addressable rows found, and never evaluating more than `MAX_GATE_CANDIDATES = 2000` candidates before
falling back to `document` (design.md R4's "D4 gate cap"; spec.md "Scenario: The addressable-row gate
never evaluates more than its candidate cap").

- [x] 5.1 [RED] `test/application/read-document.test.ts`: a document with ≥2,000 candidate rows (short, highly generic, widely-matching titles by substring), none addressable within the first 2,000 evaluated in document-position order, returns `document` — even though the fixture does not prove whether a later, unevaluated candidate would have qualified (spec.md "Scenario: The addressable-row gate never evaluates more than its candidate cap").
- [x] 5.2 [RED] A document with exactly 2 addressable rows located early in position order (well under the cap) still returns `outline` — the cap must not short-circuit ordinary documents (regression guard alongside 5.1).
- [x] 5.3 [GREEN] `src/application/read-document.ts`: rewrite the addressable count from Phase 3's eager `[...rows.values()].filter(...).length` into a lazy walk over the R1-classified candidates in pinned position order, stopping at 2 addressable rows found or after `MAX_GATE_CANDIDATES = 2000` evaluated, whichever first. Export `MAX_GATE_CANDIDATES` as a module constant next to `OUTLINE_THRESHOLD_TOKENS`.
- [x] 5.4 Run 5.1-5.2 green plus all of Phase 3's kept fallback fixtures (3.1-3.3) and Phase 4's tests (4.1-4.6); confirm none regress.

## Phase 6: R3 — own-sections and the "+other" flag (replaces D9's overlap half)

Replaces `overlaps()`'s heading-line-containment scan (which flagged the changelog's byte-identical
`1.0.0` line and required retaining every row's joined content) with R3's own-sections interval rule:
each heading occurrence owns `[k, end(k))`; a chunk is foreign to a row when it falls outside the union
of that row's pooled occurrence intervals. Renames `OutlineSection.overlapsOtherSection` to
`includesOtherContent` (design.md Interfaces / Contracts).

**Deletes/replaces** the revision-0 describe block `"ReadDocument — overlap annotation, unified iff rule
(design.md D9, second half)"` (old tasks 6.1-6.8, lines ~928-1049). Its `"D2: an overlap-annotated H3's
tokens can exceed its listed parent's tokens"` case (old 6.5, `exceeds-parent.md`) models a title
("Shared") repeated under two different H2 parents — under R1 that shape is now a `repeated` entry, not
a child of either parent, so `requirementsRow.children.find(h => h.heading === "Shared")` would be
`undefined`. Delete that fixture; the invariant it protected (a flagged child's `tokens` may exceed its
listed parent's) is re-proven in 6.7 below with a fixture where the same single-parent child is
`+other`-flagged via substring match (not cross-parent duplication), so it stays a genuine child, not a
`repeated` entry. All other old 6.x cases (substring overlap, fused siblings, ordinary-H2-not-flagged,
D8+D9 combined) are RE-ASSERTED under the new field name and interval rule in 6.1/6.3/6.4/6.9, not
dropped.

- [x] 6.1 [RED] `test/application/read-document.test.ts`: new describe `"ReadDocument — R3 own-sections and the +other flag (design.md R3)"`. Re-assert the substring-overlap case (`"Scope"`/`"Out of Scope"`) under `includesOtherContent`: `"Scope"`'s row is flagged, `"Out of Scope"`'s is not (spec.md "Scenario: A substring title overlap flags only the row whose response includes the other").
- [x] 6.2 [RED] Worked example (a): an ordinary, non-terse changelog version — `chunkOutline`'s non-descend rule places `## 1.0.0` + `### Added`/`### Fixed`/`### Changed` in one chunk — the `1.0.0` row is NOT flagged `includesOtherContent`, matching the Acceptance table's "Level" row and closing the byte-identical-`1.0.0` false-positive that falsified revision 0.
- [x] 6.3 [RED] Worked example (b): a single oversized H2 with no H3 children, split by `splitToBound` into 2+ physical chunks where only the first piece keeps the literal heading line, is NOT flagged `includesOtherContent` — both pieces fall inside the same occurrence's `[k, end(k))` span (spec.md "Scenario: A split oversized heading with no children is not flagged as including other content").
- [x] 6.4 [RED] Re-assert under the new field: two sections fused at index time into one stored chunk both carry `includesOtherContent: true` (old 6.3, spec.md "Scenario: A heading fused with a neighbor at index time is flagged"); an ordinary H2 whose response includes only its own H3 children's content is NOT flagged (old 6.4, spec.md "Scenario: An ordinary H2 with its own H3 children is not flagged").
- [x] 6.5 [RED] Consequence (a): a parent H2 whose own section contains 2+ H3 children sharing the SAME heading text as each other is NOT flagged — its children's repeated content is still its own (spec.md "Scenario: A parent whose section holds repeated child titles is not flagged").
- [x] 6.6 [RED] Consequence (b), the changelog `Added` `repeated` row: in the ordinary non-terse shape, `chunkOutline` places each version's `## x.y.z` line ahead of `### Added` in the same chunk, so the pooled `Added` `repeated` row IS flagged `includesOtherContent` — NOT because it pools many occurrences, but because of the fused version-heading text (spec.md "Scenario: A repeated row fused with its parent's heading is flagged"). Companion case: when every parent H2 is large enough to force the chunker's descend branch, so each `Added` child occupies its own dedicated chunk with no preceding parent heading line, the `repeated` row is NOT flagged (spec.md "Scenario: A repeated row with no fused foreign content is not flagged").
- [x] 6.7 [RED] Worked example (c) / union-not-intersection: a `repeated` H3 title occurring once under H2 parent P1 (its own dedicated chunk) and once under a different H2 parent P2 (its own dedicated chunk) is NOT flagged, because each matched chunk is inside SOME pooled interval even though neither is inside the other's (design.md R3 worked example (c)). Redo the deleted `exceeds-parent.md` invariant here or in a sibling case: a genuine single-parent child (nested under exactly one H2, not duplicated across parents) whose `section` response is pulled wider by a substring match is flagged `includesOtherContent` AND its `tokens` exceeds its listed parent's `tokens` (the surviving old-6.5 invariant, re-fixtured to avoid the now-invalid cross-parent-duplicate shape).
- [x] 6.8 [RED] Worked example (d): a document's untitled intro chunk carries the document's own title (e.g. `"Configuration Guide"`); a listed H2 row titled `"Guide"` is a substring of that title, so `sectionMatcher` pulls the intro chunk into `"Guide"`'s match set. The intro chunk precedes every occurrence in the walk and has no owner, so `"Guide"`'s row is ALWAYS flagged `includesOtherContent` (spec.md "Scenario: A title that is a substring of the document title always flags its row").
- [x] 6.9 [RED] Re-assert D8+D9 combined (old 6.6) under the new rendering contract: a row that is both oversized (`tokens > OUTLINE_THRESHOLD_TOKENS`) and `includesOtherContent` carries BOTH flag booleans set to `true` — this task asserts only the two booleans on the `OutlineSection`, not the rendered text (rendering itself moves to Phase 7).
- [x] 6.10 [GREEN] `src/application/read-document.ts`: implement the occurrence table's per-chunk `firstOwner`/`lastOwner` (undefined for any chunk preceding every occurrence, per worked example (d)) and `end(k)` (next occurrence at level ≤ k's level), the single-occurrence and generalized union-of-pooled-intervals containment rule, and rename `overlapsOtherSection` → `includesOtherContent` on `OutlineSection` and everywhere it is read (`src/server.ts`'s renderer, to be rewritten in Phase 7). Delete `ComputedRow.content` and the O(rows²) `overlaps()` scan entirely (design.md R5).
- [x] 6.11 Run 6.1-6.9 green; `npm run typecheck`. Confirm Phase 4/5's tests are unaffected by the field rename (they do not read `includesOtherContent`).

## Phase 7: R2 + R4 + R5 — flags, legend, row budget, and rendering

Replaces the prose annotations (`OVERSIZED_ANNOTATION`, `OVERLAP_ANNOTATION`, `formatOutlineSection` in
`src/server.ts`) with R2's short flags (`xN`, `too large`, `+other`) and a `Flags:` legend, adds R4's
8,000-character row budget with its 3-step degradation ladder and omission notices, and moves R5's
bounded-cost invariant (sizes/flags computed only for rendered rows) into the sizing step itself.

**Deletes/replaces** the revision-0 describe block `"ReadDocument — oversized-row annotation (design.md
D8)"` is KEPT as-is (Phase 3 note above: `.oversized` boolean is unaffected) but its RENDERING
counterpart — `test/server/format-read-result.test.ts`'s two `"outline"` literal-output tests (lines
~104-159) — is deleted and replaced, because the whole rendered format changes from prose annotations to
short flags + a legend line + `repeated` group + omission notices.

- [x] 7.1 [RED] `src/domain/tokens.ts` test (or extend the existing `tokens` test file): `tokensForLength(n)` returns `Math.ceil(n / 4)` and `estimateTokens(s)` delegates to it for `s.length` (design.md File Changes: "the formula stays in one place").
- [x] 7.2 [GREEN] `src/domain/tokens.ts`: add `tokensForLength(n: number): number`; rewrite `estimateTokens` to call it.
- [x] 7.3 [RED] `test/application/read-document.test.ts`: for every flag combination (none, `xN` only, `too large` only, `+other` only, all three), `formatOutlineRow(row, depth).length + 1 <= cost`, where `cost` is R4's exact per-row pessimistic-cost formula (`formatOutlineRow` called with `tokens = docTokens`, both flags on, real `occurrences`) — this is R4's exactness claim, tested directly against the function, not just observed on fixtures.
- [x] 7.4 [RED] Literal rendering test: flag clauses render in the fixed order `xN`, `too large`, `+other`; `xN` renders iff `occurrences > 1`; each of `too large`/`+other` renders iff its own boolean is `true`; the `Flags:` legend line explains a flag only when some LISTED row uses it (not just any row in the tree).
- [x] 7.5 [RED] `OutlineOmission` ladder step 1 (all rows fit): every candidate row (top-level, children, `repeated` group) is rendered, `omitted: { kind: "none" }`.
- [x] 7.6 [RED] Ladder step 2 (`subheadings`): a fixture where all top-level rows fit within `OUTLINE_ROWS_BUDGET_CHARS = 8000` but the full candidate set does not — assert all top-level rows render, children render only for `too large` top-level rows as a document-order prefix up to the first child that would not fit, the `repeated` group AND any remaining unshown children are omitted, and `omitted: { kind: "subheadings", hidden }` counts BOTH together (spec.md "Scenario: Over budget, only too-large parents keep their subheadings").
- [x] 7.7 [RED] Ladder step 3 (`truncated`): a fixture where even the top-level rows alone do not fit — assert only the longest document-order prefix of top-level rows renders, with no children and no `repeated` group, and `omitted: { kind: "truncated", shown, total }` (spec.md "Scenario: Over budget, top-level rows themselves are truncated").
- [x] 7.8 [RED] The row budget never revisits the D4/gate decision: a document that qualifies for `outline` (≥2 addressable rows found by the Phase 5 gate) but whose rendered set is reduced by the ladder to fewer than 2 visible addressable rows still returns the (budget-reduced) `outline`, never `document` (spec.md "Scenario: Truncation never changes the addressable-row gate").
- [x] 7.9 [RED] Redo the surviving old-6.5 fixture from Phase 6 through the FULL pipeline: an `includesOtherContent`-flagged child's `tokens` can exceed its listed parent's `tokens`, and (regression) `child.tokens <= parent.tokens` continues to hold whenever the child is NOT `includesOtherContent`-flagged.
- [x] 7.10 [GREEN] `src/application/read-document.ts`: add `OUTLINE_ROWS_BUDGET_CHARS = 8000`, the `OutlineOmission` union type, and `formatOutlineRow(row: Omit<OutlineSection, "children">, depth: 0 | 1): string` (moved from `src/server.ts`, next to `formatFrontmatter`, per D5). Implement the 3-step ladder computing costs from `formatOutlineRow`'s own output length (never a separate estimate). Compute `tokens`/`includesOtherContent` ONLY for rows selected to render (R5): defer per-row sizing/flag computation until after the ladder has chosen the rendered set, using precomputed chunk lengths (`chunkLengths`) and `sectionMatcher`'s index-returning form (`matchIndices`, added in this task) rather than joined content strings.
- [x] 7.11 [GREEN] `src/server.ts`: delete `OVERSIZED_ANNOTATION`, `OVERLAP_ANNOTATION`, and `formatOutlineSection`; rewrite the `"outline"` case of `formatReadResult` to call `formatOutlineRow`, render the `Flags:` legend (only for flags in use among rendered rows), the `repeated` group under its own label when non-empty, and the `omitted` notice line matching design.md's exact wording for `subheadings`/`truncated`.
- [x] 7.12 [RED] `test/server/format-read-result.test.ts`: replace the two deleted prose-literal tests with new literal-output tests matching design.md's `formatReadResult` example exactly (frontmatter block, header line, instructions line, `Flags:` legend, nested rows with flag suffixes, `repeated` group section, `String(n)` never `toLocaleString`) — with and without frontmatter fields present, and at least one variant per `OutlineOmission` kind.
- [x] 7.13 [GREEN] Confirm 7.12 passes against 7.11's renderer (no further server.ts change expected; fix if it does not).
- [x] 7.14 Run 7.1-7.9 and 7.12 green; `npm run typecheck`. Confirm Phases 3-6's tests are unaffected (they do not call `formatOutlineRow`/`formatReadResult`).

## Phase 8: Integration — real chunker, spec-delta fixture, oversized-split, `ejemplos/`

Re-runs the revision-0 integration tests through the real chunker under R1-R6, adds the one new
integration scenario R3 requires (terse-changelog fusion flags each fused version `+other`), and updates
the spec-delta-shaped fixture's assertion from prose to the `too large` flag.

- [x] 8.1 Re-run (unmodified expected behavior, reformat only if a prose-text assertion exists): the old "a section split by the size bound and a merged tiny H2 each produce exactly one row" integration case (old 8.1) — re-assert under the new fields (`includesOtherContent`, `occurrences`) instead of any removed prose.
- [x] 8.2 [RED] `test/application/read-document.test.ts`: rewrite the spec-delta-shaped fixture case (old 8.2, single wrapping `## ADDED Requirements` H2 with no intro, many H3 `### Requirement:` children) to assert the wrapper row's `oversized === true` renders the `too large` flag via `formatOutlineRow` (not a prose body), and each H3 child row resolves to `section` with content strictly smaller than the wrapper's, with `includesOtherContent === false` for each ordinary child (spec.md "Scenario: A wrapper heading over an entire spec-delta-shaped document is listed but not addressable").
- [x] 8.3 [RED] Terse-changelog integration test (new): a changelog fixture whose per-version text is small enough that `mergeTinyPieces` (`chunk.minTokens = 100`) fuses 2+ consecutive versions into one physical chunk — each version is still its own row with the correctly summed `tokens`, and EACH fused version's row is flagged `includesOtherContent` (its `firstOwner`/`lastOwner` reach into the neighboring version's interval), distinct from the ordinary, non-fused single-version case of Phase 6's worked example (a), which stays unflagged (design.md Testing Strategy, "Integration, terse changelog").
- [x] 8.4 [RED] Oversized-childless-H2-split integration test through the real chunker (not the synthetic fixture of 6.3): index a document whose single H2 has no H3 children and exceeds `chunk.maxTokens`, forcing `splitToBound` to produce 2+ real stored chunks; assert the outline lists it as one row, not `includesOtherContent`-flagged.
- [x] 8.5 [GREEN] Fix any divergence 8.1-8.4 surface between the synthetic Phase 4-7 fixtures and the real `chunkOutline`/`splitToBound`/`mergeTinyPieces` behavior.
- [x] 8.6 Re-run the `ejemplos/` golden-set harness (old 8.3, unchanged expectation): every document in `ejemplos/` returns `document`, never `outline`; `estimateTokens(content) < OUTLINE_THRESHOLD_TOKENS` across the corpus. No assertion change expected — confirms Revision 1's `tokensForLength` refactor (7.2) does not shift the threshold boundary.
- [x] 8.7 Run 8.1-8.4 and 8.6 green; confirm `document`/`section-not-found`/`no-sections` paths remain unmodified.

## Phase 9: Scale, property, and the probe (R6)

Moves the stress probe out of the change folder into the shipped repo, adds the vitest-level scale
guarantees design.md's Acceptance table commits to, and runs the pre-apply manual check against this
repo's own large documents.

- [x] 9.1 [RED] `test/application/read-document.test.ts`: property test — for every rendered row in an outline (top-level, child, or `repeated` entry), `read_doc({ path, section: row.heading })` returns `type: "section"` (never `section-not-found`), and `estimateTokens(content) === row.tokens`; run against several generated/fixture documents including at least one with a `repeated` group and one truncated by the Phase 7 budget ladder (spec.md "Scenario: An outline row round-trips through `section`" — this is the revision-0 round-trip invariant, re-proven end to end under R1-R4).
- [x] 9.2 [RED] Scale test, `:memory:` seed, `apiRef` shape at 2,000 headings: rendered outline ≤ 2,300 estimated tokens (header + legend + notice + rows, excluding frontmatter and path), predicted level `subheadings` per design.md's Acceptance table (cost formula: 1×53 + N×101-ish per real title lengths — assert the actual level returned, not the formula). Expect RED today (revision 0 has no budget).
- [x] 9.3 [RED] Scale test, same seed helper, `flat` shape at 2,000 headings: ≤ 2,300 estimated tokens, predicted level `truncated`.
- [x] 9.4 [RED] Scale test, same seed helper, `changelog` shape at 2,000 headings: ≤ 2,300 estimated tokens, predicted level `full` (design.md Acceptance table: changelog/500 — extend the same expectation check to 2,000 in this task, since the wrapper H2/H3 count stays low relative to the `repeated`-group collapse).
- [x] 9.5 [RED] No-OOM guard: `changelog` shape at 5,000 headings completes and returns `type: "outline"` within a 10s vitest timeout, without throwing — this is the exact shape that OOM'd in revision 0's probe.
- [x] 9.6 [GREEN] Fix any remaining Phase 7 ladder / Phase 5 gate-cap defect that 9.2-9.5 surface at these sizes (expected to be minor if 4.7/5.3/7.10 are correct; this task exists because scale is where revision 0 actually broke, and TDD requires observing these RED before declaring the ladder correct).
- [x] 9.7 Run 9.1-9.5 green; confirm none regress Phases 4-8.
- [x] 9.8 Create `scripts/outline-stress-probe.mjs`, moved from `openspec/changes/read-doc-large-outline/stress-probe.mjs`: repo root resolved from `import.meta.url` (not a hardcoded absolute path), bench root in `os.tmpdir()` (not `process.cwd()`), and the script exits non-zero when any shape/size breaks the 2,300-token or no-OOM budget (design.md R6). Keep the 3 shapes (`apiRef`, `flat`, `changelog`) and the 5 sizes (105/500/1000/2000/5000).
- [x] 9.9 Delete `openspec/changes/read-doc-large-outline/stress-probe.mjs`, `probe1.mjs`, `probe2.mjs`, `probe3.mjs` from the repo root (scratch scripts from the design-revision investigation, superseded by 9.8).
- [x] 9.10 `docs/manual-gates.md`: add a new gate section for the outline stress probe — command (`node scripts/outline-stress-probe.mjs` against a built `dist/`), budgets (≤ 2,300 estimated tokens for every shape at every size 105-5000, no OOM/crash at 5,000, ≤ 300ms median exec time at 5,000, manual-only), and the expected `Level` per shape/size from design.md's Acceptance table.
- [x] 9.11 Manual pre-apply check (before Phase 12, per design.md Testing Strategy's "Pre-apply check" row): run the probe (via 9.8's script or a scratch script against a built `dist/`) against `openspec/specs/indexing/spec.md` and `docs/design-decisions.md`; confirm both land at level `full`, matching the Acceptance table's "Level, real repo documents" predictions (≈3,891 and ≈3,081 pessimistic chars respectively, both under the 8,000-char row budget). If either lands outside `full`, stop and update `design.md` before continuing to Phase 12 — do not silently adjust the fixture or the budget.

---

## Phase 10: Server contract — description, instructions, tool surface, exports — KEPT

- [x] 10.1-10.6 `read_doc` description wording, `section` param description, `SERVER_INSTRUCTIONS` before/after, exactly-3-tools assertion, `export type { OutlineSection }`. None of R1-R6 touches tool descriptions, `SERVER_INSTRUCTIONS` wording, or the tool count — unaffected. One follow-up only, folded into 11.2 below: `src/index.ts` also needs `export type { OutlineOmission }` (new in Phase 7), which 10.5's task did not anticipate.

## Phase 11: Documentation — REOPENED

- [x] 11.1 [DOCS] `docs/design-decisions.md`: rewrite the existing `## read_doc returns an outline for large documents` section (added by revision-0's old 11.1) to describe R1 (row identity, `repeated` group, precedence/positioning rules), R2 (short flags + legend, replacing the prose annotations), R3 (own-sections/`+other`, replacing the heading-line-containment overlap rule), R4 (the 8,000-char row budget, the 3-step ladder, the D4 gate cap), R5 (bounded-cost sizing, no retained per-row text), and the updated non-guarantees (setext headings, frontmatter excluded from threshold, fused-section double-listing, the new row-budget-driven omission possibilities, `addressable` never serialized, gate cap possibly missing a later-qualifying candidate). Remove the now-false claim that "the outline's own size is unbounded in principle but measured small in practice."
- [x] 11.2 [DOCS] `AGENTS.md`: edit the existing one-line `read_doc` bullet under "MCP tools (progressive disclosure)" in place (no new paragraph, per this file's own "keeping this file small" policy) to state the outline is "bounded to ≤ 2,300 estimated tokens, excluding frontmatter and the document path" (design.md File Changes table's exact wording), replacing whatever revision-0's old 11.2 wrote about an unbounded outline.
- [x] 11.3 [GREEN] `src/index.ts`: add `export type { OutlineOmission }` alongside the existing `export type { OutlineSection }` (Phase 10 follow-up, Phase 7's new type).

## Phase 12: Final verification — REOPENED

- [x] 12.1 [GATE] `npm run typecheck` — zero errors.
- [x] 12.2 [GATE] `npm test` — full suite green, including every task above; confirm no `it.only` left behind (`CI=true` also turns on `forbidOnly`, per AGENTS.md).
- [x] 12.3 [GATE] `npm run build`.
- [x] 12.4 [GATE] Run `node scripts/outline-stress-probe.mjs` (9.8) against the built `dist/` — never bare `compendio` (AGENTS.md's manual-gates policy) — and confirm every shape/size stays within the 2,300-token and no-OOM budgets, matching `docs/manual-gates.md`'s new section (9.10).
- [x] 12.5 [GATE] Re-confirm the pre-apply check from 9.11 against the FINAL built `dist/` (not just the pre-apply scratch run): `openspec/specs/indexing/spec.md` and `docs/design-decisions.md` (now containing 11.1's rewritten section — re-measure, since editing that file changes its own heading count/size) both resolve to `full`.
- [x] 12.6 [GATE] Confirm MCP surface is still exactly 3 tools (10.3's assertion, re-run as part of 12.2).

---

## Task-to-Requirement Traceability (Revision 1)

| Task(s) | Spec scenario (spec.md, `mcp-contract`) |
|---|---|
| 2.1 (kept) | Boundary 6000/6001 |
| 2.2, 2.4 (kept) | Row shape, split-chunk collapse |
| 3.1-3.3 (kept) | 0/1-addressable fallbacks, `NO_CHUNKING`, wrapper+one-H3, one-H2-with-H4s |
| 4.1 | No two rows share a normalized title |
| 4.2 | A heading repeated under several parents is listed once with its count |
| 4.3 | A title with a child occurrence and a single top-level occurrence is one top-level row |
| 4.4 | A title promoted to top-level is excluded from the repeated group |
| 4.5, 4.6 | Identical heading titles collapse with an occurrence count; two identically-titled H2s with nothing else addressable return in full |
| 5.1 | The addressable-row gate never evaluates more than its candidate cap |
| 5.2 | Regression guard: ordinary early-addressable documents still return `outline` |
| 6.1 | A substring title overlap flags only the row whose response includes the other |
| 6.2 | (Acceptance table) ordinary changelog version not flagged |
| 6.3 | A split oversized heading with no children is not flagged as including other content |
| 6.4 | A heading fused with a neighbor at index time is flagged; an ordinary H2 with its own H3 children is not flagged |
| 6.5 | A parent whose section holds repeated child titles is not flagged |
| 6.6 | A repeated row fused with its parent's heading is flagged; a repeated row with no fused foreign content is not flagged |
| 6.7 | Union-not-intersection containment; surviving D2-exceeds-parent invariant |
| 6.8 | A title that is a substring of the document title always flags its row |
| 7.4, 7.12 | Flag order and legend rendering |
| 7.5 | (implicit) rows-fit-in-budget baseline |
| 7.6 | Over budget, only too-large parents keep their subheadings |
| 7.7 | Over budget, top-level rows themselves are truncated |
| 7.8 | Truncation never changes the addressable-row gate |
| 8.2 | A wrapper heading over an entire spec-delta-shaped document is listed but not addressable |
| 8.3 | (Testing Strategy) terse-changelog integration |
| 8.4 | A split oversized heading with no children is not flagged (real chunker) |
| 8.6 | Every `ejemplos/` document returns in full |
| 9.1 | An outline row round-trips through `section` |
| 9.2-9.5 | Outline size stays bounded at very large heading counts |
| 9.11, 12.5 | (Acceptance table) predicted levels for this repo's own large documents |
| 10.1-10.3 (kept) | The tool description no longer promises unconditional full-document return; tool surface stays 3 tools |

Risk carried forward, not resolved here: if apply finds the spec's R3 "own span" wording and the actual
`chunkOutline`/`mergeTinyPieces` fusion boundaries diverge in a shape not enumerated in Phase 6/8, stop
and report it — do not resolve it inline (per this phase's brief). Same for the R4 cost formula's real
character counts versus the Acceptance table's estimates (9.2-9.4, 9.11) — if a level prediction misses,
that is a `design.md` update, not a silent test-only fix.
