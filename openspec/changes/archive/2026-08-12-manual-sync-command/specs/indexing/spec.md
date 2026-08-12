# Delta for Indexing

## ADDED Requirements

### Requirement: Incremental Sync Trigger — Manual `compendio sync` Invocation

`compendio sync` MUST trigger exactly one incremental sync pass per invocation, using the same incremental sync mechanism `serve`'s startup and throttled pre-tool-call triggers use — a manual run diffs and applies pending changes identically to an automatic one for the same corpus state. Because it is a one-shot process rather than a long-lived server, `compendio sync` MUST NOT participate in the throttled scheduling that gates `serve`'s pre-tool-call check: `sync.throttleMs` MUST NOT gate a manual invocation, and every invocation MUST perform a fresh incremental pass regardless of how recently a prior pass ran. Unlike a `serve`-triggered pass — whose failure is caught and logged to stderr so a background sync error never breaks a live tool call — a manual pass's failure MUST propagate out of the command, and the process MUST exit non-zero; there is no "proceed against the current index" fallback for a command whose entire purpose is a definitive result. The command's report MUST include the count of documents deleted during that pass, a field the full-`compendio index` report has no counterpart for.

#### Scenario: A manual invocation runs exactly one incremental pass

- GIVEN a corpus with pending new, changed, and deleted documents
- WHEN `compendio sync` runs
- THEN it performs exactly one incremental sync pass — applying the same diff-and-reindex behavior `serve`'s triggers use — and exits once that pass completes, with no continuous or watching behavior

#### Scenario: The configured throttle does not gate a manual invocation

- GIVEN `sync.throttleMs` configured to a nonzero value
- WHEN `compendio sync` runs twice in immediate succession
- THEN both invocations perform a full incremental pass — the throttle window that gates `serve`'s pre-tool-call check has no effect on the manual command

#### Scenario: A failed manual pass exits non-zero

- GIVEN an incremental sync pass encounters a failure severe enough to abort the pass
- WHEN that pass is triggered by `compendio sync` rather than by `serve`
- THEN the failure propagates out of the command and the process exits non-zero — unlike the identical failure occurring inside `serve`, which is caught, logged to stderr, and does not stop the running server

#### Scenario: Deletions are reported by count, a field the full reindex report lacks

- GIVEN a manual sync pass in which one or more previously indexed documents are no longer present on disk
- WHEN `compendio sync` completes
- THEN its report states how many documents were deleted during that pass — a count `compendio index`'s report carries no field for

### Requirement: Vector-Coverage Reconciliation Is Reported as Written Work, Never Attempted Work

When a `compendio sync` pass fills one or more documents' missing chunk vectors during vector-coverage reconciliation, the system MUST report that work to the user — distinctly from the count of documents indexed as new or changed this pass, and never merged into it. This reporting MUST reflect work actually committed to the index, not merely attempted: a document whose reconciliation embedding call fails, or whose vector write fails and rolls back, MUST contribute nothing to this report, regardless of how many chunks were attempted for it — such a document's failure surfaces instead through the pass's existing degraded-embeddings warning (an embed failure) or through `skipped` (a write failure), exactly as those failures are already reported today. On a pass that reconciles nothing — because no vector-coverage gap existed, or because none of the attempted reconciliations succeeded — the pass's ordinary summary MUST be unperturbed: byte-identical to what it would report if this reporting capability did not exist at all.

#### Scenario: A pass that changes no document but fills vector-coverage gaps reports the work it did

- GIVEN a `compendio sync` pass in which no document is new or changed, but one or more hash-matched documents have their vector-coverage gaps filled and written
- WHEN the pass completes
- THEN the report and the CLI summary make that reconciliation work visible, rather than the pass reporting as if it changed nothing and did nothing

#### Scenario: Reconciliation work is reported distinctly from changed-document counts, never merged

- GIVEN a `compendio sync` pass in which one document is indexed as changed and, independently, a different, unchanged document has its vector-coverage gap filled and written
- WHEN the pass completes
- THEN both facts are visible separately — the changed-document count and chunk total are unaffected by the reconciliation work, and the reconciliation work is reported without being folded into the changed-document counts

#### Scenario: A failed reconciliation embed contributes zero, not a partial count

- GIVEN a `compendio sync` pass in which the embeddings provider throws while reconciling one document's vector-coverage gap
- WHEN the pass completes
- THEN that document contributes nothing to the reconciliation report — none of its attempted chunks are counted — and the failure is surfaced via the pass's degraded-embeddings warning, not via the reconciliation report

#### Scenario: A rolled-back reconciliation write contributes zero, not a partial count

- GIVEN a `compendio sync` pass in which a document's replacement vectors are computed successfully but the subsequent write of those vectors to the store fails and rolls back
- WHEN the pass completes
- THEN that document contributes nothing to the reconciliation report, and the document is reported in `skipped` instead

