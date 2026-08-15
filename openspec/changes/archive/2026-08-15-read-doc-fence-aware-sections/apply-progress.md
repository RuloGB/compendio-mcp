# Apply progress: `read_doc`'s Section Lookup Must Not Treat Fenced Code as Headings

**Phase**: apply · **Artifact store**: openspec (Engram unavailable this cycle) · **Skill resolution**:
paths-injected (`work-unit-commits`)

`strict_tdd: true` followed throughout. All tasks below are `[x]` complete.

## Phase 0 — Two claims measured, not inherited

- **[x] 0.1** — MEASURED, NOT AS PREDICTED. Design's flow notes illustrated a single-template excerpt
  with 2 delimiters. The LIVE "12. Templates" chunk (`chunk 12` in this repo's own indexed corpus)
  bundles all four templates (functional spec, ADR, API contract, test plan) into one chunk because it
  fits within `maxTokens` as a whole — its real fence-delimiter count is **8**, not 2. This is still
  EVEN (balanced), so the invariant the design actually needs ("every chunk of that section carries an
  even delimiter count") holds — but the specific number 2 in design.md's flow-notes illustration does
  not match the real chunk. Recorded honestly rather than smoothed over. Not a STOP condition: the
  guard still engages correctly (measured below).
- **[x] 0.2 / STOP condition check** — PASSED, no stop. `read_doc({ path:
  "docs/documentation-convention.md", section: "Business rules" })` against the unfixed tree resolved
  `type: "section"` with the "12. Templates" chunk's content (verbatim transcript in Phase 2/5 below).
  The live-occurrence justification is confirmed.

## Phase 1 — Domain: `isFenceDelimiter` exported

- **[x] 1.1** RED observed: import of `isFenceDelimiter` failed at runtime (`TypeError: isFenceDelimiter
  is not a function`), 7 new tests failed, 56 pre-existing passed.
- **[x] 1.2** GREEN: `export` keyword + doc comment added, zero other changes to `split-text.ts` (git
  diff: `+14/-1`, purely the export line + doc comment).
- **[x] 1.3** `npx vitest run test/domain/split-text.test.ts` → 63/63 passed. `npm run typecheck` clean.

## Phase 2 — `scripts/section-lookup.mjs`

- **[x] 2.1–2.3** Written per Decision 6: imports from `dist/`, no `TransformersEmbeddings` import (no
  model download), prints the `ReadResult` discriminant + matched-chunk diagnostics (heading, fence-
  delimiter count, leading content) for `section`, and `availableSections` (sorted) for
  `section-not-found`. Asserted self-check: exits non-zero when a `section` result's matched chunk(s)
  have no OWN heading matching the request.
- **[x] 2.4 (= 0.1 + 0.2)** Ran against the unfixed tree:
  ```
  node dist/cli.js --root . index --lexical
  node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"
  ```
  Result: `type: section`, matched chunk 12 (`heading: "12. Templates"`), fence-delimiter count **8**
  (see 0.1), self-check FAILED as expected → **exit code 1**. Confirms Gate 1 "before" and validates
  2.3's self-check works (it correctly flags the defect's shape).

## Phase 3 — `headingsIn` rewrite

- **[x] 3.1–3.5** written. Observed states exactly as tasks.md predicted per-task (not a blanket
  "all red"): **3.1, 3.2 already passed** on the unfixed tree (guard cases against over-pruning,
  written to prevent regression, not to observe red) — **3.4 (Gate 2c, load-bearing) also already
  passed** on the unfixed tree, exactly as design.md's testing-strategy table states ("green today,
  green after the fix"). **3.3, 3.3-sibling (tilde fence), and 3.5 genuinely failed red** (21 passed / 3
  failed on the pre-3.6 run). No STOP condition — this matches tasks.md's own explicit per-task notes,
  which in turn match design.md's Gate table; unlike the sibling `overview-counter-safety` apply, this
  tasks.md's assertion directions were checked and found correct.
- **[x] 3.6** Rewrite implemented exactly per design.md Decision 3 (balanced-precondition guard,
  `HEADING_LINE = /^#{2,6}\s+(.+)$/` initially, later amended — see "Deviation from design" below).
  Both call sites required zero edits beyond the callee (confirmed by diff, per Decision 5).
- **[x] 3.7** `npx vitest run test/application/read-document.test.ts` → 24/24 passed (later 25/25 after
  the CRLF fix below), zero pre-existing assertions modified (confirmed by `git diff` showing no `-`
  lines outside the new describe block).

### Load-bearing sanity check (required by the orchestrator brief)

