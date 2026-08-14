# Design: `upsertDocument` Must Not Discard Embeddings Without a Signal

**Phase**: design · **Artifact store**: openspec (Engram MCP tools unavailable this cycle — this file
is the artifact of record) · **Skill resolution**: paths-injected

## Technical Approach

**The whole change is one inversion: `applyOne` stops handing vectors to a store that cannot keep
them, and starts asking first — which is what the sibling path in the same file already does.**
`reconcileVectors` (`sync-index.ts:257-271`) consults `listChunksMissingVectors()`, which returns `[]`
outright when the extension is unavailable (`sqlite-index-store.ts:265`), so the reconciliation half of
`SyncIndex` already spends nothing on a degraded store and already reports nothing false. The apply
half embeds unconditionally and then discovers, or fails to discover, that the write went nowhere.
Making it ask is the fix; everything else follows.

```
SyncIndex.execute()                                                sync-index.ts:114
  ├─ discover() / listDocuments()
  ├─ state.vectorsPersistable = this.embeddings === null || store.canPersistVectors()    NEW
  │     └─ if false: state.embeddingsWarning = <vector-storage variant>                  NEW
  ├─ diff(...)                                                     unchanged
  ├─ applyChanged → applyOne                                       :201
  │     ├─ this.embeddings === null       → provider warning, embeddings = null   unchanged
  │     ├─ !state.vectorsPersistable      → SKIP embed(), embeddings = null       NEW
  │     └─ else                           → await embed()                          unchanged
  │     └─ store.upsertDocument(meta, chunks, null|vectors)                        unchanged
  ├─ deleteMissingDocuments(...)                                   unchanged
  └─ reconcileVectors(...)                                         unchanged — already a no-op
                                                                     when the store cannot persist

SqliteIndexStore                                                   sqlite-index-store.ts
  ├─ canPersistVectors(): boolean  →  this.vectorsEnabled                          NEW
  └─ ensureVectorTable(dimension)  →  if (!this.vectorsEnabled) return; …          GUARD, :313
```

| Question the change owns | Answer | Where |
|---|---|---|
| Which of A / B / C ships | **B**, plus the guard. A is not load-bearing after all | Decision 1 |
| What stops the fresh case throwing before anything is returned | one early return inside `ensureVectorTable` — the single choke point all three vector writers pass through | Decision 2 |
| Where is the question asked, and how often | once per pass, in `execute()`, so `mode` is truthful even on a pass that changed nothing | Decision 3 |
| What the warning says, and what it cannot say | a third variant naming vector storage; the loader's own error stays swallowed | Decision 4 |
| What the port now promises | `canPersistVectors()`, and `upsertDocument`'s ignore-on-unavailable made explicit | Decision 5 |
| How the real adapter is driven with `vectorsEnabled === false` | `vi.mock("sqlite-vec")` in two new test files. **No production seam is built** | Decision 6 |
| What happens to `compendio index` on a carried-over degraded database | unmeasured third case, probed in Phase 0, deliberately not fixed here | Decision 7 |

`src/domain/model.ts`, `src/application/index-documents.ts`, `src/application/search-documents.ts`,
`src/application/get-overview.ts` and the SQLite schema are **unchanged**. No new npm dependency, no
DDL change beyond *when* an existing `CREATE … IF NOT EXISTS` is attempted, no config key.
`src/domain/` gains one method signature on an existing port and nothing that touches SQLite,
transformers.js or the filesystem (`openspec/config.yaml`, `rules.design`).

## Findings that correct the inputs

Recorded up front rather than buried, per this project's practice. Each was checked against the file.

| Claim in the exploration / proposal | Verified state |
|---|---|
| **"A is load-bearing; B is an optimization on top of it."** (exploration §Design fork, proposal §The open design fork) | **Wrong, and it inverts the decision.** The argument is *"B alone still leaves `SyncReport.mode` lying unless a warning is also set"* — but B's whole shape is a branch that decides not to embed, and setting the warning in that branch costs one line at the site the branch already exists. B alone satisfies every clause of the fixed observable contract (proposal Approach 1: lexical mode, warning set, documents indexed, lexically searchable). **A is the one that is not load-bearing**: it reports a drop that B prevents. See Decision 1 |
| "Option A changes the `IndexStore` port shape, which moves every fake in the test suite" (exploration Risks) | Already corrected by the proposal, and the corrected number is confirmed: there are exactly **four** `implements IndexStore` in the repo — the production adapter plus `RecordingStore` (`sync-index.test.ts:466`), `ThrowingStore` (`:570`) and `ReplaceThrowsStore` (`:733`). No other file constructs a `SavedDocument` literal. A costs zero fake edits; **B costs three delegating methods, roughly nine lines** |
| "`vectorsEnabled` … **no test in the suite exercises the real `SqliteIndexStore` with `vectorsEnabled === false`** — the condition this whole change is about is currently unreachable from the test suite" (exploration §Testability gap) | The first half is true. **The second half is false, and it drove the proposal to put "build a test-only affordance in a production adapter" on the table.** The condition is reachable today with zero production changes: `vi.mock("sqlite-vec", …)` makes the real `loadVectorExtension` catch (`:91-98`) take its `return false` branch in a real store. The suite already mocks a native-adjacent dependency this exact way (`test/infrastructure/transformers-embeddings-progress.test.ts:8`) and already uses `vi.importActual` alongside a mock (`test/infrastructure/file-document-source.test.ts:10-33`). See Decision 6 |
| The defect is about new/changed documents | **Incomplete — there is a third hole neither document names.** `state.embeddingsWarning` is only ever set inside `applyOne`, so a pass over a corpus where **nothing changed** never enters that method. Against a degraded store with a working provider, such a pass reports `mode: "hybrid"` (`sync-index.ts:137`) with `hasVectors()` false — the defect verbatim, on the most common pass shape a running `serve` produces. A fix scoped to `applyOne` alone leaves it. See Decision 3 |
| `IndexDocuments` "does warn in the identical environment" (proposal, opening) | True **for a fresh degraded database, and unverified for a carried-over one.** `IndexDocuments.execute()` calls `store.reset()` (`index-documents.ts:92`) before any file is read, and `reset()` executes `DROP TABLE IF EXISTS chunks_vec` (`sqlite-index-store.ts:123`). Whether that statement resolves the `vec0` module — and therefore whether `compendio index` throws outright rather than degrading — is **not measured**, and Gate 3 is written as if it is. See Decision 7 |
| — | Confirmed, and it is what makes B sufficient: **`upsertDocument` has exactly one production caller**, `sync-index.ts:226`. A's generality (any caller learns what happened) buys nothing that exists today |

