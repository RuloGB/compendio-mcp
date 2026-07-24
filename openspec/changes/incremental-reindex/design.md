# Design: Incremental Reindex — keep a running `serve` fresh

## Technical Approach

`serve` gains an in-process, content-hash diff that reconciles the SQLite index with the docs
directory. The diff reuses the already-persisted `documents.hash` (never read until now), so only
new/changed/deleted `ruta`s do work. Four new `IndexStore` operations (`deleteDocument`,
`upsertDocument`, `listChunksMissingVectors`, `replaceEmbeddings`) give correct per-document teardown
and idempotent vector reconciliation; a `SyncIndex` application service drives the diff; a throttled
scheduler wires it into the three MCP tool handlers. `FileDocumentSource` gains one small fix — a
directory-level read failure is now reported instead of silently swallowed — because the delete-safety
rule depends on it. `compendio index`'s full-rebuild semantics are unchanged and `reset()` is not
touched by this change. Satisfies all six `indexing` requirements, the `configuration` `sync`
requirement, and the `mcp-contract` `sincronizacion` requirement.

## Goals / Non-Goals

- **Goals**: edits/adds/deletes reflected within one throttle window without a manual command; only
  changed docs re-parsed/re-embedded; correct FTS5 + `vec0` + `chunks` teardown with no orphans; a
  read failure never causes a deletion.
- **Non-goals** (from proposal, reaffirmed): no filesystem watcher, no rename lineage, no mtime/size
  prefilter, no `INDEX.md` cadence, external `compendio index`-vs-`serve` process race stays a
  non-goal. **Withdrawn since the proposal**: the `PRAGMA user_version` schema-staleness gate (see the
  old-schema decision below).

## Architecture Decisions

### Decision: Per-document teardown is explicit, not FK cascade (CRITICAL findings #1 + #2)

**Choice**: `deleteDocument(ruta)` reads the doc's chunk rows, issues the FTS5 external-content
`'delete'` command per chunk, deletes `chunks_vec` rows (guarded by `vectorsEnabled &&
tableExists("chunks_vec")`, the same double guard `searchVector`/`hasVectors` already use — the
extension can fail to load in a process while the table still exists in the DB file, so a bare
"table exists" check is not enough), then `chunks`, then `documents` — all in one transaction.
`upsertDocument(meta, chunks, embeddings)` runs that same delete (if the `ruta` exists — guarded as
above, DELETE-only) followed by the insert path — `documents` + `chunks` + `chunks_fts`, plus
`chunks_vec` rows when `embeddings` is non-null. The WRITE side has its own, narrower guard and does
NOT reuse `deleteDocument`'s double guard: a `chunks_vec` write is guarded by `vectorsEnabled` alone
and, following the existing `saveEmbeddings` precedent (`sqlite-index-store.ts:173-188`), calls
`ensureVectorTable(dimension)` to create the table lazily before inserting, because `migrate()` never
creates `chunks_vec`. Reusing the DELETE guard for WRITE would make the literal
`tableExists("chunks_vec")` check false on a brand-new project's very first `upsertDocument` call — no
`compendio index` has ever run, so the table doesn't exist yet — silently discarding every freshly
computed embedding despite the provider succeeding, on exactly the zero-config `serve` path this
proposal supports. The whole delete-then-insert sequence still runs in **one** transaction.
`embeddings` is `null` when the embeddings provider is unavailable or fails for this document, in
which case the document still commits lexical-only (see the per-document embedding decision below).

```sql
-- ordered inside a single transaction, per chunk of the doc:
INSERT INTO chunks_fts(chunks_fts, rowid, contenido, encabezado)
  VALUES('delete', :id, :contenido, :encabezado);   -- original row values, external-content form
DELETE FROM chunks_vec WHERE chunk_id = :id;          -- BigInt bind; only if vectorsEnabled && tableExists("chunks_vec")
-- then, once per doc:
DELETE FROM chunks    WHERE document_id = :docId;
DELETE FROM documents WHERE id = :docId;
```

**Alternatives considered**: (a) enable `PRAGMA foreign_keys = ON` and rely on cascade — rejected:
cascade only cleans `chunks`, it does **nothing** for the FTS5 external-content desync, so the
`'delete'` command is still mandatory; adding FKs would be a redundant second mechanism with
process-wide side effects. (b) `deleteDocument` + `saveDocument` as two transactions in `SyncIndex`
— rejected: leaves a torn intermediate state and risks duplicate rows; atomic replace belongs in the
store.
**Rationale**: the FTS5 `'delete'` form is unavoidable, so we own teardown explicitly and keep it
atomic; `vec0` delete is a plain statement; must read chunk rows *before* deleting them.

