## Exploration: Skip database creation when no documents exist

### Current State

The `.compendio/` directory and `compendio.db` file are created **unconditionally** during container construction, before any document discovery happens. The exact code path:

1. **`createContainer()` in `composition.ts:78`**:
   ```typescript
   const store = new SqliteIndexStore(resolve(options.root, config.db));
   ```

2. **`SqliteIndexStore` constructor in `sqlite-index-store.ts:83-88`**:
   ```typescript
   constructor(private readonly dbPath: string) {
     if (dbPath !== ":memory:") {
       mkdirSync(dirname(dbPath), { recursive: true });  // Creates .compendio/
     }
     this.open();  // Creates compendio.db via new Database(dbPath)
   }
   ```

3. **`open()` in `sqlite-index-store.ts:93-98`**:
   ```typescript
   private open(): void {
     this.db = new Database(this.dbPath);  // Creates the file
     this.db.pragma("journal_mode = WAL");
     this.vectorsEnabled = this.loadVectorExtension();
     this.migrate();  // CREATE TABLE IF NOT EXISTS (non-destructive)
   }
   ```

**Document discovery happens later**, in the `execute()` methods of `IndexDocuments`, `SyncIndex`, or `GenerateIndexMd`. By that time, the database already exists.

### Affected Areas

- **`src/composition.ts`** — `createContainer()` constructs the store before discovery; needs to defer or conditionalize store creation.
- **`src/infrastructure/sqlite/sqlite-index-store.ts`** — Constructor unconditionally creates the directory and file.
- **`src/infrastructure/fs/composite-document-source.ts`** — Discovery logic; returns empty `files` array for empty roots, throws only if ALL roots fail.
- **`src/infrastructure/fs/file-document-source.ts`** — `discover()` throws if root doesn't exist (line 52), returns empty for empty root.
- **`src/application/index-documents.ts`** — `execute()` calls `this.store.reset()` at line 92 AFTER discovery (line 83), but the store is already constructed.
- **`src/application/sync-index.ts`** — `execute()` never calls `reset()` (incremental), but the store is already constructed.
- **`src/server.ts`** — `createMcpServer()` receives a container with an already-constructed store; `SyncScheduler.startup()` triggers discovery.
- **`src/cli.ts`** — Every command (`index`, `sync`, `search`, `overview`, `eval`, `serve`, `index-md`) goes through `createContainer()`.

### Root Cause Analysis

**Three scenarios where the DB is created unnecessarily:**

1. **`docs` folder does not exist**:
   - `FileDocumentSource.discover()` throws → `CompositeDocumentSource` catches → converts to `ReadError` → if ALL roots fail, `discover()` throws → but the DB is already created.
   - **Current behavior**: DB exists, command fails with "no documentation root could be read".

2. **`docs` folder exists but is empty**:
   - `FileDocumentSource.discover()` returns `{ files: [], readErrors: [], encodingNotices: [] }` → no error → `IndexDocuments.execute()` calls `reset()` → loops over empty `files` → does nothing → returns report with `indexed: []`.
   - **Current behavior**: DB exists, command succeeds with "Indexed 0 documents".

3. **`docs` folder exists but contains no `.md` files** (only subdirectories, or only non-markdown files):
   - Same as scenario 2: discovery returns empty, command succeeds with 0 documents.
   - **Current behavior**: DB exists, command succeeds with "Indexed 0 documents".

**`compendio serve` has the same issue**:
- `serve` calls `createContainer()` → store is created → `SyncScheduler.startup()` triggers `SyncIndex.execute()` → discovery runs.
- If docs dir doesn't exist, discovery throws → `SyncScheduler.runTracked()` catches and logs to stderr → but the DB is already created.
- If docs dir is empty, discovery returns empty → sync does nothing → but the DB is already created.

### Approaches

#### Approach 1: Defer store creation until after discovery

**Description**: Move `new SqliteIndexStore()` out of `createContainer()` and into each use case's `execute()` method, after discovery confirms there are documents to index.

**Pros**:
- Clean separation: store is only created when needed.
- Each use case controls its own store lifecycle.
- No changes to `SqliteIndexStore` constructor.

