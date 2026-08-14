# Verify Report: `upsertDocument` Must Not Discard Embeddings Without a Signal

**Change**: `2026-08-14-sync-vector-contract` · **Branch**: `fix/sync-vector-contract` (5 commits on `main` @ `fce813f`)
**Mode**: openspec (Engram unavailable this cycle) · **Verdict**: **PASS**

## Summary

All 8 gates (0-7) pass with independently reproduced evidence, not just cited numbers. The rejected
option C (throw from `upsertDocument`) stays rejected — verified both by inspection and by the
`ThrowingStore` negative test, which is genuinely discriminating (still passes unmodified). All
asserted-unchanged files (`index-documents.ts`, `search-documents.ts`, `get-overview.ts`, `SCHEMA_DDL`,
`migrate()`, `reset()`, the store constructor signature) show empty diffs. `test/application/sync-index.test.ts`
diff is additions-only (three delegating `canPersistVectors()` methods, zero assertion changes). No
`application/` to `infrastructure/` import exists anywhere in the diff (or the codebase). `npm test` /
`npm run typecheck` / `npm run build` are all clean, independently re-run in this session. Two
orchestrator claims were independently reproduced by temporarily mutating source and reverting it: the
`ensureVectorTable` guard is load-bearing (removing it breaks D2/D3 with the exact predicted
`SqliteError: no such module: vec0`), and Decision 3's pass-level placement is load-bearing (moving the
warning into `applyOne` leaves exactly 5/6 G-tests green and fails only G4).

## Commands run (verbatim)

```
$ npm test
 Test Files  46 passed (46)
      Tests  688 passed (688)
   Duration  11.80s (transform 3.45s, setup 0ms, import 13.63s, tests 17.62s, environment 7ms)

$ npm run typecheck
> tsc --noEmit && tsc -p tsconfig.test.json
(clean, no output)

$ npm run build
> tsc
(clean, no output)
```

Re-run after both mutation experiments below (guard-removed, then warning-relocated), tree restored
each time via `git checkout --`, to confirm the restored tree is genuinely back to green:

```
$ npm test   (post-restore)
 Test Files  46 passed (46)
      Tests  688 passed (688)
```

`git status --short` at the end of the session: only the pre-existing untracked
`code-review-src-2026-08-14.md` (present at session start, not touched). Working tree is clean with
respect to every tracked file.

## Gate-by-gate