Temporarily removed the `if (balanced)` guard (`inFence = !inFence` unconditionally) and re-ran ONLY
the Gate 2c test (`-t "Gate 2c"`): **it went RED** — `expected 'section-not-found' to be 'section'`.
Reverted immediately; full suite re-confirmed green (87/87 across the three affected test files). **2c
is confirmed load-bearing**: it fails without the guard and passes with it.

### Genuine regression found and fixed — NOT in tasks.md, NOT the accepted parity hole

While running Gate 1 against this repository's OWN corpus (Phase 2.4/5.1), discovered that real,
unfenced headings ("## 3. File names", "## 10. Glossary", both real H2s reachable only via
`headingsIn` on merged/content-embedded text) were NOT resolving at all after 3.6 — `section-not-found`
even from `availableSections`. Root cause, measured (not assumed): `docs/documentation-convention.md`
is CRLF-encoded. `design.md`'s literal specified `HEADING_LINE = /^#{2,6}\s+(.+)$/` claimed CRLF
behaviour would be unchanged ("`split("\n")` leaves a trailing `\r` inside `(.+)`, and `.trim()` removes
it -- exactly what `matchAll(/…/gm)` does today"). **That claim does not hold, measured directly**:
without the `/m` flag, `$` requires the literal end of the (per-line) string; `.` never matches `\r`;
so on a line like `"## 3. File names\r"`, `(.+)` stops one character short of the true end (excluded
from matching `\r`), and `$` then fails to match at that position — the WHOLE line fails to match, not
merely fenced ones. Under the OLD code's `matchAll(/…/gm)` on the full string, `$` in multiline mode
matches immediately before ANY line terminator (including a bare `\r`), so this never failed there.

**Fix**: `HEADING_LINE` changed to `/^#{2,6}\s+(.+)\r?$/` — an explicit optional `\r` before `$`. This
is a measured deviation from design.md's literal regex text (not from its underlying intent, which the
new regex actually fulfills correctly for the first time). Documented in a code comment at the
regex definition and in `CLAUDE.md`'s Non-obvious decisions.

Added a dedicated regression test (`test/application/read-document.test.ts`, "found during apply, not
in tasks.md") for a CRLF real-heading case: RED-observed against the un-fixed regex (reverted
temporarily, confirmed `expected 'section-not-found' to be 'section'`), then GREEN after re-applying the
`\r?` fix. Full suite re-run: 89/89 passed across the three affected files.

**Impact if left unfixed**: on THIS repo's own corpus, sections "3. File names", "10. Glossary" (real
H2s merged into bigger chunks) and every H3 template sub-heading inside "12. Templates" would have
silently stopped resolving — an unintended, much broader regression than the documented parity hole,
affecting content that is NOT inside any fence. Confirmed fixed: `availableSections` for
"Business rules" grew from 12 (broken) to 19 (correct) entries after the CRLF fix, and none of the 17
phantom fenced names are among them (verified by direct enumeration against
`docs/documentation-convention.md`'s real, non-fenced heading lines).

## Phase 4 — Round-trip regression (Gate 3)

- **[x] 4.1** `test/application/fence-aware-round-trip.test.ts` added, following
  `goldenset-addresses.test.ts`'s harness shape per the orchestrator note (temp-dir copy of `ejemplos/`,
  `forceLexical: true`, no model download). Every `search_docs` result's `section`, for every goldenset
  `pregunta` query, passed verbatim to `read_doc`, asserted `type: "section"`. Ran BEFORE 3.6: passed
  (1/1) — confirms Decision 5's invariant held even before the fix, as predicted. Ran AFTER 3.6 (and
  after the CRLF fix): passed (1/1) again.

## Phase 5 — Gate 1 "after" + full-corpus gates

