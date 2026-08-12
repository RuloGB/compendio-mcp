# Verification Report

**Change**: manual-sync-command
**Version**: N/A (openspec deltas, not yet merged into base specs — merge happens at archive)
**Mode**: Strict TDD

Artifact store this cycle: openspec (file-based). Engram MCP tools confirmed unavailable — no
`mem_*` calls made, per the orchestrator's briefing.

This report does not repeat the orchestrator's own spot-checks verbatim; it re-runs the three
commands for fresh evidence and focuses effort on what the orchestrator explicitly did not check:
whether the load-bearing tests can actually fail, full requirement-by-requirement conformance
across both delta specs, Gates 2/5/6 end to end, Gate 3's "additions only" claim diff-verified,
and a check of apply-progress.md's own claims against the repository.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 60 |
| Tasks complete | 60/60 |

All 60 checkboxes in `tasks.md` (13 phases, PR 1 "engine" + PR 2 "surface", delivered as one PR
per the resolved `size:exception` decision) are marked `[x]`. Spot-checked a representative sample
against actual repository state (source inspection, git diffs, running code) rather than taken on
trust — see the per-gate sections below.

## Build & Tests Execution

**Build**: PASS
```text
$ npm run build
> compendio-mcp@1.3.1 build
> tsc
(no output, exit 0)
```

**Typecheck**: PASS
```text
$ npm run typecheck
> compendio-mcp@1.3.1 typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
(no output, exit 0)
```

**Tests**: PASS — 675 passed / 0 failed / 0 skipped
```text
$ npm test
 Test Files  44 passed (44)
      Tests  675 passed (675)
   Duration  19.50s
```
Re-run independently in this session (not quoted from `apply-progress.md`), and matches its
claimed final count exactly.

**Baseline re-derived independently.** `apply-progress.md`'s Test Summary claims "46" tests were
written this session; the itemized breakdown it gives (9 P-series + 5 sync-index additions + 9
subprocess S-series + 4 `formatSyncSummary` C-series) sums to **27**, not 46. To settle which
figure is right, `main` was checked out into an isolated `git worktree` (`npm install` + `npm
test`, independent of the working tree) and produced **648 passed (648)** — so the real delta is
675 minus 648 = **27**, matching the itemized breakdown exactly. The "46" total is a plain
arithmetic error in the report; see Issues Found.

**Coverage**: Not available — no coverage tool configured (`vitest.config.ts` has no coverage
provider; `package.json` has no `--coverage` script). `coverage_threshold: 0` per the
orchestrator's briefing — not a failure.

**Linter**: Not available — `package.json`'s `scripts` block has no `lint` entry, matching
`CLAUDE.md`'s own statement.

## Mutation testing — can the load-bearing tests actually fail?

Per this project's recorded history of green suites over broken behaviour (and of verification
mechanisms themselves being defective), the three highest-stakes assertions were checked by
temporarily mutating `src/application/sync-index.ts` to reproduce the exact regression each test
exists to catch, confirming red, then restoring with `git checkout --`. The tree was confirmed
clean (`git status --porcelain`) before and after every mutation; no source file differs from the
pre-mutation state at the end of this report.

| Mutation | Simulates | Result |
|---|---|---|
| `files/start` denominator changed from `changed.length` to `files.length` (Option A) | The exact rejected design option Gate 1 exists to catch | RED: P2, P3, P6 in `sync-progress.test.ts` all failed (e.g. P3 expected `total: 0`, received `total: 1`) |
| Encoding-notice push moved from `diff` (iterates every discovered file) to fire only for changed files | The "natural, wrong-looking-right" refactor `design.md` names by name | RED: the Gate 4 case in `sync-index.test.ts` failed — `second.encodingNotices` was `undefined` instead of naming the hash-matched CP1252 document |
| `reconcileOne` pushes to `state.reconciled` unconditionally (before the embed/write try blocks), simulating "counts attempted, not written" | Gate 7's own named STOP condition | RED: both R2 (embed throws) and R3 (write rolled back) failed — `report.reconciled` held a nonempty entry where `[]` was expected |