## Architecture Decisions

### Decision 1: option **B** — a capability query and an early skip. A is rejected as redundant, C stays rejected

**Choice.** `IndexStore` gains `canPersistVectors(): boolean`. `SyncIndex` asks before spending, sets
the warning when the answer is no, and passes `null` to `upsertDocument`. `SavedDocument` does **not**
gain a field.

**Why B rather than A, in the order the reasons actually matter.**

1. **B prevents the cost; A only narrates it.** A's signal arrives after `embed()` has returned. On a
   degraded machine every changed document is embedded and thrown away on *every* pass, and on a cold
   model cache the first pass pays a ~129 MB download for a result that is discarded by construction.
   `serve` runs a throttled pass per tool call, so this is a recurring charge, not a one-time one.
   The proposal filed this as "the part of the defect the review notes and does not address"; B
   addresses it, A does not.
2. **B is what the same file already does.** `reconcileVectors` asks `listChunksMissingVectors()`
   first, which answers `[]` when the store cannot persist (`sqlite-index-store.ts:265`), and embeds
   nothing. The apply path is the odd one out. B removes an inconsistency; A codifies it.
3. **A's generality is unpaid-for.** Its advantage is that *any* caller of `upsertDocument` learns
   what happened without asking. There is one caller (`sync-index.ts:226`).
4. **A is not cheaper.** Both are small; A's edge (zero fake edits vs. three delegating methods) is
   about nine lines, and it does not survive contact with reason 1.

**What B costs, stated rather than elided.** The port grows a method, which is a wider contract
surface than a field on a returned record, and every future `IndexStore` implementation must answer
it. That is the honest price of a *precondition* contract over a *postcondition* one, and it is the
right side of that trade here because the precondition is the only one of the two that can stop work
from happening.

**Rejected — A alone (return `vectorsWritten: boolean` on `SavedDocument`).** Redundant under B: with
B in place, `applyOne` never hands vectors to a store that will drop them, so the field would be
`false` only on a path that no longer occurs and `true` everywhere else. A field no consumer reads is
a contract to maintain for nothing.

**Rejected — A **and** B together.** The proposal calls them complementary. They are, in the abstract;
in this codebase the complement is empty. The only scenario A covers that B does not is a store that
answers `canPersistVectors() === true` and then fails to write anyway — in `SqliteIndexStore` that
means `ensureVectorTable`'s DDL threw for some reason other than the missing module, which takes the
document's whole transaction down and lands it in `skipped`. That is the hard-failure path, correctly
handled today and explicitly out of scope. Shipping both would add a port field to cover an empty set.

**Rejected — C, the code review's throw-based fix.** Kept on the record here as well as in the
proposal, because a reader who has seen only `code-review-src-2026-08-14.md` will re-propose it and it
looks obviously right. Two independent reasons, both verified in the code rather than reasoned from
the name:

- `upsertDocument` wraps delete-if-exists **and** `insertDocumentAndChunks` in one
  `this.db.transaction(...)` (`sqlite-index-store.ts:254-261`). better-sqlite3 rolls back the entire
  wrapped function on any throw, so throwing to signal a vector problem discards the document's rows,
  its chunks and its FTS content too.
- `applyOne`'s `catch` pushes to `state.skipped` (`sync-index.ts:228-230`). There is no branch that
  routes a caught store error to `embeddingsWarning`, and `ThrowingStore` (`sync-index.test.ts:570`)
  pins that behaviour deliberately — a genuine hard write failure **is** a skip, and must stay one.

Net effect of C: from "silently degraded but fully searchable lexically" to "absent from the index
entirely, reported as skipped". Gate 2 exists to fail if it ships anyway.

**Rejected — reusing `hasVectors()` as the query.** Named in the proposal's risk table and repeated
here because the name reads right at the call site. `hasVectors()` is
`!this.vectorsEnabled || !this.tableExists("chunks_vec") ? false : count > 0`
(`sqlite-index-store.ts:322-326`). It returns `false` for a perfectly healthy corpus that simply has
no vectors yet — which is every project's first run. Reusing it would suppress embedding on **every**
first index, trading a rare degradation for a universal one. Decision 5 states the doc-comment
cross-reference that makes the distinction visible at the definition site.

### Decision 2: the guard lives **inside** `ensureVectorTable`, not at its call site

**Choice.**

