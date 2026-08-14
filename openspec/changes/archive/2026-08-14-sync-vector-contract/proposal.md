# Proposal: `upsertDocument` Must Not Discard Embeddings Without a Signal

`SqliteIndexStore.upsertDocument` — the only write path `SyncIndex` uses — throws away
already-computed vectors when the sqlite-vec extension is unavailable, and returns as if it had
written them. The pass reports `mode: "hybrid"` with no `embeddingsWarning` while `hasVectors()` is
`false` and every subsequent search runs lexical-only. `compendio index` warns in the identical
environment; `compendio sync` does not.

This is **one of two changes split from the same code-review pass** (`code-review-src-2026-08-14.md`).
The sibling is `2026-08-14-config-value-validation` (finding 1.1). They share an origin document and
nothing else — different files, different layers, different specs. They are not bundled.

## Intent

### The defect

`upsertDocument` builds its vector-insert statement behind two gates:

```ts
const insertVec =
  this.vectorsEnabled && this.tableExists("chunks_vec")
    ? this.db.prepare(`INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`)
    : null;
```

`insertDocumentAndChunks` then writes a `chunks_vec` row only when `insertVec !== null && embeddings
!== null`. When `vectorsEnabled` is `false` the caller's `embeddings` argument — a full set of
vectors, CPU already paid — is silently ignored. No throw. No return-value signal. Its two siblings
do the opposite: `saveEmbeddings` and `replaceEmbeddings` both open with an unconditional
`if (!this.vectorsEnabled) throw new Error("the sqlite-vec extension is not available in this
installation")`.

`SyncIndex` sets `state.embeddingsWarning` in exactly two places, both **before** the write: when
`this.embeddings === null`, and when `embed()` itself throws. Neither fires here, so
`SyncReport.mode` — computed as `state.embeddingsWarning === undefined && this.embeddings !== null ?
"hybrid" : "lexical"` — reports `hybrid` over a corpus with zero vectors.

The user-visible shape: sqlite-vec fails to load on a platform while transformers.js keeps working,
`compendio sync` embeds every changed document, discards every vector, prints a clean summary, and
search quality silently drops to BM25-only. The one report the user reads says the run was hybrid.

### The asymmetry with `index` is architectural, not a missing line

`IndexDocuments` commits documents and vectors through **two separate store calls**: `saveDocument`
per file (unconditional), then `saveEmbeddings` per batch inside `embedPending`'s own `try/catch`. A
throw from the vector call is therefore catchable at exactly the granularity where the right thing to
do is "keep the documents, degrade to lexical, set the warning" — which is what `embedPending`
returns and what `execute` turns into `mode: "lexical"` plus `embeddingsWarning`.

`SyncIndex.applyOne` commits documents + chunks + FTS + vectors through **one** `upsertDocument`
call, wrapped in **one** better-sqlite3 transaction. There is no seam at which a vector-only failure
can be caught without taking the document down with it. That missing seam is the change; the silent
drop is its symptom.

### Nothing downstream will ever raise the alarm either

Vector-coverage reconciliation looks like a safety net and is not one here.
`listChunksMissingVectors()` returns `[]` outright when `!this.vectorsEnabled`, so a degraded corpus
reports **no gap** — and `openspec/specs/indexing/spec.md`'s *Vector table has never been created*
scenario specifies that no-op as correct ("reports no gap and raises no error"). The silence is
spec-sanctioned in the reconciliation path. So the alarm has to be raised at `applyOne`, or it is not
raised at all.

### Why now

The change is small, the failure is silent, and the review pass that found it is fresh. More
pointedly: `manual-sync-command` just put `compendio sync` in a user's hands as a first-class command,
which widens the population that reaches this path without ever running `compendio index` — the one
command that *does* warn today.

## The fix this change explicitly rejects

**The suggestion in `code-review-src-2026-08-14.md` §1.2 is a regression. Do not implement it.**
Recorded here rather than in an appendix because a future reader who has seen only that review
document will otherwise re-propose it, and it looks obviously right.

The review suggests: *"in `upsertDocument`, if `embeddings !== null` and `!this.vectorsEnabled`,
throw ... and let `applyOne` convert it into `embeddingsWarning` as it already knows how to do."*

`applyOne` does not know how to do that. Verified two independent ways during this phase:

