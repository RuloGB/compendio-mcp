# Delta for Indexing

This delta does not touch the `reset()` hard-failure on a carried-over degraded database (Decision 7) — that is a separate, unstarted change.

## ADDED Requirements

### Requirement: Embeddings Degradation Reporting Is Trigger-Agnostic and Cause-Agnostic

When computed embeddings cannot be persisted during a sync pass — whether the pass is a full `compendio index` run or an incremental `compendio sync`/`serve` pass, and whether the cause is the embeddings provider or the vector store itself — the system MUST report the pass as `mode: "lexical"` with a non-empty `embeddingsWarning` naming vector persistence as the cause when the store, not the provider, is why vectors were not persisted. Every document affected by that unavailability MUST remain in `indexed`, MUST NOT appear in `skipped` for that reason, and MUST be retrievable by a subsequent lexical search. This obligation holds even on a pass in which no document is new or changed, since the store's capacity to persist vectors is a standing property of the pass, not a per-document event. A genuine write failure unrelated to vector-persistence unavailability — one that prevents the document itself from being committed — remains a skip, exactly as today; this requirement MUST NOT be satisfied by converting that failure into a lexical-mode degrade.

#### Scenario: Vectors cannot be persisted while the provider works

- GIVEN a new or changed document, an embeddings provider that succeeds, and a store that cannot persist vectors
- WHEN a sync pass processes that document
- THEN the document appears in `indexed`, not `skipped`, `report.mode` is `"lexical"`, `embeddingsWarning` is non-empty and names vector persistence (not the provider) as the cause, and a subsequent lexical search returns its content

#### Scenario: The same store, on a pass that changes nothing

- GIVEN the same vector-persistence-unavailable store and a pass in which no document is new or changed
- WHEN that pass completes
- THEN `report.mode` is still `"lexical"` with a non-empty `embeddingsWarning`, not `"hybrid"` — the degradation is reported even though no document went through the per-document embedding path

#### Scenario: A genuine hard write failure is still a skip, not a degrade

- GIVEN a document whose store write fails for a reason other than vector-persistence unavailability, so the whole write is rolled back
- WHEN the pass processes that document
- THEN the document appears in `skipped` with its error, exactly as today

### Requirement: `IndexStore` States Vector-Persistence Capability and Enforces It Consistently

The `IndexStore` port MUST expose `canPersistVectors()`, a way for a caller to determine — before generating embeddings — whether the store can currently persist vectors at all: a standing capability of the store, distinct from whether any vector currently exists. `upsertDocument`'s contract MUST state explicitly that it writes `chunks_vec` only when `embeddings` is non-null AND `canPersistVectors()` is true; when vector persistence is unavailable, the `embeddings` argument MUST be ignored, the call MUST still write the document, its chunks, and its FTS rows, and MUST still return normally — a caller that does not consult `canPersistVectors()` first has no way to observe the drop through the return value. The methods that already refuse to proceed when vector persistence is unavailable (`saveEmbeddings`, `replaceEmbeddings`) MUST continue throwing in that case; nothing in the store's internal vector-table setup MUST be simplified into a substitute for those explicit throws.

#### Scenario: The capability query reflects unavailability

- GIVEN a store whose vector extension failed to load
- WHEN a caller calls `canPersistVectors()` before embedding
- THEN it returns `false`, independent of whether any vector table or vector row currently exists

#### Scenario: `upsertDocument` ignores embeddings without throwing, and the document still commits

- GIVEN a store where `canPersistVectors()` is `false`, and a caller that calls `upsertDocument` with non-null embeddings anyway
- WHEN the call completes
- THEN it does not throw, the document, its chunks, and its FTS rows are committed, and no vector row is written for any of its chunks

#### Scenario: `saveEmbeddings` and `replaceEmbeddings` still throw when vectors cannot be persisted

- GIVEN a store where `canPersistVectors()` is `false`
- WHEN `saveEmbeddings` or `replaceEmbeddings` is called with one or more items
- THEN the call throws, exactly as before this change