```ts
/** Created lazily so the dimension always matches the active provider.
 * No-op when the extension is unavailable: on a database that does not
 * already carry the table, `CREATE VIRTUAL TABLE IF NOT EXISTS … USING
 * vec0(…)` raises `no such module: vec0` (measured, proposal Gate 0), and
 * `upsertDocument` calls this from OUTSIDE its transaction — so an
 * unguarded throw here takes the document, its chunks and its FTS rows
 * down with it and lands the path in `skipped`. */
private ensureVectorTable(dimension: number): void {
  if (!this.vectorsEnabled) return;
  this.db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding FLOAT[${dimension}]
    );
  `);
}
```

**Why inside rather than at the `upsertDocument` call site.** `ensureVectorTable` has three callers —
`upsertDocument:241`, `replaceEmbeddings:283`, `saveEmbeddings:301`. Guarding at one call site leaves
Gate 5's obligation ("no remaining vector-touching method reaches DDL without consulting
`vectorsEnabled`") as something a reviewer must re-check per call site forever. Guarding at the choke
point makes it one expression covering all three. This is the same shape as `withNonEmptyHeadings`,
enforced once at `transformFile` rather than inside each chunk producer (CLAUDE.md, *"covered by one
expression rather than two"*).

**It changes nothing for the other two callers.** `saveEmbeddings:297-299` and
`replaceEmbeddings:279-281` both `throw` on `!this.vectorsEnabled` *before* reaching
`ensureVectorTable`, so the early return is unreachable from them. Their throw is load-bearing —
it is what makes `compendio index` degrade with a warning via `embedPending`'s catch
(`index-documents.ts:157-161`) — and D6 in the test plan exists so a later "simplification" that
deletes those throws in favour of the new no-op is caught rather than shipped.

**The guard that would break the healthy path, named so it is not written.**

```ts
if (!this.vectorsEnabled || !this.tableExists("chunks_vec")) return;   // WRONG
```

Reading `deleteDocumentRows`'s double guard (`:206`) and copying it here is the natural mistake — the
two are not symmetric. Deleting from a table that does not exist is impossible; *creating* it is the
whole point. With the `tableExists` clause the table is never created on a brand-new project, the
first `upsertDocument` writes no vector, and every subsequent one sees a still-absent table. The
existing case **"writes embeddings for a brand-new document even before any compendio index run"**
(`test/infrastructure/sqlite-index-store.test.ts:257-270`) is the falsifier and passes **unmodified**
against the chosen form: on a healthy store `vectorsEnabled` is `true`, the early return is not taken,
the DDL runs exactly as today, `tableExists("chunks_vec")` is then true at `:250`, `insertVec` is
prepared, and `hasVectors()` / `searchVector` return what they return today. The comment at `:237-239`
that records *why* this guard is `vectorsEnabled`-alone stays accurate and is extended, not replaced.

**The consequence worth stating plainly: the two measured cases collapse into one.** After the guard,
a fresh degraded install behaves exactly like a carried-over one — `ensureVectorTable` no-ops instead
of throwing, `insertVec` is `null` either way (`vectorsEnabled` alone already fails the `:250`
conjunction), and the document, its chunks and its FTS rows commit normally. Decision 3 then makes
both report themselves. The change therefore has one behaviour to specify, not two.

### Decision 3: the capability question is asked **once per pass**, in `execute()` — so `mode` is truthful on a pass that changed nothing

**Choice.** `PassState` gains one field, set before `applyChanged` runs:

```ts
interface PassState {
  …
  /** False only when a provider exists AND the store cannot persist vectors
   * at all. Answered once per pass: `SqliteIndexStore.canPersistVectors()`
   * reflects a load attempt made in the constructor, so it cannot change
   * mid-pass, and one answer keeps the skip branch and the report in step. */
  vectorsPersistable: boolean;
}
```

```ts
// execute(), immediately after `state` is built
state.vectorsPersistable = this.embeddings === null || this.store.canPersistVectors();
if (!state.vectorsPersistable) {
  state.embeddingsWarning =
    "embeddings not persisted (vector storage unavailable): search runs in lexical mode";
}
```

```ts
// applyOne, replacing the two-branch embed block at :213-223
let chunkEmbeddings: Float32Array[] | null = null;
if (this.embeddings === null) {
  state.embeddingsWarning = "indexed without embeddings (provider unavailable): search runs in lexical mode";
} else if (state.vectorsPersistable) {
  try {
    const texts = chunks.map((c) => `passage: ${c.heading}\n${c.content}`);
    chunkEmbeddings = await this.embeddings.embed(texts);
  } catch (error) {
    state.embeddingsWarning = `embeddings unavailable (${describeError(error)}): search runs in lexical mode`;
  }
}
// no third branch: the pass-level warning is already set, and chunkEmbeddings stays null
```

**Why pass level and not inside `applyOne`.** `applyOne` runs only for new-or-changed documents. The
overwhelmingly common pass — every `serve` throttled check on a corpus nobody edited — has an empty
changed set and never enters it. Setting the warning there would leave exactly the reported defect
alive on that pass: `state.embeddingsWarning === undefined && this.embeddings !== null` evaluates to
`"hybrid"` (`sync-index.ts:137`) over a corpus with zero vectors. Neither the exploration nor the
proposal names this hole; both scope the fix to the changed-document path. Asking at pass level closes
it for free, because the answer is a standing property of the store, not a per-document event.

**Why `this.embeddings === null` short-circuits the query to `true`.** With no provider there is
nothing to persist and nothing to skip; `mode` is already `lexical` and `applyOne` already emits the
provider-unavailable warning. Without the short-circuit a lexical-mode run against a degraded store
would emit a second, more confusing warning about storage the user never asked to use.

**Why this is consistent with the pinned precedent it appears to contradict.**
`sync-index.test.ts:219` asserts that a pass with no provider and nothing changed sets **no** warning
— *"nothing new/changed this pass, no provider to blame for"*. That case is unaffected: with
`embeddings === null` the short-circuit above sets `vectorsPersistable` to `true` and no warning is
written, exactly as today. The precedent is about the *provider* being absent for a pass that did no
work; this decision is about the *store* being permanently incapable, which is a property of the
corpus and true whether or not the pass did work.

**Rejected — query per document inside `applyOne`.** Identical cost at runtime (a field read), but it
puts a standing property behind a per-item call, and it cannot set the pass-level warning without
duplicating the condition in `execute()` anyway.

**Rejected — derive the warning from `store.hasVectors()` after the pass.** It cannot distinguish "the
store cannot persist vectors" from "this corpus has no vectors yet", which is Decision 1's rejected
reuse wearing a different hat, and it would fire on every first `--lexical` run.

### Decision 4: a third warning variant naming vector storage; the loader's own error stays swallowed

**Choice.** The warning family in `SyncIndex` becomes three, all sharing the
`": search runs in lexical mode"` tail:

| Cause | String |
|---|---|
| No provider configured | `indexed without embeddings (provider unavailable): search runs in lexical mode` *(unchanged)* |
| `embed()` threw | `embeddings unavailable (${describeError(error)}): search runs in lexical mode` *(unchanged)* |
| **Store cannot persist vectors** | `embeddings not persisted (vector storage unavailable): search runs in lexical mode` **(new)** |

The new variant leads with `embeddings not persisted` rather than `indexed without embeddings` because
it is set at pass level and must read correctly on a pass that indexed nothing. It names *persistence*,
not the provider — the proposal's Resolved decision, and Gate 1's second bullet.

**The loader error stays swallowed, and the cost is named.** `loadVectorExtension` (`:91-98`) catches
with a bare `catch {}` and returns `false`; the cause is discarded. Proposal question 4 assumed "out
of scope" and this design upholds it. The consequence: a user is told *which subsystem* failed but not
*why*, so the warning is honest and not actionable. Three things bound that cost:

- `compendio index` in the same environment already surfaces more, for free and without any change
  here: `saveEmbeddings` throws `"the sqlite-vec extension is not available in this installation"` and
  `embedPending` interpolates it verbatim (`index-documents.ts:158-160`). "Run `compendio index`" is a
  real next step, not a dead end.
- sqlite-vec is the only vector backend that exists in this project, so "vector storage" resolves to
  one named dependency for anyone reading the README or CLAUDE.md.
- The extension point is one method, in the adapter, with no port change: capturing
  `describeError(error)` into a private field and widening the query to
  `vectorPersistenceUnavailable(): string | null` — the same "warning or null" shape
  `embedPending` already returns — is the whole diff if a later cycle answers question 4 "yes".

**Rejected — a reason-carrying query in this change.** It is the better long-term shape and it is
*not* rejected on principle: it is rejected because it converts a contract fix into a diagnostics
change, which is the exact scope line the proposal drew ("this one is about not lying about the
consequence"), and because the message it would produce today is a constant string — `loadVectorExtension`
has nothing else to give until it stops discarding the cause.

**Rejected — reusing the `embeddings unavailable (…)` variant.** It blames the provider, which in this
failure is working perfectly. A user chasing it would go to transformers.js, the model cache and the
network before ever suspecting a native extension.

### Decision 5: the corrected port contract

**Choice.** `src/domain/ports.ts`, `IndexStore`:

```ts
  /** Atomically replaces a document (delete-if-exists, then insert):
   * documents + chunks + chunks_fts, plus chunks_vec when `embeddings` is
   * non-null AND the store can persist vectors at all. When it cannot, the
   * `embeddings` argument is IGNORED: the document, its chunks and its FTS
   * rows are still written and the call still returns normally, so a caller
   * that did not ask first has no way to learn its vectors were dropped.
   * Call `canPersistVectors()` BEFORE generating them. `embeddings`, when
   * provided, must have one entry per chunk in the same order. */
  upsertDocument(
    meta: DocumentMeta,
    chunks: Chunk[],
    embeddings: Float32Array[] | null,
  ): SavedDocument;

  /** Whether this store can persist vectors AT ALL — a standing capability,
   * fixed for the store's lifetime, not a statement about current contents.
   * NOT `hasVectors()`: that one answers "are there vectors in here right
   * now" and is `false` for a healthy corpus on its first run, so using it
   * as a capability check suppresses embedding on every first index. A
   * caller MUST consult this before spending CPU on embeddings destined for
   * `upsertDocument`. */
  canPersistVectors(): boolean;

  /** True when the vector index exists and holds at least one embedding.
   * A statement about CONTENT, not capability — see `canPersistVectors()`. */
  hasVectors(): boolean;
