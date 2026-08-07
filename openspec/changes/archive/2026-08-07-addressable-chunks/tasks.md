# Tasks: A Chunk Heading Is Never Empty

## Review Workload Forecast

| Task group | Estimated changed lines |
|---|---|
| Phase 1: `test/helpers/build.ts` fixture export | ~5 |
| Phase 2: Baseline tests (`chunking.test.ts`, `index-pipeline.test.ts`, `heading-less-round-trip.test.ts`) | ~150 |
| Phase 3: `documentHeading`/`withNonEmptyHeadings` + `heading-fallback.test.ts` | ~120 |
| Phase 4: `index-pipeline` seam wiring + Gate 2 inversion | ~25 |
| Phase 5: Gate 1/3 inversion (`heading-less-round-trip.test.ts`) | ~50 |
| **Work Unit 1 subtotal** | **~350** |
| Phase 6: `read-document.ts` `no-sections` variant + tests | ~90 |
| Phase 7: `formatReadResult` export/retype + `format-read-result.test.ts` | ~120 |
| Phase 8: Contract text (`server.ts` descriptions) | ~10 |
| **Work Unit 2 subtotal** | **~220** |
| Phase 9: Spec cross-check (no diff — already written by `sdd-spec`) | 0 |
| Phase 10: Gate 5 scope falsifiers (verification only, no diff) | 0 |
| Phase 11: `CLAUDE.md` docs (3 additions) | ~30 |
| Phase 12: Recorded observations (`verify-report.md` only) | 0 |
| **Total** | **~600 (range 540–770, per design's forecast)** |

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
| Decision status | **Already resolved.** User accepted `size:exception` on 2026-08-07 against the design-phase forecast (540–770 vs. a 400 budget) and the two-PR alternative, recorded in `state.yaml`'s `delivery_decision`. Not re-opened here. Precedent: `match-centred-excerpt` (750–800 forecast, ~1521 actual), `encoding-aware-reads` (555–695), `incremental-reindex` (500–800). |

**This is a single PR.** The design's cut line is the review structure *inside* it, not a PR boundary. Land Work Unit 1 as one or more commits that fix the write-side defect and leave `npm test`/`typecheck`/`build` green, then Work Unit 2 as commits on top. Per design Decision 4, Work Unit 2 has the **wider reach** (it is the only half that helps a corpus that never reindexes) — it must not be the part that gets squeezed if the PR runs long.

### Suggested Work Units

| Unit | Goal | Delivery | Notes |
|---|---|---|---|
| 1 | Write side — `documentHeading`, `withNonEmptyHeadings`, the `chunking.ts` segment filter, the `index-pipeline` seam | Single PR, commit group 1 | Fixes the defect at its root; needs a full `compendio index` to reach existing corpora |
| 2 | Read side — the `no-sections` `ReadResult` variant, `availableSections` filtering, `formatReadResult` | Single PR, commit group 2 | Depends on Unit 1 compiling; wider reach per Decision 4 — do not squeeze |

## Coverage Map

| Requirement / Gate / Item | Task(s) |
|---|---|
| `indexing`: Every Emitted Chunk Heading Is Non-Empty — heading-less loose doc | 2.1, 2.4, 3.3, 3.4, 4.1, 4.2, 5.1 |
| `indexing`: ... — `-.md`/`_.md` humanizes to empty | 2.3, 4.1, 4.2 |
| `indexing`: ... — `NO_CHUNKING` covered by the same invariant | 2.3, 4.1, 4.2 |
| `indexing`: Heading-Only Changes Also Require a Full Reindex | 11.2 (doc only — operational, not code-testable) |
| `mcp-contract`: `search_docs`'s `section` never empty + round-trips | 5.1, 5.2 |
| `mcp-contract`: ... stale corpus not repaired at query time | 9.1 (satisfied by omission — no repair logic is added anywhere in Phases 1–8; cross-checked, not separately tested) |
| `mcp-contract`: `read_doc` never renders an empty-labeled bullet; explains a sectionless document in prose | 6.1–6.4, 7.1–7.3 |
| Gate 1 (defect reproduces, then disappears) | 2.4, 2.5, 5.1 |
| Gate 2 (invariant on output, not data source) | 2.3, 4.2 |
| Gate 3 (round trip through the public contract) | 5.2 |
| Gate 4 (failure path says something true) | 7.1–7.3 |
| Gate 5 (scope falsifiers) | 10.1–10.4 |
| Gate 6 (operational consequence written down) | 9.1 (spec, already written), 11.1–11.3 |
| Recorded observations (not gates) | 12.1–12.2 |
| P1 (parser probe) | Already discharged by the orchestrator's measurement (state.yaml) — turned into regression tests at 2.2, no investigation task |

---

## Work Unit 1 — The Write Side

### Phase 1: Fixture prerequisite

- [x] 1.1 `test/helpers/build.ts`: add `VECTOR_REACH_DOCS` export pointing at `test/fixtures/vector-reach/docs` (six committed heading-less documents, already the exact failing shape — no new fixture corpus).

### Phase 2: Baseline — record today's broken behavior, before any implementation

> Case A has zero test coverage today. A green suite carries no information until these baselines are landed and observed to pass on unmodified code — that observation is what makes Gate 1 capable of failing.

- [x] 2.1 `test/domain/chunking.test.ts`: add an `emptyTitleOutline(sections, intro = "")` helper (`{ title: "", summary: "Summary.", intro, sections }`) — the existing `outline()` at `:13-15` hardcodes `title: "Test doc"` and cannot express this case. Baseline test: a heading-less outline with an intro long enough to split into several chunks → every chunk's `heading === ""` today.
- [x] 2.2 Same file, two P1-confirmed regression baselines (orchestrator-measured, not investigation — see design Open Question P1 / `state.yaml`): (a) a document with a good H1 and H2 plus **one top-level empty `##` section** among real ones → that section's chunk has `heading === ""` today; (b) an **empty `###` child under a good H2** → that chunk has `heading === "Parent > "` today (non-empty but malformed). **Trap**: both cases need the empty-heading piece to survive `mergeTinyPieces` (`chunking.ts:78-93`), or the test passes while proving nothing — the orchestrator's first probe returned a single correct heading for exactly this reason. The merge fires when `estimateTokens(piece.text) < opts.minTokens` **and** the merged candidate still fits `maxTokens`, so either condition defeats it. This file's `OPTS` is `{ minTokens: 25, maxTokens: 100 }` (`chunking.test.ts:7`) — that is **25 tokens, not 100 characters**; `maxTokens` is the 100. Size the body from `estimateTokens`, not from a character count, and assert `chunks.length > 1` so a silently merged fixture fails loudly instead of passing.
- [x] 2.3 `test/application/index-pipeline.test.ts`: via the existing `run(content, options, path)` helper, a heading-less body at path `"-.md"` (humanizes to `""`, `convention.ts:45-51`) → every chunk `heading === ""` today, through both `chunkOutline` and `wholeDocumentChunk` (`noChunking: ["-.md"]`).
- [x] 2.4 Create `test/application/heading-less-round-trip.test.ts`: Gate 1's end-to-end baseline over `test/fixtures/vector-reach/docs/manual-extenso.md`, via `buildHarness(null, EXAMPLES_CONVENTION, VECTOR_REACH_DOCS)` (null embeddings, lexical-only, deterministic). Assert every persisted chunk `heading === ""`, `search_docs` result `section === ""`, `read_doc({ path, section: "anything" })` returns `section-not-found` with `availableSections` exactly `[""]`.
- [x] 2.5 Run `npm test` on unmodified `src/` — confirm 2.1–2.4 all pass. **If any fails, the fixture is void and MUST be rebuilt** (Gate 1 STOP condition). Record the run in apply notes.

### Phase 3: `documentHeading` + `withNonEmptyHeadings` — domain primitives (RED/GREEN, Gate 2 unit half)

- [x] 3.1 [RED] Create `test/domain/heading-fallback.test.ts`: `documentHeading(title, path)` — non-empty title wins over path; empty title falls to non-empty path; both empty → exactly `"Untitled document"` (`documentHeading("", "")`).
- [x] 3.2 [RED] Same file: `withNonEmptyHeadings(chunks, fallback)` postconditions — empty `heading` replaced by `fallback`; non-empty `heading` preserved; replacement uniform across every chunk of one batch; `content`/`position` untouched.
- [x] 3.3 [GREEN] `src/domain/chunking.ts`: add `export const UNTITLED_HEADING = "Untitled document"`; `export function documentHeading(title: string, path: string): string` = `title.trim() || path.trim() || UNTITLED_HEADING`; `export function withNonEmptyHeadings(chunks: Chunk[], fallback: string): Chunk[]`. Doc comments per design's Interfaces/Contracts block, naming where the invariant is enforced.
- [x] 3.4 [GREEN] Same file, the join at `chunking.ts:59`: `piece.path.filter((s) => s.trim().length > 0).join(" > ")` (was `piece.path.join(" > ")`).
- [x] 3.5 Invert 2.2(b): the empty-`###`-child case now asserts `heading === "Parent"`. Leave 2.1 and 2.2(a) asserting `heading === ""` — `chunkOutline` alone still may emit an empty heading for a single-empty-segment path; `withNonEmptyHeadings` at the seam (Phase 4) closes that last mile. Run `npx vitest run test/domain/heading-fallback.test.ts test/domain/chunking.test.ts` — green.

### Phase 4: The `index-pipeline` seam (GREEN, Gate 2 integration half)

- [x] 4.1 [GREEN] `src/application/index-pipeline.ts:75-77`: compute `const fallback = documentHeading(resolution.meta.title, file.path);` then wrap the branch — `const chunks = withNonEmptyHeadings(isNoChunking(...) ? wholeDocumentChunk(...) : chunkOutline(...), fallback);`. Import `documentHeading`/`withNonEmptyHeadings` from `../domain/chunking.js`. `chunkOutline`'s signature and its 15 test call sites stay untouched.
- [x] 4.2 Invert 2.3: the `-.md` baseline now asserts every chunk `heading === "-.md"` (the path fallback, since `humanizeFileName("-.md") === ""`), for both the `chunkOutline` branch and the `wholeDocumentChunk`/`noChunking` branch. Run `npx vitest run test/application/index-pipeline.test.ts` — green. **This is Gate 2.**

### Phase 5: Gate 1 inversion + Gate 3 (round trip)

- [x] 5.1 Invert 2.4: every chunk `heading === "Manual extenso"`; `search_docs` result `section === "Manual extenso"`.
- [x] 5.2 Same file, Gate 3: take the `section` string `search_docs` returned, pass it **verbatim** to `read_doc({ path, section })`, assert `result.type === "section"` (never `section-not-found`). Add the equivalent round-trip assertion for the `-.md` pipeline case (Phase 4), whose value contains punctuation `normalize` does not strip (`similarity.ts:37-42`).
- [x] 5.3 Run `npx vitest run test/application/heading-less-round-trip.test.ts` — green. **Work Unit 1 checkpoint**: `npm test`, `npm run typecheck` full green, no `no-sections` case needed yet (round trip resolves to `section`, not the failure path).

---

## Work Unit 2 — The Read Side

### Phase 6: `no-sections` `ReadResult` variant + `availableSections` filter (RED/GREEN)

- [x] 6.1 [RED] `test/application/read-document.test.ts`: seed a store directly — `store.saveDocument(meta, [{ heading: "", content: "...", position: 0 }])` against `SqliteIndexStore(":memory:")` (the stale-corpus state, no pipeline needed). `read.execute({ path, section: "anything" })` → `{ type: "no-sections", meta, section: "anything" }`.
- [x] 6.2 [RED] Same file: a store mixing empty and non-empty chunk headings → the `section-not-found` path's `availableSections` never contains `""`. Confirm `:116-166` (reassembly) is untouched by diff, not by re-reading.
- [x] 6.3 [GREEN] `src/application/read-document.ts`: add `{ type: "no-sections"; meta: DocumentMeta; section: string }` to `ReadResult`; filter empty members out of the `availableSections` assembly (`:80-92`); when the filtered set is empty, return `no-sections` instead of `section-not-found`.
- [x] 6.4 Run `npx vitest run test/application/read-document.test.ts` — green.

### Phase 7: `formatReadResult` — export, retype, new case (RED/GREEN, Gate 4)

- [x] 7.1 [RED] Create `test/server/format-read-result.test.ts`: literal-output assertions across every `ReadResult` variant, including `availableSections` = `[""]`, `["", "A"]`, `[]`, and the `no-sections` variant. Assert **no rendered line equals `"- "`** and none matches `/^- \s*$/`. Assert the `no-sections` text verbatim: `Document "<path>" has no addressable sections.` / `Read it whole with read_doc({ path: "<path>" }).`
- [x] 7.2 [GREEN] `src/server.ts`: export `formatReadResult`; retype its parameter from `ReturnType<Container["readDocument"]["execute"]>` to `ReadResult` (import from `./application/read-document.js`); add the `no-sections` case; filter empty labels **again** inside `section-not-found` (Decision 5), falling through to the no-sections prose if the filtered list is empty.
- [x] 7.3 Run `npx vitest run test/server/format-read-result.test.ts` — green. **Work Unit 2 checkpoint**: `npm test`, `npm run typecheck` full green. Note for the record (not a task action): `tsconfig.json`'s `include: ["src/**/*"]` means `typecheck` enforces this switch's exhaustiveness for `src/server.ts` only — it does not and cannot validate `test/` files, so 7.1's assertions are the real coverage.

### Phase 8: Contract text (`server.ts` tool descriptions)

- [x] 8.1 `src/server.ts`, `read_doc`'s `section` param description: append "Sections name a region of a document, not a single fragment: a large section returns all of its parts joined."
- [x] 8.2 `src/server.ts`, `search_docs` description: replace "Each result has path, title, section, excerpt and score." with "Each result has path, title, section, excerpt and score; `section` names the document region the fragment came from — a document with no headings reports one region for the whole file." Both sentences claim document-region granularity — no artifact in this change may describe `section` as fragment-level.

---

## Phase 9: Spec cross-check

- [x] 9.1 Cross-check `openspec/specs/indexing/spec.md`'s two requirements and `openspec/specs/mcp-contract/spec.md`'s two requirements (already written by `sdd-spec`, in `openspec/changes/addressable-chunks/specs/`) against the tests landed in Phases 2–8. No file edit expected unless a scenario is found unsatisfied — if so, fix the implementation, not the spec. Explicitly confirm no repair-at-query-time logic was added anywhere (the stale-corpus `section: ""` case must be returned as stored).

## Phase 10: Gate 5 — scope falsifiers (BLOCKING, run last)

- [x] 10.1 `test/application/read-document.test.ts:116-166` and `test/domain/chunking.test.ts:74-89`/`:91-114` pass **unchanged** — verify by diff, not by re-reading; if either needed an edit, the change left its stated scope.
- [x] 10.2 `SCHEMA_DDL` in `src/infrastructure/sqlite/sqlite-index-store.ts` is byte-identical to pre-change (diff-check, no edit expected). `src/domain/ports.ts` and `src/domain/model.ts` (`Chunk` shape) unchanged.
- [x] 10.3 `npm test`, `npm run typecheck`, `npm run build` — all green.
- [x] 10.4 `node dist/cli.js --root ejemplos eval` — MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22, as **identity**, not a tolerance band (all 12 `ejemplos/` documents carry exactly one H1). Record in `verify-report.md`.

## Phase 11: Gate 6 — docs (BLOCKING)

- [x] 11.1 `CLAUDE.md`, non-obvious-decisions list (~line 153): add a bullet — no persisted chunk has an empty `heading`; the invariant is enforced once at `transformFile`, not inside `chunkOutline`; the fallback chain is heading path → `meta.title` → `file.path` → `"Untitled document"`, and level 2 is the path because it round-trips through `normalize` by construction.
- [x] 11.2 Same bullet, second half: a heading-only change does not reach unchanged documents through incremental sync (content-hash fingerprinting) — a full `compendio index` is required, the same reason `bounded-chunk-size` documented for boundary changes.
- [x] 11.3 `CLAUDE.md`, next to the Gate 1b table (~line 75-90): one-line caveat — the recorded cosines predate `addressable-chunks`, which changed the embedded string (`heading\ncontent`) for every heading-less chunk in `test/fixtures/vector-reach/docs/` (all six are heading-less); re-measure before trusting them on the next chunking change. Do **not** re-run Gate 1b in this cycle — deliberately not promoted to a gate (design Decision 6.3).

## Phase 12: Recorded observations (not gates)

- [x] 12.1 After `node dist/cli.js --root test/fixtures/vector-reach index`, query `SELECT heading, COUNT(*) FROM chunks GROUP BY heading` against `test/fixtures/vector-reach/.compendio/compendio.db`. Record distinct-heading count and max chunks-per-heading in `verify-report.md`.
- [x] 12.2 Restate (do not run) exploration §7's `MAX_CHUNKS_PER_DOCUMENT` probe recipe in `verify-report.md`, per `scripts/rank-probe.mjs`'s "after cap" row.