**Cons**:
- Requires significant refactoring of `createContainer()` and all use cases.
- `Container` interface exposes `store: SqliteIndexStore` — would need to become lazy or optional.
- `SearchDocuments`, `GetOverview`, `ReadDocument` need a store to query — what happens when there's no DB? They'd need to handle "no index" gracefully.
- `SyncScheduler` holds a `SyncIndex` which holds a store — complex lifecycle.
- Breaks the composition root pattern (everything wired once at startup).

**Effort**: High

#### Approach 2: Add a "discovery-first" gate in `createContainer()`

**Description**: Before constructing the store, run a lightweight discovery pass to check if any documents exist. If not, skip store creation and return a "no-index" container.

**Pros**:
- Minimal refactoring: discovery logic already exists in `CompositeDocumentSource`.
- Clear decision point: "are there documents?" → yes/no → create store or not.
- Can be done once in `createContainer()`, all commands benefit.

**Cons**:
- Discovery is async (`discover()` returns `Promise<DiscoverResult>`), but `createContainer()` is synchronous.
- Would need to make `createContainer()` async, or split it into `createContainer()` (sync, config only) + `initializeContainer()` (async, after discovery).
- Duplicate discovery: `createContainer()` discovers once, then `execute()` discovers again (wasteful).
- `serve` needs to re-discover on each sync pass anyway (files can change), so the initial discovery is only useful for the "no docs at all" case.

**Effort**: Medium

#### Approach 3: Make `SqliteIndexStore` lazy (create on first write)

**Description**: Change `SqliteIndexStore` to defer directory/file creation until the first write operation (`saveDocument`, `upsertDocument`, `reset()`). Read operations (`search`, `listDocuments`, `getChunks`) work against an empty in-memory state if the file doesn't exist.

**Pros**:
- No changes to `createContainer()` or use cases.
- Store is always available, but the file is only created when needed.
- Read operations on a non-existent DB return empty results (natural behavior).
- Minimal blast radius: only `SqliteIndexStore` changes.

**Cons**:
- `reset()` is called by `IndexDocuments.execute()` unconditionally — would create the file even if there are no documents to index (need to guard `reset()` too).
- `SyncIndex` calls `listDocuments()` at startup — if the DB doesn't exist, this should return `[]` (not throw).
- `SearchDocuments`, `GetOverview`, `ReadDocument` need to handle "no DB file" gracefully (return empty results, not throw).
- Complexity: need to track "is the DB initialized?" state, handle concurrent access.

**Effort**: Medium

#### Approach 4: Add an early-exit check in each use case's `execute()`

**Description**: After discovery, before any store operations, check if `files.length === 0`. If so, return an empty report without calling `reset()` or any other store method.

**Pros**:
- Simple, localized changes: one `if` statement per use case.
- No architectural refactoring.
- Clear intent: "if there's nothing to index, don't touch the store".

**Cons**:
- The store is STILL created by `createContainer()` — the DB file exists, it's just empty.
- Doesn't fully solve the problem (DB file is created, just not populated).
- Need to add the check to `IndexDocuments`, `SyncIndex`, `GenerateIndexMd`, and potentially `serve`'s startup path.

**Effort**: Low

#### Approach 5: Combine Approach 3 + Approach 4 (lazy store + early exit)

**Description**: Make `SqliteIndexStore` lazy (Approach 3) AND add early-exit checks in use cases (Approach 4). The store is only created when there's actual work to do.

**Pros**:
- Fully solves the problem: no DB file created when there are no documents.
- Early exit avoids unnecessary work (discovery → transform → embed → persist).
- Read operations on a non-existent DB return empty results (natural).
- Minimal blast radius: `SqliteIndexStore` + use case `execute()` methods.

**Cons**:
- More complex than either approach alone.
- Need to carefully handle the "DB doesn't exist yet" state in read operations.
- `reset()` must be guarded: only create the DB if there are documents to index.

**Effort**: Medium

### Recommendation

**Approach 5: Combine lazy store + early exit.**

