# Proposal: `compendio sync` — a manual trigger for the incremental pass

Add one CLI command that runs a single incremental sync pass — reindexing only the documents whose
content changed — with the same progress reporting `compendio index` already has. The engine exists
and is already on the container (`SyncIndex`, `src/application/sync-index.ts:73-102`;
`src/composition.ts:117-120`, whose own comment calls it "unwired from any trigger by itself"). What
does not exist is a way for a person to run it.

## Intent

### The problem is not speed. It is *where the cost is paid*.

`compendio serve`'s startup sync is deliberately not awaited before the transport connects
(`cli.ts:162-169`), so the MCP `initialize` handshake is never blocked. But all three tool handlers
open with `await container.syncScheduler.maybeSync()` as their literal first statement
(`server.ts:90,152,186`), and `maybeSync()` joins whatever promise `startup()` assigned
(`sync-scheduler.ts:54-61`). **The substantive response to the agent's first tool call therefore waits
for the whole startup pass.**

That blocking is correct — README.md:247 states it as a feature, and answering against a cold index
would be worse. What is wrong is that there is no way to pay the cost *before* the agent asks. And
the place it gets paid is the one place Compendio cannot report anything:

- An MCP tool response has no progress channel. A `search_docs` call that takes 40 s is
  indistinguishable, from the agent's side, from a hung server.
- A long-lived `serve` process's stderr is invisible in most MCP clients — this project's own
  recorded reasoning, from `incremental-reindex`'s binding-decision table, and the reason sync status
  was folded into `docs_overview` in the first place.
- `serve` calls `createContainer({ root })` with **no** `onProgress` (`cli.ts:160`), so even the
  progress machinery that exists is dark there by construction.

The worst case is the first-contact one. Embeddings are lazy (`composition.ts:70-78`), so on a cold
model cache the ~129 MB download happens inside the first `embed()` call. A user who registers the
MCP server without ever running `compendio index` gets: whole-corpus indexing **plus** a 129 MB
download, inside their agent's first `search_docs`, with no output on any channel. `compendio sync`
moves exactly that work into a terminal, where the bar built by `index-progress-reporting` already
exists and is visible.

The cost is proportional to the pending change set — which is precisely the quantity nobody knows at
the moment `serve` starts.

### Why the speed argument is secondary, and partly misleading

"Faster than `index`" is not a property of the command; it is a property of the change set. Against
an unchanged corpus a sync pass costs a cheap diff; against a first run it costs the same as a full
index, plus the download. And framing the command as "the fast one" actively invites the single
failure this change exists to prevent (below). Speed is a consequence worth having, not the
justification.

### Why now

The engine has been sitting unwired since `incremental-reindex` shipped, and every trigger added
since has been automatic. Three of the `indexing` spec's requirements are currently written as if
`serve` were the only thing that can run a pass — a wording debt that is cheap to pay now, while the
requirements are still accurate, and expensive to pay later, when they will be actively wrong.

### The failure mode this change must not ship

**A user reaching for `sync` because it sounds like a faster `index`, and silently getting nothing.**
The change fingerprint is the document's content hash alone (`sync-index.ts:123-129`;
`indexing/spec.md`'s "Fingerprint-Based Incremental Diff"). A changed `chunk.maxTokens`, a change to
the splitting logic, or a change to how `heading` resolves does **not** reach a document whose bytes
did not change. Only `compendio index`'s `reset()` drop-and-recreate does.

That limit is already specified twice (`indexing/spec.md:556`, `:572`) and documented once
(README.md:255). All three are written against `serve`. Shipping a *manual* trigger without widening
them puts a command in a user's hands whose most likely reason for reaching for it is the one thing
it cannot do.

## Scope

### In Scope

- **`compendio sync`** — a new CLI command running exactly one incremental pass via
  `container.syncIndex.execute()`, **bypassing `SyncScheduler`** (Approach 1). Global `-C, --root`
  applies; `--lexical` is accepted, `--dir` is not (Approach 5).
- **Progress reporting at parity with `index`**: `resolveProgressMode` + `createProgressSink`
  (`cli.ts:40-41`), `onProgress` passed into `createContainer` so nested model-download reporting
  comes free (`composition.ts:144-150`, verified in exploration §B).
- **A two-pass split of `SyncIndex.processNewAndChanged`** (`sync-index.ts:110-160`) into a fast
  silent diff sub-pass and an apply sub-pass over the changed set only, so the `files` phase
  denominator is the **changed** count (Approach 2). **No new `ProgressEvent` variant.**
