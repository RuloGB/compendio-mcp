# Delta for Index-Progress

## ADDED Requirements

### Requirement: A `compendio sync` Pass Never Emits `embedding/failed`

Unlike `compendio index` (`IndexDocuments`), where an embeddings-provider failure is terminal for the batch loop and reported via an `embedding/failed` progress event, a `compendio sync` pass MUST NOT ever emit `embedding/failed` — neither when the embeddings provider fails while embedding a new/changed document during the per-file phase, nor when it fails while reconciling a vector-coverage gap during the embedding phase. In both cases the pass MUST continue processing the remaining documents/groups rather than treating the failure as terminal, and the failure MUST instead be surfaced through `SyncReport.embeddingsWarning` — the same channel the CLI summary already reads from — rather than through a progress event.

#### Scenario: An embeddings failure during the per-file phase emits no `embedding/failed`

- GIVEN a `compendio sync` pass in which the embeddings provider throws while embedding a new or changed document
- WHEN the pass completes
- THEN no `embedding/failed` event was ever emitted, that document is committed lexical-only, the pass continues with the remaining documents, and `SyncReport.embeddingsWarning` is set

#### Scenario: An embeddings failure during vector-coverage reconciliation emits no `embedding/failed`

- GIVEN a `compendio sync` pass in which the embeddings provider throws while reconciling one document's vector-coverage gap
- WHEN the pass completes
- THEN no `embedding/failed` event was ever emitted, that document's gap is left unresolved for a future pass, the pass continues with the remaining groups, and `SyncReport.embeddingsWarning` is set

## MODIFIED Requirements

### Requirement: Four Reportable Phases With Synchronously-Known Denominators

The system MUST report phases drawn from a fixed set — discovery, per-file parse/chunk/persist, per-batch embedding, and the one-time model download (nested inside the embedding phase, never a fifth top-level phase) — and whichever phases a given pass reports MUST fire in that relative order. Which phases a pass reports, and how each reported phase's denominator is computed, is producer-specific; what MUST hold identically for every producer is the core guarantee this requirement exists to protect: whichever phase a pass DOES report, that phase's denominator MUST be available and reportable at the moment the phase starts, before its first tick.

| Producer | Phases always reported | Embedding phase reported | Per-file denominator | Embedding denominator |
|---|---|---|---|---|
| `compendio index` (`IndexDocuments`) | discovery, per-file, embedding | Unconditionally | `files.length`, known immediately after discovery returns | `ceil(pending.length / batchSize)`, known immediately after the per-file phase completes |
| `compendio sync` (`SyncIndex`) | discovery, per-file | Only when at least one document has a vector-coverage gap to reconcile | The changed-document count, known immediately after the pass's diff sub-pass completes, before the per-file phase's first tick | `{batches, chunks}` — the count of documents with a gap, and their total missing chunks — known once reconciliation begins, before its first tick |

A `compendio sync` pass that reports no embedding phase (nothing to reconcile, or `--lexical` with no embeddings provider) legitimately reports two phases, not four; this is conformant, not a violation — the four-phase enumeration binds unconditionally only for `compendio index`. See "A `compendio sync` Pass Never Emits `embedding/failed`" for what a sync pass reports instead of an `embedding/failed` event when its embeddings provider fails.
(Previously: the per-file denominator was pinned to `files.length` unconditionally and the embedding denominator was pinned to `ceil(pending.length / batchSize)` unconditionally, both written for `IndexDocuments`, the only phase-emitting producer that existed at the time — so the four-phase enumeration and both denominator formulas always applied unconditionally. `compendio sync` is a second producer whose embedding phase is conditional and whose denominators are shaped differently; the requirement is generalized to state the producer-invariant property — a reported phase's denominator is always known before its first tick — while pinning `IndexDocuments`' own behavior, unchanged, as one conformant instance rather than the only possible one.)

#### Scenario: Per-file denominator is known at phase start

- GIVEN discovery has returned `files.length` files
- WHEN the per-file phase begins
- THEN its total is reported as `files.length`, before the first file is processed

#### Scenario: A sync pass's per-file denominator is the changed set, not the discovered count

- GIVEN a `compendio sync` pass in which discovery finds `files.length` documents but only a smaller subset are new or have changed content
- WHEN the per-file phase begins
- THEN its total is reported as that changed-document count, known before the first document is processed, and this total MAY be smaller than `files.length`

#### Scenario: `compendio index`'s embedding batch denominator is known at phase start

- GIVEN a `compendio index` run (via `IndexDocuments`) whose per-file phase has completed with `pending.length` chunks awaiting embedding and a configured `batchSize`
- WHEN the embedding phase begins
- THEN its total is reported as `ceil(pending.length / batchSize)`, before the first batch is embedded

#### Scenario: A sync pass's embedding-phase denominator is its reconciliation group and chunk counts

- GIVEN a `compendio sync` pass whose apply sub-pass has completed and found 3 documents with a vector-coverage gap totaling 7 missing chunks
- WHEN the embedding phase (vector-coverage reconciliation) begins
- THEN its total is reported as `{batches: 3, chunks: 7}`, known before the first group is reconciled

#### Scenario: A sync pass with nothing to reconcile reports two phases, not four

- GIVEN a `compendio sync` pass in which every hash-matched document already has full vector coverage, or `--lexical` was passed so there is no embeddings provider
- WHEN the pass completes
- THEN it reports only the discovery and per-file phases — no `embedding/start`, `embedding/tick`, or download event is ever emitted for that pass — and this is conformant with this requirement, not a violation of it

#### Scenario: Download progress is reported inside the embedding phase, not separately

- GIVEN a cold model cache triggers a download while an embed call is in flight — whether during `compendio index`'s embedding-phase batch loop or during a `compendio sync` per-document embed in the per-file phase
- WHEN download progress is reported
- THEN it is reported as nested within the embedding phase's reporting, not as a separate top-level phase preceding or following it, regardless of which phase the triggering embed call itself belongs to
