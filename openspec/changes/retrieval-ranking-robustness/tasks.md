# Tasks: Retrieval-Ranking Evidence

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 700–1,050 authored lines (goldenset excluded) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | U1 trace; U2 evaluation; U3 runner/gates/docs |
| Delivery strategy | single-pr (`size:exception` accepted 2026-09-06) |
| Chain strategy | none (single PR) |

Decision needed before apply: RESOLVED 2026-09-06 — single PR with `size:exception`
Chained PRs recommended: Yes (declined by user)
Chain strategy: none
400-line budget risk: High (accepted)

## Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| U1 | Trace production search without behavior drift | PR 1 | `npx vitest run test/application/search-trace.test.ts` (planned) | observer on/off parity (planned) | observer/trace files |
| U2 | Labels and metrics with canaries | PR 2 | `npx vitest run test/domain/retrieval-evaluation.test.ts` (planned) | synthetic valid/invalid/known-bad fixtures (planned) | domain evaluator/tests |
| U3 | Isolated baselines, gates, reviewed corpus | PR 3 | `npm test` (planned) | `node scripts/retrieval-baseline.mjs` (planned) | runner/tests/docs/local ignored outputs |

## Phase 1: Trace Foundation (U1; sequential)

- [x] 1.1 RED: test observer-off no extra inference, unchanged response, copied arrays, filter retries, warnings, callback failure, vector branches, ties, cap, and missing rows in `test/application/search-trace.test.ts`.
- [x] 1.2 GREEN/REFACTOR: add `src/application/search-trace.ts` types and optional observer plumbing in `src/application/search-documents.ts`; capture every attempt, lexical/vector ranks, union, unrounded fusion, cap removals, final slice, mode branches, and unavailable ranks without altering `SearchResponse`.

## Phase 2: Pure Evaluation (U2; after 1.2)

- [x] 2.1 RED: add `test/domain/retrieval-evaluation.test.ts` for alternative/ambiguous/unresolvable labels, document-only hits, empty denominator, ties, missing ranks, invalid-label/vacuity/known-bad relevance failures, and passing control.
- [x] 2.2 GREEN/REFACTOR: create pure `src/domain/retrieval-evaluation.ts` for reviewed labels, quote/chunk fingerprints, grouped 20-intent metrics, Hit@5/mean/all-three/nullable first-answer rank, separate document metrics, identity comparison, and gate reasons.

## Phase 3: Isolated Runner and Threat Gates (U3; after 2.2)

- [x] 3.1 RED: add `test/retrieval-baseline.test.ts` for canonical containment, traversal/symlink escape, output collision, non-Markdown requirements.txt/CMakeLists.txt/MDX/README.sh, executable Markdown inertness, no shell/subprocess, and no sync/checkpoint/reindex/repair.
- [x] 3.1a RED: test stopped writers, absent/empty WAL, source/DB hash drift, row/vector mutation, provenance drift, mode/depth independence, incomplete traces, and prerequisite refusal in `test/retrieval-baseline.test.ts`.
- [x] 3.2 GREEN/REFACTOR: create `scripts/retrieval-baseline.mjs` using a private checkpointed DB copy; validate root overlap, stopped writers, empty WAL, source/DB hashes before/after, logical rows/vectors immutability, provenance and semantic digests, lexical/hybrid/embedding-fallback branches, independent k=5/k=10, descriptive time/RSS/memory, and ignored `.compendio/evaluation/` outputs.
- [ ] 3.3 Prepare/review 20 intents × 3 variants (including refund), quotes, overlapping chunks, reviewer/rationale, groups/splits, and identities in `.compendio/evaluation/goldenset.json`; keep `ejemplos/goldenset.yaml` (read-only) as separate 22-case baseline. **PREPARED, NOT REVIEWED** (2026-09-06): `scripts/build-goldenset.mjs` emits 20 intents / 60 queries / 60 labels for DocuTests2's `demo-docs`; all 60 pass `validateLabel`, every quote resolves to exactly one chunk in exactly one document and appears nowhere else in the corpus. Every label still carries `reviewer: "UNREVIEWED"` — the review half of this task is open and no gate enforces it.
- [ ] 3.4 Run planned real-corpus baselines for the larger prepared corpus and `ejemplos/` (read-only), then compare observer on/off and pre/post instrumentation; external DocuTests2 (read-only) is measurement-only until canonicalization, filesystem access, authority, and model/index prerequisites are resolved. **PARTIALLY UNBLOCKED** (2026-09-06): the embedding model IS staged on the development machine (`node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small`, 130 MB), and both lexical and hybrid baselines have been run against DocuTests2 with the prepared goldenset. What remains is `ejemplos/` and the observer on/off + pre/post-instrumentation comparisons.

## Phase 4: Verification and Docs (after U3)

- [x] 4.1 Add workflow documentation in `.compendio/evaluation/README.md` covering preparation, checkpoint refusal, provenance, gates, rollback, and out-of-scope behavior. NOTE: `.compendio/` is Git-ignored, so this file is intentionally untracked/not part of the PR diff — see apply-progress.md.
- [x] 4.2 Ran `npm test`, `npm run typecheck`, and `npm run build`; recorded valid traces (search-trace.test.ts, 16/16), non-vacuous labels + intended canary failures + passing control (retrieval-evaluation.test.ts, 20/20; retrieval-baseline.test.ts, 28/28), and unchanged production behavior (full suite 55 files / 986 passed / 1 pre-existing skip, byte-identical `SearchResponse` assertions in search-trace.test.ts).