1. **By reading the code.** The `catch` wrapping `this.store.upsertDocument(...)` in
   `src/application/sync-index.ts` executes `state.skipped.push({ path, errors: [describeError(error)] })`.
   There is no branch anywhere in `applyOne` that routes a caught store error to `embeddingsWarning`.
2. **By an existing test.** `test/application/sync-index.test.ts`'s `ThrowingStore` fixture makes
   `upsertDocument` throw for one path and asserts that path lands in `report.skipped` and that
   `report.indexed` excludes it. The behaviour is not incidental — it is pinned.

And because `.transaction()` rolls back the **entire** wrapped function on any throw, a throw inside
`upsertDocument` discards the document's rows, its chunks and its FTS content too — not just its
vector. Net effect of the suggested fix:

> from **"silently degraded but fully searchable lexically"** to **"absent from the index entirely,
> reported as skipped."**

Strictly worse than the bug. Implementing it faithfully would additionally require restructuring
`applyOne`'s catch to distinguish "vector-only failure → degrade, keep indexing" from "hard failure →
skip the document" — a distinction that does not exist in the codebase today and which is most of the
work either way.

Gate 2 below exists specifically to fail if this fix is implemented anyway.

## The second failure mode — MEASURED, and it holds

Found while verifying the above; **not** in the exploration, and it changes which design option is
sufficient. `upsertDocument` calls `ensureVectorTable` **before** its `vectorsEnabled` gate and
without consulting it:

```ts
if (embeddings !== null && embeddings.length > 0) {
  this.ensureVectorTable(embeddings[0]!.length);   // db.exec(CREATE VIRTUAL TABLE ... USING vec0)
}
```

`ensureVectorTable` is unguarded — it is the only vector-touching method in the adapter that does not
check `vectorsEnabled` first. `saveEmbeddings` and `replaceEmbeddings` both check, then ensure. The
probes below were **run** (orchestrator, 2026-08-14, this repo's installed `better-sqlite3` +
`sqlite-vec`), and both predictions hold. The defect has **two** cases, not one:

| Case | Precondition | Measured behaviour today |
|---|---|---|
| **1 — fresh** | No `chunks_vec` table yet, sqlite-vec unavailable | `CREATE VIRTUAL TABLE` raises `SqliteError: no such module: vec0` → `ensureVectorTable` throws → `applyOne` catch → **every document skipped**, indexed nowhere |
| **2 — carried over** | `chunks_vec` exists from a run where the extension worked, now unavailable | `IF NOT EXISTS` short-circuits on the name in `sqlite_master` **before** resolving the module, so it does **not** throw; `insertVec` is `null` → **silent drop**, `mode: "hybrid"` |

Verbatim output:

```
THROWS: SqliteError | no such module: vec0            # case 1
phase2 ensureVectorTable: NO THROW                    # case 2
phase2 tableExists sees: {"name":"chunks_vec"}        # case 2
```

Case 2 is the reported defect, and it is confirmed exactly as the review described it — but **only**
for a database that already carries the table. Case 1 is the review's own rejected outcome
*already happening in production* on a fresh degraded install, and it is **not** fixed by a
return-value signal, because the throw happens before anything is returned.

**Consequence for the fork: option A alone is not sufficient.** The `ensureVectorTable` guard is
load-bearing, not the hygiene item it was first filed as. A change that ships only the signal leaves
`compendio sync` skipping every document on a fresh degraded install.

The probes, kept for re-verification (two commands, no model download, no fixture). They have already
been run once — the results are in the table above; re-run them if the `sqlite-vec` or
`better-sqlite3` version moves:

```bash
# Case 1: module absent, table absent.
node -e "
const Database = require('better-sqlite3');
const db = new Database(':memory:');
try { db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[384]);');
      console.log('case 1: no throw'); }
catch (e) { console.log('case 1: THROWS ->', e.message); }
"

# Case 2: table created with the extension loaded, then reopened without it.
node -e "
const Database = require('better-sqlite3'); const sqliteVec = require('sqlite-vec');
const f = require('node:os').tmpdir() + '/vecprobe.db'; require('node:fs').rmSync(f, {force:true});
let db = new Database(f); sqliteVec.load(db);
db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[384]);');
db.close();
db = new Database(f); // extension deliberately NOT loaded
try { db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[384]);');
      console.log('case 2: no throw'); }
catch (e) { console.log('case 2: THROWS ->', e.message); }
"
```

