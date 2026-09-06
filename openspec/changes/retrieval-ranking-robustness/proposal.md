# Proposal: Establish Retrieval-Ranking Evidence

## Intent

Establish trustworthy, production-faithful evidence of answer-bearing retrieval across reformulations before any ranking change.

## Scope

### In Scope
- Prepare a reviewed local goldenset of 20 intents with three reformulations each (60 queries), answer evidence, overlapping acceptable chunks, intent groups, and reproducibility identities.
- Prepare runnable baselines, stage diagnostics, tests, and canaries that preserve exact fragments and order.
- Report answer Hit@5, means, all-variant intent success, first-answer rank, separate document metrics, modes, retrieval stages, and descriptive time/memory.
- Measure `ejemplos/` compatibility and the permitted larger external corpus; separate synthetic diagnostics from frozen real-corpus results.

### Out of Scope
- Ranking, fusion, excerpt, chunking, MCP-contract, or dependency changes.
- Algorithm selection, tuning thresholds, or improvement claims.

## Capabilities

### New Capabilities
- `retrieval-evaluation`: Reviewed answer labels, reformulation metrics, production-faithful diagnostics, reproducible baselines, and falsifiable gates.

### Modified Capabilities
- None. Production search requirements remain unchanged.

## Approach

Extend existing evaluation/probe patterns without duplicating ranking logic. Resolve document-relative evidence to sufficient chunks; capture per-leg ranks, union membership, unrounded fusion, cap removals, and final slices. Validate final-list identity against production at `k=5`; treat `k=10` as a distinct candidate-depth diagnostic. Freeze corpus, configuration, model, code, query, label, split, chunk, and result identities. Gates prove non-vacuity and fail on invalid labels and known-bad relevance.

## Affected Areas

| Area | Status | Impact |
|---|---|---|
| `src/application/evaluate-search.ts`, `scripts/rank-probe.mjs` | Existing | Reuse patterns; behavior stays fixed |
| `ejemplos/goldenset.yaml` | Existing | Compatibility baseline remains Spanish |
| `scripts/`, `test/` | Planned | Runner, diagnostics, and canaries |
| Git-ignored local evaluation directory | Planned | Goldenset, corpus identities, and results |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Ambiguous or drifting answer labels | Med | Review evidence, require nonempty resolution, freeze identities |
| Diagnostic diverges from production | Med | Assert identical fragments/order at identical inputs |
| External corpus path or write authority unavailable | Med | Resolve canonical path and permission before later writes |

## Rollback Plan

Remove measurement tooling/tests and ignored artifacts; production behavior is untouched.

## Dependencies

- Existing production search/evaluation seams and local embedding model.
- Canonical path, sandbox permission, and native edit authority for future external-corpus work.

## Success Criteria

- [ ] All 60 queries have reviewed, resolvable answer evidence and intent-group metadata.
- [ ] Baselines preserve exact production top-five fragments/order and distinguish lexical, hybrid, and separate `k=10` diagnostics.
- [ ] Reports include approved metrics plus descriptive time and memory on both corpora.
- [ ] Anti-vacuity, invalid-label, and known-bad relevance canaries fail for their intended reasons.
