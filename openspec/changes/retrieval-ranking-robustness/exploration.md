## Exploration: Retrieval ranking robustness under query reformulation

### Current State

**Recommendation first:** treat this as a measurement and evaluation change before treating it as a fusion-algorithm change. The current evidence attributes the demonstrated failure to hybrid ranking, but it does not yet identify which vector/fusion behavior should replace the present one.

#### Observed facts

- `SearchDocuments.runSearch` retrieves `max(50, requestedK * 10)` chunk IDs from BM25 and, when available, vector search; it fuses the two ranked ID lists with RRF, applies a two-chunks-per-document cap, and only then slices to `requestedK` (`src/application/search-documents.ts:39-42,83-102`).
- RRF uses the fixed formula `sum(1 / (60 + rank))`; it receives ranks, not BM25 scores or vector distances (`src/domain/fusion.ts:6-29`). Displayed scores are rounded to four decimals after ranking (`src/application/search-documents.ts:129-135`).
- FTS5 ranks an OR query over all normalized query tokens. The vector leg uses normalized E5 query text (`query: ...`) and sqlite-vec nearest-neighbour order (`src/infrastructure/sqlite/sqlite-index-store.ts:458-500`; `src/application/search-documents.ts:157-174`).
- `capPerDocument` is order-preserving and can only remove the third and later fused chunks from a document; it cannot demote a retained result relative to another retained result (`src/domain/fusion.ts:32-50`; `test/domain/fusion.test.ts`).
- `EvaluateSearch` measures the rank of an expected **document path**, after deduplicating paths. `EvalCase` contains only `question` and `expected`; it cannot express a section, answer-bearing chunk, or answer phrase (`src/domain/metrics.ts:1-18`; `src/application/evaluate-search.ts:40-52`).
- Evaluation asks `SearchDocuments` for `3 * evaluationK` chunks before deduplicating documents. Because search candidate depth itself depends on requested `k`, an eval at `k=5` fuses up to 150 candidates per leg, while the normal default search at `k=5` fuses 50. Current eval is therefore a useful document-retrieval indicator, but not an exact replay of the default search population (`src/application/evaluate-search.ts:16-17,40-52`; `src/application/search-documents.ts:88`).
- The committed Spanish `ejemplos/goldenset.yaml` has 22 document-level cases. The CLI loader accepts only the frozen keys `pregunta` and `esperado` (`src/cli.ts:305-331`). The documented 0.943 MRR / 20-of-22 top-1 result is historical evidence and was not re-run during this read-only exploration.
- The external `DocuTests2` corpus is currently present with 81 Markdown documents and a read-only index containing 81 documents and 888 chunks, but no root or `demo-docs` goldenset. The answer text is present in two overlapping stored chunks, IDs 361 and 362, both headed `6. Settlement reconciliation > Capture collision`; stable evaluation must identify a **set** of answer-bearing chunks by path/heading/content evidence, never by database ID.
- A read-only FTS5 diagnostic against that index reproduced the production lexical query construction. For the successful wording, the two answer-bearing chunks rank 2 and 1 lexically; for the failing wording, they rank 1 and 4. The documented hybrid rank swing from 1 to 8 therefore does not originate in BM25 candidate loss.

#### What the evidence says about the two proposed causes

1. **The per-document cap does not explain the demonstrated top-five loss.** The documented capped top ten contains `billing-rules.md` at ranks 3 and 8. Those are the first two retained chunks from that document. Because the cap preserves fused order, any third answer-bearing chunk it drops must occur after the retained rank-8 chunk. Removing the cap could add results above the answer, but cannot promote the retained answer into the top five. The cap can cause failures in other cases—the existing `scripts/rank-probe.mjs` documents one—but it is not the causal mechanism shown by this trace.
2. **The narrow displayed RRF score range is not itself a defect.** Fixed `k=60`, two rank-only lists, and four-decimal presentation naturally compress scores. The answer's documented `0.0259` proves it appeared in both legs (a single leg cannot exceed `1/61 = 0.0164`), but does not prove that changing the RRF constant improves relevance. Combining the current lexical ranks with the rounded score suggests, but does not prove, a poor vector rank: lexical 1/vector 45 or lexical 4/vector 37 are the exact integer combinations that round to `0.0259`. A live per-leg hybrid trace was intentionally not run because it would require initializing the embedding model; model download/cache mutation was outside this exploration's authority.

#### Measurement hazards

- The documented `--k 10` top ten uses a 100-candidate-per-leg fusion population. It is not safe to infer the exact default-`k=5` order, which uses 50 candidates per leg. Both must be measured explicitly.
- A path-level eval can pass when the expected document ranks well but the answer-bearing section does not. In the failing trace, `billing-rules.md` is already present at document rank 3 while the answer-bearing chunk is rank 8.
- Heading alone is not a unique chunk locator because bounded splitting creates overlapping chunks with the same heading. Database chunk IDs are index-instance details and are not stable labels.
- `scripts/rank-probe.mjs` is valuable but duplicates production constants and pipeline assembly. It should be guarded against drift or replaced by a shared, production-owned diagnostic seam before it becomes an acceptance gate.

### Affected Areas