```

**Why the corrected `upsertDocument` text documents the silent drop instead of removing it.** Removing
it means throwing (option C, rejected: rollback) or returning a signal (option A, rejected: redundant
under B). Documenting it converts an *undocumented* silent drop — a caller trusting a promise the port
made, which is the whole defect — into a *documented, tested* one that the only production caller is
now structurally unable to hit. Test D3 pins it so it stays deliberate rather than becoming accidental
again.

**Adapter implementation:**

```ts
  canPersistVectors(): boolean {
    return this.vectorsEnabled;
  }
```

Deliberately not `this.vectorsEnabled && this.tableExists("chunks_vec")`. The table is created lazily
on first write (Decision 2); including its existence would reproduce the `hasVectors()` trap exactly.

### Decision 6: **no production seam** — the real adapter is driven degraded via `vi.mock("sqlite-vec")`

**Choice.** No constructor option, no protected factory, no injected loader, no test-only affordance
in `SqliteIndexStore`. Two new test files declare `vi.mock("sqlite-vec", …)` with a `load` that
throws; the real `loadVectorExtension` (`:91-98`) then takes its real `return false` branch, and every
`SqliteIndexStore` constructed in those files is genuinely degraded.

```ts
vi.mock("sqlite-vec", () => ({
  load: () => { throw new Error("simulated: sqlite-vec unavailable on this platform"); },
}));
```

**This is strictly better than the seam the proposal was prepared to buy, on three counts.**

1. **Higher fidelity.** A constructor flag sets `vectorsEnabled = false` while the extension remains
   loaded in the connection, so `CREATE VIRTUAL TABLE … USING vec0` would still *succeed* if the guard
   were removed — the case-1 throw would be unreproducible and the guard's regression test would be
   asserting against a condition that cannot occur in production. Under the mock the module is
   genuinely absent, so `no such module: vec0` is genuinely reachable and D2 genuinely falsifies the
   unfixed code.
2. **It covers `loadVectorExtension` itself**, which no seam would: the catch-and-return-false branch
   has zero coverage today and is the origin of the whole condition.
3. **Zero production surface.** The codebase has so far avoided test-only affordances in adapters;
   this keeps that intact, and Gate 5's "the contract and the adapter say the same thing" is not
   complicated by a constructor parameter that exists for tests.

**Precedent in this suite, not a new technique.** `test/infrastructure/transformers-embeddings-progress.test.ts:8`
mocks `@huggingface/transformers` with a factory over a namespace import — the same import shape
(`import * as sqliteVec from "sqlite-vec"`) and the same hoisting rule. `test/infrastructure/file-document-source.test.ts:10-33`
combines `vi.mock` with `vi.importActual` for the real module, which is exactly what the carried-over
fixture needs.

**Why two new files rather than adding to the existing two.** `vi.mock` is file-scoped: declaring it
inside `test/application/sync-index.test.ts` would degrade the store for all of that file's existing
cases at once. Putting the degraded cases in
`test/application/sync-index-degraded.test.ts` and `test/infrastructure/sqlite-index-store-degraded.test.ts`
makes Gate 6's "every existing case passes with no assertion modified" a **mechanical** property of the
diff (both existing files see additions only) rather than a promise. Same reasoning
`manual-sync-command` recorded for `sync-progress.test.ts`.

**Two apply-time wrinkles, recorded so they are not discovered as surprises.**

- `sqlite-vec` is CommonJS. If vitest's interop complains that the factory omits a `default` export,
  the fix is `() => { const load = …; return { load, default: { load } }; }`. Verified pattern, not a
  design change.
- The **carried-over** fixture (case 2) needs a real `chunks_vec` created by a working extension and
  then reopened without one, so it cannot use `:memory:` — a `:memory:` database does not survive
  `close()`. Seed a temp-file database with
  `const real = await vi.importActual<typeof import("sqlite-vec")>("sqlite-vec")`, a raw
  `new Database(file)`, `real.load(db)`, the `CREATE VIRTUAL TABLE` statement, `db.close()`; then
  construct `new SqliteIndexStore(file)`, which goes through the mocked loader.

**Gate 4 is therefore satisfied without waiving anything, and the proposal's Testability section can be
answered rather than negotiated.** The residual non-guarantee is narrow and worth stating: the mock
substitutes the *loader*, not the native library, so these tests prove the adapter's behaviour when
`sqlite-vec` fails to load — not that `sqlite-vec` fails to load in any particular real environment.
That second question is a platform fact, not a testable property of this codebase.

### Decision 7: `reset()` on a carried-over degraded database is a **MEASURED third defect**, out of scope here and filed separately

**The gap.** `IndexDocuments.execute()` calls `store.reset()` (`index-documents.ts:92`) before reading
any file, and `reset()` executes `DROP TABLE IF EXISTS chunks_vec` (`sqlite-index-store.ts:123`) inside
a transaction. Dropping a virtual table requires the module to be resolvable, because SQLite must call
its destructor. Gate 0 measured `CREATE VIRTUAL TABLE IF NOT EXISTS` in both states; it did not measure
`DROP`.

**It has now been measured (orchestrator, 2026-08-14, this repo's installed `better-sqlite3` +
`sqlite-vec`). It throws:**

```
DROP on degraded THROWS: no such module: vec0
after DROP, sqlite_master: {"name":"chunks_vec"}
```

The table also survives the failed drop, which is what makes the naive guard dangerous (below).

**Consequence, and it is larger than this change.** `compendio index` — the command the proposal cites
as *already behaving correctly* — **fails outright on a carried-over degraded database**. It does not
degrade to lexical with a warning; `reset()` throws before a single file is read, so the whole command
dies. The `index` / `sync` asymmetry the proposal describes therefore holds only for a **fresh**
degraded install. On a carried-over one, both commands are broken, in different ways:

| Database state | `compendio sync` today | `compendio index` today |
|---|---|---|
| fresh, degraded | every document → `skipped` (measured, Gate 0 case 1) | works, degrades to lexical with a warning |
| carried over, degraded | silent vector drop, false `mode: "hybrid"` (measured, Gate 0 case 2) | **hard failure at `reset()`** (measured here) |

The fresh sub-case is safe either way: with no `chunks_vec` row in `sqlite_master`, `DROP TABLE IF
EXISTS` short-circuits on the name exactly as `CREATE … IF NOT EXISTS` was measured to do, and no
module is resolved.

**Branch taken (the design pre-decided both; this is the "it throws" branch).**

- **Gate 3 is narrowed to a fresh degraded store**, which is where the `index` / `sync` asymmetry this
  change exists for actually lives.
- **D5 is committed as a documenting assertion of the current (broken) behaviour** — `reset()` throws
  `no such module: vec0` on a carried-over degraded database — so the separate change has a failing-
  behaviour pin to work against, rather than as the positive guarantee the not-throws branch wanted.
- **`reset()` is NOT patched here.** The reason is not budget. The obvious guard (drop `chunks_vec`
  only when `vectorsEnabled`) leaves the stale vector table in place while `documents` and `chunks` are
  dropped and recreated and chunk ids restart at 1 — so surviving `chunks_vec` rows would silently
  attach the *previous* corpus's vectors to the *new* corpus's chunk ids, `listChunksMissingVectors()`
  would report no gap, and `searchVector` would return correct-looking chunk ids for entirely unrelated
  content. Trading a hard failure for silent cross-corpus contamination is the wrong direction.
- **Filed as a separate change** for its own proposal, which must choose properly between dropping the
  shadow tables directly (version-coupled to `sqlite-vec`'s internal table layout) and failing loudly
  with a "delete `.compendio/` and retry" instruction (cheap, honest, and consistent with this
  project's beta-era no-migrations stance).

Probe used, kept for re-verification if the `sqlite-vec` or `better-sqlite3` version moves:

```bash
node -e "
const Database = require('better-sqlite3'); const sqliteVec = require('sqlite-vec');
const f = require('node:os').tmpdir() + '/vecdrop.db'; require('node:fs').rmSync(f, {force:true});
let db = new Database(f); sqliteVec.load(db);
db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[384])');
db.close();
db = new Database(f); // extension deliberately NOT loaded
try { db.exec('DROP TABLE IF EXISTS chunks_vec'); console.log('DROP on degraded: NO THROW'); }
catch (e) { console.log('DROP on degraded THROWS:', e.message); }
"
```

**Both branches as originally written, kept for the record.**

- **It does not throw** → nothing to do. Commit the probe as a positive assertion (`reset()` succeeds
  on a carried-over degraded database), because that is a real guarantee worth pinning, and Gate 3
  stands as written.
- **It throws** → **do not patch it in this change.** Record it as a discovered defect for a separate
  proposal, and narrow Gate 3's assertion to a **fresh** degraded store, which is where the `index`/`sync`
  asymmetry the change exists for actually lives. The reason for not patching is not budget: the
  obvious guard (`drop chunks_vec only when vectorsEnabled`) leaves the stale vector table in place
  while `documents` and `chunks` are dropped and recreated, and chunk ids restart at 1 — so surviving
  `chunks_vec` rows would silently attach the *previous* corpus's vectors to the *new* corpus's chunk
  ids, `listChunksMissingVectors()` would report no gap, and `searchVector` would return correct-looking
  chunk ids for entirely unrelated content. Trading a hard failure for silent cross-corpus contamination
  is the wrong direction, and choosing properly between the alternatives (drop the shadow tables
  directly, version-coupled; or fail loudly with "delete `.compendio/` and retry", cheap and honest
  given beta with no installed users) is a data-integrity decision of its own size.

Recorded here rather than left for `sdd-verify` to trip over, because a blocking gate written against
an unmeasured assumption is exactly the failure this project keeps re-learning.

## Flow notes

Per `rules.design`. Line numbers are current, pre-change.

**A degraded sync pass, 1 changed document, working provider (the change's central case):**

```
SyncIndex.execute()                                                       sync-index.ts:114
  ├─ discover() → files[3]; listDocuments() → existing[3]
  ├─ state.vectorsPersistable = (embeddings === null || store.canPersistVectors()) → FALSE  NEW
  │     └─ state.embeddingsWarning = "embeddings not persisted (vector storage
  │                                   unavailable): search runs in lexical mode"            NEW
  ├─ diff → changed[1]  ("docs/b.md")
  ├─ applyChanged → applyOne("docs/b.md")
  │     ├─ transformFile → ok
  │     ├─ embeddings !== null, but state.vectorsPersistable === false
  │     │     └─ embed() IS NOT CALLED           <-- Gate 7: zero invocations, no model download
  │     └─ store.upsertDocument(meta, chunks, null)
  │           ├─ embeddings === null → ensureVectorTable NOT reached
  │           ├─ insertVec = null   (vectorsEnabled false)
  │           └─ transaction: documents + chunks + chunks_fts committed
  │        state.indexed.push("docs/b.md")       <-- Gate 2: indexed, NOT skipped
  ├─ deleteMissingDocuments → nothing
  └─ reconcileVectors → listChunksMissingVectors() === [] → returns    unchanged, already correct