Whatever the result, it is recorded in `design.md` and the guard on `ensureVectorTable` is in scope
for this change either way — an unguarded `CREATE VIRTUAL TABLE` in a method whose two siblings guard
is a latent inconsistency worth closing on its own terms.

## Scope

### In Scope

- **A signal, or an avoidance, for the drop** — `SyncIndex` must end a pass in which vectors could
  not be persisted with `mode: "lexical"` and a non-empty `embeddingsWarning`, while the affected
  documents remain in `indexed` and lexically searchable. The mechanism is the open fork below; the
  observable outcome is not open.
- **The port contract in `src/domain/ports.ts`.** `upsertDocument` is documented as writing
  "documents + chunks + chunks_fts, plus chunks_vec when embeddings is non-null." The adapter applies
  an undocumented second gate. Whichever option is taken, the contract states the vector-availability
  condition explicitly and describes what a caller observes when it is not met. This is part of the
  change, not incidental cleanup: the whole defect is a caller trusting a promise the port made.
- **`ensureVectorTable`'s missing guard**, per the measurement above.
- **A test seam decision, made here rather than discovered at apply time** — see Testability.
- **One new `indexing` requirement**, plus whatever the seam decision implies. See Required spec
  action.

### Out of Scope

| Item | Why |
|---|---|
| **Finding 1.1 (config value validation)** | The sibling change `2026-08-14-config-value-validation`. Different file, different layer, different spec capability. Sharing a review document is not a reason to share a PR |
| **Every other finding in `code-review-src-2026-08-14.md`** (1.3, 1.4, 1.5, 2.x, 3.x, 5.x) | Untouched. This change opens no general "act on the review" scope |
| **Making `index` and `sync` share one write path** | The real long-term answer to the asymmetry and far too large for a defect fix. `IndexDocuments`' two-call shape and `SyncIndex`' one-transaction shape both have recorded reasons (per-document atomicity for sync: an interruption never leaves a hash-current row without its vectors) |
| **Recovering vectors for documents already indexed under the silent drop** | Already covered, once the extension works again: those chunks appear in `listChunksMissingVectors()` and reconciliation fills them, chunk-granularly, with no user action. No migration, no schema marker |
| **Detecting *why* sqlite-vec failed to load, or reporting the underlying loader error** | `loadVectorExtension` swallows the cause today. Widening that is a separate, defensible change; this one is about not lying about the consequence |
| **Any change to `SearchDocuments`' behaviour when `hasVectors()` is false** | It already degrades correctly. The defect is in reporting, not in retrieval |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`). Nothing here touches the schema |

## Capabilities

### New Capabilities

- None. This is a gap inside `indexing`, not a new capability area.

### Modified Capabilities

- **`indexing`** — gains a requirement covering vector persistence being unavailable during a sync
  pass. The graceful-degradation guarantee that `IndexDocuments` already honours (embeddings
  unavailable → lexical mode **with** `embeddingsWarning`) is restated as **trigger-agnostic and
  cause-agnostic**, so it binds the `SyncIndex` path and covers a store-side failure, not only a
  provider-side one.
- **`mcp-contract`** — **no delta expected.** *Sync-Status Visibility in `docs_overview` Response*
  already guarantees the `sync` field surfaces `embeddingsWarning`; once the warning is set, it
  surfaces by construction. Asserted here so a later phase does not add a redundant delta.

### Required spec action

`openspec/specs/indexing/spec.md` has five detailed vector-coverage-reconciliation scenarios, and
**none covers vector persistence being unavailable while the embeddings provider works.** Confirmed
by reading them, not inferred:

| Existing scenario | Why it does not cover this |
|---|---|
| *Vector gap persists while the provider is unavailable* | Cause is the **provider**. Here the provider succeeds and the **store** cannot persist |
| *Vector table has never been created* | Premise is "the embeddings provider has never once succeeded". Here it succeeds every time. Also scoped to reconciliation, not to `upsertDocument` |
| *Partially vectorized document has only its missing chunks embedded* | Assumes vectors are writable |
| *Vector-Coverage Reconciliation Is Reported as Written Work* (4 scenarios) | Governs the reconciliation report, which stays empty in this failure |

