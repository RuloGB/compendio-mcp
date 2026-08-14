# Tasks: `upsertDocument` Must Not Discard Embeddings Without a Signal

`strict_tdd: true` (`openspec/config.yaml`). Every implementation task is preceded by a RED test task
naming what it falsifies, per `design.md`'s Testing Strategy table. The `indexing` spec delta
(`openspec/changes/2026-08-14-sync-vector-contract/specs/indexing/spec.md`) is **already drafted** —
no task here writes or edits it; Phase 7 cross-checks it against the implementation.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines (design.md's driver table) | 290–475 |
| 400-line budget risk | Medium — upper bound crosses 400; design frames one PR as the working assumption with the slice cut as a named escape hatch, not a mandate |
| Chained PRs recommended | Yes (as a fallback plan) |
| Suggested split | Slice 1 (adapter + port) → Slice 2 (`SyncIndex` wiring + spec cross-check + docs) |
| Delivery strategy | ask-on-risk (default; orchestrator confirms) |
| Chain strategy | stacked-to-main, pending confirmation — Slice 1 is independently valuable (fixes the worse of the two measured cases on its own) and Slice 2 depends only on Slice 1's merged `canPersistVectors()`, not on a shared tracker branch |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium
```

**Why Medium, not High.** The design's own caveat: this project's forecasts have landed 2–4x low for
several cycles (`bounded-chunk-size` 240–420 → 773; `match-centred-excerpt` 300–470 → ~1521), so the
475 upper bound is not a hard ceiling. But the production surface here is genuinely three files under
60 lines, and Decision 6 removed the 5–20 line test-seam driver the proposal had budgeted — the
variance is concentrated entirely in the two new test files (D1–D6, G1–G6), which is exactly where
prior overruns came from. **If Slice 1 alone trends toward or past 400, stop and ship it as its own PR
before starting Slice 2** — it is a complete, independently correct fix for the fresh-install case.

### Suggested Work Units

| Unit | Goal | Base | Notes |
|---|---|---|---|
| 1 | Adapter + port: `ensureVectorTable` guard, `canPersistVectors()`, corrected `ports.ts` contract, `sqlite-index-store-degraded.test.ts` (D1–D6) | `main` | Fixes the worse measured case alone: a fresh degraded install stops sending every document to `skipped`. Satisfies Gates 4 and 5 outright. Estimated 137–210 lines |
| 2 | `SyncIndex` wiring, `sync-index-degraded.test.ts` (G1–G6), spec cross-check, `CLAUDE.md` | Unit 1 branch (or `main` post-merge) | Needs Unit 1's `canPersistVectors()` to exist. Satisfies Gates 1, 2, 3, 7. Estimated 155–265 lines (spec delta already written, cross-check only) |

## Gate Coverage Map

| Gate | Task(s) |
|---|---|
| 0 — fresh case measured | Already SATISFIED in the proposal/design; no task here |
| 1 — degradation reported | 5.2, 5.5, 6.1–6.3, 7.2 |
| 2 — document survives, stays searchable | 5.3, 5.7, plus `ThrowingStore`'s existing throw→`skipped` case (7.1, unmodified) |
| 3 — `index`/`sync` agree (fresh store only) | 5.6 |
| 4 — condition reachable from the suite | 2.1–2.9 (real `SqliteIndexStore`, not a decorator) |
| 5 — contract and adapter agree | 1.1, 2.4, 4.3 |
| 6 — nothing else moved | 1.3–1.4, 3.2, 7.1, 8.1, 8.3, 8.4 |
| 7 — no wasted embedding (active, B taken) | 5.4 |

### STOP conditions — explicit falsifiers

| Gate | STOP condition | Falsified by |
|---|---|---|
| 1 | `report.mode === "hybrid"` over a corpus with zero vectors | 5.2 (per-document case), 5.5 (all-unchanged pass — Decision 3's hole) |
| 2 | Any affected document lands in `skipped` (the rejected option C) | 5.3 |
| 3 | `IndexDocuments` and `SyncIndex` disagree on mode against the same fresh degraded store | 5.6 |
| 7 | `embed()` is invoked when vectors cannot be persisted | 5.4 |
| — | Any case in this file asserts `report.mode === "hybrid"` (proves the mock silently failed) | 5.8 |

---

## Work Unit 1 — Adapter + Port (Slice 1, base: `main`)

### Phase 1: Port contract + trivial adapter method (unblocks compilation)

- [x] 1.1 `src/domain/ports.ts`: add `canPersistVectors(): boolean` to `IndexStore` with the doc comment
      from design Decision 5 (a standing capability, distinct from `hasVectors()`'s content check —
      explicitly NOT `hasVectors()`, since that returns `false` on a healthy first-run corpus). Correct
      `upsertDocument`'s doc comment to state the embeddings-ignored-on-unavailable contract, and
      `hasVectors()`'s doc comment to cross-reference `canPersistVectors()`.
- [x] 1.2 `src/infrastructure/sqlite/sqlite-index-store.ts`: add `canPersistVectors(): boolean { return this.vectorsEnabled; }`. Deliberately not `this.vectorsEnabled && this.tableExists("chunks_vec")` — the table is created lazily, and including its existence would reproduce the `hasVectors()` trap (Decision 5).
- [x] 1.3 `test/application/sync-index.test.ts`: add one delegating `canPersistVectors(): boolean { return this.inner.canPersistVectors(); }` to each of `RecordingStore` (`:466`), `ThrowingStore` (`:570`), `ReplaceThrowsStore` (`:733`). Additive only — no existing assertion changes.
- [x] 1.4 `npm run typecheck` and `npm test` green — confirms the interface addition compiles across every `IndexStore` implementer with zero behavior change yet (Gate 6 baseline).

### Phase 2: `sqlite-index-store-degraded.test.ts` — D1–D6 (Gate 4, 5)

- [x] 2.1 [new file] Create `test/infrastructure/sqlite-index-store-degraded.test.ts`. Declare
      `vi.mock("sqlite-vec", () => ({ load: () => { throw new Error("simulated: sqlite-vec unavailable on this platform"); } }))` (Decision 6) so the real `loadVectorExtension`'s catch takes its real
      `return false` branch. If vitest's CJS interop rejects the factory for missing a `default` export,
      change it to `() => { const load = () => { throw new Error(...); }; return { load, default: { load } }; }` (Decision 6's named wrinkle) — check this at file-creation time, not discovered later.
      Ran without the `default` export wrinkle; vitest's CJS interop accepted the factory as-is.
- [x] 2.2 [D1] Case: fresh degraded `SqliteIndexStore(":memory:")` → `canPersistVectors()` is `false`.
      Falsifies the query being wired to `tableExists`/`hasVectors`. Expected green immediately (1.2
      already implements the trivial half); not the load-bearing case.
- [x] 2.3 [D2 — RED, load-bearing] Case: fresh degraded store, `upsertDocument(meta, chunks, [vector])` →
      assert no throw; `getDocumentByPath` finds the document; `searchLexical` finds its content;
      `chunks_vec` is absent from `sqlite_master`. **Run and confirm this FAILS today** with
      `SqliteError: no such module: vec0` — this is the single most load-bearing test in the change; the
      `sqlite_master` assertion is what distinguishes "guard fired" from "guard absent but the table
      happened to exist." CONFIRMED: failed with exactly `SqliteError: no such module: vec0` before 2.4.
- [x] 2.4 [D2 — GREEN] `src/infrastructure/sqlite/sqlite-index-store.ts`'s `ensureVectorTable`: add
      `if (!this.vectorsEnabled) return;` as its first line. Replace its one-line doc comment with the
      expanded comment from design Decision 2 (why the guard sits inside the method rather than at the
      `upsertDocument` call site — the choke point for all three vector-touching callers — and why
      `upsertDocument` calling this OUTSIDE its transaction makes an unguarded throw here take the
      document, its chunks and its FTS rows down with it). Confirm 2.3 now passes. CONFIRMED green.
- [x] 2.5 [D3] Case: the same call's `embeddings` argument is ignored — `hasVectors()` stays `false`,
      `listChunksMissingVectors()` stays `[]`. Falsifies the documented ignore-on-unavailable contract
      (1.1) drifting back into being accidental.
- [x] 2.6 [D4] Case: **carried-over** degraded store. Seed a temp-file db —
      `const real = await vi.importActual<typeof import("sqlite-vec")>("sqlite-vec")`, a raw
      `new Database(file)`, `real.load(db)`, the `CREATE VIRTUAL TABLE ... USING vec0(...)` statement,
      `db.close()` — then construct `new SqliteIndexStore(file)` through the mocked loader.
      `upsertDocument` does not throw, the document commits, `chunks_vec` gains no row. Falsifies case 2
      regressing and the "two cases collapse into one" claim (Decision 2's consequence).
- [x] 2.7 [D5] Case: `reset()` on that same carried-over database **throws** `no such module: vec0`.
      Commit this as a **documenting assertion of today's broken behavior** (Decision 7) — comment it
      explicitly as a pin for a separate future change, not a guarantee. Do NOT patch `reset()` to make
      this pass; `reset()` is out of scope for this change.
- [x] 2.8 [D6] Case: `saveEmbeddings([...])` and `replaceEmbeddings([...])` on a degraded store still
      **throw** `"the sqlite-vec extension is not available in this installation"`. Falsifies the new
      no-op guard being "simplified" into a substitute for their explicit throws — which would silently
      stop `compendio index` from warning (`index-documents.ts:157-161`).
- [x] 2.9 [confirm] Run the whole file: D1–D6 green. Record explicitly that D2 failed before 2.4 and
      passes after — this transition is Gate 4/5's central evidence. CONFIRMED: 6/6 green; D2 failed
      with `SqliteError: no such module: vec0` before 2.4, passed after.

### Phase 3: Healthy-store regression (Gate 6)

- [x] 3.1 `test/infrastructure/sqlite-index-store.test.ts`: add one case — `canPersistVectors()` is
      `true` on a healthy (unmocked) store. The mocked file (Phase 2) can only prove the `false` half.
- [x] 3.2 [confirm, no code change] Re-run the existing case "writes embeddings for a brand-new document
      even before any compendio index run" (`:257-270`) — confirm it passes **unmodified** against the
      guarded `ensureVectorTable`. This is the exact case a `tableExists`-based guard variant (the wrong
      form named in Decision 2) would break. CONFIRMED green, unmodified (28/28 tests in file pass).

### Phase 4: Slice 1 verification

- [x] 4.1 `npm test`, `npm run typecheck`, `npm run build` green. CONFIRMED: 682/682 tests pass (45 files,
      up from 675/44 baseline), typecheck clean, build clean.
- [x] 4.2 Confirm Gate 4: D1–D6 all drive a real `SqliteIndexStore` — none is a decorator simulation.
      CONFIRMED — every case in `sqlite-index-store-degraded.test.ts` constructs `new SqliteIndexStore(...)`
      directly (`:memory:` for D1–D3, D6; a temp-file db for D4–D5), no `IndexStore` decorator involved.
- [x] 4.3 Confirm Gate 5: diff `ports.ts`'s three corrected doc comments against Decision 5's text; walk
      every vector-touching method in `SqliteIndexStore` (`ensureVectorTable`, `upsertDocument`'s
      `insertVec` gate, `deleteDocumentRows`'s `vecGuarded`, `saveEmbeddings`, `replaceEmbeddings`,
      `listChunksMissingVectors`, `hasVectors`, `searchVector`) and confirm each consults
      `vectorsEnabled` before reaching DDL or a write. CONFIRMED — `ports.ts`'s `upsertDocument`,
      `canPersistVectors()` and `hasVectors()` comments match Decision 5 verbatim; every listed method
      still gates on `this.vectorsEnabled` (directly or via `vecGuarded`/the `insertVec` conjunction),
      unchanged except `ensureVectorTable`'s new early return.
- [x] 4.4 Confirm Slice 1's diff is limited to `src/domain/ports.ts`, `src/infrastructure/sqlite/sqlite-index-store.ts`, `test/infrastructure/sqlite-index-store-degraded.test.ts` (new), `test/infrastructure/sqlite-index-store.test.ts` (additive), `test/application/sync-index.test.ts` (additive, three methods). Record the actual line count against the 137–210 estimate.
      CONFIRMED — `git diff --stat` on the four modified files: 52 changed lines (21 ports.ts, 20
      sqlite-index-store.ts, 9 sync-index.test.ts, 7 sqlite-index-store.test.ts) + 152 lines in the new
      `sqlite-index-store-degraded.test.ts` = **204 total**, inside the 137–210 estimate. No other file
      touched.

---

## Work Unit 2 — `SyncIndex` Wiring + Spec Cross-Check + Docs (Slice 2, base: Unit 1 branch)

### Phase 5: `sync-index-degraded.test.ts` — G1–G6 (Gates 1, 2, 3, 7)

- [ ] 5.1 [new file] Create `test/application/sync-index-degraded.test.ts`. Declare its own
      `vi.mock("sqlite-vec", ...)` (same shape as 2.1 — `vi.mock` is file-scoped, so this does not
      degrade Phase 1's decorator-only cases in `sync-index.test.ts`). Build the harness: a real
      `SqliteIndexStore(":memory:")` under the mock, a mutable in-memory `DocumentSource` (mirroring
      `MutableSource` in `sync-index.test.ts:40-47`), and a locally re-declared `RecordingEmbeddings`
      wrapping `new FakeEmbeddings()` (mirrors `sync-index.test.ts:81-88`, re-declared rather than
      imported, to keep that file's diff additions-only per Decision 6).
- [ ] 5.2 [G1 — RED, Gate 1] Case: one new document, working provider, degraded store → after the pass,
      `report.mode === "lexical"`; `embeddingsWarning` is non-empty, contains `"vector storage"`, and
      does **not** contain `"provider unavailable"`. **Confirm this FAILS today** — reports
      `mode: "hybrid"`.
- [ ] 5.3 [G2, Gate 2] Same pass → the path is in `indexed`, absent from `skipped`, and
      `store.searchLexical` returns its content. This is the assertion the rejected option C (throwing
      from `upsertDocument`) cannot pass.
- [ ] 5.4 [G3, Gate 7] Same pass → `recording.calls` (the `RecordingEmbeddings` wrapper) is `[]` — zero
      `embed()` invocations. Falsifies shipping option A instead of B (the wasted-CPU half left unfixed).
- [ ] 5.5 [G4 — RED, Gate 1] Case: a **second** pass over identical content (nothing changed) → still
      `mode === "lexical"` with the warning, and `indexed` is `[]`. **Confirm this FAILS** against a fix
      scoped only to `applyOne` (Decision 3's hole — an all-unchanged pass never enters `applyOne`).
- [ ] 5.6 [G5, Gate 3] Case: `IndexDocuments.execute()` (not `SyncIndex`) over the same corpus against a
      **fresh** degraded store → `mode === "lexical"` and a non-empty `embeddingsWarning`. Scoped to a
      fresh store only (Decision 7's narrowing) — do not extend to a carried-over store; `compendio
      index` is itself broken there via `reset()` (pinned by D5, not fixed here).
- [ ] 5.7 [G6, Gates 1, 2] Case: the carried-over fixture (same seeding technique as 2.6) driven through
      a full `SyncIndex` pass → identical outcome to G1+G2. Falsifies the two cases diverging after the
      guard.
- [ ] 5.8 [guard, no new case] Confirm no case in this file asserts `report.mode === "hybrid"` anywhere —
      every store here is degraded by construction; a `hybrid` expectation would mean the mock silently
      failed to take effect. G1's `lexical` assertion doubles as the mock's own liveness check (D1 pins
      it independently at the adapter).

### Phase 6: `SyncIndex` implementation — GREEN (Decision 3)

- [ ] 6.1 `src/application/sync-index.ts`: add `vectorsPersistable: boolean` to the module-private
      `PassState` interface, with the doc comment from design Decision 3 (answered once per pass since
      `canPersistVectors()` reflects a load attempt made in the constructor and cannot change mid-pass).
- [ ] 6.2 In `execute()`, immediately after `state` is built: set
      `state.vectorsPersistable = this.embeddings === null || this.store.canPersistVectors();` and, when
      `false`, `state.embeddingsWarning = "embeddings not persisted (vector storage unavailable): search runs in lexical mode"` (Decision 4's new warning variant — verbatim string, third in the family
      alongside the two existing ones).
- [ ] 6.3 In `applyOne` (`:213-223`), replace the two-branch embed block with the three-way form from
      Decision 3: `this.embeddings === null` → unchanged provider-unavailable warning branch;
      `else if (state.vectorsPersistable)` → the existing try/embed/catch block, unchanged; no third
      branch — when neither condition holds, `chunkEmbeddings` stays `null` and the pass-level warning
      set in 6.2 already covers it.
- [ ] 6.4 Run G1–G6: confirm all green, and specifically confirm 5.2 and 5.5 (the two RED cases) now
      pass.

### Phase 7: Regression confirmation, spec cross-check, docs

- [ ] 7.1 [confirm] Re-run `test/application/sync-index.test.ts` in full — every pre-existing case
      passes, plus the three additive `canPersistVectors()` delegating methods from 1.3, with **no
      assertion modified** (Gate 6). Confirm `ThrowingStore`'s throw→`skipped` case (`:628-658`) still
      passes unmodified (Gate 2's negative half).
- [ ] 7.2 Cross-check `openspec/changes/2026-08-14-sync-vector-contract/specs/indexing/spec.md`'s two
      ADDED requirements — "Embeddings Degradation Reporting Is Trigger-Agnostic and Cause-Agnostic" (3
      scenarios) and "`IndexStore` States Vector-Persistence Capability and Enforces It Consistently" (3
      scenarios) — against Phases 2, 5, 6. Record which test satisfies each scenario (D1–D6, G1–G6). Do
      not edit the spec file; it is already drafted.
- [ ] 7.3 `CLAUDE.md`: widen the "Graceful degradation on embeddings failure" bullet. It currently names
      only the embeddings provider as a cause and only `IndexDocuments` as a trigger. Reword to cover
      both triggers (`IndexDocuments` and `SyncIndex`) and both causes (provider missing/throws, OR the
      store cannot persist vectors — `canPersistVectors()` false), matching the trigger-agnostic,
      cause-agnostic framing of the spec delta.
- [ ] 7.4 Confirm the five existing vector-coverage-reconciliation scenarios in the canonical
      `openspec/specs/indexing/spec.md` remain untouched — in particular "Vector table has never been
      created," whose no-op stays correct and is not edited by this change.

### Phase 8: Whole-change verification

- [ ] 8.1 `npm test`, `npm run typecheck`, `npm run build` green.
- [ ] 8.2 Walk the proposal's Gate 0–7 checklist end to end against the finished diff (both slices);
      record which test(s) satisfy each gate. Gate 0 already satisfied (measured in the proposal). Gate
      7 is active because option B was taken — satisfied by 5.4.
- [ ] 8.3 Diff-sweep the design's "Asserted unchanged" table: `src/application/index-documents.ts`
      (including `IndexReport`), `src/application/search-documents.ts`, `src/application/get-overview.ts`, `SCHEMA_DDL`/`migrate()`/`reset()`, `SqliteIndexStore`'s constructor signature,
      `SavedDocument`/`SyncReport`/`IndexReport` shapes. Confirm each is empty-diff.
- [ ] 8.4 Confirm `hasVectors()`'s adapter body (`sqlite-index-store.ts:322-326`) is byte-identical to
      before this change, and it is not used anywhere as the `canPersistVectors()` query (Gate 6's fourth
      bullet). Confirm `SyncReport.mode`'s computation line (`sync-index.ts:137`) and `SyncReport`'s
      shape are otherwise unchanged — the fix flows entirely through `state.embeddingsWarning`/
      `state.vectorsPersistable`, never through a new report field.
- [ ] 8.5 Record the final changed-line count (per work unit and total) against the 137–210 / 155–265 /
      290–475 forecasts, the same way `manual-sync-command` and `encoding-aware-reads` reconciled their
      own forecasts at the end of `tasks.md`.