- **An output renderer for `SyncReport`**, which `index`'s (`cli.ts:53-68`) is not: `SyncReport`
  carries `deleted: string[]` that `IndexReport` has no counterpart for (`sync-index.ts:19`).
  Encoding notices, `skipped` and `embeddingsWarning` render exactly as `index` renders them.
- **The full-reindex caveat, surfaced where the user actually stands**: in `compendio sync --help`
  output *and* in the README (Approach 4).
- **Public vocabulary unified to "sync"** — explicit user decision, taken over the smaller diff.
  README.md:241's `## Incremental reindex` heading and its prose are brought to sync language;
  "reindex" / "full rebuild" stays reserved for `compendio index`, the command that actually drops
  and recreates. README.md:243's "exactly three ways the index gets refreshed" and its three-row
  table become four.
- **Spec deltas**: one new `indexing` requirement, three requirement rewordings, one scenario line,
  and one denominator generalization in `index-progress` (see "Required spec action").

### Out of Scope

| Item | Why |
|---|---|
| **An MCP tool surface for sync** | Every tool call already triggers a throttled pass (`indexing/spec.md:353`). A `sync` tool would be a second, redundant path to the same call, and this command exists for the human at the terminal — see question 1 |
| **Any change to `SyncScheduler`** | `serve`'s startup + throttle behaviour is unchanged, byte for byte. The CLI does not go through it (Approach 1), so the scheduler is not even read by this change |
| **Cross-process coordination between a manual `sync` and a live `serve`** | Declared non-goal, with its mechanism stated honestly rather than waved at the existing one — see Approach 6 and the Risks table |
| **A filesystem watcher** | Still the non-goal `incremental-reindex` declared. A manual trigger is the opposite of a watcher: explicit, on demand, dependency-free |
| **A new `ProgressEvent` variant, or a dedicated "diff" phase** | Exploration §B Option C. The diff sub-pass is CPU-only and typically finishes under `BAR_MIN_ELAPSED_MS` (1 500 ms), so its ticks would rarely render. Zero benefit over Option B, and it widens a domain type |
| **Per-item progress for deletions** | DB-only and fast. Reported as a final count, matching how `skipped` is not ticked today |
| **`--dir` on `sync`** | Not an omission — a data-loss guard. See Approach 5 |
| **Changing `docs_overview`'s `Sync:` block** | `toSyncInfo` (`get-overview.ts:71-100`) reports the *serving process's* last pass. A manual run in a different process legitimately does not appear there |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`). Nothing in this change touches the schema anyway |

## Capabilities

### New Capabilities

- None as a new spec domain. A manual trigger is a third member of an existing enumeration, not a new
  capability area.

### Modified Capabilities

- **`indexing`** — the trigger set grows from two to three; the "requires a full reindex" limits
  become trigger-agnostic; the external-process concurrency scenario list gains the manual-run case.
- **`index-progress`** — the per-file denominator is generalized from `files.length` to "the count of
  documents this phase will process, known before its first tick", without weakening what it
  guarantees for `IndexDocuments`.
- **`configuration`** — **no delta.** `sync.throttleMs`'s requirement (`configuration/spec.md:199`) is
  scoped to the throttled check, i.e. `SyncScheduler`, which this command bypasses. But CLI help and
  README MUST state that the throttle does not gate the manual command, because the shared name makes
  the opposite assumption entirely reasonable.

### Required spec action (not optional)

Drawn from the exploration's §A table, which the orchestrator re-verified line by line. Named by
exact heading so `sdd-spec` cannot miss one:

| File · line | Requirement heading | Action |
|---|---|---|
| `indexing/spec.md:353` | Incremental Sync Triggers — Startup and Throttled Pre-Tool-Call Check | **New sibling requirement** for the manual trigger. The existing one is written as an exhaustive enumeration of two |
| `indexing/spec.md:556` | Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents | **Reword.** "an incremental `serve` sync pass alone MUST NOT be relied on" → trigger-agnostic |
| `indexing/spec.md:572` (scenario `:579`) | Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents | **Reword**, same reason, scenario included |
| `indexing/spec.md:247` (scenario `:254`) | Corrected Decoding Self-Heals via Incremental Sync | **Reword**, same class. Found during orchestrator verification, missed by the first sweep |
| `indexing/spec.md:430` (scenario `:448`) | In-Process Incremental Sync Concurrency Guarantee | **One scenario line.** Its closing scenario names only `compendio index` as the external-process case; a manual `sync` is also a separate OS process |
| `index-progress/spec.md:83` (scenario `:87-91`) | Four Reportable Phases With Synchronously-Known Denominators | **Generalize the denominator.** `files.length` is pinned verbatim; a sync pass's total legitimately differs. The `IndexDocuments` scenario stays as-is; a sync scenario is added beside it |

Three requirements are explicitly **unaffected** and must not be touched: Fingerprint-Based
Incremental Diff (`:267`), Resolver Rejection on a Changed Known Document Deletes the Stale Row
(`:321`), Per-Document Upsert and Delete Without Orphaning or FTS Desync (`:337`). All three are
already trigger-agnostic and cover a CLI-triggered pass by construction.

## Approach

Stated as decisions with rationale, so later phases do not re-litigate them.

**1. The command calls `container.syncIndex.execute()` directly, not `SyncScheduler`.** Two
structural reasons, both from exploration §C. The throttle is moot: `lastRunAt` starts at `-Infinity`
(`sync-scheduler.ts:26`), so a one-shot process is always the first call — routing through the
scheduler would add a dependency on `config.sync.throttleMs` with no observable effect. And the
scheduler's failure handling is actively wrong here: `runTracked()` (`sync-scheduler.ts:67-80`)
catches every error, logs to stderr and returns normally, by design, so a background sync failure
never breaks a tool call. A CLI needs the opposite — a failed run must reach `cli.ts`'s top-level
`.catch()` (`cli.ts:297-300`) and exit non-zero, exactly like `index`, because there is no "proceed
against the current index" fallback. Getting a definitive answer is the whole point of typing the
command.

**2. The `files` denominator is the changed count, and that requires splitting the loop.**
`processNewAndChanged` iterates *every* discovered file; a hash match does `continue`
(`sync-index.ts:126-129`) with zero I/O and **zero `await`** — content is already in memory from
`discover()`. Only a changed file reaches `await this.embeddings.embed(...)` (`:147`). So with 3 of
500 documents changed, a naive per-file tick races through ~497 iterations inside a single event-loop
tick — sub-millisecond — then stalls for the three real embeds. The bar would read 99% and hang. That
is a consequence of the loop's own sync/async shape, not a rendering bug, and no renderer can fix it.

The split is a contained refactor: a synchronous diff sub-pass building `toProcess: DocumentFile[]`
plus the existing `hashMatchPaths` set, then the existing apply loop restricted to `toProcess`. The
denominator is **discovered documents whose `path` is unknown or whose hash differs** — including
those that will end up in `skipped`, because it must be known before the first tick to satisfy the
generalized `index-progress` requirement. Ticks fire **after** each `upsertDocument` commits,
mirroring `IndexDocuments`' documented convention (`index-documents.ts:148-153`) — and because
`SyncIndex` already embeds-then-writes per document, one tick is also one unit of committed atomic
work, so progress granularity and consistency granularity coincide for free.

**One thing the split must not drop.** The encoding-notice push (`sync-index.ts:120-121`) sits
*before* the hash check, so a transcoded document is reported **every pass, even when unchanged** —
required by `indexing/spec.md:231` ("to every consumer of the index/sync report") and by the type's
own comment (`sync-index.ts:26-29`). Moving that push into the apply loop is the natural,
wrong-looking-right refactor. It has **zero test coverage today**: `encodingNotices` appears nowhere
in `test/application/sync-index.test.ts`, and `get-overview.test.ts:133,171` exercises only
`toSyncInfo` against a hand-built fake report. See Gate 4.

`reconcileVectors` (`sync-index.ts:183-207`) maps onto the existing `embedding` phase shape
(`start{batches, chunks}` / `tick` per group) with no new event kind.

**3. `serve` is unaffected, and that is provable rather than asserted.** `serve` constructs its
container with no `onProgress` (`cli.ts:160`), and `SyncIndex`'s reporter will be optional exactly as
`IndexDocumentsOptions.onProgress` is (`composition.ts:98-100`). Progress emission added to
`SyncIndex` is therefore **inert under `serve` by construction**, not by care. Gate 3 pins it.

**4. The full-reindex caveat goes in both `--help` and the README, and the reasoning is different for
each.** `--help` is where the person who reached for `sync` because it sounded faster is standing at
the moment they are wrong; it is the only surface that reaches a user who reads no documentation. The
README is where the refresh table lives, and a table listing four triggers without saying which one
is authoritative is worse than three. Requirement: the caveat must be visible in `compendio sync
--help`'s own output, not only in the one-line entry of the top-level command list. It is **not**
printed on every successful run — see question 3.

**5. `--lexical` yes, `--dir` no.** These look symmetric with `index`'s two flags and are not.

`--lexical` is safe because the damage it does is self-healing. With `forceLexical`, `embeddings` is
`null`, changed documents are upserted with no vectors and `reconcileVectors` returns early
(`sync-index.ts:184`). On the *next* pass with a working provider those same documents hash-match, so
their chunks land in `listChunksMissingVectors()` and are filled chunk-granularly, with no user
action — the recovery path `indexing/spec.md:271` already specifies. It also keeps offline/hermetic
use possible, which is what the existing subprocess tests depend on.

`--dir` is a data-loss trap. It **replaces** `docsDir` (`composition.ts:63-66`), and
`deleteMissingDocuments` (`sync-index.ts:165-178`) deletes every persisted `path` absent from the
discovered set, protected only by that pass's `readErrors`. A dropped root produces no `ReadError`, so
`compendio sync --dir docs/adr` in a project indexed at `docs/` would purge the entire corpus, exit 0,
and print a cheerful `0 indexed, 42 deleted`. Under `index` the same flag is harmless because
`reset()` drops everything anyway — there, `--dir` is a scoping choice; here it would be silent
destruction. The flag is omitted, and `compendio sync --dir` must fail as an unknown option.

**6. Cross-process concurrency is a non-goal, stated with its actual mechanism.** The exploration
routes this to the existing "Concurrent Readers During `compendio index` Are Out of Scope"
(`indexing/spec.md:257`), which is the right *class* — external-process concurrency is already
accepted as best-effort. But that requirement's mechanism is `reset()`'s drop-and-recreate
transaction, and a manual `sync` performs no `reset()`, so its symptoms are different and the spec
line must say so rather than imply "no such table" errors. The database runs in WAL
(`sqlite-index-store.ts:86`) with better-sqlite3's default 5 000 ms busy timeout
(`node_modules/better-sqlite3/lib/database.js:34`), which permits one writer alongside readers. So a
manual `sync` racing a live `serve`'s own pass contends on short per-document write transactions and
may throw `SQLITE_BUSY`; in `serve` that is swallowed to stderr by design, and in the CLI it
propagates and exits non-zero. The supported answer is to retry. This is honest and bounded, not
hidden — see question 5.

**7. One uniform summary line, including the all-unchanged case.** `Synced 0 documents (0 chunks), 0
deleted in 14 ms [mode hybrid]` is unambiguous and greppable; a special-cased "already up to date"
branch buys a nicer sentence at the cost of two output shapes for one outcome. Exit code semantics
match `index` exactly: `skipped` documents are warnings on stderr and still exit 0; a thrown error
exits non-zero.

**7b. Reconciliation work is reported, not silently folded into a zero — scope expanded after design,
by explicit user decision.** `SyncReport.totalChunks` sums `indexed[].chunks` only
(`sync-index.ts:90`), so a pass that changes no document but fills vector-coverage gaps would print
`Synced 0 documents (0 chunks), 0 deleted` while doing real embedding work. Design recorded this as an
accepted honesty gap on the grounds that closing it needs a new `SyncReport` field, which this
proposal had scoped out.

**That reasoning was reversed on review.** This command's entire justification is making a hidden cost
visible; a summary line that reports `0` while the process embedded for thirty seconds reproduces the
exact failure mode the change exists to fix, in the one place the user reads after it finishes. The
live progress bar does show the embedding phase, which bounds the damage — but the bar is transient
and the summary is what remains on screen and in scrollback.

`SyncReport` therefore gains reconciliation counts, and the CLI reports them when non-zero. The
counts are already computed inside `reconcileVectors` for the `embedding`-phase denominator
(`{batches, chunks}`), so this is a plumbing change, not new measurement. Exact field shape and output
wording are settled in `design.md`; the spec delta pins the observable behaviour.

**8. A `sync` against a never-indexed project indexes everything.** No special case, and no branch:
this is the same path `serve`'s startup sync takes on an empty database, already specified
(`indexing/spec.md:369-373`). It is not `index` — no `reset()` runs, so nothing upgrades a
pre-existing schema. Named here because it is the shape question 2 asks about.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/application/sync-index.ts:110-160` | Modified | Two-pass split; optional `onProgress` on its options; `discovery`/`files` emission; `embedding`-shaped emission in `reconcileVectors`. The encoding-notice push must stay over **all** discovered files |
| `src/cli.ts` | Modified | New `sync` command + `SyncReport` renderer (incl. `deleted`); `--help` caveat text |
| `src/composition.ts:117-120` | Modified | Thread `onProgress` into `SyncIndex`'s options, mirroring `indexDocumentsOptions` (`:98-100`). The `syncIndex` field comment ("unwired from any trigger by itself", `:48-49`) is now false |
| `src/domain/progress.ts` | **Unchanged — asserted** | No new `ProgressEvent` variant. Only its module comment ("Progress event stream for `compendio index`") is stale. A type change here means Option C was taken, which is scoped out |
| `src/application/sync-scheduler.ts` | **Unchanged — asserted** | The CLI bypasses it (Approach 1). Any edit means the wrong path was wired |
| `src/infrastructure/sqlite/` · `src/domain/ports.ts` | **Unchanged — asserted** | No port change, no `IndexStore` method, no schema change |
| `test/application/sync-index.test.ts` | Extended | Every existing case must pass **unmodified** (the split is a refactor). New describe block for progress emission + the encoding-notice-on-unchanged case that does not exist today. **Count correction**: the exploration says 23 cases; the file holds **19** (measured 2026-08-12, `it(` occurrences). Gates must not hinge on the literal number |
| `test/cli-subprocess.test.ts` | Extended | The only file that spawns real `dist/cli.js`. New `sync` cases against the already-built `workdir` fixture; `:116`'s command list gains `sync` |
| `openspec/specs/indexing/spec.md` | Modified | One new requirement, three rewordings, one scenario line (see Required spec action) |
| `openspec/specs/index-progress/spec.md:83` | Modified | Denominator generalization + a sync scenario |
| `README.md:211-220, 241-255` | Modified | CLI table row; `## Incremental reindex` retitled and its prose brought to sync language; "exactly three ways" → four; the throttle-does-not-gate-`sync` note |
| `CLAUDE.md` | Modified | The two "requires a full `compendio index`" bullets and the MCP/CLI surface description |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The full-reindex rewordings get dropped or deferred**, and `sync` ships implying it is a faster `index` — reproducing exactly the confusion they exist to prevent | **High** | Blocking for this proposal, not a follow-up (exploration risk 1). Gate 5 asserts the caveat is in `--help` output; the spec deltas are enumerated by exact heading above so none can be quietly skipped |
| **A CLI wiring bug passes a fully green suite.** `createContainer` appears **zero** times under `test/`; `test/cli.test.ts` unit-tests `parseType` only. Forgetting `onProgress`, or wiring `syncScheduler` instead of `syncIndex`, is invisible to every unit test | **High** | Gate 2 runs the real spawned `dist/cli.js` and asserts **stdout content**, never exit code alone — this project's recorded gotcha is that a broken entry-point guard exits 0 with empty stdout |
| **The two-pass split silently drops encoding notices for unchanged documents**, violating `indexing/spec.md:231` with no test noticing — `encodingNotices` is asserted nowhere in the sync tests | **Med** | Gate 4, which is the only new test in this change that guards an *existing* documented behaviour rather than a new one |
| **The denominator ships as `files.length` anyway** (Option A), because it is one line and looks right | **Med** | Gate 1 is a single string assertion on a mostly-unchanged corpus: `Indexing 1 documents`, never `Indexing 5 documents`. Independent of timing, so a fast fake provider cannot mask it (exploration risk 2) |
| **`--dir` gets added for symmetry with `index`** in a later review pass, turning a scoping flag into a corpus wipe (Approach 5) | **Med** | The omission is a Resolved decision, with the mechanism written down. Gate 5 asserts `compendio sync --dir` fails |
| **`SQLITE_BUSY` against a live `serve`** — and the user most likely to run `sync` is exactly the one with `serve` running in their editor | **Med** | Non-goal, documented with its real symptom (Approach 6), not silently inherited from a requirement about `reset()`. Contention windows are short per-document transactions under WAL, but they are real. See question 5 |
| **Vocabulary unification widens beyond prose** and starts renaming config keys or response fields | Low | `sync.throttleMs`, `SyncReport` and the `Sync:` block are already sync-shaped. This change edits prose only; no config key, response field or identifier is renamed |
| **Size overrun.** This project's forecasts have landed 2-4x low for several cycles running | Med | Two-PR chain recommended from the start, below; `sdd-tasks` owns the final boundary |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`. This is the cheapest rollback of any recent
cycle in this repository, and the reason is structural: **the change adds a trigger, not a
transformation.** Every write `compendio sync` performs is a write `serve` was already performing
through the identical `SyncIndex.execute()` call.