#### Scenario: An ordinary pass with nothing to reconcile is unperturbed

- GIVEN a `compendio sync` pass in which no document has a vector-coverage gap to reconcile
- WHEN the pass completes
- THEN the summary the user sees is identical to what it would be if this reporting capability did not exist — no additional line, no altered wording, no altered counts

## MODIFIED Requirements

### Requirement: A Successfully Transcoded Document Is Always Reported

Whenever a document's bytes are not valid UTF-8 but are successfully decoded via BOM detection or the CP1252 fallback, the system MUST report that document as transcoded to every consumer of the index/sync report (`compendio index`, `compendio index-md`, the sync pass feeding `docs_overview`, and a manual `compendio sync` run) — even when the transcoded content is byte-for-byte the string a correct decoder would have produced anyway. This obligation holds on every pass over that document, independently of whether the document's content hash has changed since the previous pass: a document reported as transcoded on one pass MUST be reported again on the next pass that discovers it, for as long as its bytes still require the fallback, exactly as if its content had changed. The document MUST still be indexed normally and MUST NOT appear in `skipped`; a transcoded document is a reportable event, not a failure.
(Previously: the reporting obligation was stated per decode event, without saying whether an unchanged-hash document must be reported again on a later pass — the case a two-pass sync implementation risks silently dropping if the notice push moves out of the discovery-time decode and into a changed-documents-only loop.)

#### Scenario: A perfect transcode is still reported

- GIVEN a CP1252 document whose bytes decode via the fallback with no lossy substitution
- WHEN `compendio index` runs
- THEN the document is indexed successfully, does not appear in `skipped`, and the run's report still names it as transcoded

#### Scenario: The transcode notice reaches CLI output

- GIVEN a transcoded document reported by an `index` or `index-md` run
- WHEN the CLI prints its summary
- THEN a transcoding notice for that document's path is printed, alongside the existing `skipped`/`embeddingsWarning` warnings

#### Scenario: An unchanged-but-transcoded document is reported on every pass, not only when its content changes

- GIVEN a CP1252 document already indexed and reported as transcoded on a prior pass, whose bytes on disk — and therefore its recomputed hash — have not changed since
- WHEN a subsequent incremental sync pass runs (whether triggered by `serve` or invoked manually via `compendio sync`)
- THEN that document is included again in this pass's transcoding notices, even though "Fingerprint-Based Incremental Diff" correctly leaves it un-reparsed, un-rechunked, and un-reembedded

### Requirement: Corrected Decoding Self-Heals via Incremental Sync

Because the change fingerprint (`computeHash(content)`) hashes the already-decoded string rather than the raw bytes (see "Fingerprint-Based Incremental Diff"), fixing this decoding defect for a previously mis-decoded document changes its stored hash even though the file's bytes on disk are unchanged. An incremental sync pass — whether triggered by `serve` or invoked manually via `compendio sync` — MUST therefore treat that document as changed and re-index it; no full `compendio index` MUST be required to apply corrected decoding to an already-indexed corpus. This is the inverse of "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents": there, bytes were unchanged and only chunking config moved, so the hash never changed and a full reindex was mandatory; here, bytes are unchanged but decoded output differs, so the hash does change and an incremental pass suffices.
(Previously: scoped to "an incremental `serve` sync pass" — the only trigger that existed when this requirement was written. The self-healing property follows from the fingerprint mechanism alone, so it holds identically for a manually-triggered `compendio sync` pass.)

#### Scenario: An incremental pass alone re-indexes a previously mis-decoded document

- GIVEN a document previously indexed under the old, UTF-8-only decoder, whose bytes on disk have not changed
- WHEN the encoding-aware decoder is deployed and an incremental sync pass runs, whether triggered by `serve` or invoked manually via `compendio sync`
- THEN the document's recomputed content hash differs from its stored hash, so it is re-parsed, re-chunked, and re-embedded by that pass alone, with no full `compendio index` required

### Requirement: In-Process Incremental Sync Concurrency Guarantee

Within a single `serve` process, every individual SQLite call is synchronous and cannot be interleaved by other JavaScript, and each document's teardown-plus-insert MUST run inside ONE transaction. The guarantee this provides is PER-DOCUMENT atomicity: a reader MUST never observe a partially-written document — no chunks without their `documents` row, no `chunks_fts` desynced from `chunks`, no mix of pre-change and post-change chunks for the same `path`.