| Gate | Result | Evidence |
|---|---|---|
| **0** — fresh case measured before design settles | PASS (pre-satisfied) | proposal.md's measured probe output, re-confirmed structurally: guard-removal experiment below reproduces the exact `SqliteError: no such module: vec0` on the fresh case |
| **1** — degradation is reported | PASS | `sync-index-degraded.test.ts` G1 (per-document pass, mode is "lexical", warning contains "vector storage", not "provider unavailable") and G4 (all-unchanged pass, still "lexical") both pass in the current suite |
| **2** — document survives, stays searchable | PASS | G2 (`indexed` contains the path, `skipped` is empty, `searchLexical` returns content) and G6 (carried-over fixture, same assertions) pass. Discriminating power confirmed: `ThrowingStore`'s existing case (`sync-index.test.ts:572-664`) still asserts throw leads to `skipped`, unmodified, and still passes — this is the exact negative case that would fail if option C had been implemented instead |
| **3** — `index`/`sync` agree (fresh store only, per Decision 7's measured narrowing) | PASS | G5: `IndexDocuments.execute()` over a fresh degraded store reports `mode: "lexical"` with a non-empty `embeddingsWarning` — same outcome as `SyncIndex` (G1). Correctly narrowed to a fresh store; Decision 7 documents (and D5 pins) that a carried-over store makes `compendio index` itself broken via `reset()`, so it cannot be the reference behaviour there |
| **4** — condition reachable from the test suite | PASS | Confirmed by direct inspection: every D1-D6 case and every G1-G6 case constructs a real `SqliteIndexStore` (`:memory:` or a temp-file db) under `vi.mock("sqlite-vec", ...)` — no `IndexStore` decorator involved in any degraded-path assertion. Nothing waived |
| **5** — contract and adapter agree | PASS | `ports.ts`'s `upsertDocument` doc comment states the vector-availability condition and the ignore-on-unavailable outcome; `canPersistVectors()`'s doc comment explicitly says "NOT hasVectors()" with the reason; `hasVectors()`'s comment cross-references it. Every vector-touching method in `sqlite-index-store.ts` consults `vectorsEnabled` before reaching DDL or a write — grepped and confirmed line-by-line |
| **6** — nothing else moved | PASS | `npm test`/`typecheck`/`build` all green (re-run independently). `sync-index.test.ts` diff is 3 additive delegating methods only (confirmed via `git diff`), zero assertion changes. `sqlite-index-store.test.ts`'s existing brand-new-document case is present and unmodified (only one new case added). `hasVectors()`'s body (`sqlite-index-store.ts:340-344`) is untouched — confirmed by direct read, not grep alone — and not used anywhere as `canPersistVectors()`'s implementation |
| **7** — no wasted embedding (active, option B taken) | PASS | G3: `RecordingEmbeddings` wrapper records `recording.calls` as `[]` (zero `embed()` invocations) for a pass where vectors cannot be persisted. This is exactly the counting-embeddings test the task requires, and it passes in the 688/688 green run |

## Independent reproductions (not just cited)

### 1. `ensureVectorTable` guard is load-bearing

Removed `if (!this.vectorsEnabled) return;` from `ensureVectorTable` (`sqlite-index-store.ts`), ran
`test/infrastructure/sqlite-index-store-degraded.test.ts`:

```
FAIL D2: upsertDocument with non-null embeddings does not throw; ...
  AssertionError: expected [Function] to not throw an error but
  'SqliteError: no such module: vec0' was thrown
FAIL D3: the embeddings argument is ignored -- hasVectors() stays false, ...
  SqliteError: no such module: vec0
    at SqliteIndexStore.ensureVectorTable src/infrastructure/sqlite/sqlite-index-store.ts:331:13
    at SqliteIndexStore.upsertDocument src/infrastructure/sqlite/sqlite-index-store.ts:241:12
Test Files  1 failed (1)
     Tests  2 failed | 4 passed (6)
```

Matches Gate 0's measured case 1 exactly. D4 (carried-over case) still passed even with the guard
removed — this is expected and consistent with design.md's documentation: case 2's `CREATE VIRTUAL
TABLE IF NOT EXISTS` short-circuits on the existing table name before resolving the module, so it never
throws with or without the guard; the guard exists specifically to close case 1 (fresh), and D2/D3 are
the tests that discriminate it. Restored via `git checkout -- src/infrastructure/sqlite/sqlite-index-store.ts`;
confirmed clean.

### 2. Decision 3's pass-level placement is load-bearing

Moved the pass-level warning-setting (`execute()`'s check of `state.vectorsPersistable` that sets
`state.embeddingsWarning`) into a new `else` branch inside `applyOne`'s embed block (the naive
per-document placement), ran `test/application/sync-index-degraded.test.ts`:

```
FAIL G4: a second pass over identical content still reports lexical mode with the warning, ...
  AssertionError: expected 'hybrid' to be 'lexical'
Test Files  1 failed (1)
     Tests  1 failed | 5 passed (6)
```