report.mode = (embeddingsWarning !== undefined) → "lexical"            <-- Gate 1
stdout: Synced 1 documents (12 chunks), 0 deleted in N ms [mode lexical]
stderr: WARNING embeddings not persisted (vector storage unavailable): search runs in lexical mode
search: store.searchLexical("…") returns docs/b.md's chunk             <-- Gate 2
```

**The same store, an all-unchanged pass (the hole Decision 3 closes; the shape `serve` produces most):**

```
diff → changed[] empty; applyOne never runs
state.vectorsPersistable === false  →  warning set at pass level anyway            NEW
reconcileVectors → [] → no embedding events
report.mode = "lexical"        (before this change: "hybrid", over a corpus with zero vectors)
```

**Fresh vs. carried-over, after the guard — one behaviour, not two:**

```
CASE 1 (fresh, no chunks_vec)          CASE 2 (chunks_vec carried over)
upsertDocument(…, null)                upsertDocument(…, null)
  ensureVectorTable  not reached         ensureVectorTable  not reached
  (…and if it were: early return,        (…and if it were: early return,
   instead of `no such module: vec0`)     instead of the measured no-op)
  insertVec = null                       insertVec = null   (vectorsEnabled fails the :250 conjunction)
  document + chunks + FTS committed      document + chunks + FTS committed
  → indexed, lexical, warning            → indexed, lexical, warning
