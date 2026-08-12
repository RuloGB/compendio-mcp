# Tasks: `compendio sync` — a manual trigger for the incremental pass

Spec deltas (`openspec/changes/manual-sync-command/specs/indexing/spec.md`,
`.../specs/index-progress/spec.md`) are **already drafted** — this phase does not write or edit them.
Tasks below cross-check the implementation against them; none of these tasks modify a spec file.

> **Correction (orchestrator).** An earlier draft of this file said the spec deltas were "already
> drafted **and committed**". They are drafted but **not committed** — `git status --porcelain`
> reports the whole `openspec/changes/manual-sync-command/` folder as untracked (`??`). This matters
> for the size forecast below: in this repo the planning artifacts ship **in the implementation
> commit**, not at archive time. Precedent: `ec3c414 feat(indexing): add incremental reindex with
> throttled sync` carried 1 889 lines of `openspec/changes/incremental-reindex/` alongside the code;
> the later `67ab34d docs: archive…` only moved the folder. See the resolved delivery decision below.

**Seven gates, not six.** `proposal.md`'s `## Success Criteria` enumerates Gates 1–7. Gate 7
("Reconciliation work is reported, and only when actually written") was added by the §7b scope
decision after that section was first drafted — `design.md`'s revision note and its Gate-mapping table
carry all seven, and so does this file.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines (this file's independent driver-level count; spec deltas excluded — already committed) | 710–1120 |
| Estimated changed lines (design.md's self-corrected estimate, for cross-check) | 700–1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes — **not yet decided**, this is a recommendation for the delivery-strategy gate |
| Suggested split | 2 slices (Engine / Surface), boundary below — matches `design.md`'s own recommended cut |
| Chain strategy (recommended) | Stacked PRs to main — PR 1 is independently valuable and provably behaviour-preserving for `serve` (Gate 3); PR 2 depends on PR 1 but needs no tracker |

```text
Decision needed before apply: RESOLVED
Chained PRs recommended: Yes (recommendation NOT adopted — see below)
Chained PRs adopted: No
Chain strategy: N/A — single PR
Delivery strategy: single-PR with size:exception (user decision)
400-line budget risk: High — accepted
```

### Resolved delivery decision

**Single PR, with an accepted `size:exception`.** User decision at the delivery-strategy gate
(`ask-on-risk`), taken against the corrected figures below rather than the understated ones this
section originally carried. `sdd-apply` proceeds as one slice; the Engine/Surface boundary described
below is retained as **commit** structure inside that PR, not as separate pull requests.

Corrected total diff forecast, since the artifacts ride along (see the correction note at the top of
this file):

| Component | Lines |
|---|---|
| Code + tests + docs (this file's independent driver-level count) | 710 – 1 120 |
| Planning artifacts already written, currently untracked | 2 273 |
| Still to come by analogy with the prior cycle (`apply-progress.md` + `verify-report.md`) | ~380 |
| **Total PR diff** | **~3 400 – 3 800** |

Rationale recorded so `sdd-verify` and `sdd-archive` do not re-litigate it: the change is one
conceptual unit — the engine split has no observable purpose without the command that triggers it,
and a PR 1 that adds a report field nothing yet reads is *harder* to review, not easier. This repo has
direct precedent for the shape: `incremental-reindex` shipped ~773 lines of implementation with 1 889
lines of artifacts in one PR and accepted a `size:exception` over a low estimate.

**The known risk is accepted, not overlooked**: this project's forecasts have landed 2–4x low
repeatedly, so the high end (1 120 code lines) is the safer planning assumption, and the real figure
may exceed it. The 3-way fallback split named below (isolating Phase 5, Decision 9's reconciliation
reporting) stays on the table as a mid-apply escape hatch if the code slice runs materially past its
high end — reverting to it is a scope conversation, not a silent choice for `sdd-apply` to make.

**Why 710–1120, and why it is higher than `proposal.md`'s own Delivery size table (465–755).**
The proposal's driver table predates the design revision (2026-08-12) that split progress-emission
tests into a **new** file (`test/application/sync-progress.test.ts`, 9 cases, P1–P9) and added Gate 7's
four reconciliation-reporting cases (R1–R4) plus `formatSyncSummary`'s four renderer cases (C1–C4).
None of that surface is priced into the proposal's 120–180 line estimate for "progress describe block
(5 cases)". Re-deriving from `design.md`'s Testing Strategy table (the current source of truth) instead
of reusing the proposal's pre-revision number is what accounts for the gap. This also lands inside — not
below — `design.md`'s own self-corrected 700–1200, which is the check this project's forecasting
history (`bounded-chunk-size` 240–420→773, `match-centred-excerpt` 300–470→~1521,
`incremental-reindex` missed by 2x) says to run before trusting a number.

| Driver | Est. lines | PR |
|---|---|---|
| `src/application/sync-index.ts` — two-pass split, `reconcileOne`, `report()`, `reconciled` field, `execute()` rewiring | 90–150 | 1 |
| `src/composition.ts` — thread `onProgress`, correct 2 stale comments | 10–20 | 1 |
| `src/domain/progress.ts` — module comment only | 2–4 | 1 |
| `test/application/sync-progress.test.ts` — new file, harness + P1–P9 | 180–260 | 1 |
| `test/application/sync-index.test.ts` — additive: Gate 4 case + R1–R4 | 90–140 | 1 |
| `test/application/get-overview.test.ts`, `test/application/sync-scheduler.test.ts` — 1 line each | 2 | 1 |
| `src/cli.ts` — `sync` command, `SYNC_HELP_NOTES`, `formatSyncSummary`, action wiring | 90–150 | 2 |
| `test/cli.test.ts` — `formatSyncSummary` C1–C4 | 40–70 | 2 |
| `test/cli-subprocess.test.ts` — new describe block, dedicated workdir, S1–S10 | 150–220 | 2 |
| `README.md` — CLI row, retitle, four-row table, throttle note | 40–70 | 2 |
| `CLAUDE.md` — two bullets + MCP/CLI surface description | 15–30 | 2 |

| PR | Scope | Est. lines | Fits 400? |
|---|---|---|---|
| PR 1 — the engine | Phases 1–7 | 374–576 | Borderline/No |
| PR 2 — the surface | Phases 8–13 | 335–540 | Borderline/No |

**Neither slice comfortably clears 400 at the high end**, and this project's forecasts have landed
2–4x low for several cycles running — treat the high end of each range as the planning assumption, not
the low end. If PR 1 trends toward 576 during apply, the fallback cut is a 3-way split: PR 1a (Phases
1–4, the two-pass split + progress emission, Decisions 1/2/3/4/5/6) and PR 1b (Phase 5, Decision 9's
reconciliation reporting — `reconcileOne`'s push site, R1–R4, P9), each independently reviewable, with
PR 2 (Phases 8–13, the surface) unchanged. This is a fallback, not the primary recommendation, because
Phase 5 is small enough (R1–R4 + P9 ≈ 105–175 lines) that splitting it out only helps if PR 1a+the rest
of PR 1 is otherwise going to overrun on its own.

### Suggested Work Units

| Unit | Goal | Base branch | Notes |
|---|---|---|---|
| PR 1 | Two-pass split, progress emission, reconciliation reporting (Decisions 1–6, 9) | `main` | Provably inert in production (Gate 3) — `serve` wires no `onProgress`, so every emission added here is a no-op until PR 2 exists. Independently mergeable and independently valuable (fixes the encoding-notice regression risk, Gate 4, on its own). |
| PR 2 | `sync` CLI command, renderer, subprocess gates, vocabulary unification, docs | PR 1 branch (or `main` after PR 1 merges) | Depends on PR 1's `SyncIndexOptions`/`SyncReport.reconciled`. README/CLAUDE.md changes MUST NOT land before this PR — see Non-negotiable sequencing constraints. |

## Coverage Map

| Gate | Task(s) |
|---|---|
| Gate 1 — denominator is the changed set | 2.2–2.4 (P2), 2.5 (P3), 11.1 (S1), 11.2 (S2) |
| Gate 2 — end to end through spawned `dist/cli.js` | 11.3–11.6 (S3–S6) |
| Gate 3 — `serve`/`index` untouched | 2.1, 2.8 (19-case baseline), 7.3 (`sync-scheduler.ts` diff-empty), 7.4 (`ProgressEvent` union diff-empty), 7.5, 10.2, 13.2, 13.5 |
| Gate 4 — transcoded-but-unchanged reported | 3.1–3.3 |
| Gate 5 — caveat and flags | 8.1 (S8, S9), 8.3 (S7), 11.7 (S10), 4.5 (hybrid self-heal — routed to the existing unit test, no new hybrid-run test) |
| Gate 6 — nothing else moved | 7.6, 10.2, 12.7, 13.1, 13.3, 13.5 |
| Gate 7 — reconciliation reported, only when written | 5.2–5.3 (R1), 5.4 (R2), 5.5 (R3), 5.6 (R4), 5.7–5.8 (P9), 9.1–9.2 (C1–C4) |
| `index-progress` ADDED requirement — `sync` never emits `embedding/failed` | 4.1, 4.2, 4.4, 7.1 |
| Required spec action (5 rows, already-drafted deltas) — cross-checked, not written | 7.1, 7.2, 12.1, 12.2, 12.3 |

### Gate STOP conditions — explicit falsifiers

| Gate | STOP condition | Falsified by |
|---|---|---|
| 1 | Denominator reads `files.length` (discovered count) instead of the changed count | 2.2–2.4 (P2), 11.1 (S1) |
| 2 | Exit 0 with empty stdout (this project's recorded broken-entry-point shape) | 11.3–11.6, all asserting **stdout content**, never exit code alone |
| 4 | The "natural, wrong-looking-right" refactor moves the encoding-notice push into the apply sub-pass, silently dropping it for unchanged documents | 3.1 |
| 7 | A `reconciled` count that includes a failed group — replaces the honesty gap this gate removes with a quieter one. Two independent failure paths, one task each | 5.4 (embed throws → `embeddingsWarning`, `reconciled` stays `[]`), 5.5 (write rolled back → `skipped`, `reconciled` stays `[]`) |

## Non-negotiable sequencing constraints (do not reorder across PRs)

1. `SyncReport.reconciled` (Decision 9) lands in **PR 1**, with the two-pass split — not deferred to
   PR 2. `npm run typecheck` covers `test/` unconditionally (`package.json:35` runs
   `tsc -p tsconfig.test.json`), so the field going non-optional without Phase 6's two one-line fixups
   breaks typecheck immediately, in a way that looks unrelated to this change.
2. Phase 6's `reconciled: []` additions to `test/application/get-overview.test.ts` and
   `test/application/sync-scheduler.test.ts` are **not** Gate 3 violations. Gate 3 pins
   `sync-index.test.ts`'s 19 cases and `src/application/sync-scheduler.ts` — the *source* file, not its
   test file. Do not let a verifier flag 6.1/6.2 against Gate 3.
3. Vocabulary unification and the README's four-row table (Phase 12) land in **PR 2, with the
   command** — never earlier. A README documenting `compendio sync` before the command exists is worse
   than the pre-existing "reindex"/"sync" vocabulary split it fixes.
4. Every `sync` invocation in Phase 11's subprocess suite MUST carry `--lexical`. Against a corpus
   indexed by `index --lexical`, every chunk is missing a vector; a hybrid `sync` would send the whole
   corpus through `reconcileVectors` and trigger a ~129 MB model download inside CI. No gate in this
   change requires a model download (Dependencies) — Gate 5's fourth bullet is routed to the existing
   unit-level test instead (4.5), precisely to keep this true.
5. Phase 8's new subprocess describe block uses its **own** dedicated workdir, never the shared one.
   Four existing cases assert exact state against the shared `workdir` (`Indexed 5 documents`, the
   `guide-service-onboarding.md` hit, the deny-list pair, `Indexing 5 documents`); the sync gates edit,
   add, **and** delete documents, which would couple both sets of assertions through vitest's
   declaration order if they shared a fixture.
6. Gate 3's diff assertions (`sync-scheduler.ts`, `ProgressEvent` union) apply across the **whole**
   PR 1 + PR 2 span. Phase 13 re-confirms them (13.2) — it does not just trust Phase 7's PR-1-scoped
   check.

---

## PR 1 — the engine (two-pass split + progress + reconciliation reporting; base: `main`)

### Phase 1: Type surface and composition wiring (mechanical, unblocks every later RED test)

- [x] 1.1 `src/application/sync-index.ts`: add `export interface SyncIndexOptions extends PipelineOptions { onProgress?: ProgressReporter }`; change `SyncIndex`'s constructor 6th parameter type from `PipelineOptions` to `SyncIndexOptions`; add a private `report(event: ProgressEvent): void` calling `this.options.onProgress?.(event)`, mirroring `index-documents.ts:164-166`. `report` is unused until Phase 2 — no behavior change yet.
- [x] 1.2 `src/composition.ts:117-120`: build `syncIndexOptions` with the same two-hop conditional as `:98-99` (`if (onProgress !== undefined) syncIndexOptions.onProgress = onProgress`), pass into `new SyncIndex(...)`. Correct the stale `syncIndex` field comment at `:48-49` — name both `syncScheduler`/`serve` and the future `sync` CLI action as triggers (not yet true until PR 2, but the comment should describe the intended end state landed by this change, matching Decision 6).
- [x] 1.3 `src/domain/progress.ts:2`: correct the module comment from "Progress event stream for `compendio index`" to name both commands. **No `ProgressEvent` union change** — Gate 3 scopes its diff assertion to the union, and this comment edit is explicitly in bounds.
- [x] 1.4 `npm run typecheck` green with no behavior change — confirms the two-hop conditional satisfies `exactOptionalPropertyTypes` and `serve`'s existing call site (`cli.ts:160`, no `onProgress` passed) still compiles untouched.

### Phase 2: `diff` / `applyChanged` / `applyOne` split — files-phase denominator (Decisions 1, 2, 5)

- [x] 2.1 [baseline] Run `test/application/sync-index.test.ts` unmodified — confirm all **19** `it(` cases pass on today's code. This is Gate 3's anchor; record the count so a later diff can be checked against it.
- [x] 2.2 [RED] `test/application/sync-progress.test.ts` (new file): build the harness — `SqliteIndexStore(":memory:")`, a mutable in-memory `DocumentSource` fake with a conditionally-assigned `encodingNotices` field, `FakeEmbeddings`, `onProgress` wired conditionally (`exactOptionalPropertyTypes`). Write **P1** (`discovery/start` is event 0; every `files/tick` follows the single `files/start`) and **P2** (3 indexed, then 1 edited → `files/start.total === 1`, exactly one tick `{current:1,total:1,path}`). Both fail — no phase emission exists in `SyncIndex.execute()` yet. **P2 is the assertion the whole design stands on.**
- [x] 2.3 [GREEN] `src/application/sync-index.ts`: split `processNewAndChanged` into `diff(files, existing, encodingNotices, state): ChangedFile[]` (synchronous, silent — the encoding-notice push stays here, see Phase 3) and `applyChanged(changed, state): Promise<void>` looping over `changed` via `applyOne`. Report `discovery/start` before `discover()` runs; report `files/start { total: changed.length }` after `diff` returns and before `applyChanged` starts. `applyOne` holds today's per-document body verbatim; its two `continue` statements become `return`.
- [x] 2.4 [GREEN] Exactly one `files/tick` call site: `applyChanged`'s loop calls `this.report({ phase: "files", kind: "tick", current: i+1, total, path: entry.file.path })` immediately after `await this.applyOne(entry, state)` returns — never inside `applyOne`. P1 and P2 pass.
- [x] 2.5 [invert] Add **P3** (all-unchanged pass → `files/start.total === 0`, zero `files/tick`) and **P4** (2 changed, one rejected by `policy.resolver` under `strict` → `total: 2`, ticks `1/2` and `2/2` both fire) to `sync-progress.test.ts`. P3 falsifies a suppressed `files/start`; P4 falsifies a tick trapped inside a branch a `continue`/`return` would skip.
- [x] 2.6 Add **P5** to `sync-progress.test.ts`: at the moment each `files/tick` fires, `store.getDocumentByPath(event.path) !== null` — query the store from inside the `onProgress` callback itself, not a timing assertion. Falsifies a tick emitted before `upsertDocument` commits. Do **not** write a wall-clock/timing test here — `FakeEmbeddings` resolves in a microtask and cannot reproduce the "99% then stall" illusion; P2 already covers that case via the denominator, not via timing.
- [x] 2.7 Add **P8**: a `SyncIndex` built with no `onProgress` completes a full pass without throwing. Falsifies a non-optional reporter.
- [x] 2.8 [confirm] Diff-check `test/application/sync-index.test.ts` against 2.1's baseline — all 19 original cases pass **unmodified**. A changed assertion here means diffing semantics moved (Gate 3 STOP condition); do not proceed to Phase 3 until this holds.

### Phase 3: Encoding-notice regression — the guard for behaviour that already exists (Gate 4)

- [x] 3.1 [RED] `test/application/sync-index.test.ts`: give the local `MutableSource` fake an additive `encodingNotices: EncodingNotice[] = []` field, returned from `discover()` alongside `files`/`readErrors` (default `[]`, invisible to all 19 baseline cases — `execute()` already reads `encodingNotices ?? []`). Add the Gate 4 case: index a document, then run a second pass with **identical content** and `encodingNotices: [{ path, encoding: "windows-1252" }]` on the fake → assert `report.indexed` is empty (hash matched, nothing re-indexed) **and** `report.encodingNotices` names that path. Confirm this fails if the notice push has moved into `applyChanged` — the exact "natural, wrong-looking-right" refactor this gate exists to catch, and the case has **zero** coverage today.
- [x] 3.2 [confirm/GREEN] Confirm the encoding-notice push sits inside `diff`, iterating **every** discovered file — not `applyChanged`, which by construction excludes hash-matched documents. If Phase 2 already placed it correctly this is a verification only; if not, move it now.
- [x] 3.3 Confirm 3.1's case passes and the 19-case baseline (2.8) remains untouched by this addition.

**Note on 3.1's TDD sequencing.** Implemented as an approval test (strict-tdd.md's Approval Testing pattern), not a pure RED-then-GREEN case: written and confirmed PASSING against the unrefactored code first (20/20, including the 19-case baseline), *then* the diff/applyChanged/applyOne split (Phase 2) was applied and the case confirmed still passing. This is the correct sequencing for a regression guard over *preserved* behavior — the case never needed to fail against correct code, only against the wrong refactor, which was never shipped.

### Phase 4: `reconcileVectors` → `reconcileOne`; embedding-phase emission; no `embedding/failed` (Decisions 3, 4)

- [x] 4.1 [RED] Add **P6** to `sync-progress.test.ts`: use the suite's existing `dropVector` white-box helper to manufacture one vector-coverage gap → `files/start.total === 0`, no `files/tick`, then `embedding/start {batches:1, chunks:1}` followed by `embedding/tick {current:1, total:1}`, in that order. Fails today — `reconcileVectors` emits nothing.
- [x] 4.2 [RED] Add **P7**: nothing to reconcile (no gap) → zero `embedding` events; a pass with `embeddings: null` → zero `embedding` events. Falsifies an unconditional empty `embedding/start`.
- [x] 4.3 [GREEN] `src/application/sync-index.ts`: extract `reconcileOne(embeddings, path, chunksMissing, state)` from today's per-group loop body — narrow `this.embeddings` once inside `reconcileVectors` and pass it as a parameter (no non-null assertion). `reconcileVectors` reports `embedding/start {batches, chunks}` only when `groups.length > 0` (Decision 4); one `embedding/tick` per group, hoisted above the branching exactly as Decision 2's `files/tick`, so a group whose embed throws still advances the counter. **No `embedding/failed` is ever emitted** — the embeddings-unavailable path sets `state.embeddingsWarning` and returns instead of throwing an event.
- [x] 4.4 P6 and P7 pass. Confirm no test anywhere asserts `embedding/failed` for a `SyncIndex` pass — this is the `index-progress` spec's new ADDED requirement.
- [x] 4.5 [confirm, no new test] Gate 5's fourth bullet ("`sync --lexical` completes and its documents are later vector-filled by a hybrid pass with no user action") is satisfied by the **existing, unmodified** `sync-index.test.ts` case that leaves a vector-coverage gap untouched while the provider is unavailable and reconsiders it once the provider returns — `embeddings: null` already stands in for `--lexical`. Do not write a new hybrid-run test here or in PR 2; no gate in this change requires a real embeddings provider or a model download (Non-negotiable sequencing constraint 4). The CLI-facing half is S10 (Phase 11).

### Phase 5: `SyncReport.reconciled` — written, never attempted (Decision 9, Gate 7 unit level)

- [x] 5.1 `src/application/sync-index.ts`: add `export interface ReconciledFileReport { path: string; chunks: number }`; `SyncReport` gains **non-optional** `reconciled: ReconciledFileReport[]`; `PassState` gains `reconciled: ReconciledFileReport[]`, initialized to `[]` alongside `indexed`/`skipped`/`deleted`, copied straight into the report — not through the `?? []` conditional path `embeddingsWarning`/`encodingNotices` use.
- [x] 5.2 [RED] `test/application/sync-index.test.ts`: add **R1** — index one document, `dropVector` one chunk, pass again with identical content → `reconciled` is `[{path, chunks:1}]`, `indexed` is `[]`, `totalChunks` is `0`. Fails until `reconcileOne` pushes.
- [x] 5.3 [GREEN] `reconcileOne`'s single push site: **after** `this.store.replaceEmbeddings(...)` returns (never before, never inside the `try` before the call resolves), `state.reconciled.push({ path, chunks: chunksMissing.length })`. R1 passes.
- [x] 5.4 [RED then GREEN — failure path 1 of 2] Add **R2**: same setup, second pass built with `BrokenEmbeddings` (the existing helper the current embed-failure case already uses) → `reconciled` is `[]` and `embeddingsWarning` is set. Extend the existing case additively; do not edit it (Gate 3's additions-only constraint on this file). This is one of Gate 7's two required STOP-condition falsifiers.
- [x] 5.5 [RED then GREEN — failure path 2 of 2] Add **R3**: a store wrapper whose `replaceEmbeddings` throws (the same technique the existing `upsertDocument`-throws case already uses) → `reconciled` is `[]` and the path is in `skipped`. Confirms the push sits strictly after the write returns — a throw from `replaceEmbeddings` must never reach it. This is Gate 7's other required STOP-condition falsifier.
- [x] 5.6 Add **R4**: one changed document plus, independently, one hash-matched document with a gap → `indexed.length === 1`, `reconciled.length === 1`, on different paths. Falsifies the two collections being conflated, or reconciliation being skipped when the apply sub-pass did work.
- [x] 5.7 [RED] Add **P9** to `sync-progress.test.ts`: one reconciliation group of two documents whose `embed()` throws → `embedding/start` still reports `batches: 2` (the denominator is what was **attempted**) **and** `report.reconciled` names only the surviving document (the report is what was **written**). Falsifies deriving the denominator from committed work, or the report from attempted work.
- [x] 5.8 [confirm] P9 passes without further code change if 4.3/5.3 are correct — the denominator is computed from `groups`/`missing` before the loop starts; the report is populated only inside the try/catch success branch. Record which is true; if P9 fails, the bug is in 4.3 or 5.3, not a new mechanism. **Confirmed: P9 passed on first run, no further code change needed** — the bug-free path was 4.3/5.3.
- [x] 5.9 Confirm R1–R4, P9 all pass, and the 19-case baseline (2.8) remains untouched.

### Phase 6: Out-of-blast-radius fixups (non-optional field ripple)

- [x] 6.1 `test/application/get-overview.test.ts:7-11`: add `reconciled: []` to the `fakeReport(overrides: Partial<SyncReport>)` factory — one line, mechanical, required because `reconciled` is non-optional. Not a Gate 3 violation — see Non-negotiable sequencing constraint 2.
- [x] 6.2 `test/application/sync-scheduler.test.ts:5-9`: the same one-line `reconciled: []` addition to its own `fakeReport` factory. Same non-Gate-3-subject note as 6.1.
- [x] 6.3 `npm run typecheck` (`tsc --noEmit && tsc -p tsconfig.test.json`) green — this is the check that fails loudly, and confusingly, if 6.1/6.2 are skipped. **Confirmed: typecheck failed with exactly the two predicted TS2375 errors before 6.1/6.2, green after.**

### Phase 7: Spec cross-check + PR 1 verification

- [x] 7.1 Cross-check `specs/index-progress/spec.md`'s "A `compendio sync` Pass Never Emits `embedding/failed`" requirement and its two scenarios against Phase 4. Confirm satisfied; if a genuine gap is found, record it as a risk — do not edit the spec file. **Satisfied** — grep confirms zero `embedding/failed` emission sites in `sync-index.ts`.
- [x] 7.2 Cross-check the same file's "Four Reportable Phases With Synchronously-Known Denominators" MODIFIED requirement (the `sync` row of its table and its four `sync`-specific scenarios) against Phases 2 and 4. Confirm satisfied. **Satisfied.**
- [x] 7.3 Confirm `src/application/sync-scheduler.ts` has an **empty diff** across all of Phases 1–6 (Gate 3, diff-asserted). **Confirmed via `git diff main...HEAD` — zero lines.**
- [x] 7.4 Confirm `src/domain/progress.ts`'s `ProgressEvent` union has an **empty diff** — only the module comment (1.3) moved (Gate 3, diff-asserted; a union change would mean the rejected Option C shipped). **Confirmed — diff is exactly the 3-line comment edit.**
- [x] 7.5 Confirm `serve`'s call site (`cli.ts:160`) is untouched in PR 1 (no `sync` CLI code exists yet) and still constructs its container with no `onProgress` — every emission added in Phases 2–5 is therefore inert there by construction, provable now and re-exercised by the S-series in PR 2 once the CLI can be spawned. **Confirmed — `src/cli.ts` diff is empty at this point.**
- [x] 7.6 `npm test`, `npm run typecheck`, `npm run build` green. Confirm PR 1's diff is limited to `src/application/sync-index.ts`, `src/composition.ts`, `src/domain/progress.ts` (comment only), `test/application/sync-progress.test.ts` (new), `test/application/sync-index.test.ts` (additive), `test/application/get-overview.test.ts`, `test/application/sync-scheduler.test.ts`. **All green: 662/662 tests, typecheck clean, build clean.**

---

## PR 2 — the surface (base: PR 1 branch)

### Phase 8: The `sync` command — registration, `--dir` rejection, help text (Decisions 7, 8)

- [ ] 8.1 [RED] `test/cli-subprocess.test.ts`: open a **new** `describe` block with its **own** dedicated temp workdir (its own `cpSync` of `test/fixtures/strict` + `compendio.config.json`, then `index --lexical` in `beforeAll`) — never the shared `workdir` (Non-negotiable sequencing constraint 5). Write **S8** (`compendio --help`'s command list contains `sync` — extends the array at `:116`, the one edit to an existing case) and **S9** (`compendio sync --dir <path>` exits non-zero with `unknown option '--dir'` on stderr). Both fail — no `sync` command is registered yet.
- [x] 8.2 [GREEN] `src/cli.ts`: register `program.command("sync")` with `.description(...)` and `.option("--lexical", "sync without embeddings (lexical search only)")`; add `.showHelpAfterError('(run "compendio sync --help" for the accepted options)')`. Register **no** `--dir` option — its absence is what makes S9 pass; commander's own `unknownOption()` rejects it. Action body may be a stub for now — full wiring is Phase 10.
- [x] 8.3 [RED then GREEN] Add **S7**: `sync --help` stdout contains `compendio index`, the chunking/heading-resolution caveat, the `sync.throttleMs` sentence, and the `--dir` paragraph. Write the `SYNC_HELP_NOTES` constant (the three-paragraph help body — "What a sync pass does NOT do" / "The throttle does not apply here" / "Why there is no --dir", per Decision 8) and wire it via `.addHelpText("after", SYNC_HELP_NOTES)`. S7 passes.
- [x] 8.4 Confirm S7, S8, S9 all pass, and the existing case at `:116` still asserts every other pre-existing command name unchanged.

### Phase 9: `formatSyncSummary` — the renderer, and its untestable-by-subprocess branch (Decisions 8, 9)

- [x] 9.1 [RED] `test/cli.test.ts`: add **C1** (`reconciled: []`, `skipped: []` → exactly one line, equal to today's summary string verbatim — the "must not perturb the common case" guard), **C2** (`reconciled` with two entries, `indexed: []` → two lines, line 2 is `Filled 47 missing chunk vectors across 2 documents.`), **C3** (changed documents **and** reconciliation → two lines, the two counts never merge), **C4** (reconciliation **and** skips → three lines, in order summary → `Filled` → `Skipped`). All fail — `formatSyncSummary` does not exist yet.
- [x] 9.2 [GREEN] `src/cli.ts`: export `formatSyncSummary(report: SyncReport): string[]` — the summary line unconditional (`Synced N documents (M chunks), K deleted in D ms [mode X]`), a conditional `Filled … missing chunk vectors across … documents.` line when `report.reconciled.length > 0`, a conditional `Skipped N documents with invalid frontmatter.` line when `report.skipped.length > 0`, in that order. `documents` stays unpluralized, matching the existing `Indexed 1 documents`. C1–C4 pass.
- [x] 9.3 [note, no code] Record why this function is exported and unit-tested directly rather than left inline: the `Filled …` line is unreachable from any hermetic subprocess run — reconciliation needs a real embeddings provider and no CLI flag injects a fake one — so `formatSyncSummary` is the only seam in this change that executes it in CI. Gate 2's S3–S6 still cover the wiring and the rest of the summary end to end, unchanged.

### Phase 10: CLI action wiring end to end (Decision 8)

- [x] 10.1 `src/cli.ts`: wire the `sync` action — same `resolveProgressMode`/`createProgressSink` calls as `index`'s action; `withContainer({ forceLexical: options.lexical, onProgress: progress.onProgress }, ...)`; `try { report = await container.syncIndex.execute() } finally { progress.finish() }` (finish **before** any `console.warn`, mirroring `cli.ts:48-52`'s ordering); the three `console.warn` loops (`skipped`, `encodingNotices`, `embeddingsWarning`); then `for (const line of formatSyncSummary(report)) console.log(line)`.
- [x] 10.2 Confirm `withContainer`, the `index` action, and `progress-sink.ts` are all diff-empty from this phase onward (Gate 3/6's "nothing else moved," restated for the surface layer). **Confirmed — none of the three touched.**

### Phase 11: Subprocess gates — Gates 1, 2, 5 end to end (dedicated workdir from Phase 8)

**Every `sync` spawn in this phase carries `--lexical`** — Non-negotiable sequencing constraint 4.

- [x] 11.1 [RED] Add **S1** (Gate 1): edit one document in the dedicated workdir; `sync --lexical` with `COMPENDIO_PROGRESS=plain` → stderr contains `Indexing 1 documents`, `[1/1]`, and **not** `Indexing 5 documents`.
- [x] 11.2 Add **S2** (Gate 1): run again unedited → stderr contains `Indexing 0 documents` and matches no `/\[\d+\/\d+\]/`.
- [x] 11.3 Add **S3** (Gate 2): that same edited-document run's stdout matches `/Synced 1 documents \(\d+ chunks\), 0 deleted/`; a following `search` returns the new content.
- [x] 11.4 Add **S4** (Gate 2): delete a document → stdout matches `/Synced 0 documents \(0 chunks\), 1 deleted/`; a following `search` no longer returns it.
- [x] 11.5 Add **S5** (Gate 2): add a document → stdout matches `/Synced 1 documents/`; a following `search` returns it.
- [x] 11.6 Add **S6** (Gate 2, Approach 8): a **fresh** temp dir with the corpus and no `.compendio/` → `sync --lexical` stdout matches `/Synced 5 documents/`; a following `search` finds a document.
- [x] 11.7 Add **S10** (Gate 5): `sync --lexical` exits 0 and its stdout carries `[mode lexical]`.
- [x] 11.8 [GREEN] S1–S6 and S10 pass against Phase 10's wiring. No further production change is expected here; if one fails, the bug is in Phase 10's wiring, not a new test requirement. **Confirmed: all passed on first run against Phase 10's wiring.**
- [x] 11.9 [confirm] The four existing cases against the **shared** `workdir` (`Indexed 5 documents`, the `guide-service-onboarding.md` hit, the draft deny-list pair, `Indexing 5 documents`) are untouched — the dedicated workdir from Phase 8 is what keeps them that way. **Confirmed — full file run is 20/20 green.**

### Phase 12: Vocabulary unification, spec cross-check, and docs (must land with the command — never earlier)

- [x] 12.1 Cross-check `specs/indexing/spec.md`'s new "Incremental Sync Trigger — Manual `compendio sync` Invocation" requirement and its four scenarios against Phases 8–11. Confirm satisfied. **Satisfied**: single-pass (S1-S6), throttle-independent (Non-negotiable constraint 4/design), non-zero exit on failure (uncaught in cli.ts), deletion count field (`SyncReport.deleted`, S4).
- [x] 12.2 Cross-check the same file's "Vector-Coverage Reconciliation Is Reported as Written Work, Never Attempted Work" requirement and its four scenarios against Phase 9's C1–C4 **and** PR 1's R1–R4/P9 — this is the one requirement whose evidence spans both PRs. **Satisfied.**
- [x] 12.3 Cross-check the four reworded requirements ("A Successfully Transcoded Document Is Always Reported", "Corrected Decoding Self-Heals via Incremental Sync", "In-Process Incremental Sync Concurrency Guarantee", "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents", "Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents") against Phase 3's encoding-notice coverage and the command's mere existence. None of them require a new test beyond what Phases 3/8–11 already provide; if a genuine gap is found, record it as a risk rather than writing a new test silently. **Satisfied — no gap found.**
- [x] 12.4 `README.md:211-220`: add the `sync` row to the CLI command table.
- [x] 12.5 `README.md:241-255`: retitle `## Incremental reindex` to sync language; rewrite "exactly three ways the index gets refreshed" into a four-row table (adding the manual trigger); state that `sync.throttleMs` does not gate the manual command; keep "reindex"/"full rebuild" reserved for `compendio index`. Sequenced after Phase 11, not before — Non-negotiable sequencing constraint 3.
- [x] 12.6 `CLAUDE.md`: update the two "requires a full `compendio index`" bullets (chunk-boundary, heading-only) to name both triggers; update the MCP/CLI surface description (`compendio sync` is human-only — no fourth MCP tool, Resolved decisions Q1).
- [x] 12.7 Grep the reworded `indexing/spec.md` requirements for the word `serve` in a scoping position — confirm none still reads as if only `serve` can trigger the described behavior (Gate 6's spec-grep bullet). **Confirmed clean** — every `serve` mention in the four reworded requirements is paired with "or invoked manually via `compendio sync`".

### Phase 13: Final verification — all seven gates, full suite

- [x] 13.1 `npm test`, `npm run typecheck`, `npm run build` green. **675/675 tests, typecheck clean, build clean (final run).**
- [x] 13.2 Re-run the Gate 3 diff assertions from 7.3/7.4 across the **whole** PR 1 + PR 2 span — `sync-scheduler.ts` and the `ProgressEvent` union still diff-empty; the existing "stdout identical across none/plain/bar modes" test for `index` still passes. **Confirmed: `sync-scheduler.ts` zero-diff; `progress.ts` diff is the 3-line module comment only; the cross-mode stdout test is green in the full suite run.**
- [x] 13.3 Confirm README no longer claims "exactly three ways," its refresh table has four rows, and no prose in the retitled section calls the incremental mechanism "reindexing" (Gate 6). **Confirmed by grep — see 12.4/12.5 notes.**
- [x] 13.4 Walk the seven-gate checklist in `proposal.md`'s `## Success Criteria` end to end against the finished PR 1 + PR 2 diff — not gate-by-gate in isolation this time. Record any gate whose checkbox cannot be marked; treat that as blocking, not a follow-up. **All seven gates walked and satisfied — see apply-progress.md's Gate Verification table for the full per-checkbox mapping to tests.**
- [x] 13.5 Diff-sweep the full "Asserted unchanged" table from `design.md`'s Interfaces/Contracts section: `src/domain/ports.ts`, `src/infrastructure/sqlite/**`, `src/application/index-documents.ts` (including `IndexReport`), `src/application/get-overview.ts` (the source file — its test file's one-line fixup from Phase 6 is expected), `src/cli.ts`'s `withContainer` and `index` action. Confirm each is empty-diff or, for `cli.ts`, that only the additive `sync` command/renderer/help-text moved. **All confirmed: `ports.ts`, `sqlite/**`, `index-documents.ts`, `get-overview.ts` (source) are zero-diff; `get-overview.test.ts` carries exactly the expected 1-line fixup; `cli.ts` diff is 85 insertions / 0 deletions, one contiguous additive block (import + SYNC_HELP_NOTES + formatSyncSummary + sync command) — `withContainer` and the `index` action untouched.**

**Final line-count reconciliation** (against this file's own 710–1120 forecast): code + tests = **971** changed lines (909 insertions + 62 deletions, `git diff main -- src test`); code + tests + README/CLAUDE.md = **1001**. Both inside the forecast band, nearer its upper-middle — consistent with this project's recorded pattern of forecasts landing low, though this one did not need the 3-way fallback split. Whole-branch diff including the openspec planning artifacts (proposal/design/exploration/specs/tasks) = **3314** lines (3239 insertions + 75 deletions), against the corrected ~3400–3800 total estimate — landed slightly under.
