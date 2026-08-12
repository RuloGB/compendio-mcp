# Design: `compendio sync` — a manual trigger for the incremental pass

## Revision note — 2026-08-12 (reconciliation reporting brought into scope)

The first version of this design closed with an **accepted honesty gap**: a pass that changed no
document but filled vector-coverage gaps would print `Synced 0 documents (0 chunks), 0 deleted` while
embedding for seconds, because `SyncReport.totalChunks` sums `indexed[].chunks` only
(`sync-index.ts:90`). It was accepted on scope grounds — closing it needed a new `SyncReport` field,
which the proposal had scoped out.

**Reversed by explicit user decision** (proposal §7b, and the new `Reporting reconciliation work` row
in its `## Resolved decisions` table). The reasoning that overturned it is not about cost: this
command's entire justification is making a hidden cost visible, so a summary line reporting `0` while
the process embedded for thirty seconds reproduces the exact failure mode the change exists to fix, in
the one place the user reads after it finishes. The live bar does show the embedding phase, which
bounds the damage — but the bar is transient and the summary is what stays in scrollback.

**Confirmed after re-reading the code: the reversal is cheap, and my scope objection dissolves.** The
counts already exist at the point they are needed, no new store call or measurement is introduced, and
`replaceEmbeddings` turns out to be atomic per group (`sqlite-index-store.ts:286-291`), so "work
actually written" is exactly expressible. Roughly 20 production lines plus tests.

**Changed by this revision, by name:** Decision 3 (`reconcileOne` now records what it wrote, and takes
the provider as a parameter), Decision 8 (a conditional second stdout line, and the renderer is
extracted — with its earlier rejection narrowed rather than deleted), **new Decision 9** (the report
shape and the output contract), plus the Interfaces, Flow notes, asserted-unchanged, Testing Strategy
and Gate-mapping sections. Superseded reasoning is recorded rather than quietly overwritten, per this
project's practice.

## Technical Approach

**The whole change is one structural move, and everything else follows from it: `processNewAndChanged`
stops being one loop that decides *and* does, and becomes a synchronous sub-pass that decides
followed by an awaiting sub-pass that does.** Once the decision is complete before the work starts,
the `files` phase has a denominator that means something (`changed.length`, not `files.length`), one
tick becomes one committed document, and no new `ProgressEvent` variant is needed — the existing
`discovery` / `files` / `embedding` phases already describe the resulting shape exactly.

```
cli.ts  "sync" action
  │  mode     = resolveProgressMode(COMPENDIO_PROGRESS, stderr.isTTY)        cli.ts:40 pattern
  │  progress = createProgressSink(mode, process.stderr)                     cli.ts:41 pattern
  │
  └─ withContainer({ forceLexical, onProgress: progress.onProgress }, …)     cli.ts:172-191, unchanged
        │
        └─ createContainer
              ├─ embeddings  = LazyEmbeddings(… buildEmbeddingsOptions(onProgress))  :70-78  UNCHANGED
              │                └─ model-download reporting already comes free here
              ├─ syncIndexOptions = { chunking, noChunking }                          NEW
              │  if (onProgress !== undefined) syncIndexOptions.onProgress = onProgress   NEW, mirrors :99
              └─ syncIndex = new SyncIndex(source, parser, store, embeddings, policy, syncIndexOptions)
                                                                                     :117-120 modified
        └─ await container.syncIndex.execute()      ← NOT syncScheduler (proposal Approach 1)
```

| Question the change owns | Answer | Where |
|---|---|---|
| How does the `files` denominator become the changed count | the loop splits; the total is known before the first `await` | Decision 1 |
| What stops the split from dropping encoding notices | the notice push stays in the sub-pass that iterates **all** discovered files | Decision 1 |
| Why does `current` always reach `total` | exactly one tick call site, outside the per-document body | Decision 2 |
| Which phase covers the per-document embed | `files` — the `embedding` phase is reserved for reconciliation | Decision 3 |
| What does an all-unchanged pass render | `files/start { total: 0 }`, no ticks, no ratio — already handled | Decision 5 |
| How does `onProgress` reach `SyncIndex` under `exactOptionalPropertyTypes` | the same two-hop conditional `IndexDocuments` uses | Decision 6 |
| What makes `--dir` fail loudly | it is never registered; commander's default rejects it | Decision 7 |
| How reconciliation work stops reporting as a zero | `SyncReport` gains a per-document `reconciled` array, appended only after the write commits | Decision 9 |

`src/domain/ports.ts` is **unchanged**. `src/domain/progress.ts`'s `ProgressEvent` union is
**unchanged** (only its stale module comment is corrected — Gate 3 scopes the assertion to the union).
No `IndexStore` method, no schema change, no new npm dependency. `src/domain/` gains nothing that
touches SQLite, transformers.js or the filesystem (`openspec/config.yaml`, `rules.design`).
`SyncReport` gains exactly one field (Decision 9); `IndexReport` and `compendio index`'s stdout are
byte-identical, **verified in code rather than reasoned from the name** — `listChunksMissingVectors`
and `replaceEmbeddings` each have exactly one production caller, both in `sync-index.ts` (`:186`,
`:200`), so a full reindex has no reconciliation phase to report.

### Findings that correct the inputs

Recorded up front rather than buried, per this project's practice. Each was checked against the file,
not carried on trust from the brief.

| Claim in the brief / proposal | Verified state |
|---|---|
| "check `progress-sink.ts` for a division or percentage computation that a zero total would break" | **No such computation exists, anywhere.** `progress-sink.ts` contains no arithmetic on `total` at all. Every denominator guard lives in `progress.ts` and is explicit: `progressRatio` returns `null` when `state.total <= 0` (`:189`), `renderDetail` drops the count when `state.total <= 0` (`:198`), `renderBar` sets `filled = 0` when `ratio === null` (`:231`), `formatPlainLine` drops the `[i/N]` prefix when `event.total <= 0` (`:155-157`), and `createDownloadThrottle` returns `false` when `total <= 0` (`:249`). `progress.ts:26` states the contract in words: *"0 means the phase's denominator is degenerate: render no ratio."* A zero total is a designed-for input, not a hazard. See Decision 5 |
| `SyncReport.encodingNotices`' doc comment is at "lines 26-30" | The comment is `sync-index.ts:26-29`; `:30` is the field. The quoted text is correct |
| `cli.ts`'s `finish()`-ordering comment is at "48-51" | `finally {` is `:48`, the comment `:49-51`, `progress.finish()` `:51`… precisely: comment `:49-51`, call `:51`. Cite the block as `cli.ts:48-52` |
| "`test/cli-subprocess.test.ts`'s already-built `workdir` … mutating one file in that workdir is the entire setup cost" (proposal, Dependencies) | **Understated.** Four existing cases assert against that fixture's exact state (`Indexed 5 documents` `:132`, the `guide-service-onboarding.md` hit `:141`, the draft deny-list pair `:144-165`, and three progress cases asserting `Indexing 5 documents` `:185`). Editing, adding or deleting a document in `workdir` couples the new cases to declaration order. A second temp dir costs one `cpSync` plus one `index --lexical` run. See Testing Strategy |
| "the project's recorded blind spot: … `typecheck` is blind to `test/`" | **Already fixed.** `package.json:35` runs `tsc --noEmit && tsc -p tsconfig.test.json`, and `tsconfig.test.json` includes `test/**/*` while inheriting `exactOptionalPropertyTypes: true`. New test helpers must therefore use the same conditional-assignment dance as production code |
| "`createContainer` appears zero times under `test/`" | **No longer true**, and the correction matters for how much the subprocess gates have to carry. `test/application/goldenset-addresses.test.ts` was added by `multiple-doc-roots` (its Decision 14) and calls `createContainer` — but only for `indexDocuments`. **No test constructs a container and touches `container.syncIndex`**, so the sync wiring specifically is still uncovered, and Gate 2 is still not optional |

Gate 3's count is confirmed: `test/application/sync-index.test.ts` holds exactly **19** `it(` cases
(measured 2026-08-12), matching the proposal's correction of the exploration's "23".

## Architecture Decisions

### Decision 1: the loop splits into `diff` (synchronous, silent) and `applyChanged` (awaiting, ticked) — and the encoding-notice push stays in `diff`