```

**A healthy pass — unchanged, byte for byte:**

```
state.vectorsPersistable = TRUE  → no warning
applyOne → await embed() → upsertDocument(meta, chunks, vectors)
  ensureVectorTable(384)  → vectorsEnabled true → early return NOT taken → DDL runs as today
  insertVec prepared      → chunks_vec rows written
report.mode = "hybrid"
```

## Interfaces / Contracts

```ts
// src/domain/ports.ts
export interface IndexStore {
  …
  upsertDocument(meta: DocumentMeta, chunks: Chunk[], embeddings: Float32Array[] | null): SavedDocument;
  //   signature UNCHANGED; doc comment corrected (Decision 5)
  canPersistVectors(): boolean;   // NEW
  hasVectors(): boolean;          // signature UNCHANGED; doc comment cross-references the above
}
// SavedDocument is UNCHANGED — option A is not taken (Decision 1)

// src/infrastructure/sqlite/sqlite-index-store.ts
//   canPersistVectors(): boolean            NEW — `return this.vectorsEnabled;`
//   ensureVectorTable(dimension)            GUARD — `if (!this.vectorsEnabled) return;` (Decision 2)
//   everything else UNCHANGED, reset()/migrate()/SCHEMA_DDL included

// src/application/sync-index.ts
interface PassState { …; vectorsPersistable: boolean }   // module-private, NEW field
//   execute():  answers the query once, sets the pass-level warning       (Decision 3)
//   applyOne(): the embed block gains one `else if` guard                 (Decision 3)
//   SyncReport UNCHANGED — no new field; `mode` line at :137 UNCHANGED
```

**Asserted unchanged, not assumed:**

| File | Why it must not move |
|---|---|
| `src/application/index-documents.ts`, `IndexReport` included | its two-call shape is already correct; `saveEmbeddings`'s throw + `embedPending`'s catch already produce lexical + warning. An edit here means the fork drifted into the shared-write-path non-goal |
| `src/application/search-documents.ts` | retrieval already degrades when `hasVectors()` is false; the defect is in reporting |
| `src/application/get-overview.ts` | `toSyncInfo` already surfaces `embeddingsWarning`; the new variant reaches `docs_overview` by construction. This is why the proposal asserts **no `mcp-contract` delta** |
| `SCHEMA_DDL`, `migrate()`, `reset()` | no schema change. `reset()` is untouched **in this change** — Decision 7 is a measurement, not an edit |
| `SqliteIndexStore`'s constructor signature | no test seam is built (Decision 6) |
| `SavedDocument`, `SyncReport`, `IndexReport` | no report or record shape changes |
| `hasVectors()`'s behaviour | Gate 6's fourth bullet. Its comment changes; its body does not |
| `test/application/sync-index.test.ts`'s existing cases | additions only: three delegating `canPersistVectors()` methods, explicitly permitted by Gate 6 |

## Testing Strategy

`strict_tdd: true`. Tests first; each row below is a concrete target for `sdd-tasks`.

| File | Status | Contents |
|---|---|---|
| `test/infrastructure/sqlite-index-store-degraded.test.ts` | **new** | `vi.mock("sqlite-vec")`. Adapter-level truth: D1-D6 |
| `test/application/sync-index-degraded.test.ts` | **new** | `vi.mock("sqlite-vec")` + a **real** `SqliteIndexStore` under a real `SyncIndex`: G1-G6 |
| `test/application/sync-index.test.ts` | extended, **additions only** | one `canPersistVectors()` delegating method on each of the three decorators (`:466`, `:570`, `:733`) |
| `test/infrastructure/sqlite-index-store.test.ts` | extended, **additions only** | one case: `canPersistVectors()` is `true` on a healthy store (the mocked file can only prove the `false` half) |

### `test/infrastructure/sqlite-index-store-degraded.test.ts`

| # | Case | Falsifies |
|---|---|---|
| D1 | `canPersistVectors()` is `false` | the query being wired to `tableExists` or to `hasVectors` |
| D2 | fresh degraded store, `upsertDocument(meta, chunks, [vector])` → **does not throw**; the document is returned, `getDocumentByPath` finds it, `searchLexical` finds its content, and `chunks_vec` is absent from `sqlite_master` | **the missing guard.** Today this throws `no such module: vec0`. The `sqlite_master` assertion is what distinguishes "guard fired" from "guard absent but the table happened to exist" |
| D3 | the same call's `embeddings` argument is ignored — `hasVectors()` stays `false`, `listChunksMissingVectors()` stays `[]` | the documented ignore-on-unavailable contract (Decision 5) drifting back into being accidental |
| D4 | **carried-over** degraded store (temp-file db seeded via `vi.importActual`) → `upsertDocument` does not throw, the document commits, `chunks_vec` gains no row | case 2 regressing, and the "two cases collapse into one" claim |
| D5 | `reset()` on that carried-over database **throws `no such module: vec0`** (measured) | Decision 7. Committed as a **documenting assertion of today's broken behaviour**, so the separate `reset()` change has a pin to work against. It is not a guarantee and must be inverted by that change |
| D6 | `saveEmbeddings([…])` and `replaceEmbeddings([…])` still **throw** on a degraded store | the guard being "simplified" into a replacement for their explicit throws — which would silently stop `compendio index` from warning (`index-documents.ts:157-161`) |

D2 is the single most load-bearing test in the change: it is the only one that fails against today's
code for the *fresh* case, which is the case already shipping and the one a signal-only fix cannot
reach.

### `test/application/sync-index-degraded.test.ts`

Harness: real `SqliteIndexStore(":memory:")` under the mock, a mutable in-memory `DocumentSource`, and
`RecordingEmbeddings(new FakeEmbeddings())` — the recording decorator already exists at
`sync-index.test.ts:81-88` and is re-declared locally rather than extracted, to keep that file's diff
additions-only.

| # | Gate | Case | Falsifies |
|---|---|---|---|
| G1 | 1 | one new document → `report.mode === "lexical"`; `embeddingsWarning` is non-empty, contains `vector storage`, and does **not** contain `provider unavailable` | the defect verbatim, and a warning that blames the provider (Decision 4) |
| G2 | 2 | same pass → the path is in `indexed`, absent from `skipped`, and `store.searchLexical` returns its content | **option C.** Cannot pass with a throwing `upsertDocument` |
| G3 | 7 | same pass → `recording.calls` is `[]` | option A shipped instead of B; the wasted-CPU half left unfixed |
| G4 | 1 | a second pass with identical content → still `mode === "lexical"` with the warning, and `indexed` is `[]` | the fix scoped to `applyOne` only (Decision 3's hole) |
| G5 | 3 | `IndexDocuments.execute()` over the same corpus and a **fresh** degraded store → `mode === "lexical"` and a non-empty `embeddingsWarning` | the `index`/`sync` asymmetry surviving in either direction. See Decision 7 for why this is scoped to the fresh store |
| G6 | 1, 2 | the carried-over fixture driven through a full `SyncIndex` pass → identical outcome to G1+G2 | the two cases diverging after the guard |

**Do not assert `report.mode === "hybrid"` anywhere in this file.** Every store in it is degraded by
construction; a `hybrid` expectation here would mean the mock silently failed to take effect, which is
the one way this whole file could go green while proving nothing. G1's `lexical` assertion doubles as
the mock's own liveness check, and D1 pins it independently at the adapter.

### Gate mapping

| Gate | Decision it tests | Concrete falsifier |
|---|---|---|
| 0 — the fresh case is measured | — | **SATISFIED** in the proposal. Decision 7's companion measurement (`reset()`) has also been run: it throws. Both are settled; no probe is outstanding |
| 1 — the degradation is reported | 3, 4 | G1, G4, G6 |
| 2 — the document survives and stays searchable | 1, 2 | G2, G6, plus `ThrowingStore`'s existing throw-→-`skipped` case passing unmodified |
| 3 — `index` and `sync` agree | 1, 7 | G5, on a **fresh** degraded store only. **Narrowed** — Decision 7's measurement showed `reset()` throws, so on a carried-over degraded database `index` is itself broken and cannot be the reference behaviour |
| 4 — the condition is reachable from the test suite | 6 | D1-D4, D6 and all of G1-G6 drive a real `SqliteIndexStore`. **Nothing is waived** |
| 5 — the contract and the adapter say the same thing | 2, 5 | the `ports.ts` diff; D2's `sqlite_master` assertion; D6 for the two sibling writers |
| 6 — nothing else moved | 2 | `npm test`, `npm run typecheck` (both projects), `npm run build`; `sqlite-index-store.test.ts:257-270` unmodified; `sync-index.test.ts` diff additions-only; `hasVectors()`'s body unchanged and unused as the query |
| 7 — no wasted embedding | 1 | G3. **Active**, because B was taken |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/ports.ts` | Modified | `canPersistVectors()` added to `IndexStore`; `upsertDocument`'s and `hasVectors()`' doc comments corrected (Decision 5) |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | Modified | `canPersistVectors()` (3 lines); `ensureVectorTable`'s early return (1 line + comment). No seam, no schema change, no `reset()`/`migrate()` edit |
| `src/application/sync-index.ts` | Modified | `PassState.vectorsPersistable`; the pass-level query + warning in `execute()`; one `else if` in `applyOne`. `mode` (`:137`) and `SyncReport` unchanged |
| `src/application/index-documents.ts` | **Unchanged — asserted** | already correct; an edit means the shared-write-path non-goal was entered |
| `src/application/search-documents.ts`, `get-overview.ts` | **Unchanged — asserted** | retrieval already degrades; `toSyncInfo` already surfaces the warning |
| `test/infrastructure/sqlite-index-store-degraded.test.ts` | **New** | D1-D6 |
| `test/application/sync-index-degraded.test.ts` | **New** | G1-G6 |
| `test/application/sync-index.test.ts` | Extended, additive | three delegating methods |
| `test/infrastructure/sqlite-index-store.test.ts` | Extended, additive | one healthy-store case |
| `openspec/specs/indexing/spec.md` | Modified | one new requirement + scenarios (`sdd-spec` owns the wording; see Open questions) |
| `CLAUDE.md` | Modified | the graceful-degradation bullet is too narrow on both halves — it names only the *provider* as a cause and only `IndexDocuments` as a trigger |