1. Revert the change commits and `npm run build`.
2. **Nothing else.** No `.compendio/` deletion, no `compendio index` run, no config edit.

Why each residue class is empty:

- **No schema change and no DDL** — asserted in Affected Areas. `migrate()` and `reset()` are untouched.
- **No new data shape on disk.** A document indexed by a manual `sync` is byte-identical to one
  indexed by a `serve` pass; reverted code reads it with no knowledge that a CLI ever existed.
- **No config key added**, so no project config can be left in a shape reverted code rejects — the
  ordered-rollback hazard `multiple-doc-roots` had.
- **No public path/ID shape change**, so `ejemplos/goldenset.yaml` and `compendio eval` are untouched.

The one *behavioural* residue is a user habit: someone who stopped running `compendio index` because
`sync` was faster is, after a revert, back to a corpus that only `serve` refreshes. That is the
pre-change state, and the reworded requirements are what make it a documented one.

## Dependencies

- **Zero new npm dependencies.** No port change, no `IndexStore` method, no new domain type.
- **No new fixture corpus.** `test/fixtures/strict` (5 documents) plus the temp `workdir` that
  `test/cli-subprocess.test.ts:81-91` already builds and indexes in `beforeAll` is the whole harness
  Gates 1, 2, 4 and 5 need. Mutating one file in that workdir is the entire setup cost.
