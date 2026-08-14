# Exploration: `sync-vector-contract` — `upsertDocument` drops embeddings without a signal

**Phase**: explore · **Artifact store**: openspec (Engram unavailable in the originating session —
no `mem_*` tool was exposed, so this file is the artifact of record) · **Skill resolution**: none
(no skill in the registry applies to a TypeScript adapter-contract change).

**Origin**: finding 1.2 of `code-review-src-2026-08-14.md` (severity: medium; priority 1 in that
document's suggested ordering).

**Sibling change**: `2026-08-14-config-value-validation` covers finding 1.1. See that file's "Why
this is not one change with 1.2" for the split rationale.

## The claim under test

The review asserts that `saveEmbeddings` and `replaceEmbeddings` throw when `vectorsEnabled ===
false`, that `upsertDocument` instead builds `insertVec = null` and continues — discarding
already-computed vectors with no signal — and that the resulting `SyncReport` therefore declares
`mode: "hybrid"` while `hasVectors()` is false and every search runs lexical-only.

**Verdict: the defect is confirmed. The review's own suggested fix is wrong and would make things
worse.** That correction is the most valuable output of this exploration.

## Current state (verified)

`src/infrastructure/sqlite/sqlite-index-store.ts`, `upsertDocument`:

```ts
const insertVec =
  this.vectorsEnabled && this.tableExists("chunks_vec")
    ? this.db.prepare(`INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`)
    : null;

const run = this.db.transaction((): SavedDocument => {
  const existing = findExisting.get(meta.path) as { id: number } | undefined;
  if (existing !== undefined) this.deleteDocumentRows(existing.id);
  return this.insertDocumentAndChunks(meta, chunks, embeddings, insertVec);
});
return run();
```

`insertDocumentAndChunks` writes a `chunks_vec` row only when `insertVec !== null && embeddings !==
null`. No throw, no return-value signal. `saveEmbeddings` and `replaceEmbeddings` both throw
unconditionally on `!vectorsEnabled` ("the sqlite-vec extension is not available").

`SyncIndex.applyOne` (`src/application/sync-index.ts`) embeds first, then commits:

```ts
try {
  this.store.upsertDocument(meta, chunks, chunkEmbeddings);
  state.indexed.push({ path: file.path, title: meta.title, chunks: chunks.length });
} catch (error) {
  state.skipped.push({ path: file.path, errors: [describeError(error)] });
}
```

`state.embeddingsWarning` is set in exactly two places, both **before** this block: when
`this.embeddings === null`, and when `embed()` itself throws. Neither fires on the silent-drop path,
so `SyncReport.mode` computes `"hybrid"` while no vector was ever written.

**Port contract violation, independent of `SyncIndex`.** `src/domain/ports.ts` documents
`upsertDocument` as writing "plus `chunks_vec` when embeddings is non-null". The implementation adds
an undocumented second gate (`vectorsEnabled`). The port promises something the adapter does not
deliver, and no caller can see the difference.

## The failure scenario, and why `index` behaves differently

sqlite-vec fails to load on a platform while transformers.js still works → `compendio sync` embeds
every changed document (CPU fully paid), throws the vectors away, reports `mode: "hybrid"`, and
every subsequent search runs lexical-only. The same environment under `compendio index` **does**
warn.

The asymmetry is architectural, not a missing line. `IndexDocuments` decouples the document commit
(`saveDocument`, unconditional) from the vector commit (`saveEmbeddings`, inside `embedPending`'s own
try/catch) — two separate store calls, so a throw from the vector call is catchable at exactly the
right granularity and degrades to `embeddingsWarning`. `SyncIndex` couples document + chunks + FTS +
vectors into **one** `upsertDocument` transaction. There is no seam at which a vector-only failure
can be caught without taking the document down with it.

## The critical correction: the review's suggested fix is a regression

The review suggests: *"in `upsertDocument`, if `embeddings !== null` and `!this.vectorsEnabled`,
throw... and let `applyOne` convert it into `embeddingsWarning` as it already knows how to do."*

`applyOne` does **not** know how to do that. Verified two ways:

1. **By reading the code** (block quoted above): the `catch` around `upsertDocument` pushes to
   `state.skipped`. There is no branch that routes a caught error to `embeddingsWarning`.
2. **By an existing test**: `test/application/sync-index.test.ts`'s `ThrowingStore` fixture asserts
   that a throwing `upsertDocument` lands the path in `report.skipped`.

And because better-sqlite3's `.transaction()` rolls back the **entire** wrapped function on any
throw, throwing inside `upsertDocument` would discard the document's rows and FTS content too — not
just its vector. The net effect of the suggested fix:

> from "silently degraded but fully searchable lexically" → to "document absent from the index
> entirely, reported as skipped."

That is strictly worse than the bug it fixes. Implementing it literally would additionally require
restructuring `applyOne`'s catch to distinguish "vector-only failure → degrade, still index" from
"hard failure → skip document" — a distinction that does not exist today.

## Design fork for `sdd-design`

**A. Return a signal.** `upsertDocument` returns `SavedDocument` already; add something like
`vectorsWritten: boolean` (or a richer `vectorStatus`). `applyOne` reads it and sets
`embeddingsWarning`. No rollback risk, no transaction restructuring, and it repairs the port doc by
making the second gate explicit in the contract instead of hidden in the adapter. Cost: a port shape
change, so every `IndexStore` implementation and every hand-rolled test fake moves with it.

**B. Never embed when vectors cannot be persisted.** `applyOne` asks the store up front and skips
`embed()` entirely — which also recovers the wasted CPU, the part of the defect the review notes but
does not address. Cost: needs a **new** port capability query. `hasVectors()` cannot be reused: it
conflates "extension unavailable" with "extension available but the corpus has no vectors yet",
which is the normal state of a fresh index — repurposing it would suppress embedding on every
first run.

**C. Throw (the review's suggestion).** Documented above as a regression. Recorded here so a later
reader can see it was considered and why it was rejected, not overlooked.

A and B are not exclusive: B prevents the waste, A reports the degradation. B alone still leaves
`SyncReport.mode` lying unless a warning is also set, so **A is load-bearing and B is an
optimization on top of it**.

## Testability gap — scope this explicitly

`vectorsEnabled` is a private field in `SqliteIndexStore` with **no injection seam**. Consequently
**no test in the suite exercises the real `SqliteIndexStore` with `vectorsEnabled === false`** — the
condition this whole change is about is currently unreachable from the test suite.

- A `SyncIndex`-level test is cheap: the hand-rolled `IndexStore` fakes already exist in
  `test/application/sync-index.test.ts` (`RecordingStore`, `ThrowingStore`, `ReplaceThrowsStore`).
- A store-level regression test needs a new seam that does not exist yet. Deciding whether to build
  that seam belongs in this change's design, not left implicit.

This matters beyond convenience: without a store-level test, the fix is verified only against fakes
that model the behavior we *believe* the adapter has.

## Spec surface

`openspec/specs/indexing/spec.md` has detailed vector-coverage-reconciliation requirements, but
**none of them cover "the sqlite-vec extension is unavailable during a fresh `upsertDocument`"**.
That is a genuine spec gap, not merely an implementation bug — the delta here adds a requirement,
it does not just correct code to match one.

The graceful-degradation guarantee that `IndexDocuments` honors (embeddings failure → lexical mode
*with* `embeddingsWarning`) is the behavior to state as trigger-agnostic, so it binds the `SyncIndex`
path too rather than being written around whichever caller existed first.

## Risks

- The naive fix is actively harmful; a reviewer skimming the original code-review document and not
  this file will likely propose it. Record the rejection in the proposal, not only here.
- Option A changes the `IndexStore` port shape, which moves every fake in the test suite. That is
  breadth, not depth, but it should be budgeted rather than discovered during apply.
- The `vectorsEnabled === false` condition cannot currently be reproduced in a test against the real
  adapter. Any claim that the fix works is, until that seam exists, a claim about the fakes.

## Addendum (measured after propose) — the defect has two cases, not one

Found during the propose phase and **measured** by the orchestrator on 2026-08-14 against this
repo's installed `better-sqlite3` + `sqlite-vec`. This exploration originally described a single
failure mode; that was incomplete.

`upsertDocument` calls `ensureVectorTable` **before** its `vectorsEnabled` gate and without
consulting it — the only vector-touching method in the adapter that does not check first
(`saveEmbeddings` and `replaceEmbeddings` both check, then ensure). Measured consequences:

| Case | Precondition | Measured |
|---|---|---|
| **1 — fresh** | no `chunks_vec` table, sqlite-vec unavailable | `CREATE VIRTUAL TABLE IF NOT EXISTS ... USING vec0(...)` → `SqliteError: no such module: vec0`. The throw escapes `ensureVectorTable`, `applyOne` catches it → **every document goes to `skipped`** |
| **2 — carried over** | `chunks_vec` exists from a healthy run, extension now unavailable | **No throw** — `IF NOT EXISTS` short-circuits on the name in `sqlite_master` before resolving the module. `insertVec` is `null` → silent vector drop, `mode: "hybrid"` |

Two things follow, and both correct this document as originally written:

1. **The review's finding 1.2 is real but conditional.** The described scenario (silent drop, false
   `hybrid`) requires a database that already carries `chunks_vec`. On a *fresh* degraded install the
   behavior is not a silent drop at all — it is a total skip, which is the very outcome this
   exploration argued against when rejecting the review's suggested fix. That outcome is already
   shipping.
2. **Option A alone is insufficient.** A return-value signal cannot report a failure that throws
   before anything is returned. The `ensureVectorTable` guard moves from hygiene to load-bearing
   scope.

Probe used for case 2 (case 1 is a single `db.exec` on a `:memory:` database with the extension not
loaded):

```bash
node -e "
const Database = require('better-sqlite3'); const sqliteVec = require('sqlite-vec');
const f = require('node:os').tmpdir() + '/vecprobe.db'; require('node:fs').rmSync(f, {force:true});
let db = new Database(f); sqliteVec.load(db);
db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[384])');
db.close();
db = new Database(f); // extension deliberately NOT loaded
try { db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[384])');
      console.log('case 2: no throw'); }
catch (e) { console.log('case 2: THROWS ->', e.message); }
"
```

## Next recommended

`sdd-propose` for this change alone. **(Done — `proposal.md` written, with Gate 0 satisfied by the
addendum above.)**