**Rationale**:
1. **Lazy store** ensures the DB file is only created when there's actual work to do (writes). This is the core fix.
2. **Early exit** in use cases avoids unnecessary discovery → transform → embed cycles when there are no documents. This is a performance optimization and makes the intent clear.
3. **Read operations** (`search`, `overview`, `read_doc`) naturally return empty results when the DB doesn't exist — no special handling needed if the store is lazy.
4. **Minimal blast radius**: only `SqliteIndexStore` and the three use cases (`IndexDocuments`, `SyncIndex`, `GenerateIndexMd`) change. No changes to `createContainer()`, `Container` interface, or the composition root.

**Implementation sketch**:
- `SqliteIndexStore` constructor: do NOT call `mkdirSync` or `open()`. Set a flag `initialized = false`.
- Add `ensureInitialized()` private method: if `!initialized`, call `mkdirSync` + `open()`, set `initialized = true`.
- Call `ensureInitialized()` at the start of every write method: `reset()`, `saveDocument()`, `upsertDocument()`, `saveEmbeddings()`, `deleteDocument()`.
- Read methods (`listDocuments()`, `searchLexical()`, `searchVector()`, `getChunks()`, etc.): if `!initialized`, return empty results (no throw).
- `IndexDocuments.execute()`: after discovery, if `files.length === 0`, return early with empty report (don't call `reset()`).
- `SyncIndex.execute()`: after discovery, if `files.length === 0` AND `existing.length === 0` (nothing to delete), return early.
- `GenerateIndexMd.execute()`: after discovery, if `files.length === 0`, write an empty INDEX.md (or skip?).

**Edge cases to handle**:
- `compendio search` on a project with no DB: should return empty results, not throw.
- `compendio overview` on a project with no DB: should return an empty overview, not throw.
- `compendio serve` on a project with no docs: should start the server, but every tool call returns empty results.
- `compendio sync` on a project with no docs but an existing DB: should delete all documents (existing behavior), but if the DB doesn't exist, do nothing.

### Risks

1. **Backward compatibility**: existing projects with an empty `.compendio/` directory will continue to work (the store will initialize on first write). No migration needed.

2. **Concurrent access**: if two processes try to initialize the store simultaneously, `mkdirSync` is idempotent (`recursive: true`), and `new Database()` will either create the file or open an existing one. The `migrate()` call is also idempotent (`CREATE TABLE IF NOT EXISTS`). Low risk.

3. **Testing**: need to add tests for:
   - `compendio index` on a project with no docs dir → no `.compendio/` created.
   - `compendio index` on a project with empty docs dir → no `.compendio/` created.
   - `compendio search` on a project with no DB → returns empty results.
   - `compendio serve` on a project with no docs → server starts, tools return empty.

4. **`reset()` semantics**: currently `reset()` is called unconditionally by `IndexDocuments.execute()`. If we guard it with "only if there are documents", we change the semantics slightly: a project that used to have docs but no longer does will NOT have its DB reset (it will have stale data). **Mitigation**: `SyncIndex` handles deletion of missing documents, so stale data is cleaned up incrementally. For `IndexDocuments` (full reindex), if there are no docs, the DB should be reset to clear stale data. **Revised approach**: call `reset()` if `files.length === 0` AND the DB already exists (to clear stale data), but don't create the DB if it doesn't exist.

5. **`serve` startup**: `SyncScheduler.startup()` triggers `SyncIndex.execute()`. If there are no docs, the early exit returns without creating the DB. Subsequent tool calls (`search_docs`, `docs_overview`, `read_doc`) query the store, which returns empty results (no DB). This is the desired behavior.

### Ready for Proposal

**Yes.** The exploration is complete. The orchestrator should tell the user:

- The problem is real: `.compendio/` and `compendio.db` are created unconditionally during container construction, before document discovery.
- The recommended approach is to make `SqliteIndexStore` lazy (defer file creation until first write) AND add early-exit checks in use cases (skip work when there are no documents).
- This requires changes to `SqliteIndexStore` and the three use cases (`IndexDocuments`, `SyncIndex`, `GenerateIndexMd`), but no changes to the composition root or container interface.
- Read operations naturally return empty results when the DB doesn't exist.
- The main risk is `reset()` semantics: a full reindex on an empty corpus should clear stale data if the DB exists, but not create it if it doesn't.