- **Existing instruments reused**: `createProgressSink` / `resolveProgressMode`, `COMPENDIO_PROGRESS`,
  the `FakeEmbeddings` stub, `--lexical` for hermetic offline runs.
- **No model download required by any gate.** Every gate runs lexical.

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement
contradicting the reasoning — not on a tolerance band (`CLAUDE.md`, Gate 2 precedent). A gate that
cannot fail is not a gate.

### Gate 1 — The denominator is the changed set, on a mostly-unchanged corpus (BLOCKING)

Against the 5-document `workdir` the subprocess suite already indexes, with exactly **one** document
edited afterwards, `COMPENDIO_PROGRESS=plain`:

- [ ] stderr contains `Indexing 1 documents`.
- [ ] stderr does **not** contain `Indexing 5 documents`.
- [ ] A second run with nothing edited reports a total of `0` and emits **no** `files` tick.

**STOP condition.** Reading `5` means Option A shipped and the progress bar lies on every real corpus.
This assertion is on the reported denominator, not on timing, so a fast fake provider cannot mask it.

### Gate 2 — The command works end to end through a real spawned `dist/cli.js` (BLOCKING)

Asserting **stdout content**, never exit code alone:

- [ ] An edited document's new content is returned by a subsequent `compendio search`, and the run's
      stdout names 1 document synced.