All three mutations produced the expected failure, restored cleanly. These are not decorative
tests — they detect the exact regressions their surrounding prose claims to guard against.

## Gate-by-gate verdict (proposal.md Success Criteria, all seven)

### Gate 1 — denominator is the changed set (BLOCKING) — PASS

- Unit: P2 (`sync-progress.test.ts`) — 3 indexed, 1 edited to `files/start.total === 1`, exactly
  one tick. P3 — all-unchanged to `total: 0`, zero ticks.
- Subprocess: S1/S2 (`cli-subprocess.test.ts`) — edited-document run's stderr contains
  `Indexing 1 documents` and `[1/1]`, never `Indexing 5 documents`; unedited re-run reports
  `Indexing 0 documents` and no `[i/N]` pattern.
- Confirmed the denominator test can fail (mutation table above).

### Gate 2 — end to end through spawned dist/cli.js (BLOCKING) — PASS

S3-S6 all assert stdout content via regex (e.g. `/Synced 1 documents \(\d+ chunks\), 0 deleted/`),
never exit code alone, and each is chained to a following `search` call that independently
confirms the effect (new content returned, deleted document no longer returned, added document
returned, never-indexed project searchable). This satisfies the STOP condition: an exit-0/empty-
stdout entry-point break, this project's own recorded failure shape, cannot pass any of S3-S6.

### Gate 3 — serve/index untouched (BLOCKING) — PASS

- `git diff main..HEAD -- test/application/sync-index.test.ts` shows the file's diff is exactly:
  one new import (`EncodingNotice`), one new field on the local `MutableSource` fake
  (`encodingNotices: EncodingNotice[] = []`), one one-line change to that fake's `discover()`
  return statement (adds the new field, default `[]`, invisible to all pre-existing cases), and
  four new `describe` blocks appended at the end. None of the 19 original `it(` bodies changed.
  `it(` count: 19 to 24 (confirmed by direct grep against both `main` and `HEAD`).
- `git diff main..HEAD -- src/application/sync-scheduler.ts` -> 0 lines.
- `git diff main..HEAD -- src/domain/progress.ts` -> exactly the 3-line module comment (names both
  commands); the `ProgressEvent` union itself is untouched.
- `git diff main..HEAD -- src/server.ts` -> 0 lines (no fourth MCP tool, confirming `CLAUDE.md`'s
  new claim).
- The existing "stdout identical across none/plain/bar modes" `index` test still passes (part of
  the 675-green run above).

### Gate 4 — transcoded-but-unchanged document reported (BLOCKING) — PASS

The new `sync-index.test.ts` case asserts a hash-matched CP1252 document still appears in
`report.encodingNotices` on a second pass. Confirmed by mutation testing (table above) that this
test fails under the exact refactor `design.md` predicts would silently drop the case. Zero
coverage existed for this before the change, as the proposal states.

### Gate 5 — caveat and flags — PASS

- S7: `sync --help` stdout contains `compendio index`, `chunk.maxTokens`, `sync.throttleMs`, and
  `--dir` — all four asserted as substrings against `SYNC_HELP_NOTES`'s three-paragraph body.
- S8: `compendio --help`'s command array (`cli-subprocess.test.ts:117`) includes `sync` alongside
  every pre-existing command name, unmodified.
- S9: `sync --dir docs --lexical` gives a non-zero exit, stderr contains `unknown option '--dir'`
  — verified against the source: `--dir` is never registered on the `sync` command
  (`src/cli.ts:121-156`), so commander's own default rejection fires; no guard code exists that
  could accidentally be bypassed.
- S10: `sync --lexical` exits 0, stdout contains `[mode lexical]`.
- Gate 5's fourth bullet (hybrid self-heal after `--lexical`) is routed to the existing, unmodified
  `sync-index.test.ts` case (`embeddings: null` standing in for `--lexical`) per the design's own
  documented reasoning — no model download is needed by any gate, confirmed true across all tests.

### Gate 6 — nothing else moved — PASS