So the delta **ADDS a requirement**; it does not correct code to match one that already exists. The
new requirement's obligation is the observable outcome, stated so that neither design option can
satisfy it vacuously: the pass reports lexical mode with a warning, **and** the affected documents
remain indexed and lexically searchable.

## Approach

Decisions taken here so later phases do not re-litigate them.

**1. The observable contract is fixed; the mechanism is not.** Any implementation must satisfy: (a)
`SyncReport.mode === "lexical"`, (b) `embeddingsWarning` set and non-empty, (c) affected documents in
`indexed`, not `skipped`, (d) their content retrievable by a lexical search afterwards. (c) and (d)
are what make the rejected fix fail, and they are as binding as (a) and (b).

**2. The warning's wording matches the existing family.** `SyncIndex` already emits two variants
(`"indexed without embeddings (provider unavailable): search runs in lexical mode"` and `"embeddings
unavailable (...): search runs in lexical mode"`). A third joins them and names the actual cause —
vectors could not be persisted — rather than reusing a message that blames the provider, which is
working. A user chasing this needs to know to look at sqlite-vec, not at transformers.js.

**3. The port doc is corrected in the same PR as the behaviour.** Splitting them leaves a window in
which the contract is wrong in a new way.

### The open design fork — `sdd-design` decides, this proposal does not

**A. Return a signal.** `upsertDocument` already returns `SavedDocument`; add a field
(`vectorsWritten: boolean`, or a richer status). `applyOne` reads it and sets `embeddingsWarning`. No
rollback risk, no transaction restructuring, and it repairs the port doc by making the second gate an
explicit part of the contract instead of an adapter secret.

**B. Never call `embed()` when vectors cannot be persisted.** `applyOne` asks the store up front and
skips embedding entirely, which also recovers the wasted CPU — the part of the defect the review
notes and does not address. Cost: a **new** port capability query. `hasVectors()` cannot be reused;
it is `!this.vectorsEnabled || !this.tableExists("chunks_vec") ? false : count > 0`, so it returns
`false` for a perfectly healthy fresh corpus that simply has no vectors yet. Repurposing it would
suppress embedding on every first run — turning a rare degradation into a universal one.

**A and B are complementary, not exclusive. A is load-bearing; B is an optimization on top of it.**
B alone still leaves `SyncReport.mode` lying unless a warning is also set. B alone also does not
address the fresh case above, if the probe confirms it. A alone does not address it either — the
throw precedes the return — which is why the `ensureVectorTable` guard is in scope independently of
the fork.