### Decision: An old-schema database is an ACCEPTED risk, not a mitigated one (CRITICAL finding #3)

**Choice**: no schema-staleness detection ships in this change. There is no `PRAGMA user_version`
stamp, no `isSchemaCurrent()` port method, and no startup branch: `startup()` unconditionally runs one
`syncIndex.execute()`. A database created by an older build under the old `NOT NULL
tipo/modulo/estado` schema will therefore keep failing inserts on the serve-side incremental path, for
any document missing those fields — exploration finding #3, knowingly left open.
**Alternatives considered**: the `PRAGMA user_version` gate specified in the proposal's binding
product decisions (transparently run one full `reset()`+reindex on mismatch) — WITHDRAWN by the user
after the proposal: it costs a schema-version constant, a port method, a stamp inside both `reset()`
and a fresh-DB branch of `migrate()` with subtle DDL-ordering constraints, a second startup branch,
and its own failure semantics, all to protect an installed base of effectively zero. Probing
`PRAGMA table_info(documents)` for lingering `NOT NULL` — rejected earlier as fragile, and moot now.
**Rationale**: compendio is in beta with no meaningful installed base, so "a database written by an
older version breaks" is an accepted, uninteresting risk. The supported remedy is already documented
and requires no new code: delete `.compendio/` or run `compendio index` once — `reset()` drops and
recreates the current schema in one transaction, after which incremental sync works normally. See
Migration / Rollout.

### Decision: `SyncIndex` use case over a shared per-file pipeline

**Choice**: new `src/application/sync-index.ts`. Extract the identical per-file transform
(`parse → policy.resolver({…, hash}) → chunk`) from `IndexDocuments` into a shared application helper
so both paths stay in lockstep. `IndexDocuments`'s own end-of-pass `embedPending` batch loop is NOT
extracted or reused here — it stays private to `IndexDocuments`, unchanged (see the per-document
embedding decision below for why `SyncIndex` embeds differently). `SyncIndex` computes
`sha256(contenido)` once per discovered file for the diff and passes it into the resolver (no double
hashing).

`SyncIndex` also owns three diff-augmentation rules it must apply per pass:

- **Read failures are excluded from delete candidates, subtree included.** For every entry in
  `DiscoverResult.erroresLectura`, `SyncIndex` excludes from that pass's delete-candidate set both the
  reported `ruta` and every indexed `ruta` starting with `` `${ruta}/` `` — retaining those rows as-is
  and reporting the failure in `omitidos`. The prefix half of the rule is what makes a directory-level
  failure survivable; it is harmless for file-level failures, since a discovered file `ruta` always
  ends in `.md` and can never be the directory prefix of an indexed `ruta`. **Rationale**: transient
  vs persistent unreadability is indistinguishable within one pass, so retention of last-known-good
  data is deliberately chosen over full-rebuild convergence for read failures — and a single
  `readdir` hiccup must never delete a whole subtree from the index (see the `FileDocumentSource`
  decision below).
- **Resolver rejection on a KNOWN `ruta` deletes the stale row.** Under `convencion.modo: "estricto"`,
  if an already-indexed `ruta` has a changed hash but its new content now fails `policy.resolver()`,
  `SyncIndex` calls `store.deleteDocument(ruta)` and reports the file in `omitidos`, instead of leaving
  the stale pre-edit row served forever. A NEW (never-indexed) `ruta` failing resolution stays a plain
  skip, exactly as `IndexDocuments` does today. **Rationale**: resolver rejection is deterministic on
  content (unlike a transient read error), and deletion converges with what a full `compendio index`
  rebuild would produce (the invalid file would be omitted and absent).
- **Vector-coverage reconciliation is CHUNK-granular and idempotent.** `SyncIndex` calls
  `store.listChunksMissingVectors()` once per pass — one batched query returning every individual
  indexed chunk with no `chunks_vec` row, carrying `{ chunkId, ruta, encabezado, contenido }` (exactly
  what the embed call needs, so no re-parse or re-chunk is required) — and keeps only the entries whose
  `ruta` is in this pass's hash-match set (chunks of changed documents are covered by the upsert;
  chunks of deleted documents go away). The survivors are grouped by `ruta`, embedded per document
  when the provider is operational, and written with `store.replaceEmbeddings(...)`, which deletes and
  re-inserts each targeted `chunk_id` inside one transaction. Granularity and idempotency are BOTH
  load-bearing: `IndexDocuments.embedPending` batches the flat `pending` array in groups of
  `DEFAULT_BATCH_SIZE = 16` ACROSS document boundaries (`index-documents.ts:129-147`), so an
  interrupted full rebuild can leave one document with some chunks vectorized and others not — a
  ruta-granular read cannot express that — and `chunk_id` is the `vec0` PRIMARY KEY, so a plain
  `INSERT` for an already-covered chunk throws. `listChunksMissingVectors()` returns `[]` when
  `!vectorsEnabled || !tableExists("chunks_vec")` (the same double guard as `hasVectors()`), so on a
  project whose provider has never once succeeded the reconciliation is a silent no-op instead of
  throwing "no such table: chunks_vec" on every pass forever. If the provider is still unavailable
  when a gap IS detected, those chunks are left as-is (lexical-only) and reconsidered on a future pass.
  **Rationale**: the fingerprint rule's "hash matches → skip" guarantee must never hide a permanent,
  silent vector gap, and one batched query per pass keeps this work proportional to changed/gapped
  chunks rather than scanning the whole corpus on every throttle window.