- **[x] 5.1** Rebuilt, reindexed this repo's own docs (`--lexical`), reran the script:
  `type: section-not-found`; **19** `availableSections`, none of the 17 phantom fenced names present
  (verified by direct enumeration: "Business rules", "Use cases", "Context and objective", "Out of
  scope", "References", "Context", "Decision", "Alternatives considered", "Consequences", "Endpoints",
  "Data models", "Errors", "Examples", "Scope", "Test cases", "Test data", "Exit criteria" — all
  absent); the real H2s (1, 2, 3 [File names, now correctly present], 4, 5, 6, 7, 8, 9, 10 [Glossary,
  now correctly present], 11, 12, Appendix) and the four real H3 template sub-headings (Functional
  specification, Architecture decision, API contract, Test plan) are all listed. Self-check exit code
  **0** (no `section` match at all — correctly the strongest possible outcome, stronger than "exit 0
  because a legitimate content-heading match happened to satisfy the check").
- **[x] 5.2** `split-text.ts` diff confirmed identity-by-construction (`export` keyword + doc comment
  only, git diff verified, zero logic change). `flatten-map.ts` diff: zero lines (confirmed untouched,
  non-goal preserved). Indexed `ejemplos/` (hybrid, model already cached locally): **29 chunks**.
  `compendio eval` on `ejemplos/`: **hybrid recall@5 = 1.00, MRR = 0.943** — matches `CLAUDE.md`'s
  recorded baseline exactly; **lexical recall@5 = 0.95, MRR = 0.856**, 1 lexical-only failure (an
  existing, documented lexical-mode gap unrelated to this change).
- **[x] 5.3 (Gate 6)** `npm test`: **771/771 passed, 48 test files.** `npm run typecheck`: clean.
  `npm run build`: clean. `read-document.test.ts` and `split-text.test.ts` diffs confirmed
  additions-only (`git diff | grep '^-' | grep -v '^---'` → zero output for both, after accounting for
  the single import-line addition in `split-text.test.ts`). `flatten-map.ts`: zero-line diff.

## Phase 6 — Documentation

- **[x] 6.1** `CLAUDE.md` Non-obvious decisions: added two bullets — (a) the fence-aware,
  chunk-local, `isFenceDelimiter`-sharing behaviour with all **four** named non-guarantees (the fourth,
  the misaligned-even parity hole, distinguished from the second by its opposite, regression-direction
  consequence), and (b) the CRLF `HEADING_LINE` fix discovered during this apply, recorded as its own
  non-obvious decision since it is a real, previously-undocumented gotcha independent of the fence work.
- **[x] 6.2** Manual gate recipe added to `CLAUDE.md`, immediately after "Manual gate 1b", following the
  same section style, with the actual measured before/after table (not invented numbers): before
  `type: section` (wrong chunk) / self-check exit 1; after `type: section-not-found` / 19
  `availableSections` / self-check exit 0.
- **[x] 6.3** Confirmed as a no-op: `read_doc({ path, section? })`'s description in `CLAUDE.md`'s MCP
  tools section needs no wording change — params and response shape are unchanged by this PR.
- **[x] 6.4** `specs/mcp-contract/spec.md`'s "Scope is chunk-local..." paragraph extended with a new
  paragraph naming the fourth non-guarantee (the misaligned-even parity hole), stated as its own
  paragraph distinct from the mid-fence-start non-guarantee, per its opposite (regression-direction)
  consequence — not folded into the existing bullet, per the task's explicit instruction.

## Phase 7 — Commits

Committed by work unit (see final report for hashes): domain export + its tests; the application fix
(including the CRLF discovery, its test, and the round-trip regression test) + its tests; the
`section-lookup.mjs` tooling; documentation (CLAUDE.md + the spec's fourth non-guarantee +
proposal/design/tasks/apply-progress artifacts).

## Delivery size (actual, vs. forecast)

Design forecast **278–488 changed lines**, `delivery_strategy: exception-ok` pre-accepted. Actual
tracked-file diff (`git diff --stat` over `src/`, `test/application/read-document.test.ts`,
`test/domain/split-text.test.ts`, `CLAUDE.md`): **430 lines** (+425/-5). Plus two new untracked files:
`scripts/section-lookup.mjs` (117 lines) and `test/application/fence-aware-round-trip.test.ts` (65
lines). **Total ≈ 612 lines**, above the 278–488 forecast — driven by the CRLF discovery (a genuine
extra defect found and fixed mid-apply, with its own doc comment, test, and `CLAUDE.md` bullet) and
fuller doc comments than the forecast priced in. Per `exception-ok`, no stop/no split was required;
recorded here per this repository's stated practice of not smoothing over forecast misses.

## Two claims flagged as reasoned-not-measured (Phase 0) — final status

- The live chunk's balanced-delimiter count: **measured as 8, not the design's illustrative 2** — the
  underlying invariant (even/balanced) held regardless; the specific number in the design's flow-notes
  example did not match the live chunk. See Phase 0.1 above.
- Gate 1's "before" state: **measured, confirmed exactly as predicted** — `type: section` resolving to
  the "12. Templates" chunk. See Phase 0.2 above.

## Answers to the two required disclosures

- **(a) Does test case 2c/3.4 go red without the `balanced` guard?** **Yes**, confirmed directly: with
  the guard temporarily replaced by an unconditional toggle, `-t "Gate 2c"` failed with `expected
  'section-not-found' to be 'section'`. Reverted, full suite re-confirmed green.
- **(b) Does 3.5's fixture reproduce the parity-hole suppression?** **Yes.** The fixture (`chunk content
  = "```\nReal prose leading into a heading\n#### Real subheading between stray delimiters\n\nbody\n```"`)
  resolves to `section-not-found` with the heading absent from `availableSections`, exactly as the
  resolution predicted. No STOP condition triggered; the reachability reasoning was not re-opened.