- `src/application/search-documents.ts` — owns candidate depth, leg selection, fusion, cap placement, and emitted ranking.
- `src/domain/fusion.ts` — current pure RRF and document-cap policies.
- `src/infrastructure/sqlite/sqlite-index-store.ts` — lexical/vector adapters currently return ordered IDs only, so raw-score fusion would require a port/adapter contract change.
- `src/domain/ports.ts` — `IndexStore` exposes ranks but no per-leg scores or distances.
- `src/application/evaluate-search.ts` — document-level evaluation, unique-document collapse, and the `3 * k` search-depth coupling.
- `src/domain/metrics.ts` — goldenset case and outcome shapes cannot represent answer chunks or reformulation groups.
- `src/cli.ts` — goldenset schema loading and report output.
- `ejemplos/goldenset.yaml` — small, established regression corpus whose current behavior must not regress.
- `scripts/rank-probe.mjs` — existing read-only stage attribution probe; useful baseline, but currently a mirror rather than the production pipeline.
- `C:/Users/Raul/Workspace/DocuTests2/demo-docs/` — external large-corpus evidence source; read-only in this exploration and currently lacks a goldenset.

### Approaches

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. Measurement-first dual-granularity evaluator** — define intent/reformulation groups and expected document plus stable answer evidence (`path`, heading constraint, required phrase), then record lexical, vector, fused, capped, and emitted ranks at fixed `k=5` and `k=10`. | Establishes causality; separates document success from answer-chunk success; supports offline ablations on frozen per-leg ranks; directly tests robustness rather than one wording. | Requires goldenset ownership and label review; current evaluator and ports do not expose every stage; answer relevance may be a set of overlapping chunks. | Medium |
| **B. Tune rank-only fusion after A** — compare RRF constants, leg weights, and cap ablations using frozen traces, then verify selected candidates end-to-end on both corpora. | Small production surface; deterministic; no new model/runtime dependency; likely cheap at query time. | Easy to overfit; cannot use magnitude/confidence from either leg; a lower RRF constant or weight is not justified until stage distributions are known. | Low–Medium |
| **C. Expose raw retrieval scores and use score-aware fusion after A** — return BM25/vector distances through the port and normalize/calibrate them before fusion. | Can distinguish strong from marginal matches instead of treating only ordinal rank; may yield a meaningful confidence signal for later problem 2. | BM25 and vector distances are incomparable without corpus/query calibration; widens domain/adapter contracts; higher regression and tuning burden. | High |
| **D. Add reranking or query expansion after A** — retrieve broadly, then rerank or issue controlled reformulations. | Directly targets semantic ambiguity and wording sensitivity; can use content evidence beyond two ranks. | Highest latency/complexity; local-only and zero-network constraints limit choices; requires an explicit resource budget and a much stronger goldenset. | High |

### Recommendation

Propose **Approach A only as the first deliverable**, with algorithm selection explicitly deferred until its baseline exists. The rigorous sequence is:

1. Freeze corpus/config/model/index identity and define a reviewed `demo-docs` goldenset containing multiple intents, multiple natural reformulations per intent, expected document paths, and stable answer evidence. Resolve answer evidence to one-or-more acceptable chunks and assert the label is non-vacuous.
2. Capture per query and per answer-bearing chunk: lexical rank, vector rank, fused rank and unrounded score, rank after cap, emitted rank, candidate-list membership, leg overlap, and per-document chunk counts. Run `k=5` and `k=10` separately rather than deriving one from the other.
3. Report two layers: existing document recall/MRR for compatibility, plus answer-chunk recall@k/MRR and reformulation robustness (worst rank and rank spread within each intent). Record lexical-only and hybrid independently.
4. Establish baselines on both `ejemplos` and `demo-docs`. Re-measure—do not assume—the historical `ejemplos` MRR 0.943 / 20-of-22 top-1 figures.
5. Replay candidate fusion/cap policies offline against the frozen per-leg ranks. Select an algorithm only if it improves predeclared `demo-docs` chunk-level criteria without breaching predeclared `ejemplos` document- and chunk-level regression tolerances.
6. Verify every new gate against a known-bad policy or fixture before accepting green evidence, then run the selected policy through the real search pipeline.

This cycle must not change excerpt budgets, match-centre selection, ellipsis routing, or `matchedTerms`; those are open problems 2–5 and remain downstream.

### Risks

- **Goldenset overfitting:** variants derived from only the staged refund question will merely encode the incident.
- **Label ambiguity:** path-only labels hide wrong-section retrieval; heading-only labels collide across split chunks.
- **Evaluation mismatch:** current eval changes search candidate depth and collapses chunks to documents.
- **Probe drift:** a script that mirrors production constants can become confidently wrong after a pipeline change.
- **Unmeasured resource cost:** score-aware fusion, expansion, or reranking needs an explicit latency/CPU budget before selection.
- **External-artifact ownership:** the team must decide whether the `demo-docs` goldenset lives in `DocuTests2`, is imported as a versioned fixture, or is maintained elsewhere; this exploration had no authority to modify that repository.
- **Missing live vector evidence:** the failing query's current vector ranks and full score distribution remain unobserved under the no-model-initialization constraint.

### Ready for Proposal

Yes, for a measurement-first proposal that defines the goldenset, stage trace, dual-granularity metrics, and regression gates while leaving the ranking algorithm unselected. Before implementation, the proposal must confirm goldenset ownership, minimum query/reformulation coverage, worst-case-versus-average success criteria, `ejemplos` regression tolerance, and any latency/CPU budget. External research is optional and should inform candidate methods only after these local evidence requirements are fixed.