- `npm test` / `npm run typecheck` / `npm run build` all green (re-run independently, above).
- README: "exactly three ways" is gone (confirmed by diff); the refresh table has four rows
  (`serve` startup / any tool call / `compendio sync` / `compendio index`); the retitled
  `## Incremental sync` section's prose never calls the incremental mechanism "reindexing" — every
  remaining "reindex" occurrence in the file refers to `compendio index` specifically, consistent
  with the vocabulary-unification decision.
- Spec grep: all reworded/added `indexing/spec.md` requirements that mention `serve` pair it with
  "or invoked manually via `compendio sync`" — no requirement still scopes a full-reindex limit to
  `serve` alone (read in full, not just grepped).

### Gate 7 — reconciliation reported, only when written (BLOCKING) — PASS

R1 (reported, separate from `indexed`/`totalChunks`), R2 (embed throws to `[]`,
`embeddingsWarning` set), R3 (write rolled back to `[]`, path in `skipped`), R4 (never conflated
with `indexed`), P9 (attempted batch count of 2 vs. written `reconciled` naming only the
survivor), C1-C4 (renderer, including the byte-identical common case verified letter-for-letter
against `formatSyncSummary`'s C1 assertion). R2 and R3 — Gate 7's own named STOP-condition
falsifiers — were independently confirmed capable of failing via mutation testing (table above).

## Requirement-by-requirement conformance

### indexing/spec.md

| Requirement | Scenario | Evidence | Result |
|---|---|---|---|
| ADDED: Incremental Sync Trigger — Manual compendio sync Invocation | Runs exactly one pass | `sync` action calls `container.syncIndex.execute()` once, no loop; S1-S6 | COMPLIANT |
| " | Throttle does not gate a manual invocation | Structural: `sync` action never references `container.syncScheduler` (grep-confirmed); `SyncScheduler`'s only call site remains `serve`'s startup (`cli.ts:251`); `sync-scheduler.ts` is diff-empty (Gate 3) | COMPLIANT — proof by absence of a code path; no test runs `sync` twice against a configured nonzero throttle to observe the behavior empirically, see Issues Found |
| " | Failed pass exits non-zero | Structural: no try/catch swallows the `execute()` call inside the `sync` action; the top-level `program.parseAsync(...).catch()` calls `process.exit(1)` (`cli.ts:382-385`), identical to `index`'s mechanism | PARTIAL — no runtime test forces `SyncIndex.execute()` to throw and asserts the spawned CLI's exit code; `apply-progress.md`'s own task 12.1 note cites this as "(uncaught in cli.ts)", i.e. reasoning, not a runtime assertion. See Issues Found |
| " | Deletions reported by count | S4: stdout matches `/Synced 0 documents \(0 chunks\), 1 deleted/` | COMPLIANT |
| ADDED: Vector-Coverage Reconciliation Is Reported as Written Work, Never Attempted Work | All four scenarios | R1-R4, P9, C1-C4, mutation-confirmed for the two STOP-condition scenarios | COMPLIANT |
| MODIFIED: A Successfully Transcoded Document Is Always Reported | Unchanged-but-transcoded reported every pass (new scenario) | Gate 4 case, mutation-confirmed | COMPLIANT |
| MODIFIED: Corrected Decoding Self-Heals via Incremental Sync | Re-scoped to include manual sync | The pre-existing "re-indexes a changed file (hash differs)" case in `sync-index.test.ts` already exercises `SyncIndex` directly, not through `serve`, and the property (hash difference implies re-index) is cause-agnostic — the same fingerprint mechanism a decode fix would trigger | COMPLIANT — inherited, cause-agnostic mechanism; no new test needed, and none was written |
| MODIFIED: In-Process Incremental Sync Concurrency Guarantee | Manual sync as a second external-process case | Prose-only addition; no new production behavior — `SQLITE_BUSY` under WAL is the existing engine behavior, not new code | COMPLIANT — documentation-only delta, correctly not test-gated |
| MODIFIED: Chunk Boundary Changes Require a Full Reindex... | Re-scoped wording | Prose-only; mechanism (`computeHash` fingerprinting) untouched and already tested | COMPLIANT |
| MODIFIED: Heading-Only Changes Also Require a Full Reindex... | Re-scoped wording | Prose-only; same mechanism | COMPLIANT |

### index-progress/spec.md

| Requirement | Scenario | Evidence | Result |
|---|---|---|---|
| ADDED: A compendio sync Pass Never Emits embedding/failed | Per-file-phase embed failure | No `embedding/failed` emission possible: grep for `kind: "failed"` against `sync-index.ts` returns zero matches, and `ProgressEvent` emission is closed to whatever `report()` call sites exist in the file (none use `kind: "failed"`) | COMPLIANT |
| " | Reconciliation embed failure | Same structural evidence; P9 exercises this exact path and confirms `embeddingsWarning` fires instead | COMPLIANT |
| MODIFIED: Four Reportable Phases With Synchronously-Known Denominators | Per-file denominator is the changed set | P2, S1/S2 | COMPLIANT |
| " | index's embedding denominator known at phase start | Unchanged from before this change; still covered by `IndexDocuments`' own test suite, untouched — `index-documents.ts` is zero-diff | COMPLIANT |
| " | Sync's embedding-phase denominator is {batches, chunks} | P6, P9 | COMPLIANT |
| " | Sync with nothing to reconcile reports two phases only | P7 — fully-covered pass and `embeddings: null` pass both emit zero `embedding` events | COMPLIANT |
| " | Download progress nested inside embedding phase | Inherited, unmodified mechanism in `progress.ts` (diff-empty except the module comment); `composition.ts`'s `buildEmbeddingsOptions(onProgress)` wiring is shared with `index`'s and structurally identical for `sync` | COMPLIANT — no new test required, mechanism is reused verbatim |

No requirement or scenario across either delta spec was found without an identifiable satisfier.
The one scenario without direct runtime evidence (failed-pass-exits-non-zero) is flagged PARTIAL
above and discussed in Issues Found — it is not a missing satisfier, it is missing runtime proof
of a structurally sound mechanism.

## Gate 3's "additions only" claim — directly diff-verified

`git diff main..HEAD -- test/application/sync-index.test.ts` was read in full, not sampled. The
only changes to existing lines are: one new type import, one new field declaration on the shared
`MutableSource` fixture class, and one line inside that fixture's `discover()` method extending its
return object with the new field (default `[]`, semantically invisible to every pre-existing case
since `execute()` already reads `encodingNotices ?? []`). All 19 original `it(` bodies are
byte-identical to `main`. `apply-progress.md`'s claim ("19 original cases unmodified") is accurate.

## Item: Gate 4's CLI-level print path — code-identity vs. a dedicated test

`apply-progress.md` and `tasks.md` both note that the `sync` action's transcoding WARNING line
(`src/cli.ts:145-147`) is validated only by code-identity with `index`'s already-shipped renderer
(`src/cli.ts:57-59`), not by a dedicated subprocess test — reaching it would need a CP1252 fixture
document in the shared/dedicated sync workdir, which the design never added. Checked
independently: index's own equivalent WARNING line has no subprocess-level test either — grep
across `test/cli-subprocess.test.ts` for `encodingNotice`/`transcod`/`windows-1252`/`cp1252`
returns nothing but an unrelated comment, and the `strict` fixture corpus used by that whole file
(`test/fixtures/strict/docs/`) contains no non-UTF-8 document. `formatEncodingNotice`'s string
output is exercised at the application level via `get-overview.test.ts` (through `toSyncInfo`),
and its correct placement in the report is what Gate 4's mutation-confirmed unit test guards.

Agree with apply's characterization: this is not a new oversight introduced by this change. It is
a pre-existing, already-accepted gap in `index`'s own end-to-end coverage that `sync` inherits by
reusing the identical statement shape. It remains a real, if low-risk, hole in this project's
end-to-end coverage for both commands — worth a follow-up, not a blocker for this change.

## Issues Found

**CRITICAL**: None.

**WARNING**:
1. `indexing/spec.md`'s "A failed manual pass exits non-zero" scenario has no runtime-executed
   covering test. Evidence is structural/code-reading only (no try/catch around
   `container.syncIndex.execute()` in the `sync` action; the shared top-level `.catch()` calls
   `process.exit(1)`). Per this project's own strict-tdd-verify standard ("a spec scenario is
   compliant only when a covering test passed at runtime"), this scenario is technically UNTESTED
   rather than COMPLIANT. Low practical risk — it is the identical, already-relied-upon mechanism
   `index` uses, which has the same gap, since no subprocess test forces
   `IndexDocuments.execute()` to throw either — but it is a genuine hole, not a false alarm.
2. `apply-progress.md`'s Test Summary states "46" tests written this session; the correct figure,
   independently re-derived (main-branch worktree: 648 tests; HEAD: 675 tests), is 27, matching
   the report's own itemized breakdown (9+5+9+4=27), which the "46" total contradicts. Does not
   affect code correctness or any gate; it is a factual error in an artifact whose whole purpose
   is precise TDD evidence, and should be corrected before or during archive.
3. `CLAUDE.md`'s "A chunk.maxTokens (or splitting-logic) change…" line has no leading `- ` markdown
   bullet marker, so it does not render as a list item inside the surrounding bulleted block.
   Cosmetic, one-character fix, no behavioral impact.

   **Attribution corrected by the orchestrator — this defect is PRE-EXISTING, not caused by task
   12.6.** The line already lacked its bullet on `main`: `git show main:CLAUDE.md` puts the same
   text at line 187 starting with a single space, and `git show main:CLAUDE.md | grep -c "^- \*\*A
   \`chunk.maxTokens\`"` returns `0`. Task 12.6 did edit that line — adding the "whether triggered
   by `serve` … or invoked manually via `compendio sync`" clause — but there was no bullet there to
   remove. Recording the correction rather than silently amending the finding: blaming this change
   for a defect that predates it would send a future reader hunting the wrong commit, and the
   finding itself was worth making.

   **Fixed by the orchestrator** after verification, as a one-character edit to a file this change
   already touches.

**SUGGESTION**:
1. Gate 4's CLI-level print path (the `sync` command's transcoding WARNING line) has no dedicated
   subprocess test — see the dedicated section above. Not a defect specific to this change; a
   pre-existing gap in `index`'s own coverage that this change's design correctly chose not to
   widen further. Worth closing for both commands together in a future change.