- [ ] A deleted document stops being returned, and stdout reports 1 deleted.
- [ ] A newly added document is returned, and stdout reports 1 indexed.
- [ ] `compendio sync` against a project with no `.compendio/` database indexes the whole corpus
      (Approach 8) and says so.

**STOP condition.** Exit 0 with empty stdout is this project's recorded shape for a broken CLI entry
path. `createContainer` has zero occurrences under `test/`, so no unit test covers this wiring.

### Gate 3 — `serve` and `index` are untouched (BLOCKING)

- [ ] **Every** existing case in `test/application/sync-index.test.ts` passes **unmodified** — all 19
      of them (measured; the exploration's "23" is wrong, so the gate is "none modified", not a
      count). The two-pass split is a refactor; a changed assertion means diffing semantics moved.
- [ ] `src/application/sync-scheduler.ts` and `src/domain/progress.ts`'s `ProgressEvent` union are
      unchanged (diff-asserted).
- [ ] The existing "stdout is identical across none/plain/bar modes" test for `index` still passes.
- [ ] `serve` emits no progress output: it wires no reporter, so `SyncIndex`'s new emission is inert
      there by construction (Approach 3).

### Gate 4 — A transcoded but unchanged document is still reported (BLOCKING)

- [ ] A CP1252 document whose hash matches the persisted value is reported in the pass's
      `encodingNotices`, and the CLI prints its transcoding warning.

