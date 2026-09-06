# Retrieval Evaluation Specification

## Purpose

Provide reproducible, answer-bearing retrieval evidence across query reformulations without changing production retrieval behavior.

## Requirements

### Requirement: Reviewed Goldenset Coverage
The system MUST maintain Git-ignored local goldenset/results for the larger corpus with 20 independent intents and three meaning-preserving reformulations per intent. Each query SHALL have reviewed answer evidence that resolves to one or more independently sufficient chunks; overlapping acceptable chunks count as alternatives, not cumulative requirements. Labels MUST include intent-group and reproducibility identities. The existing Spanish `ejemplos/goldenset.yaml` MUST remain a separate 22-case document-level compatibility baseline and MUST NOT be silently expanded to 60 cases.

#### Scenario: Alternative answer chunks
- GIVEN reviewed evidence resolves to two overlapping sufficient chunks
- WHEN either chunk is emitted in the evaluated top five
- THEN the query records an answer hit

#### Scenario: Unresolvable evidence
- GIVEN a label resolves to no sufficient chunk
- WHEN baseline validation runs
- THEN it fails as an invalid label

### Requirement: Production-Faithful Baselines
For identical corpus, configuration, model, code, query, labels, and split identities, the system MUST preserve the exact returned fragments and order from production search at identical inputs. It MUST record corpus, configuration, model, code, query, label, split, chunk, and result identities. Synthetic diagnostics MUST be reported separately from frozen real-corpus baselines.

#### Scenario: Identical-input replay
- GIVEN unchanged recorded identities
- WHEN the same query is replayed
- THEN its returned fragments and order match the production result

#### Scenario: Identity drift
- GIVEN any recorded reproducibility identity differs
- WHEN results are compared
- THEN the comparison is marked non-equivalent

### Requirement: Answer and Document Metrics
The system MUST report any-answer Hit@5 as the primary query metric, its mean, intent groups where all three reformulations succeed, and first-answer rank. It MUST report document-level metrics separately from answer-bearing chunk metrics. Missing answer ranks MUST be represented as absent rather than fabricated.

#### Scenario: Intent robustness
- GIVEN all three variants of one intent have an answer in the top five
- WHEN group metrics are calculated
- THEN that intent counts as all-variant success

#### Scenario: Document-only retrieval
- GIVEN an expected document is retrieved but no sufficient chunk is emitted
- WHEN metrics are reported
- THEN document success and answer success differ

### Requirement: Stage and Mode Diagnostics
The system MUST report lexical-only, hybrid, and embedding-fallback modes distinctly. For each mode, it MUST capture lexical/vector membership and ranks, union membership, fusion ranks and unrounded scores, cap removals, and final output; unavailable or truncated ranks MUST be recorded, never fabricated. `k=5` and `k=10` MUST be independent real production executions recording candidate depth and population; neither MAY be inferred from the other, and populations MAY coincide.

#### Scenario: Cap removal
- GIVEN a fused candidate is removed by the per-document cap
- WHEN diagnostics are emitted
- THEN the removal is identifiable before final output

#### Scenario: Fallback mode
- GIVEN embeddings are unavailable
- WHEN a baseline runs
- THEN it is labelled embedding-fallback and has no invented vector rank

### Requirement: Falsifiable Measurement Gates
The system MUST include gates that fail for vacuous measurement, invalid labels, and a known-bad relevance case. Gate success SHALL establish instrumentation validity, not ranking quality or improvement. Time and memory MUST be reported descriptively without performance limits. Future external-corpus document creation MUST wait for its canonical DocuTests2 path, filesystem access, and native edit authority to be resolved.

#### Scenario: Vacuous measurement
- GIVEN no evaluated query has resolvable answer evidence
- WHEN the gate runs
- THEN it fails as a vacuity failure

#### Scenario: Known-bad relevance
- GIVEN the known-bad relevance fixture is evaluated
- WHEN the gate runs
- THEN it fails for the declared relevance reason

#### Scenario: No ranking change
- GIVEN evaluation artifacts are created
- WHEN production search is exercised
- THEN ranking, fusion, excerpts, chunking, public MCP behavior, and dependencies remain unchanged