**Choice.** `processNewAndChanged` (`sync-index.ts:110-160`) becomes a three-line orchestrator over two
private methods:

```ts
private async processNewAndChanged(files, existing, encodingNotices, state): Promise<void> {
  const changed = this.diff(files, existing, encodingNotices, state);   // synchronous, no events
  this.report({ phase: "files", kind: "start", total: changed.length });
  await this.applyChanged(changed, state);
}
```

`diff` returns `ChangedFile[]`, carrying the hash forward so no file is hashed twice:

```ts
interface ChangedFile { file: DocumentFile; hash: string; known: boolean }
```

`known` is the boolean the apply sub-pass actually consumes — `existingDoc !== undefined`, the
resolver-rejection-deletes-the-stale-row rule (`sync-index.ts:134-136`). Carrying the whole
`IndexedDocument` would hand the apply sub-pass a value it has no use for.

**The statement inventory, so there is nothing to re-derive at apply time.** Every line of today's
loop is accounted for:

| Today | Sub-pass | Why there |
|---|---|---|
| `existingByPath` map (`:116`) | `diff` | only the diff consults it |
| `noticeByPath` map (`:117`) | `diff` | only the diff consults it |
| `for (const file of files)` (`:119`) | `diff` | this is the loop over **all** discovered files |
| notice lookup + `state.encodingNotices.push` (`:120-121`) | **`diff`** | the whole point — see below |
| `computeHash(file.content)` (`:123`) | `diff` | it *is* the fingerprint |
| `existingByPath.get(file.path)` (`:124`) | `diff` | |
| hash match → `hashMatchPaths.add` + `continue` (`:126-129`) | `diff` | |
| *(new)* `changed.push({ file, hash, known })` | `diff` | |
| *(new)* `files/start { total: changed.length }` | boundary | the denominator, known with zero `await`s behind it |
| `transformFile(...)` (`:131`) | `applyChanged` | |
| resolver-rejection skip + `tryDelete(..., false)` (`:132-138`) | `applyChanged` | consumes `known` |
| embed / `embeddingsWarning` (`:140-151`) | `applyChanged` | the only `await` in the whole method |
| `upsertDocument` + `indexed.push` (`:153-158`) | `applyChanged` | |
| *(new)* `files/tick` | `applyChanged` | after the above — Decision 2 |

**Why the notice push must be in `diff`, stated three ways because it is the one thing this design
cannot get wrong.**

1. **The requirement.** `indexing/spec.md:233` — a transcoded document MUST be reported *"to every
   consumer of the index/sync report … even when the transcoded content is byte-for-byte the string a
   correct decoder would have produced anyway."* The type's own comment says the same in operational
   terms (`sync-index.ts:26-29`): *"surfaced every pass, even when the document's hash is unchanged,
   since `discover()` decodes every file on every pass regardless of whether it ends up re-indexed."*
2. **The mechanical reason it is `diff` specifically, not merely "sub-pass 1".** `diff` is the only
   sub-pass that iterates every discovered file. `applyChanged` iterates the changed set, which by
   construction **excludes hash-matched documents** — precisely the population the requirement is
   about. Putting the push in `applyChanged` would not weaken the guarantee; it would delete exactly
   the case the guarantee exists for and leave the other case working, which is the shape of a defect
   that survives review.
3. **Nothing in the suite would notice.** `encodingNotices` appears in five test files
   (`composite-document-source`, `file-document-source`, `index-and-search`, `generate-index-md`,
   `get-overview`) and in **none** of them is it asserted through a `SyncIndex` pass;
   `get-overview.test.ts` exercises `toSyncInfo` against a hand-built report literal. Verified
   2026-08-12.

**The wrong refactor, named so a reviewer can spot it.** Lines 119-158 read as one per-file unit, so
the natural move is to lift the whole body into `applyChanged` and have `diff` only compute hashes.
Observable symptom if it ships: a CP1252 document that has not been edited since the last pass stops
being reported. The user is never told to re-save it, and the warning reappears only if they happen to
touch the file for an unrelated reason. Every count in the report stays correct. **Gate 4 is the only
new test in this change that guards behaviour that already exists.**

**Why the split is cheap and safe.** The hash comparison is pure CPU over content already in memory
from `discover()` — no second discovery, no extra I/O, no `await` introduced or removed. The 19
existing cases in `test/application/sync-index.test.ts` are the falsifier: this is a refactor, and a
changed assertion means diffing semantics moved (Gate 3).

**Rejected — Option A, `total: files.length` with a tick per discovered file.** One line, and it
reproduces the illusion the change exists to remove: with 3 of 500 documents changed, ~497 iterations
complete inside a single event-loop tick (there is no `await` on the hash-match path — `:126-129`),
so the bar reaches 99% in under a millisecond and then stalls for three real embeds. No renderer can
fix a denominator that counts work nobody is going to do.

**Rejected — Option C, a dedicated `diff` phase with its own `ProgressEvent` variant.** The diff
sub-pass is CPU-only and finishes well under `BAR_MIN_ELAPSED_MS` (1 500 ms, `progress.ts:43`) on any
corpus this project has measured, so its ticks would essentially never render. It widens a domain
type to report a phase nobody sees.

### Decision 2: exactly one `files/tick` call site, outside the per-document body — so `current` always reaches `total`

**Choice.** The per-document work moves into a private `applyOne`, and the loop owns the tick:

```ts
private async applyChanged(changed: ChangedFile[], state: PassState): Promise<void> {
  const total = changed.length;
  for (const [i, entry] of changed.entries()) {
    await this.applyOne(entry, state);
    this.report({ phase: "files", kind: "tick", current: i + 1, total, path: entry.file.path });
  }
}
```

`applyOne` contains today's body verbatim, with its two `continue` statements becoming `return`.

**Two properties this shape guarantees structurally rather than by discipline.**