## Delivery size

| Driver | Estimate |
|---|---|
| `ports.ts` — `canPersistVectors()` + three corrected doc comments | 20-30 |
| `sqlite-index-store.ts` — query + guard + comments | 12-20 |
| `sync-index.ts` — `PassState` field, pass-level query/warning, `applyOne` branch | 15-25 |
| Three decorator methods + one healthy-store case | 15-20 |
| `sqlite-index-store-degraded.test.ts` (D1-D6, incl. the temp-file fixture) | 90-140 |
| `sync-index-degraded.test.ts` (G1-G6) | 90-140 |
| `indexing` spec delta | 40-80 |
| `CLAUDE.md` | 10-20 |

**290-475 changed lines** against a ~400-line review budget. **One PR is the working assumption**, and
the honest caveat from the proposal stands: this project's forecasts have landed 2-4x low for several
cycles (`bounded-chunk-size` 240-420 → 773; `match-centred-excerpt` 300-470 → ~1 521). Two things make
the risk lower here than the track record suggests — the production surface is genuinely three files
and **under 60 lines**, and no seam is built (Decision 6 removed a 5-20 line driver the proposal had
budgeted) — but the variance sits in two brand-new test files, which is where those overruns came from
before.

**The slice boundary, specified now rather than improvised at 400 lines.** Cut where the proposal
suggested, and the cut is independently valuable for a reason the proposal did not have available:

