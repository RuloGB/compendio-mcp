# Exploration: `manual-sync-command` — manual CLI trigger for incremental sync

**Phase**: explore · **Artifact store**: openspec · **Skill resolution**: none (no skill in
`.atl/skill-registry.md` applies to a TypeScript codebase exploration — `go-testing` is Go-only,
`branch-pr`/`issue-creation` are Gentle-AI workflow skills that do not apply to this repo).

## Answer to the primary question first

**No prior cycle considered and rejected a manual CLI trigger — it was never discussed at all, in
either direction.** The archived `openspec/changes/archive/2026-07-24-incremental-reindex/`
(proposal, design, exploration, tasks, archive-report) was read in full and grepped for
`manual|CLI command|compendio sync|sync command|trigger|alternative`. Every occurrence of "manual"
refers exclusively to *`compendio index`* as the thing incremental sync exists to make unnecessary
("without a manual `compendio index`", proposal.md:4; "edits/adds/deletes reflected… without a
manual command", design.md:18). The trigger design space that change actually debated was
startup-sync vs. throttled-poll vs. filesystem-watcher (exploration.md:180-192) — a manual CLI
subcommand for the *incremental* engine specifically was not one of the options weighed, not a
listed non-goal, and not an open question left for later.

**The proposal is therefore free to proceed as scoped**: there is no prior ruling to overturn or
reconcile, only a gap to fill.

## Current state (verified)

`SyncIndex.execute()` (`src/application/sync-index.ts:73-102`) already does everything the requested
command needs: `discover()` → diff by `path`+`hash` against `listDocuments()` →
`processNewAndChanged` (per-doc parse/chunk/embed/upsert) → `deleteMissingDocuments` →
`reconcileVectors` (chunk-granular vector-coverage gap-filling) → returns a `SyncReport`.

It is constructed unconditionally in `createContainer` (`src/composition.ts:117-120`) and exposed as
`container.syncIndex`, with the composition root's own comment already flagging it as "unwired from
any trigger by itself" (`composition.ts:48-49`). The only consumer today is `SyncScheduler`
(`src/application/sync-scheduler.ts`), used exclusively by `compendio serve` (`src/cli.ts:166`,
`src/server.ts:90,152,186`).

## A. What the existing specs already require

### `openspec/specs/indexing/spec.md`

| Requirement (line) | Impact |
|---|---|
| **Incremental Sync Triggers — Startup and Throttled Pre-Tool-Call Check** (353) | **Directly extended.** Currently enumerates exactly two triggers and is written as if exhaustive. Needs a new sibling requirement ("Manual Incremental Sync via `compendio sync`") or an explicit amendment naming a third trigger — otherwise the spec keeps describing a world where only `serve` can run a sync pass. |
| **Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents** (556) | **Must be reworded.** Says "an incremental **`serve`** sync pass alone MUST NOT be relied on" — wording tied to the one trigger that existed when it was written. |
| **Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents** (572, scenario at 579) | **Must be reworded**, same reason. |
| **Corrected Decoding Self-Heals via Incremental Sync** (247, scenario at 254) | **Must be reworded**, same class — "an incremental `serve` sync pass runs". *(Found during orchestrator verification; not in the original sub-agent sweep.)* |
| **In-Process Incremental Sync Concurrency Guarantee** (430) | **One scenario line.** Explicitly scoped to "Within a single `serve` process…", and its closing scenario (448) names only `compendio index` as the external-process case. A `compendio sync` run is *also* a separate OS process relative to a live `serve`; the scenario list needs a line stating this falls under the already-accepted "Concurrent Readers … Out of Scope" non-goal (257), not a new risk category. |
| **Fingerprint-Based Incremental Diff** (267), **Resolver Rejection on a Changed Known Document Deletes the Stale Row** (321), **Per-Document Upsert and Delete Without Orphaning or FTS Desync** (337) | **Unaffected.** Already trigger-agnostic ("an incremental sync pass runs"); they cover a CLI-triggered pass by construction. |

The three reworded requirements are the highest-value part of this change to get right. The
underlying claim — the fingerprint is the content hash alone, so unchanged documents keep stale
boundaries/headings — applies identically to a manual run, since it is literally the same
`SyncIndex.execute()` call. **A user reaching for `sync` specifically because it sounds faster than
`index` is the person most likely to be surprised that it silently does not apply a just-changed
`chunk.maxTokens` to unchanged content.**

### `openspec/specs/index-progress/spec.md`

**Four Reportable Phases With Synchronously-Known Denominators** (83) pins the per-file denominator
to `files.length`, "known immediately after discovery returns" (scenario at 89-91, verbatim). Written
for `IndexDocuments`, where every discovered file is always processed. Needs generalizing to "the
count of documents this phase will actually process, known before its first tick", so a sync pass's
`files/start.total` may legitimately differ from `files.length` without violating the requirement.

### `openspec/specs/configuration/spec.md`

`sync.throttleMs`'s requirement (199) is scoped to "the throttled sync check" — i.e. `SyncScheduler`.
Since a one-shot CLI command should bypass `SyncScheduler` (section C), **no amendment is needed** —
but CLI help text and README must state that the throttle does not gate the manual command, because a
user could reasonably and wrongly assume it does.

## B. Progress model feasibility

**Existing phases** (`src/domain/progress.ts`): `discovery` (`start` only, no total), `files`
(`start{total}` / `tick{current,total,path}`), `embedding` (`start{batches,chunks}` /
`download{loaded,total}` / `tick{current,total}` / `failed{reason}`).

### The "jumps to 100% then hangs" risk is real, and traced — not assumed

`SyncIndex.processNewAndChanged` (`sync-index.ts:110-160`) loops over *every* file in `files`; for a
hash match it does `continue` (`sync-index.ts:126-129`) with zero I/O (content is already in memory
from `discover()`) and **zero `await`**. Only a changed/new file reaches
`await this.embeddings.embed(...)` (line 147).

Because none of the hash-match iterations yield to the event loop, in a corpus where 3 of 500
documents changed the runtime races through all ~497 unchanged iterations synchronously, back-to-back,
before the loop ever suspends. A `files/tick` per file (mirroring `index-documents.ts:96`) would climb
to ~497/500 within a single event-loop tick — sub-millisecond — then stall for the duration of the 3
real embed calls. This is a direct consequence of the loop's own sync/async shape, not a
rendering-layer bug.

### Options

| Option | Denominator | New event kinds | Honesty |
|---|---|---|---|
| **A.** Reuse `files` phase, `total = files.length` | All discovered | None | Dishonest — reproduces the illusion above |
| **B.** Two-pass split: fast silent diff, then `files/start{total: toProcess.length}` | Changed set | **None** — reuses `discovery`/`files` verbatim | Honest — **recommended** |
| **C.** New dedicated "diff" phase with its own ticks | Same as B | Yes, a new `ProgressEvent` variant | No benefit over B: the diff sub-pass is CPU-only and typically finishes under `BAR_MIN_ELAPSED_MS` (1 500 ms), so its ticks would rarely render |

**Recommendation: Option B.** Splitting `processNewAndChanged` into (1) a fast synchronous diff
sub-pass building `toProcess: DocumentFile[]` + `hashMatchPaths`, then (2) the existing apply loop
restricted to `toProcess`, is a contained ~15-30 line refactor — no port change, no new `IndexStore`
method, no new `ProgressEvent` variant. The hash comparison is pure CPU work over already-read
content: no extra I/O, no second `discover()`.

Tick per document **after** its `upsertDocument` commits, mirroring `IndexDocuments`' own documented
convention for embedding ticks (`index-documents.ts:148-153`: "Reported AFTER the batch is embedded
and persisted… reporting it before the await made the bar read 100% at the exact moment the last —
and by far the most expensive — batch was about to start"). Because `SyncIndex` already deliberately
embeds-then-writes per document, **one `files` tick is also one unit of committed atomic work** —
progress granularity and data-consistency granularity line up for free.

`reconcileVectors` (`sync-index.ts:183-207`) maps onto the existing `embedding` phase shape
(`start{batches: groupCount, chunks: missingCount}` / `tick` per group) with no new event kind.
Deletions are DB-only and fast — no per-item ticks, just the final count in the CLI summary, matching
how `skipped` is not ticked today.

### Model-download progress comes free — verified, not assumed

`buildEmbeddingsOptions(onProgress)` (`composition.ts:144-150`) is composition-root-level and
unconditional on which use case is being built: whenever `createContainer({ …onProgress })` runs with
`forceLexical !== true`, `embeddings` is built as `new LazyEmbeddings(() =>
TransformersEmbeddings.create(…, buildEmbeddingsOptions(onProgress)))` (`composition.ts:70-78`), with
no reference to `IndexDocuments` anywhere in that path. A `sync` action passing
`onProgress: progress.onProgress` into `createContainer` gets the same nested download-progress
reporting `index` gets today, with zero new wiring.

## C. `SyncScheduler` interaction

**The CLI command should call `container.syncIndex.execute()` directly, not route through
`SyncScheduler`.** Two structural reasons:

1. **The throttle is moot for a one-shot process.** `lastRunAt` starts at `-Infinity`
   (`sync-scheduler.ts:26`) so the first call always fires — a CLI invocation *is* that first call,
   every time. Routing through the scheduler would add a dependency on `config.sync.throttleMs` with
   no observable effect.
2. **The scheduler's failure handling is actively wrong for a CLI.** `runTracked()`
   (`sync-scheduler.ts:67-80`) catches every error, logs to stderr, and returns normally — by design,
   so a background sync failure never breaks a tool call. A CLI command needs the opposite: a failed
   run should propagate to `cli.ts`'s top-level `.catch()` (`cli.ts:297-300`) exactly like
   `compendio index` does, because there is no "proceed against the current index" fallback — getting
   a definitive result is the entire point of running the command.

`startup()`'s in-flight dedupe and `maybeSync()`'s concurrent-caller guard protect a **long-lived**
process against overlapping tool-handler calls; a CLI command has no second caller within its own
lifetime.

**Output renderer is not reusable.** `SyncReport` carries `deleted: string[]` (`sync-index.ts:19`)
that `IndexReport` does not; `index`'s renderer (`cli.ts:53-68`) needs a new line for it.

## D. Justification check — is the first tool call genuinely blocked?

**Yes, confirmed precisely.** `cli.ts:166`'s `container.syncScheduler.startup()` is not awaited before
`server.connect(...)` (`cli.ts:169`), so the MCP `initialize` handshake is not blocked. But every one
of the three tool handlers begins with `await container.syncScheduler.maybeSync();` as its literal
first statement — `docs_overview` (`server.ts:90`), `search_docs` (`server.ts:152`), `read_doc`
(`server.ts:186`). `maybeSync()` (`sync-scheduler.ts:54-61`): if `inFlight !== null` — which it always
is immediately after `startup()`, since `runTracked()` assigns it synchronously before any `await` —
it awaits that same promise.

So the connection handshake is unblocked, but the **substantive response to the first tool call
genuinely waits for the startup sync pass**. The mechanism is `maybeSync()`'s in-flight-promise join,
not the transport layer. This is the strongest justification for the command: it moves a large pending
sync out of the agent's first `search_docs` call, where it reads as a hang, into an explicit
user-invoked step.

## E. Naming

**Recommendation: `compendio sync`, not `reindex`.** Evidence in both directions:

**For `sync`** — matches `SyncIndex`, `SyncReport`, `SyncScheduler`, `config.sync.throttleMs`
(`src/infrastructure/config.ts:34,66,108`), and the literal `"Sync:"` block label already rendered in
`docs_overview` and every tool response (`toSyncInfo`, `get-overview.ts:71-100`). A user has already
seen the word "Sync" in Compendio's own MCP output before this command would exist.

**Against `reindex`** — `index`'s own help text is `"Reindexes all documentation into
.compendio/compendio.db"` (`cli.ts:34`). The word "reindex" is *already claimed*, specifically for the
full-rebuild command. Naming the new command `reindex` would place it directly beside that description
and actively suggest it does the same thing — the exact hazard the reworded spec requirements exist to
prevent.

**Pre-existing tension worth flagging, not hiding.** The public README section is titled
`## Incremental reindex` (README.md:241) and its prose calls the mechanism "reindexing" throughout
(line 251), while the config key it documents is `sync.throttleMs`. The *code* vocabulary is `sync`;
the *public prose* vocabulary is loosely "reindex". This split pre-dates the change. The proposal
should decide explicitly whether to retitle that section, rather than let the split widen by adding a
`sync`-named command under a "reindex"-named heading.

**No collision with `serve`'s automatic sync** — they are literally the same operation
(`SyncIndex.execute()`), so connecting them is a correct mental model, not an ambiguity.

## F. Test surface

`strict_tdd: true` for this project, so tasks will need concrete test targets.

- **`test/application/sync-index.test.ts`** — 23 existing cases (new/changed/deleted diffing,
  chunk-granular vector reconciliation, read-failure subtree protection, resolver-rejection deletion,
  per-document embed-before-upsert atomicity, write-failure resilience). **Zero progress-emission
  tests.** New describe block, mirroring `test/application/index-progress.test.ts`:
  1. `discovery/start` fires first;
  2. **`files/start.total` equals the changed-file count, not `files.length`, when some documents are
     unchanged** — the assertion the whole Option B recommendation stands or falls on;
  3. ticks fire only for changed documents, after each commits;
  4. an all-unchanged pass reports `files/start.total: 0` with no ticks;
  5. `reconcileVectors`' `embedding`-shaped events are independent of the `files`-phase ones.
- **`test/application/sync-scheduler.test.ts`** — unaffected; the CLI bypasses the scheduler.
- **CLI tests** — `test/cli.test.ts` only unit-tests `parseType`, importing `src/cli.ts` directly; it
  never exercises `createContainer` or an action handler. `test/cli-subprocess.test.ts` is the only
  file that builds and spawns real `dist/cli.js`, precisely because `createContainer` appears **zero
  times** anywhere under `test/`. A wiring bug in the new action — forgetting `onProgress`, or
  routing through `syncScheduler` instead of `syncIndex` — would pass a fully green unit suite. The
  highest-value new test is a `cli-subprocess.test.ts` case running `compendio sync` against a real
  fixture corpus and **asserting stdout content** (indexed/deleted/skipped counts), not exit code
  alone — per this project's recorded gotcha that a broken entry-point guard exits `0` with empty
  stdout.
- **Sequencing under strict TDD**: `SyncIndex` progress-emission tests first (pure, in-memory, fast),
  then the CLI action plus its subprocess test.

## Recommendation

Proceed as scoped. Add `compendio sync` as a thin CLI action calling `container.syncIndex.execute()`
directly (bypassing `SyncScheduler`), reusing `createProgressSink`/`resolveProgressMode` exactly as
`index` does (`cli.ts:40-41`), after splitting `SyncIndex.processNewAndChanged`'s single loop into a
fast silent diff sub-pass plus an apply sub-pass over the changed set only (ticked, `files` phase,
`total` = changed count). No port change, no `IndexStore` change, no new `ProgressEvent` variant.
Vector-coverage reconciliation reuses the `embedding` phase shape unmodified. Name it `sync`.

**Spec deltas needed**: `indexing/spec.md` — new sibling trigger requirement; widen three requirements
from "`serve` sync pass" to trigger-agnostic wording (556, 572, 247); one scenario line on the
concurrency-guarantee requirement (430). `index-progress/spec.md` — generalize the denominator
requirement (83). `configuration/spec.md` — no change, but CLI help and README must state the throttle
does not gate the manual command.

## Risks

1. **The full-reindex-required rewordings are where a silent gap is dangerous, not merely awkward.**
   If dropped from scope, `compendio sync`'s help text and README entry could ship implying it is a
   faster `index` — reproducing exactly the confusion they exist to prevent. **Blocking for the
   proposal, not a follow-up.**
2. **The two-pass split's total must be verified against a genuine event-loop-yield case.** The
   failure mode depends on the loop's exact sync/async shape; a test using `FakeEmbeddings` (which
   resolves near-instantly) may not reproduce the illusion the way a real embedding call would. The
   `files/start.total` assertion is what actually guards this, independent of timing.
3. **`createContainer` blind spot.** Per this project's recorded pattern, a CLI wiring bug here passes
   a green unit suite. The subprocess test is not optional polish.
4. **README's "exactly three ways" claim** (README.md:243, verbatim, with a three-row table) becomes
   false the moment this ships and must be updated to four in the same change — easy to miss because
   it is prose, not a spec requirement.

## Ready for proposal

**Yes.** No prior-cycle ruling blocks this, the engine already exists and needs no port changes, and
the one genuinely open design risk named in the brief (the progress model) has a concrete, low-cost
answer rather than an open-ended one.

---

### Verification note (orchestrator)

Three sub-agent claims were independently re-checked against the repository before this artifact was
persisted, because the exploring agent is read-only and its findings gate the proposal:

- README.md:243 — "There are exactly three ways the index gets refreshed", verbatim, above a
  three-row table. **Confirmed.**
- All eight cited `### Requirement:` headings in `indexing/spec.md` exist at the exact line numbers
  quoted. **Confirmed.**
- `serve`-specific sync wording exists at `indexing/spec.md:254` and `:579`, and
  `index-progress/spec.md:89-91` pins the total to `files.length` verbatim. **Confirmed** — plus one
  additional occurrence (`indexing/spec.md:254`, "Corrected Decoding Self-Heals via Incremental
  Sync") that the sub-agent's sweep missed; it is folded into the table in section A above.