**STOP condition.** This is required by `indexing/spec.md:231` today and has **zero** coverage today
(`encodingNotices` appears nowhere in the sync tests). It is the exact behaviour the natural version
of the Option B refactor deletes.

### Gate 5 — The caveat and the flags are where they were promised

- [ ] `compendio sync --help` output states that a full `compendio index` is still required after a
      chunking or heading-resolution change — in the command's own help body, not only as a one-line
      entry in the top-level list.
- [ ] `compendio --help`'s command list contains `sync` (extends `cli-subprocess.test.ts:116`).
- [ ] `compendio sync --dir <path>` exits non-zero as an unknown option (Approach 5).
- [ ] `compendio sync --lexical` completes and its documents are later vector-filled by a hybrid pass
      with no user action.

### Gate 6 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] README.md no longer claims "exactly three ways", its refresh table has four rows, and no prose
      in the retitled section calls the incremental mechanism "reindexing".
- [ ] No spec file still scopes a "requires a full reindex" limit to `serve` (grep for
      `serve` within those three requirements).

### Gate 7 — Reconciliation work is reported, and only when actually written (BLOCKING)

Added by the §7b scope decision, which arrived after this section was first written. **There are
seven gates, not six** — `sdd-tasks` and `sdd-verify` must carry all seven. Detailed criteria and
test mapping live in `design.md`'s Decision 9 and its gate table.