This is explicitly NOT a pass-level snapshot. A sync pass awaits the embeddings provider between documents, and a tool handler may itself await mid-request (`search_docs`'s vector leg does), so a single call MAY resume mid-pass and reflect some of that pass's documents but not others. This in-process guarantee is additional to, and does not replace, the existing non-goal for concurrent access from a separately-running `compendio index` process (see "Concurrent Readers During `compendio index` Are Out of Scope").
(Previously: the closing scenario named only `compendio index` as the external-process case. A manual `compendio sync` run is also a separate OS process relative to a live `serve`, and its concurrency symptom differs from `compendio index`'s — no `reset()` runs, so the failure mode is `SQLITE_BUSY` rather than a transient "no such table" read, under WAL with better-sqlite3's default 5 000 ms busy timeout.)

#### Scenario: No partially-written document is ever observed

- GIVEN an incremental sync pass writing a changed document
- WHEN a tool handler reads the index
- THEN it observes that document either entirely in its pre-sync state or entirely in its post-sync state, never a mix of its old and new chunks and never chunks whose `documents` row is missing

#### Scenario: A single call may straddle a sync pass

- GIVEN a tool call that yields to the event loop mid-request (e.g. awaiting the embeddings provider) while a sync pass is running
- WHEN it resumes and completes
- THEN its response is not guaranteed to reflect the whole pass — some documents may be pre-sync and others post-sync — while every individual document it does reflect is internally consistent

#### Scenario: External `compendio index` non-goal still applies

- GIVEN `serve` is running with in-process incremental sync active
- WHEN a user separately runs `compendio index` from another OS process
- THEN the existing external-process non-goal (transient empty results/errors during that run's `reset()` transaction) still applies unchanged
- AND a manual `compendio sync` run from another OS process falls under the same non-goal, though its symptom differs: performing no `reset()`, it instead risks `SQLITE_BUSY` on short per-document write transactions under WAL (better-sqlite3's default 5 000 ms busy timeout), which propagates as a non-zero CLI exit rather than a transient read anomaly; the supported response is to retry

### Requirement: Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents

Incremental sync's change fingerprint is the document's content hash alone (see "Fingerprint-Based Incremental Diff"), so a change to `chunk.maxTokens` or the splitting logic does NOT retroactively re-chunk documents whose hash hasn't changed. Operators MUST run a full `compendio index` (its `reset()` drops and recreates the schema) for new boundaries to reach an existing corpus; an incremental sync pass alone — whether triggered by `serve` or invoked manually via `compendio sync` — MUST NOT be relied on for this, since both run the identical fingerprint-based diff against the same unchanged content hash. This is a documented operational step — the system MUST NOT introduce a schema version marker or automatic re-chunk migration for it.
(Previously: scoped to "an incremental `serve` sync pass alone" — the only trigger that existed when this requirement was written. The limit follows from the fingerprint mechanism itself, so it applies identically to a manually-triggered `compendio sync` pass.)

#### Scenario: Incremental sync alone does not apply new chunk boundaries to unchanged documents

- GIVEN a corpus already indexed under a previous `chunk.maxTokens` value, with a document whose content has not changed since
- WHEN `chunk.maxTokens` changes and only an incremental sync pass runs — whether triggered by `serve` or invoked manually via `compendio sync` — with no full `compendio index`
- THEN that unchanged document's existing chunks remain at their old boundaries

#### Scenario: A full reindex applies the new bound

- GIVEN the same corpus, with `chunk.maxTokens` changed
- WHEN a full `compendio index` run executes
- THEN every document is re-chunked under the new bound, including documents whose content did not change

### Requirement: Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents

Incremental sync's change fingerprint remains the document's content hash alone (see "Fingerprint-Based Incremental Diff"). A change to how `heading` resolves — without altering document content — does NOT retroactively update the `heading` of chunks whose hash hasn't changed. A full `compendio index` MUST be run for the corrected value to reach an existing corpus; an incremental sync pass alone — whether triggered by `serve` or invoked manually via `compendio sync` — MUST NOT be relied on for this. This is the same operational shape as "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents", extended from `chunk.maxTokens`/splitting-logic changes to `heading`-resolution changes; no schema version marker or automatic re-chunk migration is introduced for it either.
(Previously: scoped to "an incremental `serve` sync pass alone" — the only trigger that existed when this requirement was written. The limit follows from the same fingerprint mechanism, so it applies identically to a manually-triggered `compendio sync` pass.)

#### Scenario: Incremental sync alone does not correct existing empty headings

- GIVEN a corpus indexed before this change, with a document whose chunks were persisted with `heading: ""`, and whose content has not changed since
- WHEN this change is deployed and only an incremental sync pass runs — whether triggered by `serve` or invoked manually via `compendio sync` — with no full `compendio index`
- THEN that document's chunks keep their empty `heading`

#### Scenario: A full reindex applies the corrected heading

- GIVEN the same corpus
- WHEN a full `compendio index` run executes
- THEN the affected document is re-chunked and its chunks receive a non-empty `heading`
