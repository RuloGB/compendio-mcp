# Tasks: Match-Centred Lead Excerpt

## Review Workload Forecast

| Task group | Estimated changed lines |
|---|---|
| Phase 1: fixture docs (5 files) | ~50 |
| Phase 2: `match-location.ts` primitives + tests | ~150 |
| Phase 3: probes P1/P1b (recorded in apply notes, no `src/` diff) | 0 |
| Phase 4: `flatten-map.ts` + tests (I1–I4) | ~180 |
| Phase 5: `selectMatchCentre` + tests | ~90 |
| Phase 6: `toFtsQuery` extraction + regression test | ~25 |
| **Work Unit 1 subtotal** | **~495** |
| Phase 7: Gate 1 baseline task (fixture + baseline assertion only) | ~10 |
| Phase 8: `excerpt.ts` window support + tests (incl. Gate 2) | ~100 |
| Phase 9: Gate 1 inversion (real assertion) | ~5 |
| Phase 10: call-site wiring (`search-documents.ts`) + test | ~20 |
| Phase 11: Gate 3 integration test | ~30 |
| Phase 12: Gate 5 + contract text (`server.ts`, `CLAUDE.md`) | ~35 |
| Phase 13: length-bound mechanical updates | ~6 |
| Phase 14: spec cross-check (no diff, already written by `sdd-spec`) | 0 |
| Phase 15: Gate 4 manual (no diff) | 0 |
| Phase 16: recorded-observation script | ~40 |
| **Work Unit 2 subtotal** | **~256** |
| **Total** | **~751** |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

| Field | Value |
|---|---|
| Delivery strategy | single-pr |
| Chain strategy | size-exception |
| Decision status | **Already resolved** — user accepted `size:exception` on 2026-08-06 against a 750–800 forecast vs. a 400 budget, recorded in `state.yaml`'s `delivery_decision`. Precedent: `encoding-aware-reads` (555–695), `incremental-reindex` (500–800). Not re-opened here. |

**This is a single PR.** The design's cut line is used as the *review structure inside it*, not
as separate PRs — commit boundaries should follow `work-unit-commits`: land Work Unit 1 as one or
more commits that leave the repo compiling and green with no wire change, then Work Unit 2 as
commits on top. A reviewer can review each unit's diff independently even though they ship
together.

### Suggested Work Units

| Unit | Goal | Delivery | Notes |
|---|---|---|---|
| 1 | Pure core — `flatten-map.ts`, `match-location.ts`, `toFtsQuery` extraction, I1–I4 and full selection-policy tests | Single PR, commit group 1 | No wire change. Reviewer question: *is the offset map correct?* |
| 2 | The window — `excerpt.ts`, the call site, fixtures, Gates 1/2/3/5, contract text | Single PR, commit group 2 | Depends on Unit 1. Reviewer question: *does the window reach the answer?* |

## Coverage Map

| Requirement / Gate / Item | Task(s) |
|---|---|
| Spec: Graduated Excerpt Budget by Result Rank (scenario: rank-1 vs. others) | 13.1 (regression), unchanged `excerptBudget`, confirmed 15.1 |
| Spec: Lead Excerpt Is a Window Centred on Matched Span (scenario: answer past old boundary) | 7.1–7.2, 9.1 (Gate 1) |
| Spec: Supporting Excerpts Remain Start-Anchored Prefixes (scenario: opening text, not match) | 8.1 (empty-spans path), 10.2 (spans=[] for rank≠0), 13.1 |
| Spec: Truncation Marked at Either Edge, Within Budget (3 scenarios) | 8.1–8.3 (Gate 2) |
| Spec: Vector-Only Results Produce Well-Formed Excerpts (scenario) | 12.1–12.2 (Gate 5) |
| Spec: Lead Match Selection Is Not Positional (scenario) | 5.1, 11.1–11.2 (Gate 3) |
| Gate 1 — window reaches the answer | 7.1–7.3, 9.1–9.2 |
| Gate 2 — truncation contract honest at both edges | 8.1–8.3 |
| Gate 3 — stopword trap | 11.1–11.2 |
| Gate 4 — scope falsifier (`compendio eval` identity) | 15.1–15.2 |
| Gate 5 — vector-only path + contract text | 12.1–12.4 |
| Recorded observation — `SUPPORTING_EXCERPT_CHARS` distribution (not a gate) | 16.1 |
| Fixture: `window.md` (centring), self-asserted preconditions | 1.1, 7.4 |
| Fixture: `stopword-trap.md`, self-asserted preconditions | 1.1, 11.1 |
| Contract text: `server.ts:110` | 12.3 |
| Contract text: `CLAUDE.md` excerpt bullet | 12.4 |
| `+1` → `+2` bound at `index-and-search.test.ts:124,135,182`; `:184` stays `+1` | 13.1 |
| `toFtsQuery` MATCH-string regression (Decision 2) | 6.1 |
| Probes P1/P1b with STOP outcome | 3.1–3.3 |