2. No runtime/behavioral test proves "sync.throttleMs does not gate two immediate-succession
   compendio sync invocations" empirically (e.g. configuring a large throttle and running `sync`
   twice back to back). The evidence is airtight by construction — the `sync` action never
   references `container.syncScheduler` at all, so there is no code path through which the
   throttle could reach it, and this is the same "proof by absent code path" style already
   accepted elsewhere in this design (Gate 3's diff-empty assertions). Noted for completeness of
   the requirement-by-requirement walk, not because the claim is in doubt.

## Verdict

**PASS WITH WARNINGS** — 0 CRITICAL, 3 WARNING, 2 SUGGESTION.

All seven Success Criteria gates hold under independent, adversarial re-verification, including
three targeted mutation tests that confirm the highest-stakes assertions (Gate 1's denominator,
Gate 4's encoding-notice regression guard, Gate 7's two STOP-condition falsifiers) can genuinely
fail — this project's own recorded history of green suites over broken behaviour made that check
non-optional, not a formality. Every requirement and scenario in both delta specs has an
identifiable satisfier; the one exception (a structurally-sound but runtime-unverified failure-exit
path) is flagged as a WARNING, not a blocker. None of the three warnings found are severe enough
to block `sdd-archive`: two are documentation/reporting accuracy issues with trivial fixes (the
CLAUDE.md bullet marker, the Test Summary arithmetic), and the third is a coverage gap on a
scenario whose underlying mechanism is verifiably correct by inspection and shared byte-for-byte
with an already-shipped, already-trusted code path. Recommend fixing the CLAUDE.md formatting and
correcting the Test Summary count before or during archive; the failure-exit test gap can be
closed in this change or tracked as a fast follow — it does not warrant reopening `sdd-apply`.

Working tree confirmed clean (`git status --porcelain`) at the end of this verification pass; all
mutation-testing edits to `src/application/sync-index.ts` were restored via `git checkout --`.