**Alternatives considered**: duplicate the loop (rejected: drift); fold sync into `IndexDocuments`
(rejected: conflates reset-all-then-insert with diff-then-upsert); make `saveEmbeddings` itself
idempotent instead of adding `replaceEmbeddings` (rejected: silently changes the full-rebuild path's
write semantics and pays a per-chunk `DELETE` on every `compendio index` run for a collision that
`reset()` makes impossible there). **Rationale**: DRY without overloading the full-rebuild use case.

### Decision: `FileDocumentSource` must report directory-level read failures

**Choice**: in `walk()` (`file-document-source.ts:31-42`), the `readdir` catch currently throws only
when `prefix === ""` (the docs root) and otherwise `return`s silently. It must instead push
`{ ruta: prefix, error }` into `erroresLectura` before returning, so the failed subtree is reported.
The root case still throws, unchanged. Without this, a transient subdirectory failure (editor lock,
network-share blip, Windows permissions hiccup) makes every file under that subtree vanish from
`files` with NO trace, and the diff deletes the entire subtree from the index — the delete-safety rule
above would be inert against exactly the class of failure it exists for.
**Alternatives considered**: add a discriminator to `ReadError` (e.g. `esDirectorio`) so `SyncIndex`
can tell a directory failure from a file failure — rejected: the prefix-exclusion rule is safe to
apply to every `erroresLectura` entry unconditionally (a `.md` file `ruta` can never be a directory
prefix), so the extra field would buy nothing and would widen the port's type surface. Leave the
silent `return` and treat this as out of scope — rejected: it makes this change's own delete-safety
requirement unenforceable.
**Rationale**: the delete rule can only be as trustworthy as the failure reporting it consumes; this
is a ~4-line adapter fix, and `erroresLectura` already exists as the reporting channel (both
`IndexDocuments` and `SyncIndex` fold it into `omitidos`).

### Decision: `SyncIndex` embeds per document, not in one end-of-pass batch (vector-coverage gap on interruption)

**Choice**: for each new/changed document, `SyncIndex` embeds that document's own chunks FIRST (or
gets `null` back if the provider is unavailable or throws for this document), THEN calls
`store.upsertDocument(meta, chunks, embeddings)`, which commits `documents` + `chunks` + `chunks_fts`
+ `chunks_vec` (when `embeddings` is non-null) together inside one transaction, per document. This
replaces the shared end-of-pass batch shape for the incremental path only.

**Consequence**: an interruption (process kill/restart — an ordinary event for a long-lived `serve`)
mid-pass leaves the previous committed state intact — never a document whose `hash` is current on
disk but whose chunks have no `chunks_vec` rows. If the embeddings provider fails for one document
mid-pass, that document still commits lexical-only with `avisoEmbeddings` reported in the
`SyncReport` (existing graceful-degradation convention), and the pass continues to the next document.

**Accepted tradeoff**: per-document atomicity, not a pass-level snapshot — exactly the guarantee the
`indexing` spec's in-process concurrency requirement states. A concurrent `search_docs`/`read_doc`
call may observe some documents already synced and others not yet reached, in the pass's processing
order. This is observable in practice, not theoretical: `SearchDocuments.execute()` reads
`searchLexical` synchronously, then genuinely awaits `embeddings.embed(...)` for its vector leg, then
issues a SECOND round of store reads (`getChunksByIds`/`getDocumentsByIds`) with ids captured before
that yield — so a sync pass advancing during the yield IS visible to that call. Each document it does
reflect is internally consistent, because each document's teardown+insert is one synchronous
transaction.