Exactly 5/6 green, only G4 (the all-unchanged-pass case, Decision 3's hole) fails, matching the
orchestrator's prior claim precisely. Restored via `git checkout -- src/application/sync-index.ts`;
confirmed clean. Full suite re-run after restore: 688/688 green.

## Spec compliance matrix

### Requirement: Embeddings Degradation Reporting Is Trigger-Agnostic and Cause-Agnostic

| Scenario | Covering test | Status |
|---|---|---|
| Vectors cannot be persisted while the provider works | G1 + G2 (`sync-index-degraded.test.ts`) | PASS — verified running |
| The same store, on a pass that changes nothing | G4 | PASS — verified running, and its RED-before-fix transition independently reproduced above |
| A genuine hard write failure is still a skip, not a degrade | `ThrowingStore`'s existing case (`sync-index.test.ts:572-664`), unmodified | PASS — this is the negative half that stops option C from satisfying the spec vacuously; confirmed it is a real, unmodified, still-passing test |

### Requirement: `IndexStore` States Vector-Persistence Capability and Enforces It Consistently

| Scenario | Covering test | Status |
|---|---|---|
| The capability query reflects unavailability | D1 (`sqlite-index-store-degraded.test.ts`) | PASS |
| `upsertDocument` ignores embeddings without throwing, document still commits | D2/D3/D4 | PASS — D2 independently reproduced as RED against the unguarded code above |
| `saveEmbeddings`/`replaceEmbeddings` still throw when vectors cannot be persisted | D6 | PASS — confirms the guard was not "simplified" into a substitute for their explicit throws |

Both requirements: every scenario has a passing, discriminating covering test. No gap found.

## Design decision compliance

| Decision | Honored? | Evidence |
|---|---|---|
| D1 — option B, no A, C rejected | Yes | `SavedDocument` diff is empty (confirmed via the design's asserted-unchanged table and the `ports.ts` diff — no field added to `SavedDocument`); `IndexStore` gains `canPersistVectors()` instead |
| D2 — guard inside `ensureVectorTable`, correct form (`vectorsEnabled` alone, not `&& tableExists`) | Yes | `if (!this.vectorsEnabled) return;` is the sole added line; confirmed the wrong form (`|| !tableExists`) is NOT present anywhere in the diff |
| D3 — `canPersistVectors()` queried once per pass, in `execute()`, not per-document in `applyOne` | Yes | Confirmed by direct read of `sync-index.ts:132-137` (pass-level) vs. `:226` (`applyOne`'s `else if (state.vectorsPersistable)` reads the pass-level field, does not requery). Independently reproduced as load-bearing above |
| D4 — third warning variant names vector persistence, not provider | Yes | Warning string is distinct from both existing variants; G1 asserts it does NOT contain "provider unavailable" |
| D5 — corrected port contract, `SavedDocument` unchanged | Yes | `ports.ts` diff confirmed: doc comments corrected on `upsertDocument` and `hasVectors()`, new `canPersistVectors()` doc comment added; no shape change to `SavedDocument` |
| D6 — no production seam, `vi.mock("sqlite-vec")` in two new files | Yes | Both new test files declare file-scoped `vi.mock("sqlite-vec", ...)`; `SqliteIndexStore`'s constructor signature diff is empty |
| D7 — `reset()` NOT patched; D5 test is a documenting assertion of broken behavior, not a guarantee | Yes | `git diff` confirms zero changes to `reset()`/`migrate()`/`SCHEMA_DDL`. The test case D5 in `sqlite-index-store-degraded.test.ts` (line 144) is explicitly commented as a documenting assertion of today's broken behaviour, not a guarantee, and asserts `store.reset()` throws `no such module: vec0` — this pins the broken state, it does not claim a fix |

## Rejected fix (option C) confirmed still rejected

- `upsertDocument`'s transaction wrapping (`this.db.transaction(...)`) is unchanged in the diff — no
  throw was introduced inside it for a vector-only failure.
- `applyOne`'s catch block routing to `state.skipped` is unchanged (confirmed via the `sync-index.ts`
  diff — only the embed block and `PassState` changed; the try/catch around `upsertDocument` itself was
  not touched).
- `ThrowingStore`'s pinned throw-then-skipped behavior still passes unmodified, which is the assertion
  that would fail if C had been reintroduced anywhere in the call chain.

## Asserted-unchanged files — verified via diff, not assumed

| File | `git diff main...HEAD` | Result |
|---|---|---|
| `src/application/index-documents.ts` | empty | confirmed |
| `src/application/search-documents.ts` | empty | confirmed |
| `src/application/get-overview.ts` | empty | confirmed |
| `SCHEMA_DDL`, `migrate()`, `reset()` (grepped against `sqlite-index-store.ts`'s diff) | no matches | confirmed — the store's diff touches only `canPersistVectors()` (new method) and `ensureVectorTable`'s guard/comment |
| `SqliteIndexStore`'s constructor signature | unchanged | confirmed by reading the diff hunk boundaries — no constructor touched |
| `SavedDocument`, `SyncReport`, `IndexReport` shapes | unchanged | `SyncReport` interface read directly (`sync-index.ts:37-56`) — `mode` computation line and full shape match pre-change; `SavedDocument` absent from the `ports.ts` diff entirely |
| `hasVectors()`'s body | byte-identical | read directly (`sqlite-index-store.ts:340-344`); only its doc comment changed |

## Hexagonal layering check

```
$ grep -rln "infrastructure" src/application/*.ts
(no matches)
```

No `application/` to `infrastructure/` import exists anywhere in `src/application/`, in this diff or in
the pre-existing codebase. This change introduces no layering violation. (Consistent with the sibling
change's independent finding that the only such import in the repo predates both changes and is
unrelated to either.)

## Task completeness

All boxes in `tasks.md` are checked (Work Unit 1 Phases 1-4, Work Unit 2 Phases 5-8). Spot-checked
against the actual repository state rather than trusted at face value:

- 1.1-1.4: `ports.ts` doc comments, `canPersistVectors()` on the adapter, three delegating methods on
  the decorators, green typecheck/test — all confirmed present in the diff.
- 2.1-2.9 (D1-D6): all six cases present in `sqlite-index-store-degraded.test.ts`, all passing in the
  current suite, D2's RED-to-GREEN transition independently reproduced above.
- 3.1-3.2: healthy-store `canPersistVectors()` case present; existing brand-new-document case present
  and unmodified.
- 4.1-4.4: line-count reconciliation in 8.5 is internally consistent (209 for Slice 1, matching the
  `git diff --numstat` re-check noted in the task itself).
- 5.1-5.8 (G1-G6): all six cases present in `sync-index-degraded.test.ts`, all passing, G4's RED-to-GREEN
  transition independently reproduced above, no "hybrid" assertion anywhere in the file (grepped,
  confirmed empty).
- 6.1-6.4: `PassState.vectorsPersistable`, pass-level query/warning in `execute()`, `applyOne`'s
  `else if` — all confirmed by direct read.
- 7.1-7.4: `sync-index.test.ts` full-file diff confirmed additions-only; spec cross-check in 7.2 matches
  the actual spec file content read above; `CLAUDE.md`'s bullet is the trigger-agnostic/cause-agnostic
  rewrite, confirmed by diff; canonical `openspec/specs/indexing/spec.md` confirmed untouched by this
  branch (only the change's own `specs/indexing/spec.md` delta file exists).
- 8.1-8.5: `npm test`/`typecheck`/`build` re-run clean in this session (688/688); gate walk matches;
  asserted-unchanged sweep matches; `hasVectors()` body/`SyncReport.mode` line confirmed unchanged;
  line-count total (449) is consistent with `git diff main...HEAD --stat`'s reported insertions for the
  source and test files, no material discrepancy.

No unchecked task found. No task claims contradicted by the actual code state.

## Findings

None rise to CRITICAL or WARNING.

**SUGGESTION** (non-blocking, informational only — matches design.md's own explicitly named residual
non-guarantee): the `vi.mock("sqlite-vec")` approach proves the adapter's behavior when the loader
throws, not that `sqlite-vec` actually fails to load in any given real deployment environment. This is
already named and accepted in Decision 6 (that second question is a platform fact, not a testable
property of this codebase) — recorded here only so it is visible in the verify report rather than
solely in design.md.

**SUGGESTION** (non-blocking): the `reset()` hard failure on a carried-over degraded database (Decision
7) is a real, measured, user-facing defect (`compendio index` dies outright rather than degrading) that
this change correctly scopes out and files for a separate change. Confirmed the scoping is honest — D5
pins the broken state as a regression guard, not a false guarantee — but flagging that the follow-up
change is not yet proposed anywhere in `openspec/changes/`, so nothing currently tracks it besides this
design.md's prose.

## Verdict

**PASS.** All 8 gates hold under independent re-execution, not just re-reading. Both prior orchestrator
claims (guard removal breaks D2/D3; naive warning placement fails only G4) were reproduced exactly,
matching the error messages verbatim. The rejected option C stays rejected and is protected by a
genuinely discriminating negative test. All asserted-unchanged files are verified empty-diff, not
assumed. No layering violation. Tree is clean at the end of this session (only the pre-existing
untracked `code-review-src-2026-08-14.md` remains, present before this verify session began and
untouched by it).

**Ship it.**
