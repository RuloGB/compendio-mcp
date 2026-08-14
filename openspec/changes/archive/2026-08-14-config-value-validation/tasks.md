# Tasks: Config Value Validation — one policy for every declared numeric key, and a channel that says so

`strict_tdd: true`. Design and specs are settled (`design.md`, `specs/configuration/spec.md`,
`specs/mcp-contract/spec.md`) — this phase does not reopen decisions or edit spec files, only
implements against them and cross-checks. Fork C, two chained PRs (design Decision 1, 2); both slices
ship this cycle (design's Open Question 2, resolved 2026-08-14).

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines — Slice 1 | 255–440 (design.md Decision 2 table) |
| Estimated changed lines — Slice 2 | 295–510 (design.md Decision 2 table) |
| 400-line budget risk — Slice 1 | Medium (high end 440 marginally over budget) |
| 400-line budget risk — Slice 2 | High (mid-to-high end well over budget) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (validation + hygiene, silent) → PR 2 (reporting channel) |
| Delivery strategy | ask-on-risk (default assumed — not stated in this phase's input) |
| Chain strategy | stacked-to-main (recommended) |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

**Why stacked-to-main, not feature-branch-chain.** Design Decision 2: "Slice 1 is independently
shippable and independently valuable: it closes the `configuration/spec.md:221` violation … and passes
Gates 1–5 alone." A slice that is correct and valuable on its own merges to `main` on its own; PR 2
bases off `main` post-merge, not off an unmerged PR 1 branch. Confirm this with the user before apply —
the slice *count and order* are already resolved (design, Open Question 2), only the branching
mechanics are a fresh ask.

**Drift warning, carried forward rather than smoothed.** This repository's forecasts have landed 2–4×
low for several consecutive cycles (`bounded-chunk-size` 240–420 → 773 actual; `match-centred-excerpt`
300–470 → ~1521; `incremental-reindex` missed 2×; see design.md Decision 2 and proposal.md "Delivery
size"). Treat both ranges' high ends as a floor, not a ceiling — re-forecast after Phase 6 (end of
Slice 1) before starting Slice 2, and flag drift past ~600 lines on either slice as a mid-apply
size:exception conversation, not a silent absorb.

### Suggested Work Units

| Unit | Goal | Base branch | Notes |
|---|---|---|---|
| PR 1 | `positiveNumber`/`positiveInteger`, four call sites, whitelist hygiene, chunk-bound + search.k integration tests, `configuration` spec cross-check, `CLAUDE.md` | `main` | Behavior-preserving except silent fallbacks; independently mergeable (Gates 1–5) |
| PR 2 | `ConfigWarning`/`loadConfigReport`, `Container.configWarnings`, CLI + `docs_overview` rendering, `mcp-contract` spec cross-check, `README.md` | `main`, post PR 1 merge | Depends on PR 1's predicates; adds the reporting channel only |

## Gate Mapping (proposal.md Success Criteria + design.md's Gate 6)

| Gate | What it asserts | Task(s) |
|---|---|---|
| 1 — spec violation reproduced, then closed | 1.1–1.3, 4.1 |
| 2 — `search.k` config default validated | 4.2–4.3 |
| 3 — valid values untouched, nothing clamped | 2.1–2.3, 5.2 |
| 4 — rationale comment true of every branch | 3.1–3.3 |
| 5 — nothing else moved | 5.1–5.4, 11.1–11.3 |
| 6 — warning visible where a user actually is | 7.1–7.4, 8.1–8.3, 9.1–9.3, 10.1–10.4, 11.4 |

### STOP conditions

| Gate | STOP if | Guarded by |
|---|---|---|
| 1 | `{"maxTokens": 0}` / `"abc"` / `null` does NOT explode before the fix (falsifies design's reachability table) | 1.2 |
| 3 | A `maxTokens: 1` / `throttleMs: 100` / `k: 3` case gets clamped instead of honored exactly | 2.3, 5.2 |
| 6 | `Config:` block renders on a clean/no-config project, or `search_docs`' response shape changes | 10.4 |

---

## Slice 1 — Validation & Hygiene (PR 1, base: `main`)

**End state**: `search.k`, `chunk.minTokens`, `chunk.maxTokens` validate exactly as
`sync.throttleMs` already does — silently, uniformly, no clamping. No warning surface exists yet; an
invalid `chunk.maxTokens: "600"` still silently reverts to 480 at the end of this slice (the exact
silence the change exists to end — closed only by Slice 2).

### Phase 1: Gate 1 — reproduce the explosion, then measure the fix (chunk-bound integration test)

- [x] 1.1 [RED] Create `test/application/chunk-bound-config.test.ts`. Reuse `STRICT_FIXTURE_DOCS` /
      `STRICT_FIXTURE_CONVENTION` (`test/helpers/build.ts`, unmodified) with `FakeEmbeddings`. For each
      row of the design's corrected fixture table — no `chunk` block (control), `{"maxTokens":0}`,
      `{"maxTokens":"abc"}`, `{"maxTokens":null}`, `{"maxTokens":"600"}`, `{"maxTokens":1e400}` —
      write a temp `compendio.config.json`, resolve it with `loadConfig`, and index the fixture corpus
      via a directly-constructed `IndexDocuments` (`chunking: config.chunk`, `noChunking: NO_CHUNKING`)
      against an in-memory `SqliteIndexStore`. Assert: every config's chunk count equals the control's
      **except** the explicit `{"maxTokens":600}` (Gate 3) case, and no emitted chunk's `estimateTokens`
      exceeds the resolved `maxTokens`.
- [x] 1.2 [confirm-fail] Run 1.1 against the unmodified `config.ts`. Record the actual chunk counts for
      `0` / `"abc"` / `null` (must be orders of magnitude above control) and for `"600"` (must differ
      from control — honored, not exploded) in `apply-progress.md`. **STOP** per the table above if any
      of `0`/`"abc"`/`null` does not explode.
  - Measured (ad hoc harness over the `strict` fixture, embeddings disabled): control (no override,
    resolves to 480) = **5 chunks**, max observed chunk = 59 tokens. `maxTokens:0` = **796 chunks**, max
    observed = 1 token (159x the control — explosion, one chunk per code point). `maxTokens:NaN`
    (simulating `"abc"`'s coercion) = **796 chunks**, max observed = 1 token (explosion). `maxTokens:null`
    = **796 chunks**, max observed = 1 token (explosion). `maxTokens:600` (a genuine number, simulating
    the `"600"` string's coercion) = **5 chunks**, max observed = 59 tokens — honored, not exploded
    (same count as control on this fixture only because every document here is already well under both
    480 and 600; the "honored, not clamped" property is what matters, not a count difference). No STOP
    triggered — 0/NaN/null all exploded as the design predicted.
- [x] 1.3 Run `node -e "console.log(JSON.parse('{\"a\":1e400}').a)"` and confirm it prints `Infinity`
      (design.md's "one measurement to take at apply time" note) before trusting the `1e400` row.
  - Confirmed: prints `Infinity`. Also confirmed `search.k: "abc"` reaches better-sqlite3 as `LIMIT NaN`
    and throws `"datatype mismatch"` (design's claimed store-layer throw for Gate 2).

### Phase 2: `positiveNumber` / `positiveInteger` predicates (design Decision 3)

- [x] 2.1 [RED] `test/infrastructure/config.test.ts` (additions only): add cases —
      `chunk.maxTokens`/`chunk.minTokens` each falling back on `0`, `-5`, `null`, `"abc"`, `{}`,
      `[1,2]`, `true`, `1e400`; `search.k` falling back on `0`, `"abc"`, `null`, and the non-integer
      `5.01`; both keys honoring `1` / `3` without clamping. Confirm these fail (no validation exists
      yet on these three keys).
- [x] 2.2 [GREEN] `src/infrastructure/config.ts`: rename `validThrottleMs` → `positiveNumber`,
      generalize its doc comment (per design's exact draft); add `positiveInteger` built on it. Apply
      `positiveNumber` to `chunk.minTokens`, `chunk.maxTokens`, `sync.throttleMs`; apply
      `positiveInteger` to `search.k`. Four call sites in `mergeConfig`.
- [x] 2.3 Confirm 2.1 is green, and the pre-existing `config.test.ts:50` (`maxTokens: 600` → `600`) and
      `:189` (`throttleMs: 100`, not clamped) cases still pass **unmodified**.

### Phase 3: Explicit whitelists (design Decision 4)

- [x] 3.1 [RED] `config.test.ts`: add unknown-key cases for `chunk`, `embeddings`, and
      `convention.frontmatterFields`, mirroring the existing `search` case at `:115` — declared
      unrecognized key absent from the loaded config, declared sibling keys keep their values. Confirm
      these fail (all three branches are still spreads).
- [x] 3.2 [GREEN] `config.ts`: convert the `embeddings`, `chunk`, and `frontmatterFields` (in
      `mergeConvention`) branches from spreads to explicit key-by-key builds. Hoist and generalize the
      rationale comment currently on the `search` branch (`:104-106`) to the top of `mergeConfig`.
- [x] 3.3 Confirm 3.1 is green and the existing partial-`frontmatterFields`-merge case (`:97-113`,
      `spec.md:181`) passes **unmodified**.

### Phase 4: Gate 1 GREEN + Gate 2 (`search.k` reachability)

- [x] 4.1 [GREEN] Re-run 1.1 — all six configs now resolve to an identical chunk count, no chunk
      exceeds the bound. Record the "after" identity result in `apply-progress.md`.
  - Confirmed: all 8 `chunk-bound-config.test.ts` Gate 1 cases pass — `0`/`"abc"`/`null`/`1e400`/`"600"`
    all resolve `chunk.maxTokens` to `480` and produce the control's chunk count (5); `600`/`1` (genuine
    numbers) are honored unclamped.
- [x] 4.2 [RED] Extend `chunk-bound-config.test.ts` (or a sibling test in the same file) with Gate 2:
      first confirm the **before** state — a resolved `search.k: 0` config makes an unfiltered
      `SearchDocuments.execute({query})` (k omitted) return `[]` with `noMatchReason` undefined; a
      resolved `search.k: "abc"` config makes the same call throw/error from the store layer (`NaN`
      bound as `LIMIT`). Then assert the **target** state: after the fix both calls return a non-empty
      result set for a matching query, and an explicit per-call `k` is unaffected.
- [x] 4.3 [confirm-GREEN] Re-run 4.2 — passes now that `positiveInteger` (2.2) guards `search.k`; no
      further production change expected. If it fails, the gap is in 2.2, not a new mechanism.
  - Confirmed: all 5 `search.k config default (Gate 2)` cases pass with no further production change
    beyond 2.2.

### Phase 5: Slice 1 regression (Gates 3, 5)

- [x] 5.1 `npm test`, `npm run typecheck`, `npm run build` — all green.
  - `npm test`: 45 files / 714 tests passed. `npm run typecheck`: clean. `npm run build`: clean.
- [x] 5.2 `node dist/cli.js --root ejemplos eval` — MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22
      (`ejemplos/` ships no config file — exercises the pure default path).
  - Measured: hybrid recall@5 = 1.00, MRR = 0.943 (exact baseline, unchanged — `ejemplos/` has no config
    file so this slice's validation never engages on it, confirming the default path is untouched).
- [x] 5.3 `git diff` confirms `test/infrastructure/config.test.ts` is additions-only against its
      pre-Slice-1 state — no existing `it(` block's assertions changed.
  - Confirmed: `git diff --stat` shows `118 insertions(+), 0 deletions(-)`.
- [x] 5.4 `git diff` confirms `src/domain/**`, `src/application/**`, `src/infrastructure/sqlite/**`,
      `src/infrastructure/fs/**` are empty for this slice (design's "Unchanged — asserted" row).
  - Confirmed: `git status --porcelain` shows only `src/infrastructure/config.ts` modified (plus the two
    new/extended test files).

### Phase 6: Slice 1 docs + spec cross-check

- [x] 6.1 `CLAUDE.md`: add one bullet to *Non-obvious decisions* — the single `positiveNumber` /
      `positiveInteger` policy now covers all four numeric config keys, plus the coercion finding
      (a quoted number like `"480"` coerces and works identically to the number; `NaN` cannot be
      declared, the JSON grammar has no literal for it; `1e400` parses to `Infinity` and is rejected).
- [x] 6.2 Cross-check `specs/configuration/spec.md`'s ADDED "Declared Numeric Configuration Values Are
      Validated" requirement (3 scenarios) and the MODIFIED "Default `chunk.maxTokens` Is 480…"
      requirement's bound-preservation scenario against Phases 1–4. Confirm satisfied — do not edit the
      spec file (already drafted by `sdd-spec`).
  - Confirmed satisfied: all 3 scenarios of the ADDED requirement and the MODIFIED requirement's
    bound-preservation scenario are exercised by `chunk-bound-config.test.ts` (Gates 1–2) and
    `config.test.ts` (Phase 2's per-key unit cases). No spec edit made.

---

## Slice 2 — Reporting Channel (PR 2, base: `main`, post PR 1 merge)

**End state**: all four numeric keys, all four whitelisted branches' unrecognized keys, and an inverted
`chunk.minTokens`/`chunk.maxTokens` pair report through one channel (CLI stderr, `docs_overview`). A
clean config produces no report, on every call, for the life of the process.

### Phase 7: `ConfigWarning` type + `loadConfigReport` (design Decision 5)

- [x] 7.1 [RED] `config.test.ts`: add cases for `loadConfigReport` — one `invalid-value` warning per
      invalid declared value for each of the four numeric keys; one `unknown-key` warning per
      unrecognized key under `chunk`, `embeddings`, `search` (including the legacy
      `search.excludedStatuses`), and `frontmatterFields` (including the `chunk.maxtokens` case
      mismatch); one `inverted-chunk-bounds` warning when `minTokens > maxTokens` (both values honored
      unchanged, both named in the warning); `warnings === []` on a clean declared config **and** on no
      config file at all; `loadConfig(root)` equals `loadConfigReport(root).config`. Confirm all fail
      (`loadConfigReport` does not exist yet).
- [x] 7.2 [GREEN] `config.ts`: add `ConfigWarningKind`, `ConfigWarning`, `ConfigLoadReport`; implement
      `loadConfigReport(root)` so each of `mergeConfig`'s four numeric fallbacks, the four whitelist
      drops, and the `minTokens > maxTokens` comparison push a `ConfigWarning`; `loadConfig` becomes a
      one-line wrapper (`= loadConfigReport(root).config`), **signature unchanged**.
- [x] 7.3 Add `formatConfigWarning(warning: ConfigWarning): string` — pure, one rendered line per
      warning kind, mirroring `formatEncodingNotice` (`index-documents.ts:43-45`). Exact wording is not
      spec-pinned (design's Open Question 3).
- [x] 7.4 Confirm 7.1 is green, and no case added in Slice 1 (Phases 1–3) was modified — additions only,
      cumulative across both slices.

### Phase 8: `Container.configWarnings` (design Decisions 5, 6)

- [x] 8.1 [RED] Extend a composition-level test (or add one) asserting `createContainer` exposes
      `configWarnings: ConfigWarning[]` sourced from `loadConfigReport`.
- [x] 8.2 [GREEN] `composition.ts`: switch the `loadConfig(options.root)` call at `:59` to
      `loadConfigReport`, destructure `{ config, warnings }`, add `configWarnings: warnings` to the
      returned `Container`. Confirm `resolveRoots` still runs before `new SqliteIndexStore` (`:64-68`)
      — untouched (Decision 6's asserted invariant).
- [x] 8.3 Confirm `scripts/rank-probe.mjs` and `scripts/vector-reach.mjs` are untouched — both still
      call `loadConfig`, whose signature does not move.

### Phase 9: CLI rendering (design Decision 6)

- [x] 9.1 [RED] `test/cli-subprocess.test.ts`: open a new `describe` block with its **own** dedicated
      temp workdir (do not reuse the shared `workdir`). Spawn `dist/cli.js index --lexical` against a
      workdir with an invalid `chunk.maxTokens` in `compendio.config.json` — assert stderr contains a
      `WARNING` line naming the key, exit code is 0, and stdout is unaffected. Confirm fails (no
      rendering yet).
- [x] 9.2 [GREEN] `cli.ts`: in `withContainer` (all six actions that go through it) and in the `serve`
      action, render each `container.configWarnings` entry via
      `` console.warn(`WARNING ${formatConfigWarning(w)}`) `` (stdout-adjacent actions) /
      `console.error` (serve, beside its existing startup line) — positioned immediately after
      container construction, before the action body runs.
- [x] 9.3 Confirm 9.1 is green. Add a second case: a clean/no-config workdir produces zero
      `WARNING …` lines referencing config.

### Phase 10: `docs_overview` rendering (design Decision 6)

- [x] 10.1 [RED] `test/application/get-overview.test.ts`: `formatOverview(overview, sync,
      configWarnings)` renders a `Config:` block when `configWarnings` is non-empty; omits it entirely
      (never empty-rendered) when `[]` or `undefined`; the block is distinct from and never folded into
      `Sync:`; it renders on every call, not only the first, for the process's lifetime.
- [x] 10.2 [GREEN] `get-overview.ts`: `formatOverview` gains a third parameter
      `configWarnings?: ConfigWarning[]`, appends a `Config:` block (one line per warning via
      `formatConfigWarning`) after the existing `Sync:` handling, omitted when empty/undefined.
- [x] 10.3 `server.ts`: pass `container.configWarnings` as `formatOverview`'s third argument at the
      `docs_overview` tool's call site (`:93`).
- [x] 10.4 Confirm 10.1 is green, and `search_docs`' response shape is byte-identical (no
      `configWarnings` field added there — Gate 6(e), design's "Rejected — surfacing on `search_docs`").

### Phase 11: Slice 2 regression (Gate 5 re-confirmed, Gate 6 end to end)

- [x] 11.1 `npm test`, `npm run typecheck`, `npm run build` — all green.
- [x] 11.2 `node dist/cli.js --root ejemplos eval` — unchanged (no config file there, `configWarnings`
      is always `[]`).
- [x] 11.3 `git diff` confirms `config.test.ts`'s full diff across **both** slices is additions-only.
- [x] 11.4 Walk Gate 6(a)–(e) end to end against the finished PR 1 + PR 2 diff: (a) one warning per
      invalid value / unknown key / inverted pair; (b) `warnings === []` on clean and on no-config; (c)
      no `Config:` block on empty; (d) spawned `dist/cli.js index --lexical` against an invalid config
      prints `WARNING` on stderr, stdout/exit code unaffected; (e) `search_docs` response unchanged.

### Phase 12: Slice 2 docs + spec cross-check

- [x] 12.1 `README.md` (near the config table, `:162-164`): add one sentence stating an invalid
      declared value for `search.k`/`chunk.minTokens`/`chunk.maxTokens`/`sync.throttleMs` falls back to
      its default and is reported (CLI stderr; `docs_overview`).
- [x] 12.2 Cross-check `specs/configuration/spec.md`'s ADDED "Config Load Reports Invalid Values and
      Unrecognized Keys" requirement (4 scenarios), the MODIFIED `sync.throttleMs` requirement's
      "reported" scenario, and the MODIFIED "excludedStatuses Lives Under convention" legacy-key
      scenario against Phases 7–10. Confirm satisfied — do not edit the spec file.
- [x] 12.3 Cross-check `specs/mcp-contract/spec.md`'s ADDED "Config-Warning Visibility in
      `docs_overview` Response" requirement (3 scenarios) against Phase 10. Confirm satisfied.
- [x] 12.4 Confirm `CLAUDE.md` needs no further edit beyond Slice 1's bullet (6.1) — the reporting
      channel is a rendering detail of the already-documented validation policy, not a new
      non-obvious decision. Record the confirmation; do not add a redundant bullet.