- **Slice 1 — adapter + port.** `ensureVectorTable`'s guard, `canPersistVectors()`, the corrected
  `ports.ts` contract, `sqlite-index-store-degraded.test.ts` (D1-D6). **This alone fixes the worse of
  the two measured cases**: a fresh degraded install stops sending every document to `skipped` and
  starts indexing them lexically. Independently testable, independently shippable, and it satisfies
  Gates 4 and 5 outright.
- **Slice 2 — `SyncIndex` wiring, spec, docs.** The pass-level query and warning,
  `sync-index-degraded.test.ts` (G1-G6), the `indexing` delta, `CLAUDE.md`. Satisfies Gates 1, 2, 3
  and 7.

The dependency runs one way: Slice 2 needs `canPersistVectors()` to exist. Splitting leaves a window
in which the fresh case is fixed and the reporting is not — degraded but honest about nothing, which
is still strictly better than today's total skip.

## Open questions for later phases

1. **RESOLVED — the `reset()` measurement (Decision 7) has been run.** It throws
   (`no such module: vec0`), so the pre-decided branch applies and is now written into Decision 7:
   Gate 3 is narrowed to a fresh degraded store, D5 becomes a documenting assertion of the broken
   behaviour, `reset()` is not patched here, and the carried-over `compendio index` hard failure is
   filed as a separate change. `sdd-tasks` inherits this as settled; no probe remains to run.
2. **The spec delta's shape.** `sdd-spec` owns the wording; this design does not write
   `openspec/changes/2026-08-14-sync-vector-contract/specs/`. The recommendation is one requirement
   whose obligation is **trigger-agnostic and cause-agnostic** — an embeddings degradation reports
   lexical mode with a warning, whether the trigger is `index` or `sync` and whether the cause is the
   provider or the store — with three scenarios: vectors unpersistable while the provider works
   (documents indexed, lexical, warning); the same on a pass that changed nothing (the Decision 3
   hole, which is the one a future change can silently reopen); and a genuine hard write failure still
   being a skip (the negative half that keeps the requirement from being satisfiable by option C).
   Note that the five existing reconciliation scenarios (`indexing/spec.md:293-309`) remain correct and
   are not edited — in particular *Vector table has never been created*, whose no-op is still right.
3. **Whether `canPersistVectors()` should carry its reason** (`string | null` instead of `boolean`).
   Deferred with its extension path written down in Decision 4, and gated on proposal question 4 being
   answered "yes" by the user. Not a blocker: answering it later changes one adapter method and one
   call site.
4. **Nothing in this design depends on the remaining proposal questions.** Q1 (a warning is the right
   ceiling) and Q2 (recover the wasted CPU) are answered by the assumptions in force — Q2 in the
   affirmative, by taking B. Q3 (how much the test seam is worth) is answered by Decision 6 making it
   free.