- [ ] A pass that changes no document but fills vector-coverage gaps reports the work it did, instead
      of `Synced 0 documents (0 chunks), 0 deleted`.
- [ ] **STOP condition** — the count must reflect work *written*, not attempted. A group whose embed
      throws, and a group whose write is rolled back, must each contribute **zero**. A count that
      includes a failed group replaces the lie this gate removes with a quieter one, and fails the
      gate.
- [ ] Reconciliation counts are never conflated with `indexed`; the two are reported separately.
- [ ] The ordinary no-reconciliation summary line is **byte-identical** to what it would have been
      without this field — a feature that does not apply must not perturb the common case.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Command name | **`sync`.** Matches `SyncIndex`/`SyncReport`/`sync.throttleMs` and the `Sync:` block users already see in tool output. `reindex` is already claimed by `index`'s own help text (`cli.ts:34`) |
| Public vocabulary | **Unified to "sync" in this change**, not deferred. "Reindex"/"full rebuild" reserved for `compendio index` |
| Trigger path | **`container.syncIndex.execute()` directly.** `SyncScheduler` bypassed: its throttle is moot and its error-swallowing is wrong for a CLI |
| Progress model | **Option B** — two-pass split, `files` denominator = changed count, **no new `ProgressEvent` variant** |
| Tick placement | **After each `upsertDocument` commits**, per `index-documents.ts:148-153`'s convention |
| Deletion progress | **Final count only**, no ticks. Matches how `skipped` is reported |
| `--lexical` | **Yes.** Self-heals via chunk-granular vector reconciliation on the next hybrid pass |
| `--dir` | **No.** It replaces `docsDir`, and an incremental pass would purge every document of the dropped roots with exit 0 |
| Failure behaviour | **Propagates and exits non-zero**, like `index`. `skipped` documents remain warnings with exit 0 |
| All-unchanged output | **The same uniform summary line**, not a special-cased "up to date" branch |
| Reporting reconciliation work | **In scope — user decision, reversing design's "accepted honesty gap"** (see 7b). `SyncReport` gains reconciliation counts and the CLI reports them when non-zero, so a vector-gap-only pass no longer prints `0 documents (0 chunks)` while embedding. Counts already exist for the `embedding` denominator; this is plumbing, not new measurement |
| Never-indexed project | **Indexes everything, no `reset()`.** Same path `serve` startup takes on an empty DB |
| Caveat placement | **`sync --help` and README.** Not printed on every run |
| MCP tool surface | **None — user-confirmed, not assumed** (question round Q1, answered before `sdd-spec`). Tool calls already trigger a throttled pass. `compendio sync` is a human escape hatch at the terminal; an agent cannot request a sync explicitly. The known consequence is accepted: an agent that notices stale answers can only tell the user to run something |
| Manual `sync` vs. live `serve` | **Non-goal**, documented with its real symptom (`SQLITE_BUSY` under WAL, 5 000 ms busy timeout), not with `reset()`'s |
| `configuration` spec | **No delta.** But help/README must say the throttle does not gate the manual command |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Artifact store | **openspec** (file-based). Engram MCP tools unavailable this cycle |

## Delivery size — a decision for the `sdd-tasks` gate

