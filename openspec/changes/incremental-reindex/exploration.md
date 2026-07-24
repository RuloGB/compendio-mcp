# Exploration: Incremental Reindex

## Problem

`compendio serve` builds its search index once — never. Actually: the index is built exclusively
by the explicit `compendio index` CLI command, which does a full drop-and-recreate
(`IndexDocuments.execute()` -> `store.reset()` -> reinsert everything -> re-embed everything). A
running `serve` process holds a `Container` built once at startup and never touches
`indexDocuments` again. If a user edits/adds/deletes a `.md` file while `serve` is running, the
three MCP tools (`docs_overview`, `search_docs`, `read_doc`) keep answering from a stale SQLite
snapshot indefinitely, because none of them call anything that re-reads the filesystem. Nobody
is going to remember to run `compendio index` after every edit.

## Codebase findings (verified by reading, not assumed)

### 1. The full-reindex pipeline (`src/application/index-documents.ts`)

`IndexDocuments.execute()`:
1. `discover()` the docs directory (full read of every file's content into memory).
2. **Unconditionally calls `this.store.reset()`** (line 72) — this is not optional; it is baked
   into the contract of this class and into `openspec/specs/indexing/spec.md`'s "Optional
   Persisted Metadata" requirement (schema-upgrade guarantee lives here, not in `migrate()`).
3. Per file: parse -> `policy.resolver(...)` (computes `tipo`/`modulo`/`estado`/`titulo` +
   **`hash: sha256(file.contenido)`**) -> chunk -> `store.saveDocument` (**INSERT-only**, see
   below) -> queue chunk texts for embedding.
4. Batch-embeds everything queued; on missing/throwing provider, degrades to `modo: "lexico"`
   with `avisoEmbeddings` set, never crashes.
5. Returns `IndexReport { modo, indexados, omitidos, totalChunks, duracionMs, avisoEmbeddings? }`.

**Important prior art**: `DocumentMeta.hash` (`src/domain/model.ts:24`) is already documented as
*"SHA-256 of the raw file content (**basis for future incremental indexing**)"* and is already
persisted in the `documents.hash` SQLite column. Nothing today ever *compares* this hash against
anything — it's write-only — but the fingerprint primitive this change needs already exists,
computed identically in both `index-documents.ts:88` and `generate-index-md.ts:57` (duplicated
computation, not shared — worth unifying).

### 2. `IndexStore` port surface (`src/domain/ports.ts`)

Current surface: `reset()`, `saveDocument()` (**INSERT only** — the underlying SQL is a bare
`INSERT INTO documents ...`, and `documents.ruta` is `UNIQUE NOT NULL`, so calling `saveDocument`
again for an existing `ruta` throws a SQLite constraint violation), `saveEmbeddings()`,
`listDocuments()`, `getDocumentByRuta()`, `getChunksByDocument()`, `getChunksByIds()`,
`getDocumentsByIds()`, `searchLexical()`, `searchVector()`, `hasVectors()`, `close()`.

**Gap confirmed**: there is no `deleteDocument(ruta)`/`upsertDocument(...)` on the port, and no
test anywhere exercises single-document deletion. `listDocuments()` already returns
`IndexedDocument[]` which includes `.hash` (it extends `DocumentMeta`) — so **the diff step needs
zero new columns and zero new read methods to compare "what's on disk" vs "what's in the DB"**;
it only needs new *write* methods (delete-by-ruta, and an upsert path).

### 3. SQLite schema and two critical gotchas (`src/infrastructure/sqlite/sqlite-index-store.ts`)

Schema: `documents` (nullable `tipo`/`modulo`/`estado`, `hash TEXT NOT NULL`) -> `chunks`
(`document_id REFERENCES documents(id) ON DELETE CASCADE`) -> `chunks_fts` (FTS5, **external
content** table: `content=chunks, content_rowid=id`) and `chunks_vec` (sqlite-vec `vec0`, created
lazily once the embedding dimension is known).

`migrate()` runs `CREATE TABLE IF NOT EXISTS` on **every** container construction (search,
overview, eval, index-md, serve, index) and is explicitly documented as never touching an
existing schema. `reset()` — called only from `IndexDocuments.execute()` — is the **only** place
that guarantees the *current* schema (nullable columns), via a transactional drop-and-recreate.

**CRITICAL finding #1 — `ON DELETE CASCADE` is inert.** `better-sqlite3` does not turn on
`PRAGMA foreign_keys` by default, and this codebase never sets it (verified: no occurrence of
`foreign_keys` anywhere in `src/`). The `ON DELETE CASCADE` on `chunks.document_id` is decorative
today because nothing has ever issued a `DELETE FROM documents` outside of `reset()`'s
drop-the-whole-table path, so the bug has never manifested. An incremental delete/upsert path
that does `DELETE FROM documents WHERE ruta = ?` and expects cascade to clean up `chunks` **will
leave orphaned rows** unless it either (a) turns on `PRAGMA foreign_keys = ON` for the connection,
or (b) explicitly deletes `chunks` (and dependents) by `document_id` first.

**CRITICAL finding #2 — `chunks_fts` is FTS5 *external content*, not a normal table.** The only
write path today is the append-only `INSERT INTO chunks_fts(rowid, contenido, encabezado)` inside
`saveDocument`. External-content FTS5 tables require the special `'delete'` command form
(`INSERT INTO chunks_fts(chunks_fts, rowid, contenido, encabezado) VALUES('delete', ?, ?, ?)`,
matching the *original* row values) to remove a row cleanly — a plain `DELETE FROM chunks` for the
backing `chunks` table, without doing this dance, desyncs the FTS index (dangling/stale rowids).
`chunks_vec` (a `vec0` virtual table) is comparatively simple — a plain
`DELETE FROM chunks_vec WHERE chunk_id = ?` works. **This FTS5 external-content delete handling is
genuinely new, non-trivial work** that the current codebase has never had to do (only
insert-then-full-drop existed before), and it materially changes the size/complexity estimate for
this change.

**CRITICAL finding #3 — stale/old-schema DB + incremental-only serve.** If `serve` never calls
`reset()`, a pre-existing database still holding the old `NOT NULL tipo/modulo/estado` schema
(the exact case `reset()` was built to upgrade, per `openspec/specs/indexing/spec.md`'s
"Pre-existing database with the old NOT NULL schema is upgraded in place" scenario) will keep
failing NOT NULL constraint inserts for any document missing `tipo`/`modulo`/`estado` the moment
`serve`'s incremental sync tries to insert it — silently reintroducing a bug that `compendio
index` already fixed, for any user who runs `serve` before ever running `index` again after
upgrading. This needs an explicit decision in propose (see below), not a silent gap.

### 4. `server.ts` / `composition.ts` — good news, minimal wiring needed

`createContainer()` builds **one `Container`** shape for every command including `serve`
(`src/composition.ts:43-84`) — `indexDocuments` is already constructed and available inside the
`serve` container today; `cli.ts`'s `serve` action just never calls `.execute()` on it and never
calls `.close()` (long-lived process, by design). This means **no new wiring is needed** to make
indexing reachable from `serve` — the container already has everything.

The three tool handlers in `server.ts` (`docs_overview`, `search_docs`, `read_doc`) are plain
`async` closures that call `container.getOverview.execute()` / `container.searchDocuments.execute()`
/ `container.readDocument.execute()` directly, per call, with **no caching layer** in between
(confirmed by reading `get-overview.ts`, `search-documents.ts`, `read-document.ts` — all three
read straight from `store` on every call). This means **one shared pre-call sync hook benefits all
three tools identically** — no per-tool special-casing required, and `docs_overview`/`read_doc`
freshness comes "for free" once `search_docs`'s freshness is solved (all three read the same
store, so whichever tool triggers a throttled sync makes every tool fresh for that window).

### 5. `FileDocumentSource` (`src/infrastructure/fs/file-document-source.ts`)

`discover()` always walks the whole tree and **eagerly reads full file content** for every `.md`
file, every call — `DocumentFile` only carries `{ ruta, contenido }`, no `mtime`/`size`/`Stats`.
There is no cheap "list + stat" phase separate from "read bytes." This matters for the
mtime+size-prefilter decision below: a prefilter that skips re-reading unchanged files' bytes
would require extending this port (or splitting it into `list()` + `read(ruta)`), which is real
surgery, not a one-liner.

### 6. Embeddings lifecycle (`src/infrastructure/embeddings/transformers-embeddings.ts`)

`LazyEmbeddings` defers loading the ONNX model until the first `.embed()` call, then holds it
resident for the container's lifetime (already true today for `search_docs`'s vector leg). An
incremental sync reuses the same already-resident model — no new lifecycle concern. Cost is
proportional to *changed chunks*, not corpus size, which is the entire performance case for doing
this at all. The one-time cold-load cost (model download/cache-read + ONNX init) is paid whenever
the first `.embed()` call of the process happens, exactly as it is today for a first
`compendio index` run — an incremental sync at `serve` startup pays this same one-time cost if
anything changed since the last full index.

### 7. `better-sqlite3` is synchronous — event-loop implication

All SQLite calls (`saveDocument`, `saveEmbeddings`, the new deletes) are synchronous and block
Node's event loop for their duration; embedding calls are async. At docs-corpus scale (hundreds of
files, KB-sized markdown) the synchronous SQLite work is milliseconds — negligible next to a
model's async inference time — but a "throttled sync on every tool call" design must keep the
*synchronous* portion strictly proportional to *changed* documents (never a full corpus rewrite)
precisely because it runs inline with the same event loop servicing the stdio JSON-RPC transport.

### 8. Concurrency — how the existing non-goal changes shape

`openspec/specs/indexing/spec.md`'s "Concurrent Readers During `compendio index` Are Out of Scope"
requirement is about **two separate OS processes** racing (`serve` reading while an external
`compendio index` CLI's `reset()` transaction is in flight) — that scenario is orthogonal to this
change and should be explicitly **reaffirmed, not silently dropped**, since a user can still run
`compendio index` by hand while `serve` is up. What's new is **in-process** incremental sync: the
same process is both the (occasional) writer and the (frequent) reader, sequenced by JS's
single-threaded event loop — since better-sqlite3 calls are synchronous, no other JS code
(including another tool handler) can interleave mid-write, so there's no torn-read risk *within*
one process. Propose should add a new requirement distinguishing these two cases rather than
conflating them.

### 9. Tests (`test/application/index-and-search.test.ts`, `test/helpers/build.ts`,
`test/helpers/fake-embeddings.ts`, `test/infrastructure/sqlite-index-store.test.ts`,
`test/server.test.ts`)

- `FakeEmbeddings`/`BrokenEmbeddings` and `buildHarness()` already provide everything needed to
  drive an incremental-sync use case in tests without a real model download.
- `sqlite-index-store.test.ts` has zero coverage today for delete-by-ruta or upsert semantics —
  this is the area needing the most new test surface (FTS5 external-content delete + vec0 delete
  + cascade-that-isn't-really-cascade).
- `server.test.ts` never invokes real handlers against a real container (uses `{} as Container`
  fakes) — testing the "sync hook fires before a tool call" behavior will need either a new
  integration-style test with a real (in-memory) container, or restructuring the hook to be
  independently unit-testable (e.g., a `SyncIndex`/staleness-checker class with its own tests, then
  a thin integration test that server.ts actually calls it).
- `vitest.config.ts` uses `pool: "forks"` because `better-sqlite3` is a native addon loaded once
  per worker — any new tests must stay on this pool (no switch to threads).

### 10. `openspec/specs/indexing/spec.md` baseline (read in full)

Confirms the two things above with the certainty of a checked spec, not a guess:
- "Optional Persisted Metadata" requirement ties the schema-upgrade guarantee to `reset()`/
  `compendio index` specifically — an incremental path that never calls `reset()` needs its own
  explicit requirement for what happens against a stale schema (see decision below).
- "Concurrent Readers During `compendio index` Are Out of Scope" is scoped to *that* command;
  needs a sibling requirement for in-process incremental sync's guarantees.

## Decisions to surface for `sdd-propose`

### Trigger strategy
**Recommendation: startup sync + throttled-per-query check, no watcher, for Phase 1.**
- *Startup-only* alone doesn't solve the stated problem (a long session's edits are never seen).
- *Watcher* (chokidar-style) gives near-real-time freshness but adds a new dependency (none of
  `chokidar`/similar is currently in `package.json`), and the prior research explicitly flags
  cross-platform reliability pain (inotify limits, duplicate/rename events, atomic-save-via-temp-
  file patterns from editors like VS Code) — real risk on a project whose dev environment is
  Windows. Treat as a separate, later change (Phase 2), not bundled here.
- *Startup + throttled-per-query* bridges the gap with zero new dependencies: at process start,
  and then at most once per N seconds (suggest default ~30-60s pending product input), diff the
  discovered corpus against `listDocuments()` before answering a tool call. The throttle should
  gate the (currently unavoidable) "read+hash every file" pass, not skip it selectively — see
  fingerprint decision below.

### Fingerprint
**Recommendation: content hash only for Phase 1** — reuse the *already-computed, already-
persisted* `DocumentMeta.hash`/`documents.hash` (sha256 of raw file content). Diff = for each
discovered file, recompute sha256, compare against the stored hash for that `ruta` (from
`listDocuments()`); mismatch or new `ruta` => (re)index; stored `ruta` missing from disk => delete.
Zero schema change, zero `DocumentSource` port change. An mtime+size prefilter (to skip re-reading
bytes for unchanged files) is a real optimization but requires extending/splitting the
`DocumentSource` port (stat-only listing vs. full read) and persisting mtime+size somewhere — defer
this unless corpus-scale profiling actually shows the "always read+hash everything" pass is slow
(at "hundreds of markdown files," it almost certainly isn't; the expensive part — re-embedding —
is already avoided by the hash comparison).

### Deletion/rename handling
No rename detection — `DocumentSource` gives no rename signal (it's a plain directory walk, not a
watcher), and even chokidar's cross-platform rename detection is documented as unreliable. Treat a
rename as delete-old-ruta + insert-new-ruta uniformly. State this explicitly so nobody expects
history/lineage across a rename.

### `compendio index` stays the full-reset path — and what happens on old/missing DB
**Open decision, no clear winner without product input — propose should pick one:**
- (a) auto-detect a stale/incompatible schema at `serve` startup (e.g., probe `PRAGMA
  table_info(documents)` for lingering `NOT NULL`, or introduce a `PRAGMA user_version` schema
  marker bumped alongside `SCHEMA_DDL`) and transparently run one full `reset()`+reindex before
  serving — but this quietly turns "instant incremental startup" into "full re-embed on first
  serve after an upgrade," which contradicts the incremental pitch for that one run;
- (b) refuse/warn and tell the user to run `compendio index` once after upgrading;
- (c) ship the `PRAGMA user_version` marker as the cheap detection primitive regardless of (a)
  vs (b), since probing column constraints ad hoc is fragile.
A missing DB file (brand-new project) needs no special-casing: `migrate()`'s
`CREATE TABLE IF NOT EXISTS` already gives current (nullable) schema for a database that never
existed before, so the first incremental sync there behaves correctly as "everything is new."

### `docs_overview` / `read_doc` changes
None needed beyond the shared sync hook — both read the same `IndexStore` per call with no
caching layer, exactly like `search_docs`, so one hook point covers all three tools.

### `omitidos`/`avisoEmbeddings` for incremental runs — open product decision
Today `IndexReport` (with `omitidos`/`avisoEmbeddings`) is only consumed by the CLI's
stdout/stderr printer. Nobody is watching a long-lived `serve` process's stderr in most MCP
clients. Propose needs to decide where an incremental sync's skip/degradation info surfaces:
(a) stderr log line only (parity with today, but effectively invisible to most agents/users),
(b) a new field folded into `docs_overview`'s response (agent-visible, requires a contract
change — touches `mcp-contract` spec), or (c) nothing beyond silent omission (matches today's
"a broken file just doesn't show up" behavior for the resilience-skip cases). This is a UX call,
not just an engineering one.

### Blast radius on `openspec/specs/`
- **`indexing/spec.md`** — definitely touched: new requirements for fingerprint-based diffing,
  upsert/delete semantics (including the FTS5/foreign-key gotchas above), the
  startup-and-throttled trigger, and an explicit split between the existing external-process
  non-goal and a new in-process-sync guarantee.
- **`configuration/spec.md`** — touched: a new config section (e.g. `sync: { throttleMs, enabled }`
  or similar), following the existing "every key has a default" / "warn-and-ignore for retired
  keys" conventions already established in `config.ts`.
- **`mcp-contract/spec.md`** — touched only if the `omitidos`-visibility decision above picks
  option (b) (surfacing sync status through `docs_overview`'s response shape); otherwise
  untouched, since the wire contract of all three tools stays the same.
- **`search/spec.md`** — likely untouched; `SearchDocuments` itself doesn't change, only the
  freshness of the store it queries.
- **`index-md/spec.md`** — likely untouched; `GenerateIndexMd` already reads the filesystem
  directly (documented non-goal of ever lagging the DB), independent of this change, unless
  someone explicitly asks to also trigger `INDEX.md` regeneration on the same cadence (out of
  scope unless requested).

### Rough size forecast (for the review-budget guard)
Estimated **~500-800 changed lines** for Phase 1 (diff + upsert/delete + startup/throttled trigger,
no watcher, no new dependency):
- `ports.ts`: +10-20 (delete/upsert-by-ruta methods)
- `sqlite-index-store.ts`: +60-100 (FTS5 external-content delete dance, `chunks_vec` delete,
  cascade handling — the part with the most non-obvious complexity)
- New application use case (e.g. `SyncIndex`) reusing `IndexDocuments`'s per-file
  parse/resolve/chunk pipeline but diffing instead of reset+insert-all: +100-150
- `composition.ts` / `server.ts` / `cli.ts` (`serve`): +30-60 (wiring, throttle state, startup call)
- `config.ts`: +15-25 (new config section + defaults + merge, matching existing patterns)
- Tests (TDD-driven, likely the largest share): +150-300+ across a new sync-focused test file,
  extended `sqlite-index-store.test.ts` delete/upsert coverage, and `server.test.ts`/
  `cli-subprocess.test.ts` additions.

This crosses the 400-changed-line threshold that triggers a full 4R review pass (not just
`review-readability`) at apply/PR time — worth planning for explicitly rather than discovering it
mid-review. Recommend treating a chokidar-based watcher (Phase 2) as a clearly separate follow-up
change, both to keep this diff reviewable and to isolate the new-dependency/platform-reliability
risk it would introduce.

## Summary of the core design recommendation

Confirms the orchestrator's working hypothesis, with three additions the code surfaced that
weren't visible from the outside:
1. The content-hash fingerprint doesn't need to be built — it already exists, computed and
   persisted, just never compared against anything.
2. The container already wires `indexDocuments` into `serve` — no composition-root surgery needed
   to make indexing reachable from the long-lived process.
3. The FTS5-external-content-table delete semantics and the inert `ON DELETE CASCADE` (due to
   `PRAGMA foreign_keys` never being enabled) are real, previously-latent gaps that this feature
   is the first to expose — they are the crux of the implementation risk, not the diffing logic
   itself, which is comparatively simple given the existing hash column.
