# Tasks: Bounded Chunk Size

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | PR #1 ~550-650 (mostly generated fixture content) + PR #2 ~650-850 ≈ 1200-1500 total |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: **Resolved** — the user accepted `size:exception` for PR #2 rather
than sub-slicing it. PR #1 stays a separate PR because its ordering is a measurement constraint.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High (accepted for PR #2 under `size:exception`)

**The 2-unit split is a measurement constraint, not only a size decision.** Gate 1b's "before"
reading — proving the marker passage is unreachable via the vector leg — can only be captured on a
build that has the fixture/script but not yet the splitter. If the splitter lands first, that
reading is unrecoverable short of reverting a merged build (same pattern as commit `603e7d3`). So
PR #1 (fixture + `--profile fixture` + `vector-reach.mjs`, zero production code) MUST merge and be
measured against BEFORE PR #2 (the splitter) starts.

PR #2 stays one work unit despite its size: `split-text.ts`, its two call sites (`chunkOutline`,
`wholeDocumentChunk`), the `mergeTinyPieces` guard fix, and the `480` default together form one
correctness invariant — "no chunk exceeds `maxTokens` on any path." Landing any one alone would
leave that invariant false on `main`. Expect Medium-High review effort on PR #2; if it lands over
budget, use `size:exception` rather than fracturing the invariant.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Gate 1b tooling: `--profile fixture`, `vector-reach.mjs`, committed fixture, "before" capture | PR 1 | Base: `main`. Zero production code; safe to merge alone. |
| 2 | `splitToBound`, wiring into both chunk producers, merge-guard fix, `480` default, docs, Gates 1/1b-after/2 | PR 2 | Base: `main` (post PR #1 merge). One correctness invariant; do not sub-slice. |

## Work Unit 1 — Gate 1b Tooling (PR #1, base: `main`)

No production code touched. Enables the pre-splitter "before" measurement (Decision 5, Decision 6).

## Phase 1: Fixture Generator and Vector-Reach Script (PR #1)

- [x] 1.1 `scripts/generate-perf-corpus.mjs`: add `--profile fixture` — one heading-less ~12,000-char Spanish document with `QUETZAL-7731` at ~char 6,000, plus 5 short distractor documents; same prose vocabulary/`MARKER` constant as the default profile (Decision 6)
- [x] 1.2 `test/fixtures/vector-reach/docs/**`: generate with `--profile fixture` and commit the output (≈30 KB) — do NOT regenerate on demand
- [x] 1.3 Create `scripts/vector-reach.mjs`: build `SqliteIndexStore`, real `TransformersEmbeddings` (`Xenova/multilingual-e5-small`), embed `"query: " + query`, call `store.searchVector(v, {}, 10)` — vector leg only, FTS5 never consulted (Decision 5)
- [x] 1.4 `vector-reach.mjs`: print per rank — chunk id, path, heading, `estimateTokens`, whether content contains `QUETZAL-7731`; then the marker chunk's own cosine (`dot(v, embed("passage: " + content))`)
- [x] 1.5 Manual: `node dist/cli.js --root test/fixtures/vector-reach index` then `node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"` on the pre-splitter build (Gate 1b "before") — **ran; the original pass criterion was withdrawn as a result.** `containsMarker` is text containment, so it could never fail before the split. Measured: marker chunk **rank 4 of 6**, cosine **0.8350**. Design Decision 5 is amended; 1.8/1.9 below complete this measurement under the new criteria
- [x] 1.6 `CLAUDE.md`: add the Gate 1b manual procedure (commands from 1.5) beside the existing progress smoke test
- [x] 1.7 Run `npm test` + `npm run typecheck` — PR #1 gate (no `src/` changes, both must already be green)
- [x] 1.8 Extend `scripts/vector-reach.mjs` to print everything amended Decision 5 requires and the current script omits: per-rank cosine for **every** chunk (not only the marker's), the **filler band** (min/max cosine across non-marker chunks), the **truncation probe** (`dot(embed("passage: " + first 384 words of the marker document), embed("passage: " + marker chunk content))`), and the two diagnostics (marker sentence's character offset inside its chunk, that chunk's character length). The band figures currently on record came from a throwaway diagnostic that was deleted — the committed script MUST reproduce them
- [x] 1.9 Re-run the Gate 1b "before" measurement with the extended script on the pre-splitter build and record the full baseline in `apply-progress.md`: criterion A (rank, expect not 1), criterion B baseline (marker cosine and the filler band), criterion C (truncation probe, expect ≥ 0.99 — if it reads below, the fixture is too small to exceed the model window and the whole gate is void). This is the last task that requires a build without the splitter — **measured: A = rank 4 of 6, B = 0.8350 in [0.8255, 0.8407], C = 0.9949, all reproduced exactly on a second independent run** — **superseded by 1.10: this run's cosines came from re-embedded, not stored, vectors**
- [x] 1.10 Fix `scripts/vector-reach.mjs` to read cosines from the chunk's **stored** vector in `chunks_vec` (own `better-sqlite3` connection + `sqliteVec.load`, decoded FLOAT32 blob, copied out of the row buffer), assert the resulting per-rank cosines are monotonically non-increasing and exit non-zero with a clearly-marked error if not, then re-run the Gate 1b "before" measurement on the unchanged pre-splitter build and record the superseding baseline (design.md Decision 5, amended a second time) — **measured: A = rank 4 of 6 (unchanged), B = 0.8357 in filler band [0.8274, 0.8385] (shifted from the re-embedded 0.8350 / [0.8255, 0.8407]), C = 0.9947 (was 0.9949); monotonicity checker proven able to fail via a temporary perturbation, then reverted**

## Work Unit 2 — Splitter, Wiring, Default, Docs (PR #2, base: `main` post PR #1)

## Phase 2: `splitToBound` Cascade — RED (PR #2)

- [x] 2.1 Create `test/domain/split-text.test.ts`: text within `maxTokens` returns `[text]` unchanged, one `estimateTokens` call (Req: Chunk Size Is an Unconditional Upper Bound)
- [x] 2.2 Test: multi-paragraph section splits at paragraph boundaries only, no sentence/word level used (Req: Split Preference Cascade — paragraph scenario)
- [x] 2.3 Test: one oversized paragraph falls through to sentence boundaries (Req: Split Preference Cascade — sentence fallback)
- [x] 2.4 Test: one oversized line/sentence with no sentence boundary falls through to word boundaries (Req: Split Preference Cascade — word fallback)
- [x] 2.5 Test: whitespace-free 5,000-char run falls to fixed-width code-point splitting (`maxTokens * 4`), never splitting a surrogate pair (Decision 2, level 6)
- [x] 2.6 Test: Spanish sentence rule — `¿…?`/`¡…!`, `3.5`, `art. 12`, `J. García` create no false boundary (Decision 2)
- [x] 2.7 Test: oversized markdown table splits with header + separator row re-emitted on every piece; each piece parses as valid markdown (Req: A Split Markdown Table's Pieces Stay Valid Markdown)
- [x] 2.8 Test: fenced code block never splits at an internal blank line; an oversized fence re-wraps with its opening fence/info string + closing fence on each piece (Decision 3)
- [x] 2.9 Test: degenerate table — header + separator + one row alone exceeds `maxTokens` — every emitted piece stays `<= maxTokens`, that row's fragments carry no orphan preamble, other rows keep theirs (Decision 3, "the bound wins")

## Phase 3: `splitToBound` Cascade — GREEN (PR #2)

- [x] 3.1 Create `src/domain/split-text.ts`: `export function splitToBound(text: string, maxTokens: number): string[]`, no imports beyond `tokens.js`
- [x] 3.2 Implement the 6-level cascade (blocks, fence-aware → structural rows → lines → sentences → words → code points), greedy packing per level, recursing only into units still over the bound (Decision 2)
- [x] 3.3 Run `npx vitest run test/domain/split-text.test.ts` until Phase 2 is green

## Phase 4: Wire Into `chunkOutline` + Merge-Guard Defect Fix (PR #2)

- [x] 4.1 RED — `test/domain/chunking.test.ts`: delete `"keeps a section with a huge table whole (tables are never split)"` — it asserts the behavior this change removes
- [x] 4.2 RED — add: split pieces of an oversized H3 child share the parent's full heading path `"H2 > H3"` (Req: Every Split Piece Retains Its Full Heading Path)
- [x] 4.3 RED — add: table split via `chunkOutline` repeats header/separator per piece (replaces the case deleted in 4.1)
- [x] 4.4 RED — **defect regression, not a refactor**: at `maxTokens: 100`, two pieces of 200 chars each (50+50 tokens under the current summand guard) must NOT merge, because the joined candidate is `ceil(402/4) = 101 > 100` (Decision 4)
- [x] 4.5 GREEN — `src/domain/chunking.ts`: in `chunkOutline`, `flatMap` every `Piece` through `splitToBound(p.text, opts.maxTokens)` before `mergeTinyPieces` (Decision 1)
- [x] 4.6 GREEN — `src/domain/chunking.ts`: fix `mergeTinyPieces` to measure `estimateTokens(candidate)` (the joined `` `${previous.text}\n\n${piece.text}` `` string), not the summed per-piece estimates (Decision 4)
- [x] 4.7 GREEN — correct the `chunkOutline` doc comment (`:20-27`): remove the "tables never cut in half" / heading-boundary-only claim
- [x] 4.8 Run `npx vitest run test/domain/chunking.test.ts` until green

## Phase 5: Wire Into `wholeDocumentChunk` / `NO_CHUNKING` (PR #2)

- [x] 5.1 RED — create `test/application/index-pipeline.test.ts`: a `NO_CHUNKING` file within `maxTokens` still emits exactly one chunk (Req: `NO_CHUNKING` Suppresses Heading-Based Splitting Only — within-bound scenario)
- [x] 5.2 RED — add: a `NO_CHUNKING` file above `maxTokens`, containing internal markdown headings, splits via the paragraph/sentence/word cascade into multiple bounded chunks, split points NOT derived from its headings (Req: `NO_CHUNKING` — above-bound scenario)
- [x] 5.3 GREEN — `src/application/index-pipeline.ts`: change `wholeDocumentChunk(title, body)` to `wholeDocumentChunk(title, body, maxTokens)`, route `content` through `splitToBound`, map each piece to a `Chunk` with its own `position`
- [x] 5.4 GREEN — update `transformFile`'s call site to pass `options.chunking.maxTokens` into `wholeDocumentChunk`
- [x] 5.5 GREEN — correct the `PipelineOptions.noChunking` doc comment (`:9-10`)
- [x] 5.6 Run `npx vitest run test/application/index-pipeline.test.ts` until green

## Phase 6: Default, Comments, Test-Harness Drift (PR #2)

- [x] 6.1 `src/infrastructure/config.ts`: `DEFAULT_CONFIG.chunk.maxTokens` `800 → 480`; correct the `NO_CHUNKING` doc comment (`:40-43`) (Req: Default `chunk.maxTokens` Is 480 and Is a Guaranteed Upper Bound)
- [x] 6.2 `src/application/index-documents.ts`: correct the matching `noChunking` doc comment (`:36-37`) — no behavior change
- [x] 6.3 `test/helpers/build.ts` (`:75`): replace the hardcoded `{ minTokens: 100, maxTokens: 800 }` with `DEFAULT_CONFIG.chunk` + `NO_CHUNKING` imports so the harness cannot drift from production config again
- [x] 6.4 `test/application/index-progress.test.ts` (`:24`): same hardcoded-pair fix over the `ejemplos/`-sized case; leave the explicitly-sized synthetic cases at `:134`/`:158` untouched
- [x] 6.5 Confirm `test/application/index-and-search.test.ts:292/544` and `test/application/sync-index.test.ts:34` need no change (sized against their own explicit options, per design) — run them to verify

## Phase 7: Cross-Cutting Bound Invariant (PR #2)

- [x] 7.1 `test/domain/chunking.test.ts`: adversarial invariant — over a heading-less 50 KB body, one 50 KB paragraph, one unbroken line, a 60-row table, and a fenced block, every `chunkOutline` chunk is `estimateTokens(content) <= maxTokens`, and pieces cover the source modulo re-emitted preambles
- [x] 7.2 `test/application/index-pipeline.test.ts`: same invariant for a `NO_CHUNKING` body above the bound

## Phase 8: Integration Regression (PR #2)

- [x] 8.1 Run the existing `index-and-search`/`read-document` integration tests at the new `480` default: `ejemplos/` indexes clean, `glosario.md` (~290 tokens) is still exactly 1 chunk, `read_doc({ section })` returns a split section whole and in order
- [x] 8.2 Full suite: `npm test` and `npm run typecheck` green

## Phase 9: Manual Gates 1 / 1b-after / 2 + Docs (PR #2)

- [x] 9.1 Manual Gate 1: `node dist/cli.js --root ejemplos eval` before/after `480` — MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22; any drop blocks, no tolerance band (Req: English Contract Preserves the `ejemplos/` Baseline — this change's own gate governs, not the rename's exact-hold clause) — **measured (coordinator, pre-batch): hybrid recall@5 1.00 / MRR 0.943 / 0 failures — PASS, holds exactly; lexical recall@5 0.95 / MRR 0.856 / 1 failure — reported, not gated (moved from the README's published 0.857 to 0.856, per explicit user decision)**
- [x] 9.2 Re-measure `ejemplos/` chunk count at the new default (was 27 at 800) for `README.md`'s worked example — do not copy the old figure — **measured: 11 documents / 29 chunks at 480 (was 27 at 800), from the real indexer; traced in the Phase 6-8 batch to `mergeTinyPieces`' narrower merge headroom on one document, not to any section actually being divided by `splitToBound`**
- [x] 9.3 Manual Gate 1b-after: re-run the extended `scripts/vector-reach.mjs` (from 1.8) against the rebuilt splitter and gate on all three criteria of amended Decision 5 — **A**: the `QUETZAL-7731` chunk ranks 1 in the vector-only ranking; **B**: its cosine is `>= 0.855` and strictly above that run's own filler-band ceiling (`<= 0.8385` fails: the mechanism did not fire regardless of rank; `>= 0.90` is a red flag that the splitter cut far below the bound, not a better pass); **C**: the truncation probe is reported (expected `<= 0.97`), not gated. Compare against the 1.9 baseline — **measured (coordinator, pre-batch): A rank 1 of 10 (was 4 of 6) — PASS; B cosine 0.8800, band ceiling 0.8441 (was 0.8357 in-band) — PASS (>= 0.855 and above ceiling), though above the design's derived 0.855-0.875 expected range (below the 0.90 red-flag line); C truncation probe 0.9447 (was 0.9947), well under the expected <= 0.97 — reported, not gated. Fixture went 6 -> 19 chunks; marker chunk is 421 tokens, marker at char 1164 of 1681**
- [x] 9.4 Manual Gate 2: `node scripts/generate-perf-corpus.mjs <dir>` (default profile), index before/after — `ba/manual.md` 1 → ~88 chunks, corpus 242 → ~330, ~367 s → ~60 s; stop and revisit the design if contradicted — **measured: `ba/manual.md` 1 -> 99 chunks (predicted ~88, +12.5%), corpus 242 -> 358 (predicted ~330, +8.5%), full index 367 s -> ~31 s (predicted ~60 s, well below — larger speedup than predicted). Reported as a finding, not smoothed: chunk counts landed moderately above the point prediction, wall-clock landed well below it. See apply-progress.md for the full measurement, empirical Gate 3 check, and the reasoning for both deviations**
- [x] 9.5 `CLAUDE.md`: correct "cuts only happen at heading boundaries, so tables are never split mid-row"; add the Gate 2 manual procedure beside Gate 1b's (1.6); update the `0.943`/`20/22` figures only if 9.1 moves them; add the "chunk-boundary config changes need a full `compendio index`" operational note (Req: Chunk Boundary Changes Require a Full Reindex). Do NOT touch `openspec/changes/archive/2026-07-28-index-progress-reporting/exploration.md:29` — archived audit trail — **done; `0.943`/`20/22` unchanged (9.1 did not move them); archived file confirmed untouched**
- [x] 9.6 `README.md` (`:136`): config example `800 → 480` — **done**
- [x] 9.7 `README.md` (`:242-247`): update the "27 chunks" figure (from 9.2) and the eval table — hybrid row gated by 9.1 (must not move), keyword-only row (recall@5 0.95, MRR 0.857) reported as measured, not gated — **done: 27 -> 29 chunks, hybrid row unchanged (1.00 / 0.943 / 0), keyword-only row updated 0.857 -> 0.856 per 9.1's measured figure**

## Phase 10: Final Gate (PR #2)

- [x] 10.1 Gate 3: no emitted chunk exceeds `maxTokens` on any path (heading-less doc, single 50 KB paragraph, single oversized line, `NO_CHUNKING` file above the bound — Phase 7); each split table piece parses as valid markdown carrying its header row (2.7) — **holds: the Phase 7 unit-invariant suite (87 tests across `split-text`/`chunking`/`index-pipeline`/`read-document`) is green, plus an empirical check against the real 358-chunk Gate 2 index: max `estimateTokens` across every chunk is exactly 480 (the bound itself), zero chunks exceed it**
- [x] 10.2 `npm test` and `npm run typecheck` pass — **376/376, both `tsc` invocations clean**
- [x] 10.3 Diff review against the design's File Changes table — every listed file touched, nothing else — **all 15 listed files/patterns touched, none left untouched; 3 undocumented files found and reported (not hidden) — see apply-progress.md's "Task 10.3" section**