| Driver | Estimate |
|---|---|
| `sync-index.ts` — two-pass split, optional reporter, three emission points | 35–60 |
| `cli.ts` — command, `SyncReport` renderer, help text | 45–70 |
| `composition.ts` — thread `onProgress`, correct the stale field comment | 5–10 |
| `sync-index.test.ts` — progress describe block (5 cases) + the encoding-notice case | 120–180 |
| `cli-subprocess.test.ts` — Gates 2 and 5 | 90–140 |
| Spec deltas — `indexing` (1 new + 3 rewordings + 1 scenario), `index-progress` (1 + scenario) | 120–200 |
| `README.md` — CLI row, retitle, prose, four-row table | 40–70 |
| `CLAUDE.md` | 10–25 |

**465–755 changed lines**, against a 400-line PR review budget. Cleared at the low end only.

**Corrected honestly**: this project's forecasts have landed 2–4x low for several cycles running
(`bounded-chunk-size` 240–420 → **773**; `match-centred-excerpt` 300–470 → **~1 521**;
`incremental-reindex` missed by 2x). Applying that pattern puts this at **700–1 200 by apply**. One
PR is not a safe assumption.

**Recommended chain — 2 slices**, with a real reason for the cut rather than an arbitrary split:

- **PR 1 — the engine.** The two-pass split, optional `onProgress` on `SyncIndex`, the composition
  thread, the progress + encoding-notice tests, and the `index-progress` delta. **Inert in
  production**: nothing wires a reporter into `SyncIndex` yet, so the slice is behaviour-preserving
  for `serve` and provable as such (Gate 3). Same "primitive first, trigger second" cut
  `incremental-reindex` used for its store-layer work.
- **PR 2 — the surface.** The CLI command and renderer, the subprocess gates, the `indexing` deltas,
  README and `CLAUDE.md`.

One non-negotiable sequencing constraint: **the vocabulary unification and the README's four-row
table land in PR 2, with the command** — never earlier. A README documenting `compendio sync` before
`compendio sync` exists is worse than the pre-existing vocabulary split it fixes.

## Proposal question round (open — for the user, before `sdd-spec`)

Five product questions this proposal currently answers by assumption. Each names the assumption in
force, so silence is a valid answer and the change proceeds either way. A second round is available
if any answer moves the scope.

1. ~~**Who is this command for — the person at the terminal, or the agent?**~~ **ANSWERED — the
   person.** A human-only CLI escape hatch is the intended shape; the agent keeps syncing only via
   startup and the throttled pre-tool-call check, exactly as today. No fourth MCP tool. The
   consequence is accepted with eyes open: an agent that notices its answers are stale cannot fix it,
   only report it. Rationale recorded at decision time — the MCP surface is three tools with
   deliberately tuned progressive disclosure, and this project has already observed `docs_overview`
   going uncalled in practice, so a fourth tool the agent ignores would dilute routing without
   closing the gap. Revisit only with evidence that the CLI command is insufficient.

2. **When `sync` runs against a project that was never indexed, should it index everything or refuse
   and point at `compendio index`?** Assumed: **index everything** — it is literally what `serve`
   startup does on an empty database. Consequence: a user can adopt `sync` as their only command and
   never once run a `reset()`, which makes them precisely the population most exposed to the
   stale-boundaries trap this change is widening the warnings for.

3. **How loud should the full-reindex caveat be?** Assumed: **in `sync --help` and the README, not
   printed on every run.** The alternative — one line on every successful run — is the only surface
   that reaches a user who reads neither. Cost: a permanent caveat on a command people will run
   dozens of times a day, which is how warnings become invisible. Is help-plus-README enough?

4. **Where exactly does "reindex" stop being allowed?** Assumed: **`compendio index` keeps it
   exclusively** — full rebuild, drop-and-recreate — and every reference to the incremental mechanism
   becomes "sync", including README.md:255's "Only a full rebuild applies new chunking to unchanged
   files". Config keys, response fields and identifiers are untouched, since they are already
   sync-shaped. Confirm that boundary, or name a term that should survive.

5. **Is "retry" an acceptable answer for a manual `sync` racing a live `serve`?** Assumed: **yes**,
   as a declared non-goal. But the user most likely to run `sync` is the one with `serve` running in
   their editor — the two are not independent events. Under WAL with a 5 000 ms busy timeout the
   window is short, and the failure is a loud non-zero exit rather than corruption. Is a rare
   `SQLITE_BUSY` acceptable, or should the command detect a running `serve` and say something
   useful instead?