**Alternatives considered**: reuse `IndexDocuments`'s shared end-of-pass `embedPending` batch for
`SyncIndex` too (rejected: an interruption between the last `upsertDocument` commit and the batch
embed step permanently strands that document's chunks without vectors); embed everything up front
before any `upsertDocument` call in the pass (rejected: same interruption risk, just moved earlier,
and loses the incremental "commit what's done" property that makes throttled sync safe to interrupt at
all). **Rationale**: `IndexDocuments`'s own full-rebuild batching is unchanged and out of scope —
per-document commit is the only shape where "interrupted mid-pass" and "committed" are the same state
for the incremental path. (The chunk-granular reconciliation above is the safety net for the gaps the
full-rebuild path can still leave behind.)

### Decision: Trigger = startup + throttled scheduler with in-flight dedupe

**Choice**: a `SyncScheduler` (created in `composition.ts`, owned by the `Container`) holds
`throttleMs`, `lastRun`, `lastReport`, and an `inFlight: Promise<void> | null`. It exposes two entry
points that share one internal `runTracked(work)` helper (assigns `work()`'s promise to `inFlight`
synchronously, awaits it, updates `lastRun`/`lastReport`, clears `inFlight` in a `finally`):

- `startup()` — called once, from `cli.ts`, BEFORE `server.connect()`. It unconditionally hands
  `syncIndex.execute()` to `runTracked()`, which assigns its promise to `inFlight` before `startup()`
  returns. `cli.ts` does not await `startup()`'s resolution before calling `connect()`: only `inFlight`
  being populated synchronously matters for safety, not the work finishing.
- `maybeSync()` — called by all three tool handlers on every call, the hot path where the in-flight
  dedupe guarantee matters most. If `inFlight` is already set (whether started by `startup()` or by an
  earlier `maybeSync()` call), it awaits that SAME promise — no new sync starts. Otherwise, if
  `now - lastRun >= throttleMs`, it synchronously (no `await` between the check and the assignment)
  hands `syncIndex.execute()` to `runTracked()`, which assigns its promise to `inFlight` before
  `maybeSync()` continues, then awaits it. Otherwise it is a no-op and the caller proceeds against the
  current index. This synchronous check-then-assign ordering is what prevents the race the in-flight
  guard exists for: an `await` inserted before the `inFlight` assignment would let two overlapping tool
  calls both observe `inFlight === null`, both pass the throttle check, and both start a
  `syncIndex.execute()` — the exact double-sync `maybeSync()` is designed to prevent.

Because `startup()` and `maybeSync()` funnel through the same `inFlight` field and the same
`runTracked()` wrapper, there is exactly one in-flight-tracked entry point for all startup and
incremental sync work — a tool call that arrives while the startup pass is still running always finds
`inFlight` non-null and awaits it, instead of racing a second `SyncIndex.execute()` against the same
tables.

**Error recovery**: `runTracked()` wraps every sync run so that:
- `inFlight` is cleared in a `finally` block, regardless of outcome — a throw never leaves the
  scheduler permanently believing a sync is still running.
- A sync failure NEVER propagates into a tool handler's response: it is caught inside `runTracked()`,
  logged to stderr (the only channel a whole-pass failure has — by decision it does NOT surface
  through `docs_overview`), and the awaiting call (the `startup()`/`connect()` path, or a tool handler)
  proceeds against the still-consistent pre-sync index.
- `lastRun` is still advanced on failure, so a failing sync does not retry on every subsequent call
  within the same window (no hot-loop retry storm); the next throttle window retries normally.
- `lastReport` is left untouched by a failed pass — it keeps whichever report is last known-good, or
  stays `null` if none yet exists.
- Per-document write failures inside a sync pass are not pass-level failures: a document whose store
  write throws — `upsertDocument()`, `deleteDocument()`, or the reconciliation's `replaceEmbeddings()`
  — is skipped, reported in `omitidos`, and the pass continues with the remaining documents. All three
  need this, not just the upsert: `deleteDocument` runs on two ordinary paths (a `ruta` missing on
  disk, and a resolver rejection retiring a stale row), so scoping resilience to `upsertDocument` alone
  would let one failed delete abort an otherwise healthy pass. This is also what makes the accepted
  old-schema risk survivable and visible: a `NOT NULL` constraint violation from a pre-upgrade
  database surfaces as an `omitidos` entry per affected document instead of taking the pass down.
  This is NEW behavior `SyncIndex` introduces, not an existing `IndexDocuments` convention it
  mirrors: today, `IndexDocuments`'s per-file skip-and-report resilience covers only parse failures,
  resolver rejections, and empty-content documents (`src/application/index-documents.ts`) — its
  `this.store.saveDocument(...)` call (~line 105) is NOT wrapped in a try/catch, so a write failure
  there aborts the whole `compendio index` run today. Retrofitting write-failure resilience onto
  `IndexDocuments` is out of scope for this change; it is noted here only as a possible follow-up.

**Startup ordering (client-timeout safety)**: `cli.ts`'s `serve` command calls `scheduler.startup()`
FIRST — which synchronously assigns the startup sync to `inFlight` — and only THEN calls
`server.connect(...)`. The MCP stdio transport is therefore connected without waiting for the startup
pass to finish (the client's `initialize` handshake is never blocked on it), but `inFlight` is
guaranteed non-null before any tool call can reach a handler, so the very first tool call — however
soon after `connect()` it arrives — goes through `maybeSync()`, finds `inFlight` already set, and
awaits that SAME promise rather than starting an overlapping sync. **Accepted tradeoff**: tool-call
latency is proportional to changed-chunk volume during a sync window, and the worst case is the
first-ever `compendio serve` on a fresh project with no prior `compendio index` — the encouraged
zero-config path — where the startup pass populates the entire corpus through `SyncIndex`'s
per-document embedding path (more, smaller model calls than `IndexDocuments`'s cross-document batching
at `DEFAULT_BATCH_SIZE = 16`). This is accepted rather than special-cased: `SyncIndex`'s per-document
commit shape exists specifically for interruption/vector-coverage safety (see the per-document
embedding decision above), and this is the same tradeoff already accepted there, just observed on the
very first pass; a project can run `compendio index` once up front to get the batched path if
first-call latency matters more than zero-config simplicity. No background re-embed is in scope; a
client-side tool-call timeout during a large first population is a known, accepted limitation.

**Alternatives considered**: detect an empty index (`listDocuments().length === 0`) as a second startup
branch routed through `IndexDocuments`'s batched path (rejected — it duplicates the
reset-all-then-insert shape as a special case inside a use case that exists to diff-then-upsert, and
adds a startup branch whose only benefit is first-run latency); per-tool caching (rejected — no cache
layer exists; all three handlers read the same store per call, so one hook suffices); a bare timestamp
with no in-flight guard (rejected — the async embed loop yields, so two overlapping calls could
double-index); running `startup()`'s pass outside the scheduler, untracked (rejected — it would leave
`inFlight` unset during the startup pass, so a tool call arriving during it would start a concurrent
`SyncIndex.execute()`, a same-process double-writer race). **Rationale**: guarantees "at most one sync
per window" *and* no concurrent double-sync, from startup through the whole process lifetime; keeps
synchronous SQLite work proportional to changed docs only, safe inline with the stdio event loop.