- **The tick fires after the unit of work, never before.** Mirrors `IndexDocuments`' documented
  convention (`index-documents.ts:148-153`: *"Reported AFTER the batch is embedded and persisted …
  reporting it before the await made the bar read 100% (N/N) at the exact moment the last — and by far
  the most expensive — batch was about to start"*). Here it is stronger than a convention: `SyncIndex`
  already embeds-then-commits per document (`:147` then `:154`, one `upsertDocument` transaction), so
  **one tick is also one unit of committed atomic work.** Progress granularity and consistency
  granularity coincide for free.
- **`current` reaches `total` on every pass, including one where every document fails.** The
  denominator counts documents the phase will *process*, which includes those that will end up in
  `skipped` (a resolver rejection, an `upsertDocument` throw). If the tick lived inside `applyOne`,
  each of its three exits would need its own tick, and a `continue` past one of them would leave the
  bar frozen at, say, 7/9 with the run already over. Hoisting the call above the branching makes that
  unrepresentable.

**Rejected — tick inside the loop body with a shared `current` counter and three increment sites.**
It is what the current code shape invites, and it converts an invariant into three places to remember.

**Rejected — exclude skipped documents from the denominator.** Then the total is not knowable before
the first tick (whether a document will be skipped is only decided by `transformFile`, inside the apply
sub-pass), which is the exact property the generalized `index-progress` requirement demands.

### Decision 3: the apply sub-pass emits `files` events only; the `embedding` phase belongs to `reconcileVectors`

**Choice.** `applyOne`'s per-document `embed()` call (`sync-index.ts:147`) emits **no** `embedding`
event. `reconcileVectors` (`:183-207`) is the only `embedding`-phase producer in `SyncIndex`:

```ts
private async reconcileVectors(state: PassState): Promise<void> {
  const embeddings = this.embeddings;   // narrowed once here; passed to reconcileOne as a parameter
  if (embeddings === null) return;
  const missing = this.store.listChunksMissingVectors()
    .filter((chunk) => state.hashMatchPaths.has(chunk.path));
  const groups = [...groupByPath(missing)];
  if (groups.length === 0) return;                                          // Decision 4
  this.report({ phase: "embedding", kind: "start", batches: groups.length, chunks: missing.length });
  for (const [i, [path, chunksMissing]] of groups.entries()) {
    await this.reconcileOne(embeddings, path, chunksMissing, state);        // records what it WROTE
    this.report({ phase: "embedding", kind: "tick", current: i + 1, total: groups.length });
  }
}
```

Same shape as Decision 2: one tick site, after the work, so a group whose embed throws (today's
`continue` at `:197`, now a `return` inside `reconcileOne`) still advances the counter.

**Why the provider is a parameter rather than `this.embeddings!`.** TypeScript narrows
`this.embeddings` across the loop today because the field is `private readonly` and the guard is in
the same function body (`sync-index.ts:184`, then `:192`). Extracting the group body into
`reconcileOne` loses that narrowing, and a non-null assertion is precisely the kind of thing a
reviewer should reject in a class whose whole `embeddings === null` branch is load-bearing. Narrowing
once and passing the value keeps the assertion out of the code.

**`batches`/`chunks` here are *attempted*, and the report's counts are *written*. They are the same
numbers only on a clean pass.** The proposal's "the counts are already computed for the
`embedding`-phase denominator, so this is plumbing" is right about the source data, not about the
aggregation point. A progress denominator MUST be known before the first tick — that is the
`index-progress` requirement this design is generalizing — so it can only ever be what the phase is
about to attempt. A report states what happened. They diverge exactly when a group fails, which is
the case Decision 9 exists to get right.

**Why the apply sub-pass does not also emit `embedding` events.** `advanceProgress` switches
`state.phase` on every event (`progress.ts:91-146`). Interleaving `files/tick` and `embedding/tick`
per document would thrash the bar's label between `Indexing documents` and `Embedding chunks` on every
single document, and would double the event count for one unit of work. The `files` phase already *is*
the embedding progress for the apply sub-pass, because one tick means one document embedded **and**
committed.

**One group = one "batch", and that is honest enough.** `groupByPath` (`:229-237`) groups by document,
so `formatPlainLine` renders `Embedding 7 chunks in 3 batches` where "batches" means "documents whose
vector gaps are being filled". The unit differs from `IndexDocuments`' fixed `batchSize` of 16, but the
field's meaning — *the number of awaits this phase will perform* — is identical, which is why no new
event kind is needed.

**The model-download interleave already works, and needs no wiring.** On a cold cache the ~129 MB
download happens inside the first `embed()` of the apply sub-pass, i.e. while `state.phase` is
`files`. `advanceProgress`'s `download` case spreads the current state and forces
`phase: "embedding"` (`progress.ts:133-139`), and `progressRatio` gives `download` priority
(`:186-188`), so the bar shows the download percentage. The next `files/tick` returns a **freshly
built** state object with `download: null` (`:99-105`), so the bar returns to file progress with no
residue. This is the same recovery the `embedding/tick` comment documents for `IndexDocuments`
(`progress.ts:117-125`) — verified to apply unchanged to the `files` branch. `buildEmbeddingsOptions`
(`composition.ts:144-150`) is composition-root-level and use-case-agnostic: passing `onProgress` into
`createContainer` is the entire wiring, exactly as for `index`.

### Decision 4: two events `IndexDocuments` emits that `SyncIndex` deliberately does not

**Choice.** `SyncIndex` emits **no `embedding/failed`, ever**, and emits **`embedding/start` only when
there is at least one group to reconcile.**

**No `embedding/failed`.** In `IndexDocuments` the embedding failure is terminal for the phase — the
`catch` at `index-documents.ts:157` exits the whole batch loop, so `failed` is genuinely the phase's
last word and the reason belongs on screen. In `SyncIndex` neither failure site is terminal: the
per-document one (`:148-150`) commits the document lexical-only and carries on, and the reconcile one
(`:195-198`) skips one group and carries on. Emitting `failed` would hijack the bar's label
(`advanceProgress`'s `failed` case sets `label: event.reason`, `progress.ts:140-143`) for exactly one
event before the next tick overwrites it, and under `plain` mode would repeat the same line once per
group. The report's `embeddingsWarning` is the correct channel; the CLI prints it as a `WARNING` line
**after** `progress.finish()` has cleared the bar (Decision 8).

**No empty `embedding/start`.** `IndexDocuments` reports the phase unconditionally because its
embedding phase always runs. In `SyncIndex`, reconciliation does nothing on the overwhelmingly common
pass, and announcing `Embedding 0 chunks` on every run says "embedding" when nothing is embedded —
the same family of dishonesty as a denominator counting work nobody will do, in miniature. A phase
that does no work does not start. This does not weaken the generalized `index-progress` requirement,
which constrains *when a denominator must be known*, not *that every phase must always start*.

Consequence, stated so verify does not have to find it: a `--lexical` sync emits **zero** `embedding`
events (`reconcileVectors` returns at `:184`), and so does a hybrid sync with full vector coverage.

### Decision 5: an all-unchanged pass emits `files/start { total: 0 }` and no ticks — and every renderer already handles it

**Choice.** `files/start` fires unconditionally, even with `total: 0`. No branch, no special case.

**What it renders, read out of the code rather than assumed:**

| Mode | Output | Path through the code |
|---|---|---|
| `plain` | `Indexing 0 documents`, then nothing | `formatPlainLine`'s `files`/`start` branch is unconditional (`progress.ts:154`) |
| `bar` | `[------…]  1.6s Indexing documents` — no percentage, no `0/0` | `advanceProgress` → `{ total: 0 }` (`:97`); `progressRatio` → `null` (`:189`); `renderBar` → `percent = ""`, `filled = 0` (`:224,231`); `renderDetail` → ` Indexing documents` with no count (`:198`) |
| `none` | nothing | the sink short-circuits (`progress-sink.ts:51-53`) |

**There is no division by zero to guard against.** See the corrections table above: `progress-sink.ts`
performs no arithmetic on `total`, and every guard is already explicit in `progress.ts`, which states
the contract in a comment at `:26`. This was checked rather than inferred, because the brief flagged
it as a suspected failure mode.

**Why `files/start` fires at all rather than being suppressed when the changed set is empty.** It is
the only positive signal that the pass ran and found nothing. Suppressing it would make an
all-unchanged pass indistinguishable, on stderr, from a pass that never reached the `files` phase.
Gate 1's third bullet asserts exactly this pair: a total of `0` **and** no `files` tick.

### Decision 6: `SyncIndexOptions extends PipelineOptions`, wired with the same two-hop conditional as `IndexDocuments`

**Choice.** One new exported interface in `src/application/sync-index.ts`:

```ts
export interface SyncIndexOptions extends PipelineOptions {
  /** Optional progress observability hook; a no-op by default. Left unset by
   * `serve`, which constructs its container with no `onProgress`
   * (`cli.ts:160`) — so every emission added here is inert under `serve` by
   * construction, not by care. */
  onProgress?: ProgressReporter;
}
```

`SyncIndex`'s sixth constructor parameter changes type from `PipelineOptions` to `SyncIndexOptions`.
`this.options` continues to be passed straight to `transformFile(..., options: PipelineOptions, ...)`
— structurally valid, since the extra property travels on a variable rather than an object literal.
A private `report(event: ProgressEvent)` calling `this.options.onProgress?.(event)` mirrors
`index-documents.ts:164-166` verbatim.

**Composition (`composition.ts:117-120`) mirrors `:98-99` line for line:**

```ts
const syncIndexOptions: SyncIndexOptions = { chunking: config.chunk, noChunking: NO_CHUNKING };
if (onProgress !== undefined) syncIndexOptions.onProgress = onProgress;
const syncIndex = new SyncIndex(source, parser, store, embeddings, policy, syncIndexOptions);
```

The conditional assignment is not style: `exactOptionalPropertyTypes: true` (`tsconfig.json:11`)
forbids writing `onProgress` into an `onProgress?: ProgressReporter` slot when the value's type
includes `undefined`. This is hop 1 of the same two-hop pattern the existing comment at
`composition.ts:138-143` names; hop 2 (`buildEmbeddingsOptions`) is untouched.

**`composition.ts:48-49`'s field comment becomes false and is corrected in the same commit.** It
currently reads *"Incremental diff engine (unwired from any trigger by itself — see `syncScheduler`,
which is what `cli.ts`/`server.ts` actually call)"*. Replacement: name both triggers —
`syncScheduler` for `serve`, and `cli.ts`'s `sync` action calling `execute()` directly.
`src/domain/progress.ts`'s module comment (*"Progress event stream for `compendio index`"*, `:2`) is
stale for the same reason and is corrected to name both commands. Gate 3 scopes its diff assertion to
the `ProgressEvent` **union**, so a comment edit is in bounds — stated here so verify does not read it
as a violation.

**Rejected — put `onProgress` on `PipelineOptions` directly.** `PipelineOptions` is the *transform*
contract consumed by `transformFile`, which must never report anything. Note that
`IndexDocumentsOptions` deliberately duplicates `chunking`/`noChunking` rather than extending
`PipelineOptions` — but it also carries `embeddingBatchSize`, which is meaningless for a per-document
embedder. Extending is right here precisely because `SyncIndex` adds exactly one field and forwards
the rest untouched.

**Rejected — reuse `IndexDocumentsOptions` for `SyncIndex`.** It would put a batch-size knob on a use
case that has no batches, and couple two use cases through a type neither of them owns.

### Decision 7: `--dir` is rejected by never existing, and the `sync` command sets `showHelpAfterError`

**Choice.** The `sync` command registers `--lexical` and nothing else. `compendio sync --dir docs/adr`
is then rejected by commander's own default — verified in the installed version rather than assumed:
`_allowUnknownOption` defaults to `false` (`node_modules/commander/lib/command.js:28`),
`unknownOption()` builds `error: unknown option '--dir'` (`:2147`) and calls `error()` (`:2148`), which
writes to stderr and exits `1` (`:1952-1969`, `_exit` at `:534-540`). Commander is `^15.0.0`
(`package.json:49`). No guard code is written, and there is no flag object for a later reviewer to
"just wire up".

**The one line that makes the bare error useful.** Commander prints the error and nothing else — no
usage, no help. So the `sync` command sets:

```ts
.showHelpAfterError('(run "compendio sync --help" for the accepted options)')
```

`showHelpAfterError` exists in this version (`typings/index.d.ts:604`) and, given a string, appends
exactly that line after the error (`command.js:1958-1959`). It is a **per-command** setting read off
`this` inside `error()`, so `index`'s error output is untouched — which matters for Gate 3's "nothing
else moved". The `--help` body then explains *why* the flag is absent (below).

**Why the flag is absent at all, restated in one line because the asymmetry with `index` is the whole
point.** `--dir` **replaces** `docsDir` (`composition.ts:63-66`). Under `index` that is harmless —
`reset()` drops everything anyway, so `--dir` is a scoping choice. Under an incremental pass the
dropped roots produce no `ReadError`, so `deleteMissingDocuments`' `isProtected` check
(`sync-index.ts:171-177`, `:225-227`) protects nothing and every one of their documents is deleted as
absent from disk — with exit 0 and a cheerful `Synced 0 documents (0 chunks), 42 deleted`.

**The residual hazard, named.** The guard depends on `--dir` remaining a per-subcommand option. If a
future change promotes it to a global option on `program`, commander's non-positional matching would
accept `compendio sync --dir x` silently. Gate 5's third bullet is what detects that, and it is a
subprocess assertion for exactly that reason.

**Rejected — register `--dir` and throw a specific, explanatory error.** Better message, worse shape:
the flag appears in `--help` and therefore looks supported, and a registered option is one
`hideHelp()`/`if` removal away from being real. The explanation belongs in the help body, which is
durable, not in an error only the person who already typed it will see.

### Decision 8: the CLI action mirrors `index`'s, prints a count for deletions rather than paths, and renders through one pure function

**Choice.** The action mirrors `index`'s (`cli.ts:32-71`) statement for statement — same mode
resolution, same sink, same `finally { progress.finish() }` ordering, same three `console.warn` loops
— and differs only in what it renders at the end, which goes through one pure exported function:

```ts
program
  .command("sync")
  .description("Runs one incremental sync pass: reindexes only the documents whose content changed")
  .option("--lexical", "sync without embeddings (lexical search only)")
  .addHelpText("after", SYNC_HELP_NOTES)
  .showHelpAfterError('(run "compendio sync --help" for the accepted options)')
  .action(async (options: { lexical?: boolean }) => {
    const mode = resolveProgressMode(process.env["COMPENDIO_PROGRESS"], process.stderr.isTTY === true);
    const progress = createProgressSink(mode, process.stderr);
    await withContainer(
      { forceLexical: options.lexical, onProgress: progress.onProgress },
      async (container) => {
        let report: Awaited<ReturnType<typeof container.syncIndex.execute>>;
        try {
          report = await container.syncIndex.execute();
        } finally {
          progress.finish();           // before any console.warn — cli.ts:48-52's reason, unchanged
        }
        for (const s of report.skipped)  console.warn(`WARNING ${s.path}: ${s.errors.join("; ")}`);
        for (const n of report.encodingNotices ?? []) console.warn(`WARNING ${formatEncodingNotice(n)}`);
        if (report.embeddingsWarning !== undefined) console.warn(`WARNING ${report.embeddingsWarning}`);
        for (const line of formatSyncSummary(report)) console.log(line);    // Decision 9
      },
    );
  });
```

```ts
/**
 * stdout for a completed sync pass: the summary line, plus a conditional line
 * per additional finding. Pure, and exported for direct unit testing, in the
 * same spirit as `parseType` below — the reconciliation line is unreachable
 * from any hermetic subprocess run (it needs a real embeddings provider), so
 * this is the only seam that can execute it in CI. See Testing Strategy.
 */
export function formatSyncSummary(report: SyncReport): string[] {
  const lines = [
    `Synced ${report.indexed.length} documents (${report.totalChunks} chunks), ` +
      `${report.deleted.length} deleted in ${report.durationMs} ms [mode ${report.mode}]`,
  ];
  if (report.reconciled.length > 0) {
    const chunks = report.reconciled.reduce((sum, doc) => sum + doc.chunks, 0);
    lines.push(`Filled ${chunks} missing chunk vectors across ${report.reconciled.length} documents.`);
  }
  if (report.skipped.length > 0) {
    lines.push(`Skipped ${report.skipped.length} documents with invalid frontmatter.`);
  }
  return lines;
}
```

`withContainer` (`cli.ts:172-191`) is **unchanged**: it already accepts `forceLexical` and `onProgress`
and already performs the `!== undefined` guards `exactOptionalPropertyTypes` requires.

**The output cases, pinned exactly** (`N` is a real duration; nothing else varies):

| Case | stdout | stderr |
|---|---|---|
| Documents changed | `Synced 3 documents (47 chunks), 0 deleted in N ms [mode hybrid]` | progress only |
| Nothing changed | `Synced 0 documents (0 chunks), 0 deleted in N ms [mode hybrid]` | `Discovering documents` / `Indexing 0 documents` under `plain` |
| Vector gaps filled only | the summary line, then `Filled 47 missing chunk vectors across 3 documents.` | `Embedding 47 chunks in 3 batches` + ticks |
| Mixed (changed **and** gaps) | `Synced 2 documents (18 chunks), 0 deleted in N ms [mode hybrid]`, then `Filled 5 missing chunk vectors across 1 documents.` | both phases |
| Documents skipped | the summary line, then `Skipped 2 documents with invalid frontmatter.` | one `WARNING <path>: <errors>` per skip |
| Embeddings degraded | the summary line with `[mode lexical]` | `WARNING indexed without embeddings (provider unavailable): search runs in lexical mode` |

Order when both conditional lines fire: summary, then `Filled`, then `Skipped` — work accounted for
before exceptions, and `Skipped` stays last, where `index` already puts it.

**The all-unchanged case gets no branch** (proposal Approach 7, a Resolved decision). One shape is
greppable; two shapes for one outcome is a parsing hazard for anyone scripting it. Note that a
conditional **additional** line is not a second shape for the same outcome: `Skipped N documents with
invalid frontmatter.` is already exactly that, in this same function (`cli.ts:66-68`), and the summary
line itself is emitted unconditionally and identically in every case above. Decision 9 argues why the
reconciliation counts go on their own line rather than inside the summary.

**`documents` is not pluralized, and that is deliberate.** `Synced 1 documents` matches
`Indexed 1 documents`, which `cli-subprocess.test.ts:132` already asserts. Consistency across the two
commands beats grammar; fixing one without the other would be worse than fixing neither.

**Deletions are a count, not a list.** stdout in this CLI is a summary channel — `index` prints one
line plus an optional skipped line, and no command has ever emitted per-document output. A large
cleanup pass would flood it. The paths are recoverable (`compendio overview`, or the user's own `git
status`), and a deletion under `sync` means the file is genuinely gone from disk. If a future cycle
wants the list it belongs behind a flag, not on the default line.

**Superseded by the revision — the renderer IS extracted, but the original objection is narrowed, not
dropped.** The first version of this decision rejected `formatSyncSummary` outright, on the grounds
that it buys a test which cannot fail for the reason that matters: this project's recorded failure is
*wiring* invisible to a green suite, not string formatting, and a passing formatter test beside a
broken `container.syncIndex` wiring is exactly the false-green shape Gate 2 exists to catch.

**That argument holds only against extraction as a *substitute* for the end-to-end gate.** It does not
hold against extraction *alongside* it, and Decision 9 introduces a branch that no hermetic
subprocess run can reach — filling a vector gap requires a real embeddings provider, and no CLI flag
injects a fake one. Left inline, `Filled …` would be a line of production code that never executes in
CI: the precise "green suite, invisible function" shape this repository has recorded before.

So the narrowed principle, stated so it can be applied again rather than re-argued: **extract only
what no end-to-end gate can reach, and do not weaken the end-to-end gates when you do.** Gates 2's
S3-S6 still spawn real `dist/cli.js` and assert stdout content, unchanged; the pure function only adds
coverage for the branch they cannot enter. Exporting from `cli.ts` for testing is an established
pattern in this file — `parseType` carries the comment *"Exported for direct unit testing"*
(`cli.ts:201-209`).

`index`'s renderer stays inline and untouched: `IndexReport` has neither `deleted` nor `reconciled`, so
there is nothing to share and `compendio index`'s stdout is byte-identical (Decision 9).

**Failure semantics, differing from `serve`'s on purpose.** Nothing is caught. A thrown error reaches
`cli.ts:297-300`'s top-level `.catch()` and exits 1. This is the opposite of `SyncScheduler.runTracked`
(`sync-scheduler.ts:67-80`), which swallows every error to stderr so a background pass can never break
a tool call. `skipped` documents stay warnings with exit 0, exactly as under `index`.

**Help body (`SYNC_HELP_NOTES`), ASCII only, matching every other string in `cli.ts`.** It answers the
three questions a user of this command will actually have, in the order they will have them — and
carries both Gate 5's caveat and the proposal's `configuration`-spec obligation ("CLI help and README
MUST state that the throttle does not gate the manual command"):

```
What a sync pass does NOT do:
  Only documents whose file content changed are reindexed. Changing
  chunk.maxTokens, the splitting logic, or how a chunk heading is resolved does
  NOT reach a document whose bytes are unchanged. Run "compendio index" for
  that -- it drops and rebuilds the whole index.

The throttle does not apply here:
  sync.throttleMs gates only the automatic pre-tool-call check inside
  "compendio serve". Every "compendio sync" invocation runs a full pass.

Why there is no --dir:
  --dir replaces the configured docsDir. Under an incremental pass every
  document of the dropped roots would be treated as absent from disk and
  deleted. Use "compendio index --dir" if replacing the corpus is what you want.
```

### Decision 9: `SyncReport.reconciled` is a per-document array of **committed** work, rendered on its own conditional line

**Choice.** One new exported type and one new non-optional field:

```ts
/** One document whose missing chunk vectors were filled AND COMMITTED during
 * this pass's vector-coverage reconciliation. Never records an attempt: a
 * group whose embed throws, or whose `replaceEmbeddings` throws, contributes
 * nothing here (see `reconcileOne`). */
export interface ReconciledFileReport {
  path: string;
  /** Chunk vectors written for this document — `replaceEmbeddings` commits the
   * whole group in one transaction, so this is exact, never a partial count. */
  chunks: number;
}

export interface SyncReport {
  …
  /** Documents whose vector-coverage gaps were filled this pass. Empty on the
   * overwhelmingly common pass; never absent. */
  reconciled: ReconciledFileReport[];
  …
}
```

`PassState` gains the matching `reconciled: ReconciledFileReport[]`, initialized to `[]` alongside
`indexed`/`skipped`/`deleted` (`sync-index.ts:78-84`), and copied into the report beside them
(`:91-98`) — not through the conditional-assignment path `embeddingsWarning`/`encodingNotices` use.

**The single push site, which is the whole "written, not attempted" contract:**

```ts
private async reconcileOne(
  embeddings: EmbeddingsProvider, path: string,
  chunksMissing: ChunkMissingVector[], state: PassState,
): Promise<void> {
  let vectors: Float32Array[];
  try {
    vectors = await embeddings.embed(chunksMissing.map((c) => `passage: ${c.heading}\n${c.content}`));
  } catch (error) {
    state.embeddingsWarning = `embeddings unavailable (${describeError(error)}): search runs in lexical mode`;
    return;                                              // nothing embedded -> nothing counted
  }
  try {
    this.store.replaceEmbeddings(
      chunksMissing.map((c, i) => ({ chunkId: c.chunkId, embedding: vectors[i]! })),
    );
    state.reconciled.push({ path, chunks: chunksMissing.length });   // ONLY after the write returns
  } catch (error) {
    state.skipped.push({ path, errors: [describeError(error)] });    // nothing written -> nothing counted
  }
}
```

**Both failure paths verified in the code, not inferred, because a count that included them would be a
new and quieter lie in place of the one being removed:**

| Path | Today | Written? | Counted? |
|---|---|---|---|
| `embed()` throws (`sync-index.ts:195-198`) | sets `embeddingsWarning`, `continue` | no | no — `return` precedes the push |
| `replaceEmbeddings` throws (`:203-205`) | pushes to `skipped` | **no** — see below | no — the push is inside the `try`, before the `catch` |
| both succeed | — | yes, all of `chunksMissing` | yes, exactly `chunksMissing.length` |

**`chunks: chunksMissing.length` is exact rather than optimistic, and that had to be checked.**
`replaceEmbeddings` (`sqlite-index-store.ts:277-293`) wraps the **entire** `items` array in a single
`this.db.transaction(...)` (`:286-291`), so better-sqlite3 rolls the whole group back on any throw:
there is no partial-write state in which the group succeeded for some chunks and not others. Its two
pre-transaction throws — `vectorsEnabled` false (`:279-281`) and `ensureVectorTable` (`:283`) — also
write nothing. Had the transaction been per item, this field would have had to count the loop's
successful iterations instead, which would mean a port change. It does not.

**Why an array of per-document rows, and not a count or a pair of counts.** `SyncReport`'s three
collection fields — `indexed: IndexedFileReport[]`, `deleted: string[]`, `skipped:
SkippedFileReport[]` — are all non-optional arrays of per-item outcomes, defaulting to `[]`; the CLI
counts them at render time. `reconciled` is the same kind of thing and gets the same shape, so both
counts the output needs (`reconciled.length`, and the `chunks` sum) derive from one field that cannot
drift out of step with itself. Two flat scalars would be two fields that must always move together
with nothing enforcing it.

**Why non-optional, when `encodingNotices` — also a collection — is optional.** `encodingNotices` is
optional on `SyncReport` because it is optional on `DiscoverResult` (`ports.ts:37-40`, *"Optional so
existing in-memory `DocumentSource` fakes compile unchanged"*): an inherited port constraint, not a
principle about reports. `reconciled` is computed entirely inside `SyncIndex` and has no upstream
`undefined` to mirror. Non-optional also removes an `?? []` from every consumer and the
conditional-assignment dance from `execute()`. Cost: `reconciled: []` added to the two
`fakeReport(overrides: Partial<SyncReport>)` factories in the suite
(`test/application/get-overview.test.ts:7-11`, `test/application/sync-scheduler.test.ts:5-9`) — two
lines, in two files, neither of which is a Gate 3 subject.

**Rejected — reuse `IndexedFileReport`.** It carries `title`, which is not available here:
`ChunkMissingVector` is `{ chunkId, path, heading, content }` (`ports.ts:85-90`), so filling `title`
means a `getDocumentByPath` round-trip per group to populate a field nothing renders.

**Rejected — fold reconciled chunks into `totalChunks`.** It would make `(N chunks)` mean two
different things in one number, and it would silently redefine a field that already ships.

**Rejected — put the counts inside the summary line** (`…, 0 deleted, 47 revectorized in N ms …`). A
conditional mid-line segment breaks any regex anchored on the existing `deleted in \d+ ms` tail, so
the common case would be perturbed by a feature that does not apply to it. The separate line satisfies
"must not perturb the common case" literally: the summary is byte-identical when
`reconciled.length === 0`.

**`docs_overview` is unaffected, and that is deliberate.** `toSyncInfo` (`get-overview.ts:71-82`)
reads only `skipped`, `embeddingsWarning` and `encodingNotices`, and its content-based omission rule
(`:75`) is unchanged by a new field — so a pass whose only finding is reconciliation still renders no
`Sync:` block. Correct: `SyncInfo` is a warnings channel for an agent, not a work log, and the
proposal scopes `docs_overview` changes out. A future cycle that wants it there changes `toSyncInfo`,
not this field.

**`compendio index` is untouched — verified, not assumed.** `listChunksMissingVectors` and
`replaceEmbeddings` have exactly one production caller each, both in `sync-index.ts` (`:186`, `:200`);
`IndexDocuments` uses `saveDocument` + `saveEmbeddings` and embeds everything inline after a
`reset()`. A full reindex is structurally incapable of leaving a vector-coverage gap for the same run
to fill, so `IndexReport` gains nothing and `index`'s stdout does not move by a byte. No scope
surprise here.

## Flow notes

Per `rules.design`. Line numbers are current, pre-change.

**One sync pass, 5 documents discovered, 1 changed, 1 deleted from disk, no vector gaps:**

```
cli.ts "sync" action
  └─ SyncIndex.execute()                                              sync-index.ts:73
        ├─ report discovery/start                                     NEW, mirrors index-documents.ts:82
        ├─ await source.discover()            → files[5], readErrors[], encodingNotices[]     :75
        ├─ store.listDocuments()              → existing[6]  (synchronous; still "discovery")  :76
        ├─ diff(files, existing, notices, state)              NEW sub-pass, synchronous, SILENT
        │     ├─ push every discovered file's encoding notice          <-- Decision 1, all 5 files
        │     ├─ 4 hash matches → state.hashMatchPaths
        │     └─ 1 changed      → changed[1]
        ├─ report files/start { total: 1 }                    NEW      <-- the denominator, 0 awaits behind it
        ├─ applyChanged(changed, state)
        │     └─ applyOne  → transformFile → await embed → upsertDocument (one transaction)
        │        report files/tick { current: 1, total: 1, path: "docs/b.md" }   NEW, AFTER the commit
        ├─ deleteMissingDocuments(...)                        SILENT, no ticks   :87 / :165-178
        │     └─ state.deleted = ["docs/gone.md"]             → surfaces in the CLI summary only
        └─ reconcileVectors(state)                                              :88 / :183-207
              └─ groups.length === 0 → return, ZERO embedding events            <-- Decision 4

stderr (COMPENDIO_PROGRESS=plain):     stdout:
  Discovering documents                  Synced 1 documents (12 chunks), 1 deleted in 480 ms [mode hybrid]
  Indexing 1 documents
  [1/1] docs/b.md
```

**An all-unchanged pass (Gate 1, third bullet):**

```
discovery/start → discover() → listDocuments() → diff → changed[]  (empty)
files/start { total: 0 }        ← fires; renders "Indexing 0 documents" / a ratio-less bar frame
(no files/tick at all)
deleteMissingDocuments  → nothing
reconcileVectors        → nothing missing → no embedding events

stdout: Synced 0 documents (0 chunks), 0 deleted in 14 ms [mode hybrid]
```

**A hash-matched document with a vector gap (the `--lexical` self-heal, `indexing/spec.md:271`):**

```
diff  → 0 changed, path in state.hashMatchPaths
files/start { total: 0 }, no ticks
reconcileVectors
  ├─ listChunksMissingVectors() filtered to hashMatchPaths → 7 chunks across 3 documents
  ├─ report embedding/start { batches: 3, chunks: 7 }        <-- ATTEMPTED (denominator, known up front)
  └─ per group: await embed → replaceEmbeddings (one transaction)
                 └─ on success only: state.reconciled.push({ path, chunks })   <-- WRITTEN
                 report embedding/tick { current: i+1, total: 3 }

stderr: Discovering documents / Indexing 0 documents / Embedding 7 chunks in 3 batches / [1/3]… [3/3]…
stdout: Synced 0 documents (0 chunks), 0 deleted in 900 ms [mode hybrid]
        Filled 7 missing chunk vectors across 3 documents.                     <-- Decision 9
```

**The same pass with one group's `embed()` failing — attempted and written diverge:**

```
embedding/start { batches: 3, chunks: 7 }        unchanged: the denominator is what was attempted
group 2 embed throws → embeddingsWarning set, no push, tick 2/3 still fires
stdout: Synced 0 documents (0 chunks), 0 deleted in 700 ms [mode hybrid]
        Filled 5 missing chunk vectors across 2 documents.       <-- only what committed
stderr: WARNING embeddings unavailable (…): search runs in lexical mode
```

**Cold model cache, mid-`files`-phase download (no wiring, already correct):**

```
files/start { total: 3 }
applyOne #1 → await embed()
    └─ LazyEmbeddings → TransformersEmbeddings.create(…, buildEmbeddingsOptions(onProgress))  composition.ts:70-78
          └─ embedding/download { loaded, total } × N
                advanceProgress: { ...state, phase: "embedding", label: "downloading model", download }
                progressRatio prefers `download` → the bar shows MB, not 0/3        progress.ts:186-188
files/tick { current: 1, total: 3 }
    advanceProgress's `files` branch builds a FRESH object with download: null      progress.ts:99-105
    → the bar returns to file progress, no residue
```

**`serve` — provably inert (Gate 3):**

```
cli.ts:160   createContainer({ root })            ← no onProgress
composition  onProgress === undefined
             → syncIndexOptions.onProgress is never assigned
SyncIndex.report(event) → this.options.onProgress?.(event) → no-op, every event, every pass
```

## Interfaces / Contracts

```ts
// src/application/sync-index.ts   (added + one constructor parameter type change)
export interface SyncIndexOptions extends PipelineOptions {
  onProgress?: ProgressReporter;
}
export interface ReconciledFileReport {                                      // NEW — Decision 9
  path: string;
  chunks: number;                     // committed, never attempted
}
export interface SyncReport {
  …                                   // every existing field unchanged, including totalChunks
  reconciled: ReconciledFileReport[]; // NEW, non-optional, [] on a pass that filled nothing
}
export class SyncIndex {
  constructor(
    source: DocumentSource, parser: MarkdownParser, store: IndexStore,
    embeddings: EmbeddingsProvider | null, policy: ConventionPolicy,
    options: SyncIndexOptions,          // was: PipelineOptions
  );
  execute(): Promise<SyncReport>;
}
// private, new or reshaped:
//   diff(files, existing, encodingNotices, state): ChangedFile[]        synchronous, emits nothing
//   applyChanged(changed, state): Promise<void>                         emits files/tick, one site
//   applyOne(entry, state): Promise<void>                               today's loop body, verbatim
//   reconcileOne(embeddings, path, chunksMissing, state): Promise<void> today's group body + one push
//   report(event: ProgressEvent): void                                  mirrors index-documents.ts:164-166
interface ChangedFile { file: DocumentFile; hash: string; known: boolean }   // module-private
// PassState gains: reconciled: ReconciledFileReport[]

// src/composition.ts    — no signature change; ContainerOptions UNCHANGED
//   syncIndexOptions built conditionally, mirroring :98-99

// src/cli.ts            — one new command, one new module-level help-text constant, and:
export function formatSyncSummary(report: SyncReport): string[];   // NEW, pure — Decisions 8, 9
//   withContainer UNCHANGED; the `index` action UNCHANGED

// src/domain/progress.ts  — ProgressEvent union UNCHANGED; module comment corrected
// src/domain/ports.ts     — UNCHANGED
// src/application/index-documents.ts — UNCHANGED, IndexReport included
```

**Asserted unchanged, not assumed** (Gate 3 / Gate 6 diff assertions):

| File | Why it must not move |
|---|---|
| `src/application/sync-scheduler.ts` | the CLI bypasses it (Approach 1); any edit means the wrong path was wired |
| `src/domain/progress.ts`'s `ProgressEvent` union | a new variant means Option C was taken, which is scoped out |
| `src/domain/ports.ts` | no port change, no new `IndexStore` method |
| `src/infrastructure/sqlite/**` | no schema change, no DDL, no `migrate()`/`reset()` edit |
| `src/application/index-documents.ts`, including `IndexReport` | `index` is untouched; its progress convention is copied, not moved. It has no reconciliation phase to report — `listChunksMissingVectors`/`replaceEmbeddings` have one production caller each, both in `sync-index.ts` (Decision 9) |
| `src/application/get-overview.ts` | `toSyncInfo` reads only `skipped`/`embeddingsWarning`/`encodingNotices` (`:71-82`), so `SyncReport`'s new field cannot change `docs_overview` output; a manual run in another process legitimately does not appear there either |
| `src/cli.ts`'s `withContainer`, `serve` action, `index` action | `serve` wires no reporter (`:160`) — that is what makes the emission inert. `index`'s renderer stays inline and its stdout stays byte-identical |
| `SyncReport`'s existing fields, `totalChunks` included | exactly one field is **added** (`reconciled`, Decision 9); nothing existing is renamed, removed, or redefined |

## Testing Strategy

`strict_tdd: true`. Tests come first; each name below is a concrete target for `sdd-tasks`.

### File layout, and why it is three files rather than one

| File | Status | Contents |
|---|---|---|
| `test/application/sync-progress.test.ts` | **new** | every progress-emission case. Mirrors the existing precedent: `IndexDocuments`' progress lives in its own `test/application/index-progress.test.ts`, not inside `index-and-search.test.ts` |
| `test/application/sync-index.test.ts` | extended, **additions only** | one new case (Gate 4), four new reconciliation-reporting cases (Gate 7), plus one additive field on the local `MutableSource` |
| `test/cli.test.ts` | extended | `formatSyncSummary` — the only seam that can execute the `Filled …` line in CI (Decisions 8, 9) |
| `test/cli-subprocess.test.ts` | extended | Gates 1, 2, 5, in a describe block with **its own** temp workdir |
| `test/application/get-overview.test.ts`, `test/application/sync-scheduler.test.ts` | one line each | `reconciled: []` in each file's `fakeReport(overrides: Partial<SyncReport>)` factory (`:7-11` and `:5-9`). Mechanical; neither file is a Gate 3 subject — Gate 3 pins `sync-index.test.ts`'s 19 cases and `src/application/sync-scheduler.ts`, the *source* file |

Putting the progress cases in a new file is what makes Gate 3 mechanically checkable: the diff of
`sync-index.test.ts` must contain **only additions**, and none of its 19 existing `it(` bodies may
change. The new file needs its own ~8-line `MutableSource` fake rather than importing one — extracting
the class out of `sync-index.test.ts` into `test/helpers/` would make that file's diff non-additive and
destroy the property.

### `test/application/sync-progress.test.ts`

Harness: `SqliteIndexStore(":memory:")` + a mutable in-memory `DocumentSource` + `FakeEmbeddings`, with
`onProgress` assigned **conditionally** (`tsconfig.test.json` inherits `exactOptionalPropertyTypes`).

| # | Case | Falsifies |
|---|---|---|
| P1 | `discovery/start` is event 0; every `files/tick` follows the single `files/start` | reordered or missing phase start |
| P2 | **3 indexed, then 1 edited → `files/start.total === 1`, and exactly one tick `{current: 1, total: 1, path}`** | Option A (`files.length`). *The* assertion the design stands on |
| P3 | all-unchanged pass → `files/start.total === 0` and **zero** `files/tick` | a suppressed `files/start`, or ticks over hash matches |
| P4 | 2 changed, 1 of which fails `policy.resolver` under `strict` → `total: 2`, ticks `1/2` **and** `2/2` | a tick inside the per-document body that a `continue` skips (Decision 2) |
| P5 | **at the moment each tick fires, `store.getDocumentByPath(event.path) !== null`** | a tick emitted before `upsertDocument` commits |
| P6 | vector gap via the existing `dropVector` helper → `files/start.total === 0`, no `files/tick`, then `embedding/start {batches: 1, chunks: 1}` + `embedding/tick {current: 1, total: 1}`, in that order | reconciliation mapped onto the wrong phase, or the group count computed inside the loop |
| P7 | nothing to reconcile → **zero** `embedding` events; `embeddings: null` → zero `embedding` events | an unconditional empty `embedding/start` (Decision 4) |
| P8 | a `SyncIndex` built with no `onProgress` completes a full pass | a non-optional reporter |
| P9 | one group of two, whose `embed()` throws → `embedding/start` still reports `batches: 2` **and** `report.reconciled` names only the surviving document | the denominator being derived from committed work, or the report from attempted work (Decision 9) |

**P5 is the reason this suite does not need timing.** Instead of asserting *when* a tick arrives, the
`onProgress` callback itself queries the store:

```ts
const seen: { path: string; committed: boolean }[] = [];
const onProgress: ProgressReporter = (e) => {
  if (e.phase === "files" && e.kind === "tick") {
    seen.push({ path: e.path, committed: store.getDocumentByPath(e.path) !== null });
  }
};
// … all changed documents succeed in this fixture …
expect(seen.every((s) => s.committed)).toBe(true);
```

That directly falsifies a tick-before-commit implementation and is completely independent of how fast
`FakeEmbeddings` resolves.

**Do not write a test that measures tick arrival in wall-clock time.** `FakeEmbeddings` resolves in a
microtask, so no fake can reproduce the "99% then stall" illusion, and a test that tried would silently
pass on fast hardware — the exact "coverage that can vanish without anyone noticing" this suite already
refuses to write (`cli-subprocess.test.ts:212-228` records the same reasoning for the bar's `\r`).
Exploration risk 2 is answered by P2, not by timing.

### `test/application/sync-index.test.ts` — one additive case (Gate 4)

`MutableSource` (`:39-45`) gains one field, and `discover()` returns it:

```ts
encodingNotices: EncodingNotice[] = [];
async discover(): Promise<DiscoverResult> {
  return { files: this.files, readErrors: this.readErrors, encodingNotices: this.encodingNotices };
}
```

Always returning an array (empty by default) is invisible to all 19 existing cases: `execute()` reads
`encodingNotices ?? []` (`:86`) and only sets `report.encodingNotices` when non-empty (`:100`). It also
moves the fake **towards** production wiring, which the composite adapter always populates
(`ports.ts:37-40`) — the same lesson `multiple-doc-roots` recorded for `test/helpers/build.ts`.

The Gate 4 case: index a document, then run a second pass with **identical content** and
`encodingNotices: [{ path, encoding: "windows-1252" }]`. Assert `report.indexed` is empty (the hash
matched, nothing was re-indexed) **and** `report.encodingNotices` names that path. The two assertions
together are what make it a guard: either alone passes under the wrong refactor.

**Four more cases for Decision 9 (Gate 7).** These belong here rather than in the progress file: they
assert report *content*, which is diff semantics. All four build on the existing `dropVector`
white-box helper (`:70-74`), which is already the suite's way of manufacturing a vector-coverage gap.

| # | Case | Falsifies |
|---|---|---|
| R1 | index one document, `dropVector` one chunk, pass again with identical content → `reconciled` is `[{ path, chunks: 1 }]`, `indexed` is `[]`, `totalChunks` is `0` | the counts not being reported at all, or being folded into `totalChunks` |
| R2 | same setup, second pass built over the same store with `BrokenEmbeddings` → `reconciled` is `[]` and `embeddingsWarning` is set | **counting attempts.** Extends the existing `:193` case rather than editing it, so Gate 3 holds |
| R3 | same setup, store wrapper whose `replaceEmbeddings` throws (the technique the existing `:626` case already uses for `upsertDocument`) → `reconciled` is `[]` and the path is in `skipped` | **counting a rolled-back write** |
| R4 | one changed document plus one hash-matched document with a gap → `indexed.length === 1`, `reconciled.length === 1`, different paths | the two collections being conflated, or reconciliation being skipped when the apply sub-pass did work |

R2 and R3 are the load-bearing pair: they are the only tests that distinguish "written" from
"attempted", and each targets one of the two failure paths verified in Decision 9's table.

### `test/cli.test.ts` — `formatSyncSummary` (the branch no subprocess can reach)

Four cases against hand-built `SyncReport` values. The first is the guard for "must not perturb the
common case":

| # | Input | Assertion |
|---|---|---|
| C1 | `reconciled: []`, `skipped: []` | the result is **exactly one** line, equal to today's summary string verbatim |
| C2 | `reconciled: [{path, chunks: 40}, {path, chunks: 7}]`, `indexed: []` | two lines; line 2 is `Filled 47 missing chunk vectors across 2 documents.` |
| C3 | changed documents **and** reconciliation | line 1 reports the changed documents, line 2 the fill — the two counts never merge |
| C4 | reconciliation **and** skips | three lines, in the order summary → `Filled` → `Skipped` |

C1 is not ceremonial: it is what fails if a future edit makes the reconciliation segment
unconditional, or moves it into the summary line, and it costs one assertion.

`Filled 1 missing chunk vectors across 1 documents.` is the singular form, unpluralized — the same
choice as `Synced 1 documents` and the pre-existing `Indexed 1 documents` / `Skipped 1 documents`.
Consistency across the four strings beats grammar in one of them.

### `test/cli-subprocess.test.ts` — the only file that spawns real `dist/cli.js`

**A dedicated workdir, not the shared one.** The new describe block builds its own temp dir with the
same recipe as `:81-91` (`cpSync` the `test/fixtures/strict` corpus + config, then
`index --lexical`). Cost: one extra `cpSync` and one extra index run. The shared `workdir` is asserted
against by four existing cases (`Indexed 5 documents` `:132`, the search hit `:141`, the deny-list pair
`:144-165`, `Indexing 5 documents` `:185`), and the sync gates must edit, add **and** delete documents.
Coupling them through vitest's declaration order is a fixture-state trap, not a saving.

| # | Gate | Assertion |
|---|---|---|
| S1 | 1 | edit one document; `sync --lexical` with `COMPENDIO_PROGRESS=plain` → stderr contains `Indexing 1 documents`, `[1/1]`, and **not** `Indexing 5 documents` |
| S2 | 1 | run again unedited → stderr contains `Indexing 0 documents` and matches no `/\[\d+\/\d+\]/` |
| S3 | 2 | that same run's stdout matches `/Synced 1 documents \(\d+ chunks\), 0 deleted/`; a following `search` returns the new content |
| S4 | 2 | delete a document → stdout matches `/Synced 0 documents \(0 chunks\), 1 deleted/`; a following `search` no longer returns it |
| S5 | 2 | add a document → stdout matches `/Synced 1 documents/`; a following `search` returns it |
| S6 | 2 | a **fresh** temp dir with the corpus and no `.compendio/` → `sync --lexical` stdout matches `/Synced 5 documents/` (Approach 8), and a following `search` finds a document |
| S7 | 5 | `sync --help` stdout contains `compendio index`, the chunking caveat, the `sync.throttleMs` sentence, and the `--dir` paragraph |
| S8 | 5 | `--help`'s command list contains `sync` — **the one edit to an existing case**, extending the array at `:116` |
| S9 | 5 | `sync --dir <path>` → `status !== 0` and stderr contains `unknown option '--dir'` |
| S10 | 5 | `sync --lexical` exits 0 and its stdout carries `[mode lexical]` |

**Never run `sync` without `--lexical` in this suite.** Against a corpus indexed by `index --lexical`,
every chunk is missing a vector, so a hybrid `sync` sends the whole corpus through
`reconcileVectors` — a ~129 MB model download inside a test. The proposal's "no model download required
by any gate" holds only if every spawned `sync` carries the flag.

**There is no subprocess gate for the `Filled …` line, and that is a stated hole with a stated
closure.** Reaching it end to end needs a real embeddings provider: reconciliation is unreachable
under `--lexical` (`reconcileVectors` returns at `:184`), no CLI flag injects a fake provider, and
`Container` exposes `syncIndex` but not `embeddings`, so no application-level test can substitute one
either. The only hermetic route to that branch is `formatSyncSummary`, which is why Decision 8 was
revised to extract it — the alternative was a production line that never executes in CI, in a project
whose recorded worst failure is exactly that. Gate 2's S3-S6 still cover the summary line and the
wiring end to end, unchanged.

**Gate 5's fourth bullet cannot be a subprocess test, and does not need to be.** "`sync --lexical`
completes and its documents are later vector-filled by a hybrid pass with no user action" requires a
real hybrid pass. The *mechanism* is already proven at unit level by the existing case at
`sync-index.test.ts:193` ("leaves a vector-coverage gap untouched while the provider is unavailable,
and reconsiders it once the provider returns"), with `embeddings: null` standing in for `--lexical`.
S10 covers the CLI half. Recorded here so `sdd-verify` does not go looking for a gate that would
contradict the proposal's own dependency constraint.

## Gate mapping

| Gate | Decision it tests | Concrete falsifier |
|---|---|---|
| 1 — the denominator is the changed set | 1, 2, 5 | P2, P3, S1, S2. Reading `Indexing 5 documents` means Option A shipped |
| 2 — end to end through spawned `dist/cli.js` | 6, 8 | S3-S6, asserting **stdout content**; exit 0 with empty stdout is this project's recorded broken-entry-point shape |
| 3 — `serve` and `index` untouched | 3, 6 | all 19 `sync-index.test.ts` cases unmodified (diff is additions-only); `sync-scheduler.ts` diff empty; `progress.ts`'s `ProgressEvent` union diff empty; the existing cross-mode stdout test still passes |
| 4 — a transcoded but unchanged document is still reported | **1** | the new `sync-index.test.ts` case. Zero coverage today |
| 5 — caveat and flags | 7, 8 | S7-S10 |
| 6 — nothing else moved | — | `npm test`, `npm run typecheck` (both projects), `npm run build`; the asserted-unchanged table above |
| **7 — reconciliation work is reported, and only when written** *(new, this revision)* | **9** | R1 (it is reported), R2 + R3 (a failed embed and a rolled-back write report **nothing**), R4 (never conflated with `indexed`), P9 (attempted ≠ written), C1-C4 (the output, including the byte-identical common case) |

**Gate 7 is introduced by this design revision, not by the proposal.** Proposal §7b and its
`Reporting reconciliation work` row settle the requirement, but they arrived after the proposal's
`## Success Criteria` section was written, so its gate list still enumerates six. `sdd-tasks` and
`sdd-verify` should carry seven. Its STOP condition: a `reconciled` count that includes a failed group
replaces the honesty gap this revision removes with a quieter one, and R2/R3 are the only tests that
can detect it.

## Open questions for later phases

1. **Whether the `index-progress` spec's generalized denominator wording should name the changed set
   explicitly or stay abstract.** `sdd-spec` owns it. This design satisfies either reading: the total
   is `changed.length`, computed with zero `await`s between it and `files/start`.
2. **Whether the `sync`-emits-no-`embedding/failed` asymmetry (Decision 4) deserves a spec scenario.**
   It is a deliberate divergence from `IndexDocuments`, and divergences this project does not write
   down are the ones it re-litigates. Recommendation: one scenario line, `sdd-spec`'s call.
3. **What `sdd-spec` should pin for reconciliation reporting (Decision 9).** The observable behaviour
   worth making normative is the *negative* half, because it is the one a future change can break
   silently: a pass MUST report the documents whose vector gaps it filled, and a group whose embedding
   or whose vector write failed MUST NOT be counted. The exact string is a CLI detail, not a spec
   obligation; "reported when non-zero" is. Recommendation: one requirement with two scenarios (filled,
   and failed-therefore-not-counted). `sdd-spec` owns the wording — this design does not touch
   `openspec/changes/manual-sync-command/specs/`.
4. **Nothing in this design depends on the proposal's open question round.** Questions 2-5 are
   answered by the assumptions already in force (index everything on an empty database; help + README
   only; "reindex" reserved for `compendio index`; retry on `SQLITE_BUSY`). A different answer to
   question 3 (a caveat printed on every run) would add one line to `formatSyncSummary` and change no
   other decision.