**C. Throw (the review's suggestion).** Rejected above, on the record.

One cost asymmetry that the exploration got backwards and that should inform the choice: **A moves no
test fake.** All three hand-rolled `IndexStore` implementations (`RecordingStore`, `ThrowingStore`,
`ReplaceThrowsStore`, all in `test/application/sync-index.test.ts`) are pure decorators that
`return this.inner.upsertDocument(...)`, so a new field on the return type flows through them and
they compile unchanged. **B moves all three**, one delegating method each — roughly nine lines. Both
are cheap; neither is the "every fake in the suite" cost the exploration warned about.

## Testability — explicit scope, not a discovery at apply time

`vectorsEnabled` is a `private` field assigned once in the constructor from `loadVectorExtension()`.
`SqliteIndexStore`'s constructor takes `(dbPath: string)` and nothing else. **There is no injection
seam, and consequently no test in the suite exercises the real `SqliteIndexStore` with
`vectorsEnabled === false`** — the exact condition this change is about is unreachable from the test
suite today.

The shape of the gap is sharper than "inconvenient", because of how the existing fakes are built:

- A **`SyncIndex`-level test is cheap** — the three decorators already exist and one can simulate the
  signal. But a decorator wrapping a real, healthy `SqliteIndexStore` can only *assert the plumbing*
  (signal in → warning out). It cannot demonstrate that the real adapter ever emits the signal.
- A **store-level test needs a seam that does not exist**. Without it, "the fix works" is a claim
  about the fakes, verified against a model of the adapter rather than the adapter.

This proposal does not pick the seam (constructor option, protected factory method, injected loader —
`sdd-design`'s call), but it does put the decision **in scope**: the design must either build a seam
and cover the real adapter, or record an explicit, argued refusal with the residual risk named. This
project has a documented history of green suites over broken behaviour, and of defects hiding inside
verification mechanisms rather than inside features; a fix for a silent failure that is itself only
verified against a simulation is precisely that pattern.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/ports.ts` | Modified | `upsertDocument`'s contract states the vector-availability condition and its observable outcome. Under A, `SavedDocument` gains a field; under B, `IndexStore` gains a capability query |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | Modified | `upsertDocument` signal or capability query; `ensureVectorTable`'s missing `vectorsEnabled` guard; possibly a test seam |
| `src/application/sync-index.ts` | Modified | `applyOne` sets `embeddingsWarning` on the degraded path. `mode` computation is unchanged — it already derives from the warning |
| `src/application/index-documents.ts` | **Unchanged — asserted** | Its two-call shape is already correct. An edit here means the fork drifted into the shared-write-path non-goal |
| `src/application/search-documents.ts` | **Unchanged — asserted** | Retrieval already degrades correctly when `hasVectors()` is false |
| `test/application/sync-index.test.ts` | Extended | New cases for the degraded path. Every existing case must pass **unmodified**; under B, three decorators gain one delegating method each |
| `test/infrastructure/sqlite-index-store.test.ts` | Extended | Store-level coverage of `vectorsEnabled === false`, contingent on the seam decision |
| `openspec/specs/indexing/spec.md` | Modified | One new requirement (+ scenarios) |
| `CLAUDE.md` | Modified | The graceful-degradation bullet currently reads "if the embeddings provider is missing or throws" and describes `IndexDocuments` only. Both halves are now too narrow |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The rejected fix is implemented anyway**, by someone working from the code-review document rather than this one. It is one line, it looks right, and it makes a test pass | **High** | Rejected on the record above with both proofs. Gate 2 asserts the document survives and stays lexically searchable — the assertion the throw cannot pass |
| **The change ships fixing only the carried-over case** while `sync` still skips every document on a fresh degraded install | **Resolved → now a scope requirement** | Gate 0 ran and both cases are confirmed. The `ensureVectorTable` guard is mandatory scope; Gate 5 asserts no vector-touching method reaches DDL without consulting `vectorsEnabled` |
| **The fix is verified only against fakes.** With no seam, the store-level half of the behaviour is asserted by a decorator that models what we believe the adapter does | **High** | Made an explicit scope decision, not an implicit one. Gate 4. This project has a recorded history of exactly this failure |
| **`hasVectors()` is reused as the capability query** under option B, because the name reads right | **Med** | Named in the fork with its exact implementation. It returns `false` for a healthy fresh corpus, so reuse suppresses embedding on every first run — a universal regression traded for a rare one. Gate 6 |
| **Scope creeps into unifying the `index` and `sync` write paths**, which is the tempting "real" fix | **Med** | Explicit non-goal with its reason. `src/application/index-documents.ts` is asserted unchanged |
| **The spec delta is written as a correction rather than an addition**, so the new requirement is folded into an existing reconciliation scenario and the store-side cause is never stated | Med | Required spec action names all five existing scenarios and why each fails to cover it |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`, and it is cheap for a structural reason: **the
change adds a signal, it does not change what gets written.** In the healthy case — sqlite-vec
loaded, which is every normal installation — the bytes written to `.compendio/` are identical before
and after.

1. Revert the change commits and `npm run build`.
2. **Nothing else.** No `.compendio/` deletion, no `compendio index` run, no config edit.

- **No schema change, no DDL change** beyond a guard on when an existing `CREATE ... IF NOT EXISTS`
  is attempted. `migrate()` and `reset()` are untouched.
- **No new data shape on disk.** A document indexed after the fix is byte-identical to one indexed
  before it.
- **No config key added**, so no project config can be left in a shape reverted code rejects.
- **No public path/ID shape change**, so `ejemplos/goldenset.yaml` and `compendio eval` are untouched.

The one residue is informational: a user who saw the new warning and knows their corpus is
lexical-only goes back, after a revert, to not being told. That is the pre-change state.

## Dependencies

- **Zero new npm dependencies.**
- **No new fixture corpus.** Existing instruments cover every gate: the three decorators in
  `test/application/sync-index.test.ts`, `SqliteIndexStore(":memory:")` (already constructed directly
  in ~60 places across the suite), `test/helpers/fake-embeddings.ts`, `test/fixtures/strict/`.
- **No model download required by any gate.** `FakeEmbeddings` is deterministic and offline.
- Gate 0 needs only `better-sqlite3` and `sqlite-vec`, both already installed.

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement
contradicting the reasoning — not on a tolerance band. A gate that cannot fail is not a gate.

### Gate 0 — The fresh case is measured before design settles (SATISFIED)

- [x] Both probe commands above were run; verbatim output is recorded in the two-cases table.
- [x] Case 1 throws (`no such module: vec0`), so the change covers it — a fix for case 2 alone does
      **not** ship.

**Result**: case 1 confirmed (throws, documents skipped), case 2 confirmed (no throw, silent drop).
The `ensureVectorTable` guard is therefore mandatory in this change, not optional hygiene, and no
design option may treat the fresh case as out of scope.

### Gate 1 — The degradation is reported (BLOCKING)

A sync pass over at least one new-or-changed document, against a store that cannot persist vectors,
with a working embeddings provider:

- [ ] `report.mode === "lexical"`.
- [ ] `report.embeddingsWarning` is present, non-empty, and names vector **persistence** as the cause
      rather than the embeddings provider.

**STOP condition.** `mode: "hybrid"` here is the defect verbatim.

### Gate 2 — The document survives, and stays searchable (BLOCKING)

Same pass, same conditions:

- [ ] Every affected document appears in `report.indexed`.
- [ ] **No** affected document appears in `report.skipped`.
- [ ] A subsequent lexical search returns content from those documents.

**This gate fails for the review's suggested fix** (`upsertDocument` throwing). If it ever passes
with a throwing `upsertDocument`, the gate is not measuring what it claims and must be fixed before
the change proceeds. The `ThrowingStore` case that currently asserts throw → `skipped` must still
pass unmodified, since a genuine hard write failure is still a skip.

### Gate 3 — `index` and `sync` agree in the same environment (BLOCKING)

The asymmetry is the reason the change exists, so it is asserted directly rather than implied:

- [ ] Against the same vector-less store and the same corpus, `IndexDocuments.execute()` and
      `SyncIndex.execute()` both report their lexical mode and both set a non-empty
      `embeddingsWarning`.

**STOP condition.** Either one reporting hybrid falsifies the fix.

### Gate 4 — The condition is reachable from the test suite (BLOCKING)

- [ ] At least one test drives the **real** `SqliteIndexStore` with `vectorsEnabled === false`
      through `upsertDocument` and asserts what the adapter does — not what a decorator simulates.

**STOP condition.** Waiving this is a scope reduction that belongs to the user, not a design-phase
convenience. If it is waived, the proposal is amended to state that every claim about the adapter's
degraded behaviour is a claim about fakes.

### Gate 5 — The contract and the adapter say the same thing

- [ ] `src/domain/ports.ts`'s `upsertDocument` documentation states the vector-availability condition
      and the observable outcome when it is not met.
- [ ] No remaining vector-touching method in `SqliteIndexStore` reaches DDL or a write without
      consulting `vectorsEnabled` — including `ensureVectorTable`.

### Gate 6 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] **Every** existing case in `test/application/sync-index.test.ts` passes with **no assertion
      modified**. Under option B, added delegating methods on the three decorators are permitted;
      changed expectations are not.
- [ ] `test/infrastructure/sqlite-index-store.test.ts`'s existing case *"writes embeddings for a
      brand-new document even before any compendio index run"* passes **unmodified** — the healthy
      lazy-creation path is exactly what a careless guard on `ensureVectorTable` breaks.
- [ ] `hasVectors()`'s behaviour is unchanged, and it is not used as the capability query.

### Gate 7 — No wasted embedding (conditional, only if option B is taken)

- [ ] A counting embeddings fake records **zero** `embed()` invocations for a pass in which vectors
      cannot be persisted.

If B is not taken, the wasted CPU is an accepted, recorded non-goal — stated in `design.md`, not left
as an unexplained omission.

## Resolved decisions

| Question | Decision |
|---|---|
| The review's suggested fix (throw from `upsertDocument`) | **Rejected**, with both proofs recorded. Transaction rollback + `applyOne`'s catch routing to `skipped` turn a silent degradation into a missing document |
| Observable outcome | **Fixed and non-negotiable**: lexical mode, warning set, documents indexed and lexically searchable. The mechanism is open; this is not |
| Port contract correction | **In scope, same PR as the behaviour.** The defect is a caller trusting a promise the port made |
| `ensureVectorTable`'s missing guard | **In scope**, independent of the fork's outcome and of Gate 0's result |
| Warning wording | **A third variant naming vector persistence**, not a reuse of a provider-blaming message |
| Unifying `index` and `sync` write paths | **Non-goal.** Both shapes have recorded reasons; this is a defect fix |
| Recovery for already-degraded corpora | **None needed.** Existing chunk-granular reconciliation fills the gaps once the extension works, with no user action |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Relationship to finding 1.1 | **Separate change** (`2026-08-14-config-value-validation`). Not bundled |
| Artifact store | **openspec** (file-based). Engram MCP tools unavailable this cycle |
| Test seam | **Open — but the decision itself is in scope**, to be made in `sdd-design` and recorded either way (Gate 4) |
| Design fork A / B | **Open.** A is load-bearing, B is an optimization on top of it, C is rejected. `sdd-design` decides |

## Delivery size — a decision for the `sdd-tasks` gate

| Driver | Estimate |
|---|---|
| `ports.ts` — contract doc + shape change | 10–25 |
| `sqlite-index-store.ts` — signal or capability query, `ensureVectorTable` guard | 15–35 |
| `sync-index.ts` — read the signal, set the warning | 10–20 |
| Test seam in `SqliteIndexStore`, if built | 5–20 |
| `sync-index.test.ts` — degraded-path cases (+ decorator methods under B) | 80–140 |
| `sqlite-index-store.test.ts` — store-level degraded coverage | 40–80 |
| `indexing` spec delta — one requirement + scenarios | 40–80 |
| `CLAUDE.md` | 10–20 |

**210–420 changed lines**, against a 400-line PR review budget. **One PR is the working assumption**,
with one honest caveat: this project's forecasts have landed 2–4x low for several cycles running
(`bounded-chunk-size` 240–420 → 773; `match-centred-excerpt` 300–470 → ~1 521). The load-bearing
difference here is that the source-code surface is genuinely three files and under 80 lines, with the
variance concentrated in tests and spec prose. If it overruns, the natural cut is **adapter + port
contract first** (independently testable, independently valuable), **`SyncIndex` wiring + spec
second**.

## Proposal question round (open — for the user, before `sdd-spec`)

Four product questions this proposal currently answers by assumption. Each names the assumption in
force, so silence is a valid answer and the change proceeds either way. A second round is available
if any answer moves the scope.

1. **Is a warning the right ceiling, or should a corpus that cannot persist vectors be louder?**
   Assumed: **a warning**, matching how every other degradation in this project behaves — lexical
   search is a genuinely useful fallback, not a broken state. The alternative is refusing to sync at
   all, which trades a silent quality drop for a hard stop on a machine whose only problem is a
   missing native extension. Consequence of the assumption: a user who never reads the summary line
   still gets degraded search, just no longer silently.

2. **Should the wasted embedding CPU be recovered in this change (option B), or is reporting the
   degradation enough for now?** Assumed: **B is optional**, decided in design on its merits. It is
   real cost — every changed document is embedded and thrown away, and on a cold model cache that
   includes a ~129 MB download for zero benefit. But it needs a new port method, and the reporting
   half is what makes the failure visible at all.

3. **How much should the test seam be worth?** Assumed: **build it** — a fix for a silent failure
   that is itself verified only against simulations is the pattern this project has been burned by
   before. But it means adding a test-only affordance to a production adapter, which the codebase has
   so far avoided. Is that trade acceptable, or is decorator-level coverage plus an explicitly
   recorded non-guarantee the right call?

4. **Is "how did sqlite-vec fail?" worth surfacing?** Assumed: **no, out of scope.**
   `loadVectorExtension` swallows the loader error entirely, so a user told "vectors could not be
   persisted" has no thread to pull. Naming the cause would make the warning actionable rather than
   merely honest — but it widens this change from a contract fix into a diagnostics change.