---

## Work Unit 1 — The Pure Core

### Phase 1: Fixture corpus (shared prerequisite for probes and gates)

- [x] 1.1 Create `test/fixtures/excerpt-window/docs/{window.md, stopword-trap.md, short.md, distractor-1.md, distractor-2.md}` per design's fixture table (English prose, raw ≤ 1800 chars, one chunk each). `window.md` carries marker `MERIDIANO-4417` at flattened offset ≈ 1420 with the query's distinctive terms occurring once each in its sentence, the marker itself not a query term. `stopword-trap.md` carries `the` (offset < 100, ≥ 20 occurrences) and `windvane` (offset > 1400, count 1) beside marker `TRAMONTANA-9182`.
- [x] 1.2 `test/helpers/build.ts`: add `EXCERPT_WINDOW_DOCS` export pointing at the new fixture dir, wired through `buildHarness(null, EXAMPLES_CONVENTION, EXCERPT_WINDOW_DOCS)` (null embeddings — lexical-only, deterministic).

### Phase 2: Locator primitives — `tokenizeQuery`, `foldForMatch`, `locateSpans` (RED/GREEN)

- [x] 2.1 [RED] `test/domain/match-location.test.ts`: `tokenizeQuery` produces exactly the tokens `toFtsQuery`'s regex (`sqlite-index-store.ts:430-433`) produces today over a table of queries; asserts no lowercasing, no folding.
- [x] 2.2 [GREEN] `src/domain/match-location.ts`: implement `tokenizeQuery(query: string): string[]`, regex carried verbatim.
- [x] 2.3 [RED] `foldForMatch` cases: lowercase + NFD + combining-mark strip, seeded from the non-ASCII alphabet in `ejemplos/docs/` and the new fixtures.
- [x] 2.4 [GREEN] implement `foldForMatch`.
- [x] 2.5 [RED] `locateSpans(raw, terms)` cases: overlapping terms, repeated terms, no match, empty term list — spans returned in raw coordinates, ascending.
- [x] 2.6 [GREEN] implement `locateSpans`. Run `npx vitest run test/domain/match-location.test.ts` — green.

### Phase 3: Probes P1/P1b — BLOCKING gate, run before Phase 4

> These validate Decision 1's Approach-B assumption using only the Phase 2 primitives — nothing
> from flatten-map or selection is built yet. Do not proceed to Phase 4 until this phase's STOP
> gate resolves clean or the extend-and-retry path is exhausted.