### Decision: `sincronizacion` surfaced at the server boundary

**Choice**: keep `GetOverview` store-only. Map `scheduler.lastReport` to
`SincronizacionInfo { omitidos; avisoEmbeddings? }`, rendered via
`formatOverview(overview, sincronizacion?)`, which appends a block only when present. The omission
rule is CONTENT-based, not presence-based: the mapper yields `null` — and the block is omitted —
whenever `lastReport` is `null`, OR `lastReport.omitidos` is empty AND `lastReport.avisoEmbeddings` is
absent. This matters because `runTracked()` sets `lastReport` after EVERY completed pass, including a
fully clean one, and nothing ever resets it back to `null` — a presence-based rule ("`null` only when
there is no report object at all") would render an empty `sincronizacion` block forever after the very
first successful pass, violating the mcp-contract delta spec's mandatory "Sync pass had nothing to
report" scenario, which requires the field to be omitted. A whole-pass failure is deliberately NOT
represented here: the `mcp-contract` delta defines no failed-attempt scenario, so a failed pass is
stderr-only and simply leaves the last known-good report in place (see the Trigger decision's error
recovery).
**Alternatives considered**: inject the last report into `GetOverview` (rejected: pollutes a
store-only use case); reset `lastReport` to `null` after a clean pass so a presence-based omission rule
still works (rejected: throws away the last known-good report and adds a second state transition for
no benefit over a content-based check); add an `ultimoIntentoFallido` field carrying the last failure
(rejected by the user: no `mcp-contract` scenario mandates it, and it widens the response contract for
an event the spec does not define). **Rationale**: isolates the contract change to the boundary +
formatter, keeps it independently unit-testable, and honors the "omit empty fields" convention based
on what the report actually contains, not on whether a report object happens to exist.

### Decision: Naming — config keys, response fields, and new port methods

`sync.throttleMs` — **CONFIRMED**: `Ms` suffix matches existing `duracionMs`; numeric-with-default
matches config conventions; `sync` groups future keys. `sincronizacion` — **CONFIRMED**: Spanish,
diacritic-free response field, consistent with `omitidos`/`avisoEmbeddings`/`resultados` and the EN/ES
split. New port methods follow the store's existing register — method names are English, Spanish
appears only where a domain noun does (`getDocumentByRuta`, `hasVectors`, `saveEmbeddings`): hence
`deleteDocument`, `upsertDocument`, `replaceEmbeddings`, and `listChunksMissingVectors` (NOT
`listRutasSinVectores`, which would be a Hispanicized verb phrase this codebase never uses), with the
Spanish `ruta`/`encabezado`/`contenido` nouns kept in the returned record.

### Decision: `sync.throttleMs` falls back to the default on invalid values

**Choice**: `loadConfig`'s `sync` merge treats `throttleMs` as valid only when it is a finite number
greater than `0`; a non-numeric, negative, or zero value is treated the same as an absent key and
falls back to the default `30000`, following the project's existing tolerant-defaults convention (the
same spirit as `warnIfLegacyEstadosExcluidos`'s warn-and-ignore handling of a retired key). Any
positive value, however small, is accepted as-is — a very low `throttleMs` (e.g. `100`) is legal, but
its tradeoff (a near-every-call filesystem read+hash diff) is documented rather than blocked, since a
project might deliberately want that during active doc editing.
**Alternatives considered**: throwing/failing config load on an invalid value (rejected: violates the
project's "every key has a default, zero-config never hard-fails" convention); clamping to an
arbitrary non-zero floor other than the default, e.g. `1000` (rejected: harder to reason about than
"invalid falls back to the documented default"). **Rationale**: `0` or a negative value would make
every tool call pay a full corpus read+hash diff, defeating the point of throttling and risking
event-loop blocking on a large corpus — the same event-loop-safety rationale the scheduler decision is
built on.

## Data Flow

```
serve startup ─→ scheduler.startup() [runTracked(syncIndex.execute()): inFlight assigned
                  synchronously] ─→ cli.ts calls server.connect()
                       │
                       └─→ inFlight resolves ─→ report ─→ scheduler.lastReport + lastRun=now
                           (on failure: stderr only, lastReport untouched, lastRun still advanced;
                            finally: inFlight=null)

tool call ─→ handler ─→ scheduler.maybeSync()
   ├─ inFlight set (startup pass, or an overlapping throttled pass) ─→ await SAME promise
   ├─ inFlight null, throttle elapsed ─→ SyncIndex.execute() assigned to inFlight ─→ await it
   └─ inFlight null, throttle not elapsed ─→ no-op, proceed against current index

SyncIndex: discover() + listDocuments() + listChunksMissingVectors() ─→ diff by ruta+hash
   delete candidates ─→ minus every erroresLectura ruta AND everything under `${ruta}/`
      (rows retained as-is, failure reported in omitidos)
   new/changed ─→ embed this document's chunks first ─→ store.upsertDocument(meta, chunks, embeddings)
      [documents+chunks+fts+vectors committed together, one transaction]
      (upsert/delete throw ─→ skip that document, report in omitidos, continue the pass)
   deleted ─→ store.deleteDocument
   unchanged ─→ skip, EXCEPT its chunks listed by listChunksMissingVectors() ─→ embed just those
      chunks (provider operational) ─→ store.replaceEmbeddings(...) [delete+insert per chunk_id]
   ─→ SyncReport ─→ scheduler.lastReport ─→ docs_overview.sincronizacion
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/domain/ports.ts` | Modify | Add `deleteDocument(ruta)`, `upsertDocument(meta, chunks, embeddings)`, `listChunksMissingVectors()`, `replaceEmbeddings(items)` to `IndexStore`; add the `ChunkMissingVector` record type |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | Modify | Implement the four ops; `listChunksMissingVectors` as one batched query (`chunks` JOIN `documents`, `id NOT IN (SELECT chunk_id FROM chunks_vec)`), returning `[]` under the `vectorsEnabled && tableExists("chunks_vec")` guard; `replaceEmbeddings` follows the `saveEmbeddings` precedent exactly (`vectorsEnabled` guard, `ensureVectorTable(dimension)`, then `DELETE`+`INSERT` per `chunk_id` in one transaction). No schema/DDL change; `migrate()` and `reset()` are untouched |
| `src/infrastructure/fs/file-document-source.ts` | Modify | `walk()`'s `readdir` catch pushes `{ ruta: prefix, error }` into `erroresLectura` for non-root directories instead of returning silently; the root case still throws |
| `src/application/index-pipeline.ts` | Create | Shared per-file transform (`parse → policy.resolver → chunk`) extracted from `IndexDocuments`; `embedPending`'s end-of-pass batching is NOT extracted — stays private to `IndexDocuments`, unused by `SyncIndex` |
| `src/application/index-documents.ts` | Modify | Use the shared per-file-transform helper; `embedPending` and its end-of-pass batching are unchanged |
| `src/application/sync-index.ts` | Create | Diff + per-document apply (embeds each document's chunks before upserting) + chunk-granular vector reconciliation → `SyncReport` |
| `src/application/sync-scheduler.ts` | Create | Throttle state, in-flight dedupe, `lastRun`, `lastReport`, `startup()`, `maybeSync()`, `runTracked()` |
| `src/application/get-overview.ts` | Modify | `formatOverview(overview, sincronizacion?)` + content-based `SincronizacionInfo` mapper |
| `src/composition.ts` | Modify | Wire `syncIndex` + `syncScheduler` (its `syncIndex` + `config.sync.throttleMs` dependencies) into `Container` |
| `src/server.ts` | Modify | `await syncScheduler.maybeSync()` in each handler; feed `lastReport` to overview |
| `src/cli.ts` | Modify | `serve`: call `scheduler.startup()` first (synchronously populates `inFlight`), then `server.connect()`; the startup work is not otherwise awaited — every tool call, including the first, is gated on it solely via `maybeSync()` awaiting the shared `inFlight` promise |
| `src/infrastructure/config.ts` | Modify | `sync: { throttleMs: 30000 }` default + whitelist merge; non-numeric, negative, or zero `throttleMs` falls back to the default |

## Interfaces / Contracts

```ts
interface ChunkMissingVector {                 // one indexed chunk with no chunks_vec row
  chunkId: number; ruta: string; encabezado: string; contenido: string;
}
interface IndexStore {                         // additions only
  deleteDocument(ruta: string): void;          // removes documents+chunks+fts+vec, no orphans
  upsertDocument(meta: DocumentMeta, chunks: Chunk[], embeddings: Float32Array[] | null): SavedDocument;
    // atomic replace: documents+chunks+fts, plus chunks_vec when embeddings is non-null — one transaction;
    // the chunks_vec write is guarded by vectorsEnabled only (calls ensureVectorTable(dimension) lazily,
    // like saveEmbeddings) — NOT deleteDocument's tableExists("chunks_vec") double guard
  listChunksMissingVectors(): ChunkMissingVector[];
    // one batched query per pass; [] when !vectorsEnabled || !tableExists("chunks_vec")
  replaceEmbeddings(items: ChunkEmbedding[]): void;
    // idempotent vector write: DELETE + INSERT per chunk_id in one transaction, so re-covering an
    // already-vectorized chunk cannot violate the vec0 PRIMARY KEY. saveEmbeddings stays INSERT-only.
    // Throws when !vectorsEnabled, like saveEmbeddings — unreachable from the reconciliation path,
    // which only runs on a non-empty listChunksMissingVectors() result.
}
interface SyncReport {                         // reuses IndexReport shape + eliminados
  modo: SearchMode; indexados: IndexedFileReport[]; eliminados: string[];
  omitidos: SkippedFileReport[]; totalChunks: number; duracionMs: number; avisoEmbeddings?: string;
}
interface SincronizacionInfo {                 // null (block omitted) when lastReport is null, or
  omitidos: SkippedFileReport[];               // when omitidos is empty and avisoEmbeddings is absent
  avisoEmbeddings?: string;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (store) | delete leaves no `chunks`/`chunks_fts`/`chunks_vec` orphans and no lexical hits from old content; upsert replaces with no duplicates | extend `sqlite-index-store.test.ts`, `:memory:` store + `FakeEmbeddings` |
| Unit (store) | `listChunksMissingVectors` returns only the uncovered chunk ids of a partially vectorized document, and `[]` when `chunks_vec` does not exist; `replaceEmbeddings` succeeds on a chunk that already has a vector (no PRIMARY KEY violation, no duplicate row) | extend `sqlite-index-store.test.ts` |
| Unit (diff) | new/changed/unchanged/deleted/rename; fully vectorized hash-match not re-embedded; partially vectorized hash-match re-embeds ONLY its missing chunks when the provider is operational, leaves them when it is not | new `sync-index.test.ts` with a controllable `DocumentSource`, `buildHarness` |
| Unit (diff) | a `ruta` in `erroresLectura` and every indexed `ruta` under `` `${ruta}/` `` survive the pass (not deleted) and are reported in `omitidos` | `sync-index.test.ts`, `DocumentSource` stub returning a directory-level `erroresLectura` entry |
| Unit (diff) | `upsertDocument` throwing for one document, and `deleteDocument` throwing for another, each skip-and-report and the pass still completes the remaining documents | `sync-index.test.ts`, store stub throwing per `ruta` |
| Unit (source) | `FileDocumentSource` reports an unreadable subdirectory in `erroresLectura` (files under it absent, no throw); an unreadable docs ROOT still throws | extend the `file-document-source` test with a permission-denied/removed directory |
| Unit (scheduler) | at most one sync/window; two concurrent `maybeSync` → one `syncIndex` call | fake clock + spy |
| Unit (scheduler) | a tool call arriving during the startup pass awaits the SAME `inFlight` promise; `syncIndex.execute` called exactly once total across `startup()` plus a concurrent `maybeSync()` | fake clock + spy |
| Unit (scheduler) | sync throws → `inFlight` cleared, `lastReport` left untouched, the awaiting tool call still answers from pre-sync state, `lastRun` advanced so the window is respected before retrying | fake clock + spy, `syncIndex.execute` rejects once |
| Unit (contract) | `formatOverview` omits `sincronizacion` on content, not presence — a non-null `lastReport` whose `omitidos` is empty and `avisoEmbeddings` is absent still omits the block (the "sync pass had nothing to report" case, distinct from `lastReport` being `null`); a report with `omitidos` or `avisoEmbeddings` renders it | `get-overview.test.ts` |
| Integration | edit/add/delete a temp file under `ejemplos/`, sync, assert search reflects it | `index-and-search.test.ts` pattern, `FakeEmbeddings` |

Keep `pool: "forks"` (native `better-sqlite3`). **Gotcha**: any `serve`-startup subprocess test MUST
assert stdout/behavior, not exit code — a broken entry-point guard exits `0` with empty stdout.
`test/server.test.ts` uses `{} as Container`; the scheduler is unit-tested standalone, plus a thin
integration check that a real handler awaits `maybeSync()`.

## Migration / Rollout

**No schema migration, no data migration, no feature flag.** The schema is byte-identical before and
after this change; `migrate()` and `reset()` are untouched.

**Accepted risk — pre-existing old-schema databases.** A database written by an older build under the
retired `NOT NULL tipo/modulo/estado` schema will keep failing inserts on the serve-side incremental
path for any document missing those fields (exploration CRITICAL finding #3). This change does NOT
detect or repair that; the `PRAGMA user_version` gate that would have is withdrawn (see the
old-schema decision). Rationale: beta, no meaningful installed base. Remedy for anyone who hits it —
either delete `.compendio/`, or run `compendio index` once: `reset()` drops and recreates the current
schema in one transaction and rebuilds the index, after which `serve`'s incremental sync works
normally. The failure is loud (per-document `omitidos` entries with the constraint error, plus the
stderr log), not silent.

**Rollback**: revert the code and run `compendio index` once; its `reset()` re-derives a coherent
index from the filesystem, discarding any incremental residue. Nothing persisted by this change
survives that.

Size crosses the 400-line review budget (~500–800 lines). Recommended tasks-phase slice: **PR #1**
store primitives (`deleteDocument`/`upsertDocument`/`listChunksMissingVectors`/`replaceEmbeddings`)
plus the `FileDocumentSource` reporting fix + tests; **PR #2** `SyncIndex`/scheduler/config/
`sincronizacion` wiring + tests.

## Risks

| Risk | Severity | Handling |
|---|---|---|
| Old-schema database keeps failing inserts under `serve` (finding #3) | Accepted | Not mitigated by design — beta, no installed base. Remedy: `compendio index` once, or delete `.compendio/` (see Migration / Rollout) |
| A call that yields mid-request can straddle a sync pass (pass-level interleaving) | Accepted | Bounded by per-document atomicity; stated explicitly in the `indexing` concurrency requirement so no consumer assumes a pass-level snapshot |
| Whole-pass sync failures are stderr-only and invisible to MCP clients | Accepted | `mcp-contract` defines no failed-attempt scenario; `lastReport` keeps the last known-good pass, `lastRun` still advances so failures cannot hot-loop |
| First-ever zero-config `serve` pays a full corpus embed on the startup pass | Medium | Accepted latency; documented escape hatch is one up-front `compendio index` for the batched path |
| FTS5 external-content delete is genuinely new code | High (impl) | Covered by dedicated store-level orphan/no-stale-hit tests before any wiring lands (PR #1) |

## Open Questions

- [ ] `SyncReport.eliminados` is richer than the spec requires (spec only mandates
  `omitidos`+`avisoEmbeddings` in `sincronizacion`); keep it internal for logs, or omit — non-blocking.
- [ ] Whether `index-pipeline.ts` should also absorb `generate-index-md.ts`'s duplicate `sha256`
  computation — deferred; out of this change's scope.
