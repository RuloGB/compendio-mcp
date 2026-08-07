# Tasks: Multiple Documentation Roots

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines (design forecast) | 1302–2057 |
| Estimated changed lines (this project's 2–4x historical undershoot, applied honestly) | 2000–3500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 (feature-branch-chain, tracker never merges alone) |
| Delivery strategy | auto-chain (already decided — not re-opened here) |
| Chain strategy | feature-branch-chain (already decided — not re-opened here) |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
```

**Per-PR estimate, allocated from the design's driver table against the four already-decided PR boundaries.** Ranges are rough (design's total was itself a floor); none clear 400 lines even chained, and PR 2 will not clear it by a wide margin. Say so plainly rather than smoothing it: **the 400-line budget is not achievable for this change even split four ways** — the chain protects reviewer focus per-slice (one deliverable, one story, one rollback unit), it does not shrink the total under budget.

| PR | Scope | Design-forecast lines | Fits 400? |
|---|---|---|---|
| PR 1 | `exclude` directory-prefix + `isRoot` refactor (behaviour-preserving) | ~135–210 | Yes, likely |
| PR 2 | `docsDir: string[]`, `resolveRoots`, composite (no tolerance yet), composition wiring, goldenset + harness re-addressing | ~730–1130 | **No** — largest slice, harness churn across 5 files is the driver |
| PR 3 | Composite per-root tolerance, alias-as-`ReadError.path`, alias-aware `inferModule` | ~230–370 | No |
| PR 4 | Combined `INDEX.md`, `read_doc` tolerance tests, `vector-reach.mjs`, docs | ~260–430 | Borderline/No |

### Suggested Work Units

| Unit | Goal | Base branch | Notes |
|---|---|---|---|
| PR 1 | `exclude` + `isRoot` enabling refactor | tracker branch (`feat/multiple-doc-roots`, draft, no-merge) | Independently valuable today (single-root can't exclude a folder). Must land before PR 2 — same reasoning that creates the seeded-prefix trap must defuse it in the same diff. |
| PR 2 | Structural core: array `docsDir`, collision guard, composite (propagating failures), wiring, goldenset/harness re-addressing | PR 1 branch | **Non-negotiable**: prefixing and the collision guard MUST land together — separated, the intermediate state ships the uncaught SQLite UNIQUE-constraint crash. Multi-root is unusable after this PR alone (a missing root still hard-crashes) — do not announce the feature yet. |
| PR 3 | Behavioural companions: per-root tolerance, alias-as-`ReadError.path`, alias-aware `module` | PR 2 branch | Makes multi-root actually usable — first PR after which the feature may be documented/announced. |
| PR 4 | Surface + docs: combined `INDEX.md`, `read_doc` tolerance, `vector-reach.mjs`, README/CLAUDE | PR 3 branch | Only the tracker merges to `main`, after PR 4 is reviewed and integrated into the tracker branch. |

## Coverage Map

| Gate | Task(s) |
|---|---|
| Gate 1 (prefix costs one segment; eval identity, pre/post) | 2.9c, 2.11 |
| Gate 1b (zero-config shape via `createContainer`) | 2.9a, 2.9e |
| Gate 1c (every goldenset address is real) | 2.9a, 2.9e |
| Gate 2a/b/d/e (motivating case, this repo) | 2.12, 4.14 |
| Gate 2c (zero archived paths) | 1.1–1.3, 2.12 |
| Gate 3 (`module` stays a folder signal) | 3.6–3.9, 3.13 |
| Gate 4 (missing root doesn't crash; layer named; seeded-prefix reject) | 1.5, 3.1–3.4, 3.12 |
| Gate 4b (failed root protects its subtree) | 3.5 |
| Gate 5 (collision guard, incl. inner-root-first, case-differing, `..`-prefixed nesting) | 2.7 |
| Gate 6 (`INDEX.md` self-exclusion under `exclude: []`) | 4.1–4.4 |
| Gate 7 (nothing else moved) | 4.12 |
| Required spec action (unreadable-root MUST amendment) | 3.10 |

## Non-negotiable sequencing constraints (do not reorder across PRs)

1. Prefixing and the collision guard MUST land in the same PR (PR 2) — never separated.
2. Decision 1's `isRoot` refactor lands in PR 1, before prefixing is possible.
3. Multi-root is unusable until PR 3 lands; nothing documents/announces it before then.

---

## PR 1 — `exclude` directory-prefix and the enabling refactor

### Phase 1: `isExcluded` — baseline, then invert (TDD)

- [x] 1.1 [RED/baseline] `test/infrastructure/file-document-source.test.ts`: land a test asserting **today's** behavior — `exclude: ["sub"]` against a corpus containing `sub/x.md` → `sub/x.md` **is** discovered (exact-equality only). Confirm it passes on unmodified code.
- [x] 1.2 [GREEN] `src/infrastructure/fs/file-document-source.ts:84-86`: rewrite `isExcluded` to the three-clause form — `entry === path || entry === basename || path.startsWith(entry + "/")`, with a trailing-slash strip on `entry` first (`exclude: ["openspec/changes/archive/"]` must still match).
- [x] 1.3 [invert] Update 1.1's test: `sub/x.md` is now excluded. Add: trailing-slash form matches; `docs` does not exclude `docs-old/x.md` (explicit `/` boundary).

### Phase 2: `isRoot` refactor (behaviour-preserving) + English message

- [x] 2.1 `file-document-source.ts`: add optional third constructor arg `pathPrefix: string = ""`; `discover()` seeds `walk(this.docsDir, this.pathPrefix, true, ...)` with an explicit `isRoot: boolean` parameter replacing the `prefix === ""` check at line 47. No production caller passes a prefix yet, so `isRoot` stays equivalent to today's `prefix === ""` — behaviour-preserving on its own.
- [x] 2.2 Confirm `test/infrastructure/file-document-source.test.ts:99` ("still throws when the docs root itself cannot be read") passes **unchanged** — diff-check, not re-read.
- [x] 2.3 [new] Add a test beside :99: `FileDocumentSource` constructed with a **non-empty** `pathPrefix` against an unreadable root still rejects (`isRoot === true` at depth 0 regardless of prefix) — this is the assertion that falsifies the seeded-prefix trap once PR 2 wires a real prefix.
- [x] 2.4 Rewrite the Spanish root-failure message (lines 48-51) to English, e.g. `cannot read the documentation directory "<dir>": <reason>`.

### Phase 3: Spec + verification

- [x] 3.1 Confirm `openspec/changes/multiple-doc-roots/specs/configuration/spec.md`'s "`exclude` Matches a Directory Prefix" requirement and its three scenarios are satisfied by 1.1–1.3 (no local delta file to write here — it is already drafted for this change).
- [x] 3.2 `npm test`, `npm run typecheck` green. PR 1 diff limited to `file-document-source.ts` + its test file.

---

## PR 2 — the structural core (base: PR 1 branch)

### Phase 4: `resolveRoots` — baseline, then implement (TDD)

- [x] 4.1 [RED] `test/infrastructure/config.test.ts`: restate `:62-70`'s single-string round trip as an array (`docsDir: ["documentation"]`). Add one failing test per rejection case: not-an-array, empty array, non-string entry, duplicate, case-differing duplicate (win32), nested (outer declared first), **nested (inner declared first)**, alias clash.
- [x] 4.2 [GREEN] `src/infrastructure/config.ts`: `CompendioConfig.docsDir: string[]`, `DEFAULT_CONFIG.docsDir = ["docs"]`. Add `ResolvedRoot { declared, dir, prefix }` and `resolveRoots(projectRoot, docsDir): ResolvedRoot[]` — alias = `basename(dir)` of the **resolved absolute** path; ordered-pair sweep using `path.relative` (never `resolve(a) === resolve(b)`, which misses case-differing duplicates on win32), checked in **both directions**; nesting predicate `rel !== ".." && !rel.startsWith(".." + sep)` (not `rel.startsWith("..")`, which misclassifies `docs/..cache`); 7 English messages naming the offending declared strings, per design's table.
- [x] 4.3 Confirm `mergeConfig`'s `docsDir: override.docsDir ?? base.docsDir` line is unchanged (whole-value replace is already correct for arrays).
- [x] 4.4 `npx vitest run test/infrastructure/config.test.ts` green.

### Phase 5: `CompositeDocumentSource` — no tolerance yet

- [x] 5.1 [new] `test/infrastructure/composite-document-source.test.ts`: over a fake `DocumentSource`, assert merge preserves declaration order pre-sort, `files` sorted by `path.localeCompare`, and **a throwing root propagates immediately** (no catch in this PR — one root fails exactly like today's single root).
- [x] 5.2 [GREEN] `src/infrastructure/fs/composite-document-source.ts` (new): `RootSource { declared, dir, prefix, source }`; `CompositeDocumentSource implements DocumentSource`; sequential `await` per root in declaration order; concatenate `files`/`readErrors`/`encodingNotices`; sort `files` only. Zero `node:` imports.

### Phase 6: Composition wiring — one unconditional path

- [x] 6.1 `src/composition.ts:58`: replace `docsDir = resolve(...)` with `roots = resolveRoots(options.root, options.docsDir !== undefined ? [options.docsDir] : config.docsDir)`, placed immediately after `loadConfig` and **before** `new SqliteIndexStore` (line 59) — this is what makes Gate 5's "no `.compendio/` afterward" literally true.
- [x] 6.2 Wire `source = new CompositeDocumentSource(roots.map(r => ({ ...r, source: new FileDocumentSource(r.dir, config.exclude, r.prefix) })))`. Writer target stays `roots[0].dir` for now (selfPath change is PR 4).
- [x] 6.3 `ContainerOptions.docsDir?: string` stays unchanged (Decision 10) — normalization happens at the call site in 6.1, not in `cli.ts`.

### Phase 7: Collision guard — container-level test

- [x] 7.1 [new] Container-construction test: each of `["docs","docs/adr"]`, **`["docs/adr","docs"]` (inner declared first)**, `["docs","docs"]`, a case-differing duplicate on win32, `["a/docs","b/docs"]`, and `[]` → `createContainer` throws naming the offending strings, **and no `.compendio/` directory exists afterward** in a fresh temp project.

### Phase 8: Goldenset + harness re-addressing (one commit, per Decision 13/14 sequencing)

- [x] 8.1 [RED/baseline] `test/application/goldenset-addresses.test.ts` (new): `beforeAll` copies `ejemplos/` (docs + `goldenset.yaml`) into a temp dir (never index in place — would clobber `ejemplos/.compendio/compendio.db`); `createContainer({ root: tmp, forceLexical: true })`, index, then assert every indexed `path` starts `docs/` (Gate 1b) and every real `esperado` value is an indexed path (Gate 1c). Land this **before** the goldenset is re-addressed and confirm it fails on all 22 entries — a gate that has never been red proves nothing.
- [x] 8.2 `test/helpers/build.ts`: `buildHarness` calls `resolveRoots(REPO_ROOT, [docsDir])` and passes `root.prefix` as the third `FileDocumentSource` arg; correct the "mirroring production wiring" comment now that it is literally true. `test/application/index-progress.test.ts:19`'s direct `FileDocumentSource(EXAMPLES_DOCS, ["INDEX.md"])` construction is prefixed the same way in this commit.
- [x] 8.3 Re-address `ejemplos/goldenset.yaml`'s 22 `esperado` values with the `docs/` prefix — addresses only, no prose/filename/frontmatter change.
- [x] 8.4 Re-address the 26 harness-dependent literals: `evaluate.test.ts` (2 call sites + 3 inline `CASES`), `index-and-search.test.ts` (5), `read-document.test.ts` (1), `excerpt-window.test.ts` (4), `heading-less-round-trip.test.ts` (1).
- [x] 8.5 [invert] `goldenset-addresses.test.ts` now passes. Add a two-root multi-root integration case to `index-and-search.test.ts`: temp two-root corpus, lexical-only, index → search → `read_doc` round trip.

Note on 8.4's count: the actual literal count re-addressed was higher than 26 once verified against the running suite (`evaluate.test.ts` 3, `index-and-search.test.ts` 10 incl. the strict-fixture block, `read-document.test.ts` 9, `excerpt-window.test.ts` 4, `heading-less-round-trip.test.ts` 3 — 29 total), and two files outside the original list also needed re-addressing to keep `npm test` green: `test/fixtures/strict/compendio.config.json` (`docsDir` was still the pre-array-only string shape) and `test/cli-subprocess.test.ts` (3 literals against that same fixture, exercised through the real CLI subprocess). See apply-progress.md's Deviations section for the full accounting, including the accepted PR-2-only naive-`inferModule` regression (Decision 7/Phase 12, PR 3) and how it was handled in the two places it surfaced.

### Phase 9: Spec + verification

- [x] 9.1 Confirm `specs/configuration/spec.md`'s "`docsDir` Is a Non-Empty Array", "Colliding/Nested/Duplicate/Empty … Rejected at Construction", and "`--dir` … one-element root set" requirements are satisfied by 4.1–7.1 (already drafted for this change).
- [x] 9.2 Manual Gate 1: `node dist/cli.js --root ejemplos eval` **before** 8.3 — record MRR 0.000 / recall 0.00 in `verify-report.md` (proves the re-addressing is load-bearing). Re-run **after** 8.3 — record MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22, as identity.
- [x] 9.3 Manual Gate 2c: `compendio index` at the repo root with `docsDir: ["docs","openspec"], exclude: ["INDEX.md","openspec/changes/archive"]` — assert **zero** indexed paths start `openspec/changes/archive/`.
- [x] 9.4 `npm test`, `npm run typecheck`, `npm run build` green.

---

## PR 3 — behavioural companions (base: PR 2 branch)

### Phase 10: Composite tolerance + alias-as-`ReadError.path`

- [ ] 10.1 [RED] Extend `composite-document-source.test.ts`: one of two fake roots throws → the other's files present plus one `ReadError`; **all** roots throw → the composite rejects with one aggregate message naming every declared root and reason.
- [ ] 10.2 [GREEN] `composite-document-source.ts`: wrap each root's `discover()` in `try`/`catch`; on catch, push `{ path: root.prefix, error: 'declared documentation root "<declared>" (<dir>) could not be read: <reason>' }` into `readErrors` and continue; after the loop, rethrow one aggregate error only if every root threw. **`ReadError.path` is `root.prefix` (the alias), never `root.declared`** — Decision 4.
- [ ] 10.3 Re-confirm `file-document-source.test.ts:99` and the 2.3 seeded-prefix test both still pass unchanged.

### Phase 11: Gate 4b — a failed root protects its subtree

- [ ] 11.1 [RED] `test/application/sync-index.test.ts`: a `SyncIndex` pass over a store holding `openspec/**` documents, source returning `readErrors: [{ path: "openspec" }]` and no files → `deleted` is empty. Add the inverse assertion showing a `ReadError.path` carrying the **declared** string (`"packages/app/docs"` instead of `"docs"`) would let `deleteMissingDocuments` purge the whole subtree — fails if 10.2 pushed the wrong value.
- [ ] 11.2 Confirm green — this is satisfied by 10.2, not a separate implementation change.

### Phase 12: Alias-aware `inferModule`

- [ ] 12.1 [baseline] `test/domain/convention.test.ts` or an integration test: land an assertion of **today's naive** result — a root-level file under a prefixed path (`docs/documentation-convention.md`) infers `module: "docs"` — confirm it currently passes (this is the intermediate PR-2-only state).
- [ ] 12.2 [GREEN] `src/domain/convention.ts`: `inferModule(path, rootPrefixes?: readonly string[])` strips at most one matching `<prefix>/` before taking the first remaining segment; `createConventionPolicy(cfg, rootPrefixes?)` threads it through to `createLoosePolicy`'s resolver (line 71); `createStrictPolicy` ignores the parameter (it never infers `module`).
- [ ] 12.3 `composition.ts:74`: pass `roots.map(r => r.prefix)` unconditionally into `createConventionPolicy`.
- [ ] 12.4 [invert] 12.1's baseline now asserts `module` is **absent** for `docs/documentation-convention.md`; add `openspec/specs/indexing/spec.md` → `module: "specs"` (not `"openspec"`); `docs_overview`'s `byModule` has no `docs`/`openspec` bucket.

### Phase 13: Spec + verification

- [ ] 13.1 Land the **required spec amendment**: `specs/indexing/spec.md`'s "Read Failures Protect the Affected `path` Subtree From Deletion" MODIFIED requirement (already drafted) — cross-check its scenarios against 10.1–11.1. Confirm this narrows, not deletes, the pre-existing MUST.
- [ ] 13.2 Cross-check the "`module` inference … relative to the containing root" MODIFIED requirement against 12.1–12.4.
- [ ] 13.3 Manual Gate 4: `docsDir: ["docs","openspec"]` with no `openspec/` directory present → run completes exit 0, every `docs/` document indexed, missing root reported in `skipped`/`readErrors`; every declared root unreadable → still throws.
- [ ] 13.4 Manual Gate 3 on this repository — record `verify-report.md` numbers alongside Gate 2a/b/d/e if not already captured.
- [ ] 13.5 `npm test`, `npm run typecheck`, `npm run build` green.

---

## PR 4 — surface and documentation (base: PR 3 branch)

### Phase 14: Combined `INDEX.md`

- [ ] 14.1 [RED] `test/application/generate-index-md.test.ts`: two-root fixture, `exclude: []` (the only case reaching the three dead equality checks) — assert a generated `docs/INDEX.md` still excludes itself and lists prefixed entries from both roots. Confirm this fails against unmodified `generate-index-md.ts`.
- [ ] 14.2 [GREEN] `src/application/generate-index-md.ts`: add 6th constructor param `selfPath: string = INDEX_FILE`; retarget the three equality checks (lines 41, 46, 77) from the literal `INDEX_FILE` to `this.selfPath`.
- [ ] 14.3 `composition.ts`: pass `` `${roots[0].prefix}/${INDEX_FILE}` `` as `selfPath`; writer stays `new FileIndexWriter(roots[0].dir, INDEX_FILE)`.
- [ ] 14.4 [invert] 14.1 green — Gate 6.

### Phase 15: `read_doc` tolerance — tests only, no source edit expected

- [ ] 15.1 `test/application/read-document.test.ts`: add 4 cases — exact prefixed-path hit; over-prefixed hit (`repo/docs/x.md` → strips to `docs/x.md`); the aliased-collision residual case (`docsDir: ["docs","adr"]`, request for a non-existent `docs/adr/x.md` strips to the real `adr/x.md`); bare-basename miss (`read_doc({ path: "x.md" })` → `path-not-found` + 3 closest matches, never a false resolve).
- [ ] 15.2 Confirm `read-document.ts:44-50` needs zero edits — diff-check, not re-read.

### Phase 16: `vector-reach.mjs` + docs

- [ ] 16.1 `scripts/vector-reach.mjs:204`: import `resolveRoots` from `../dist/infrastructure/config.js`; replace the join with `const owner = roots.find(r => markerChunk.path.startsWith(\`${r.prefix}/\`)) ?? roots[0]` then `resolve(owner.dir, markerChunk.path.slice(owner.prefix.length + 1))`.
- [ ] 16.2 Run `node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"` end to end — confirm identical resolved absolute path to pre-change (`owner.prefix === "docs"`).
- [ ] 16.3 `README.md:132,148-150`: `docsDir` as an array (no string form), always-prefixed path shape incl. zero-config, three-clause `exclude`, `--dir` replaces-not-adds.
- [ ] 16.4 `CLAUDE.md`: same topics, plus the unreadable-vs-removed-root contrast (Decision 4) and "removing a root purges its documents on the next sync pass" as an operational note.

### Phase 17: Spec + final verification

- [ ] 17.1 Cross-check `specs/index-md/spec.md`'s two ADDED requirements against 14.1–14.4; `specs/mcp-contract/spec.md`'s two ADDED requirements against 15.1–15.2.
- [ ] 17.2 Check `openspec/specs/search/spec.md` for stale path-shape claims; amend if found, note explicitly if none.
- [ ] 17.3 Gate 7: `npm test`, `npm run typecheck`, `npm run build` green; diff-check `src/application/sync-index.ts` and `SCHEMA_DDL` (`sqlite-index-store.ts:48`) are empty across the whole 4-PR chain; grep the full `src/` tree for `string \| string\[\]` — zero matches.
- [ ] 17.4 Recorded observations (not gates), into `verify-report.md`: byte/estimated-token weight per root for the Gate 2 corpus; whether any Gate-2-corpus `search_docs` query returns a spec-delta file over the active spec.
- [ ] 17.5 Final Gate 2 pass (a, b, d, e) if not already captured during PR 2/3 manual runs — record the formula-computed `indexed` count.