- [x] 3.1 **P1 (fold agreement)**: collect the distinct non-ASCII characters present in `ejemplos/docs/` and the Phase 1 fixtures. For each character, build an in-memory FTS5 table (`tokenize='unicode61 remove_diacritics 2'`) and run `MATCH '"x{fold(c)}x"'` against a row holding `x{c}x`, then the reverse direction. Record the full character set and result in apply notes. **Result: clean, all 11 characters agree both directions (see apply-progress.md).**
- [x] 3.2 **P1b (coverage)**: run `ejemplos/goldenset.yaml`'s 22 queries through `searchLexical`; for every returned chunk assert `locateSpans` finds ≥ 1 span. Record pass rate. **Result: 100.00% (614/614 (query, chunk) pairs, 0 zero-span).**
- [x] 3.3 **STOP gate**: if P1 disagrees on a small enumerable character set, extend `foldForMatch` with explicit entries for those characters (precedent: `decode-text.ts`'s CP1252 table) and re-run 3.1 to clean. If P1 disagrees broadly, or P1b finds any zero-span chunk, **Approach B is falsified** — stop this task list and escalate to A+B per design Decision 1's table before any further task proceeds. **Gate resolved clean — both probes passed with zero disagreements/zero-span chunks. Approach B stands as designed; P2 not run (load-bearing only for A).**

### Phase 4: `flatten-map.ts` — I1–I4 (RED/GREEN)

- [x] 4.1 [RED] `test/domain/flatten-map.test.ts`: I1 `map.length === text.length`; I2 non-decreasing and every entry a valid raw index; I3 the per-character centrepiece check (`text[i] === " " || raw[map[i]] === text[i]`) over generated inputs with headings, fences, links, tables, whitespace runs, non-ASCII, empty input, and an all-fenced input (two-pass case).
- [x] 4.2 [RED] I4: `referenceFlatten` golden copy of today's `flatten()` chain (`excerpt.ts:61-74`), asserted equal to `flattenWithMap(x, d).text` over the same generated inputs.
- [x] 4.3 [GREEN] `src/domain/flatten-map.ts`: `FlatText`, `flattenWithMap` (S1–S6, shared `trackedReplace` helper for S2/S3/S5), `toFlatOffset` (binary search, least `i` with `map[i] >= rawOffset`).
- [x] 4.4 Run `npx vitest run test/domain/flatten-map.test.ts` — green; `npm run typecheck`.

### Phase 5: `selectMatchCentre` — selection policy (RED/GREEN)

- [x] 5.1 [RED] `test/domain/match-location.test.ts`: weighted distinct-term coverage (`Σ log(1 + L/f(t))` over distinct terms); stopword-early-vs-rare-late case (Gate 3's minimal form); two-distinct-late vs. one-distinct-early; scattered singletons → rarest wins; tie-break determinism (length, then earliest start).
- [x] 5.2 [GREEN] implement `selectMatchCentre(spans, budget): number | null` — two-pointer sweep over occurrences sorted by flattened offset.
- [x] 5.3 Run `npx vitest run test/domain/match-location.test.ts` — green.

### Phase 6: `toFtsQuery` extraction — regression-first (RED/GREEN)

- [x] 6.1 [RED] `test/infrastructure/sqlite-index-store.test.ts` (or existing equivalent): assert `toFtsQuery`'s emitted MATCH string is byte-identical before and after extraction, over a table of queries (multi-term, punctuation, empty, stopword-only). This is the one place the change can reach retrieval.
- [x] 6.2 [GREEN] `src/infrastructure/sqlite/sqlite-index-store.ts`: `toFtsQuery = tokenizeQuery(q).map(t => \`"${t}"\`).join(" OR ")`, null-on-empty preserved.
- [x] 6.3 **Work Unit 1 checkpoint**: `npm test`, `npm run typecheck` — full green, no wire change shipped.

---

## Work Unit 2 — The Window

### Phase 7: Gate 1 baseline — measured on current code, before window impl

- [x] 7.1 Add a test named `BASELINE (to be inverted)` over `window.md`: rank-1 excerpt does **not** contain `MERIDIANO-4417` and ends in `…`. Run `npm test` against unmodified `excerpt.ts` — **it must pass**. **Passed, observed green before any window code was written.**
- [x] 7.2 If it fails (marker already visible today), the fixture is void — rebuild `window.md` with a larger offset and repeat 7.1. **Not needed — baseline passed on the first fixture.**
- [x] 7.3 Record the observed-green run in apply notes — this is what makes Gate 1 capable of failing.
- [x] 7.4 Fixture self-asserts its own preconditions, computed via `flattenWithMap` not hard-coded: chunk count === 1, marker's flattened offset inside `[1410, 1480]`, flattened length inside `[1550, 1650]`.

### Phase 8: `buildExcerpt` window support — Decision 5/6 (RED/GREEN, includes Gate 2)

- [x] 8.1 [RED] `test/domain/excerpt.test.ts`: third optional `spans` param; clamp at both extremes (`start = clamp(centre - budget/2, 0, text.length - budget)`); dual-edge word snapping incl. the snap-revert guard (cluster span must stay inside `[start, end)`); ellipsis presence/absence at each edge; `length <= budget + 2`; empty spans → byte-identical to today's prefix (six existing tests unchanged).
- [x] 8.2 [RED] Gate 2 assertions: window at flattened offset 0 → no leading `…`; window reaching the end → no trailing `…`; `short.md` (via fixture) → neither (fixture-level check landed in Phase 9/11's `excerpt-window.test.ts`; unit-level check here via the clamp-to-start/clamp-to-end tests).
- [x] 8.3 [GREEN] `src/domain/excerpt.ts`: add `spans: readonly MatchSpan[] = []` third param; delegate flattening to `flattenWithMap`; map spans via `toFlatOffset`, drop zero-width spans; clamp → snap leading → snap trailing → ellipses per Decision 5.
- [x] 8.4 Run `npx vitest run test/domain/excerpt.test.ts` — green.

### Phase 9: Gate 1 inversion

- [x] 9.1 Replace Phase 7's baseline test with the real assertion: rank-1 excerpt contains `MERIDIANO-4417` verbatim, carries a leading `…`, carries no trailing `…` (window clamps to `[200, 1600]` on this fixture).
- [x] 9.2 Run `npx vitest run test/application/excerpt-window.test.ts` — confirm green after Phase 10's wiring lands (this test is written now, satisfied once Phase 10 completes).

### Phase 10: Call-site wiring — Decision 7

- [x] 10.1 [RED] `test/application/search-documents-spans.test.ts` (new file): spans computed only when `results.length === 0` (rank 0); `tokenizeQuery` hoisted once per search (verified by code inspection — it is pure, so hoisting has no observable-behaviour test surface — documented in the test file).
- [x] 10.2 [GREEN] `src/application/search-documents.ts:110`: hoist `terms = tokenizeQuery(query.query)`; `spans = rank === 0 ? locateSpans(chunk.content, terms) : []`; `excerpt = buildExcerpt(chunk.content, excerptBudget(rank), spans)`.

### Phase 11: Gate 3 — stopword trap

- [x] 11.1 [RED] `test/application/excerpt-window.test.ts`: over `stopword-trap.md`, query `"the windvane"` — rank-1 excerpt contains `TRAMONTANA-9182`, does not start with the document's opening words. Fixture self-asserts `the`'s first offset < 100 and count ≥ 20, `windvane`'s offset > 1400 and count === 1.
- [x] 11.2 Run and confirm green (built from Phase 5's `selectMatchCentre` and Phase 8's window). **First run was red** — the fixture's original marker placement (right after "windvane", ~40 chars past it) fell just outside the algorithm's naturally selected cluster window; the marker was repositioned before "windvane" instead (still `windvane` offset > 1400, still `the` ≥ 20 occurrences before offset 100) and the case went green without touching the selection policy itself. See apply-progress.md for the measured before/after.

### Phase 12: Gate 5 — vector-only path + contract text

- [x] 12.1 [RED/GREEN] `test/domain/excerpt.test.ts`: `buildExcerpt(long, 1400, [])` → prefix, `<= budget + 1`, trailing `…` only (empty-spans path is the vector-only path, per Decision 7).
- [x] 12.2 Integration test over a synthetic vector-only scenario (`test/application/vector-only-excerpt.test.ts`), not `test/fixtures/vector-reach/` — documented deviation, see apply-progress.md ("Deviations from Design").
- [x] 12.3 `src/server.ts:108-111`: replace the two-sentence contract with the design's wording — "centred on the part of the document that matched," "'…' at **either** end."
- [x] 12.4 `CLAUDE.md`, MCP-tools bullet 2: "(1400)" → "…(1400), spent as a window centred on the matched span rather than as a prefix"; "A trailing `…`…" → "A `…` at either edge…".

### Phase 13: Length-bound mechanical updates

- [x] 13.1 `test/application/index-and-search.test.ts:124,135,182`: `LEAD_EXCERPT_CHARS + 1` → `+ 2`. Confirm `:184`'s `SUPPORTING_EXCERPT_CHARS + 1` is left unchanged (supporting fragments stay single-ellipsis prefixes) — assert this explicitly rather than silently, so a later edit cannot drift it. Added an explicit `startsWith("…")).toBe(false)` assertion alongside the length bound.

### Phase 14: Spec cross-check

- [x] 14.1 Cross-check `openspec/specs/mcp-contract/spec.md`'s 6 requirements / 9 scenarios (already written by `sdd-spec`) against the tests landed in Phases 8–13, per the Coverage Map above. No file edit expected unless a scenario is found unsatisfied — if so, fix the implementation, not the spec. **All 6 requirements / 9 scenarios have direct test coverage; no spec edit needed.** See apply-progress.md for the requirement-by-requirement mapping.

### Phase 15: Gate 4 — scope falsifier (manual)

- [x] 15.1 `npm test`, `npm run typecheck`, `npm run build` — all green.
- [x] 15.2 `node dist/cli.js --root ejemplos eval` — MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22, **unmoved** against the published baseline (`excerpt.ts:27-30`). Non-vacuous because Phase 6 touches `toFtsQuery`. **Result: identity held on all three (MRR 0.943, recall@5 1.00, top-1 20/22).** Recorded in `verify-report.md`.

### Phase 16: Recorded observation (not a gate)

- [x] 16.1 New script `scripts/excerpt-offset-distribution.mjs`, following `vector-reach.mjs`'s pattern. Over `ejemplos/` + `goldenset.yaml`'s 22 queries, records for each non-lead result the flattened offset of its earliest located match span, and reports the fraction beyond `SUPPORTING_EXCERPT_CHARS` (120). Written into `verify-report.md`. **Result: 5.7% (5/88), well under the 50% reopening trigger — decision stands, not triggered.**
