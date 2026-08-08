# Apply Progress: Multiple Documentation Roots

Artifact store: **openspec** (Engram MCP tools unavailable this cycle, per `proposal.md`'s
Resolved Decisions table — confirmed unavailable again this batch).

Delivery: `auto-chain` / `feature-branch-chain`. Tracker branch `feat/multiple-doc-roots` (off
`main`, draft/no-merge, never merges alone). PR 1 branch `feat/multiple-doc-roots-01-exclude-prefix`
(off the tracker). PR 2 branch `feat/multiple-doc-roots-02-structural-core` (off the PR 1 branch),
per the non-negotiable sequencing constraint that prefixing and the collision guard land together.

## Batch 1 — PR 1

**Scope**: `tasks.md` §"PR 1 — `exclude` directory-prefix and the enabling refactor" — Phase 1,
Phase 2, Phase 3. Nothing from PR 2 (`docsDir` array, `resolveRoots`, composite source, prefixing,
goldenset/harness re-addressing) was touched, per explicit scope instruction.

### Completed Tasks

- [x] 1.1 [RED/baseline] Landed a test asserting today's exact-equality-only `exclude` behavior
      (`exclude: ["sub"]` does not exclude `sub/x.md`). Confirmed passing on unmodified code before
      any production edit (10/10 pre-existing tests green, new test green).
- [x] 1.2 [GREEN] Rewrote `isExcluded` to the three-clause directory-prefix form: `entry === path ||
      entry === basename || path.startsWith(entry + "/")`, with a trailing-slash strip on `entry`
      first.
- [x] 1.3 [invert] Inverted 1.1's test (`sub/x.md` now excluded) and triangulated: trailing-slash
      entry form (`"sub/"`) matches identically; `"docs"` does not exclude `docs-old/x.md` (explicit
      `/` boundary).
- [x] 2.1 Added optional third constructor argument `pathPrefix: string = ""`; `discover()` seeds
      `walk(this.docsDir, this.pathPrefix, true, ...)`; `walk` gained an explicit `isRoot: boolean`
      parameter replacing the `prefix === ""` root-detection check. No production caller passes a
      prefix yet — behaviour-preserving on its own, confirmed by the full pre-existing suite staying
      green.
- [x] 2.2 Confirmed `test/infrastructure/file-document-source.test.ts:99` ("still throws when the
      docs root itself cannot be read") passes unchanged — verified via `git diff`, the test's own
      lines (1-109) carry zero changes; only new tests were appended after it.
- [x] 2.3 [new] Added the seeded-prefix trap test beside :99: `FileDocumentSource` constructed with a
      non-empty `pathPrefix` (`"docs"`) against an unreadable root still rejects. Written first as a
      genuine RED — confirmed by `npm run typecheck` failing with `TS2554: Expected 2 arguments, but
      got 3` before the constructor change landed.
- [x] 2.4 Rewrote the Spanish root-failure message to English: `cannot read the documentation
      directory "<dir>": <reason>` (was `no se puede leer el directorio de documentacion "<dir>": ...`).
- [x] 3.1 Cross-checked `specs/configuration/spec.md`'s "`exclude` Matches a Directory Prefix"
      requirement against 1.1-1.3: the three-clause mechanism and its scope ("not glob syntax") match
      exactly. The scenario involving multi-root prefixed paths (`openspec/changes/archive`) is
      mechanism-covered here (directory-prefix matching works on whatever `path` string it receives)
      but only becomes end-to-end demonstrable once PR 2 wires `resolveRoots`/prefixing — expected,
      not a gap in this batch. The exact-match/basename scenario is unchanged pre-existing behavior,
      already exercised elsewhere in the suite (`test/helpers/build.ts`, `index-progress.test.ts` both
      pass `["INDEX.md"]` as `exclude` and rely on the basename clause).
- [x] 3.2 `npm test`, `npm run typecheck` green (see Verification below). PR 1 diff limited to
      `src/infrastructure/fs/file-document-source.ts` + `test/infrastructure/file-document-source.test.ts`
      (confirmed via `git diff --stat`: exactly those two files, 62 insertions / 11 deletions).

### TDD Cycle Evidence (PR 1)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.3 | `test/infrastructure/file-document-source.test.ts` | Unit | ✅ 10/10 (pre-change) | ✅ Written, confirmed passing on unmodified code | ✅ Passed after `isExcluded` rewrite | ✅ 3 cases (basic prefix, trailing slash, sibling boundary) | ➖ None needed — `isExcluded` already minimal |
| 2.1, 2.3, 2.4 | `test/infrastructure/file-document-source.test.ts` | Unit | ✅ 13/13 (post-Phase-1) | ✅ Written referencing a 3-arg constructor that did not exist yet; confirmed RED via `tsc` (`TS2554`) | ✅ Passed (14/14) after `pathPrefix`/`isRoot` refactor | ➖ Single scenario (approval-testing refactor task; existing throw test at :99 is the triangulating counterpart, confirmed unchanged) | ✅ Clean — `reason` extracted once instead of computed twice |

### Files Changed (PR 1)

| File | Action | What Was Done |
|------|--------|----------------|
| `src/infrastructure/fs/file-document-source.ts` | Modified | Three-clause `isExcluded`; `pathPrefix` constructor arg + `isRoot` walk parameter; English root-failure message; docstring updated |
| `test/infrastructure/file-document-source.test.ts` | Modified | 4 new tests: directory-prefix exclude, trailing-slash exclude, sibling-boundary non-exclude, seeded-prefix-still-throws |

### Workload / PR Boundary (PR 1)

- Mode: chained PR slice (`feature-branch-chain`)
- Boundary: starts from `main` (via tracker `feat/multiple-doc-roots`); ends with a green, typed,
  built `file-document-source.ts` + its tests.
- Estimated review budget impact: 73 changed lines (62 insertions + 11 deletions) — well inside the
  400-line budget, and well under the design's own ~135-210 forecast for this slice.
- Branches: tracker `feat/multiple-doc-roots` (off `main`, draft/no-merge); child
  `feat/multiple-doc-roots-01-exclude-prefix` (off the tracker, targets the tracker).
- Commits (local only, not pushed): `feat(fs): match exclude entries against a directory prefix`.

### Status (PR 1)

PR 1 (Phase 1-3): **9/9 tasks complete**. Merged into this batch's history below.

---

## Batch 2 — PR 2 (this batch)

**Scope**: `tasks.md` §"PR 2 — the structural core" — Phase 4 (`resolveRoots`), Phase 5
(`CompositeDocumentSource`, no per-root tolerance), Phase 6 (composition wiring), Phase 7 (collision
guard container-level test), Phase 8 (goldenset + harness re-addressing), Phase 9 (spec +
verification). Explicitly **not** in scope, per instruction and per the design's own PR boundary:
per-root try/catch tolerance, alias-as-`ReadError.path`, alias-aware `inferModule` (Phases 10-12, PR
3).

### Completed Tasks

- [x] 4.1 [RED] `test/infrastructure/config.test.ts`: restated the `:62-70` single-string round trip
      as an array; added 12 new tests covering the normalization (trailing slash / `./` / bare form
      all yield the same alias; two-root alias derivation) and every rejection case: not-an-array,
      empty array, non-string entry (index + typeof), duplicate, case-differing duplicate (win32,
      `it.skipIf`), nested outer-first, nested inner-first, alias clash, valid two-root accept.
      Confirmed RED via `npx vitest run` (`resolveRoots is not a function`) before any production
      code existed.
- [x] 4.2 [GREEN] `src/infrastructure/config.ts`: `CompendioConfig.docsDir: string[]`,
      `DEFAULT_CONFIG.docsDir = ["docs"]`; added `ResolvedRoot { declared, dir, prefix }` and
      `resolveRoots(projectRoot, docsDir): ResolvedRoot[]` — alias = `basename` of the resolved
      absolute path; type/shape guards (array, non-empty, string entries) first; ordered-pair sweep
      over `path.relative` (both directions) for duplicate/nested; alias-clash sweep after; the seven
      English messages from the design's table, verbatim.
- [x] 4.3 Confirmed `mergeConfig`'s `docsDir: override.docsDir ?? base.docsDir` line is unchanged —
      diff-checked, no edit made.
- [x] 4.4 `npx vitest run test/infrastructure/config.test.ts` — 25/25 green.
- [x] 5.1 [new] `test/infrastructure/composite-document-source.test.ts`: 6 tests over a fake
      `DocumentSource` — runs for a single-element root set (no branch), merges + sorts across roots
      by `path.localeCompare` (not declaration order), concatenates `readErrors`/`encodingNotices` in
      declaration order, and **a throwing root propagates immediately** (both "first root throws" and
      "second root throws after the first succeeded" — no catch in this PR). Confirmed RED
      (`Cannot find module`) before the production file existed.
- [x] 5.2 [GREEN] `src/infrastructure/fs/composite-document-source.ts` (new): `RootSource { declared,
      dir, prefix, source }`; `CompositeDocumentSource implements DocumentSource`; sequential `await`
      per root in declaration order; concatenates `files`/`readErrors`/`encodingNotices`; sorts
      `files` only. Zero `node:` imports (verified by inspection — only imports from
      `../../domain/ports.js`).
- [x] 6.1 `src/composition.ts`: replaced `docsDir = resolve(options.root, options.docsDir ??
      config.docsDir)` with `roots = resolveRoots(options.root, options.docsDir !== undefined ?
      [options.docsDir] : config.docsDir)`, placed immediately after `loadConfig` and before `new
      SqliteIndexStore` — verified this ordering with a dedicated container-level test (7.1).
- [x] 6.2 Wired `source = new CompositeDocumentSource(roots.map(r => ({ ...r, source: new
      FileDocumentSource(r.dir, config.exclude, r.prefix) })))`. Writer target stays `roots[0].dir`
      (`new FileIndexWriter(roots[0]!.dir, INDEX_FILE)`); `selfPath` is explicitly deferred to PR 4
      (Decision 9) with a comment saying so.
- [x] 6.3 Confirmed `ContainerOptions.docsDir?: string` is unchanged — diff-checked, no edit made;
      normalization happens at the 6.1 call site only.
- [x] 7.1 [new] `test/composition.test.ts`: 7 container-construction tests over
      `createContainer({ root: tmpProjectDir })` with a written `compendio.config.json` — nested
      outer-first, nested inner-first, duplicate, case-differing duplicate (win32, `it.skipIf`), alias
      clash, empty array all throw naming the offending strings **and leave no `.compendio/`
      directory** in the fresh temp project; a valid two-root set is accepted and does create
      `.compendio/`. These tests validate the Phase 6 wiring (sequenced after it per the task list, so
      GREEN-on-first-run rather than a separate RED cycle — confirmed meaningful by construction: the
      guard's position relative to `new SqliteIndexStore` is exactly what each test's ".compendio/
      does not exist" assertion depends on).
- [x] 8.1 [RED/baseline] `test/application/goldenset-addresses.test.ts` (new): `beforeAll` copies
      `ejemplos/` into a temp dir (`cp` with a filter excluding `.compendio`, never indexing in
      place), `createContainer({ root: tmp, forceLexical: true })`, indexes, then asserts Gate 1b
      (every indexed path starts `docs/`) and Gate 1c (every real `esperado` is an indexed path).
      Landed and run **before** 8.3: Gate 1b passed immediately (composition wiring from Phase 6 was
      already correct), Gate 1c failed exactly as predicted — `expected [...] to include
      'leadsviewer/validacion-formulario.md'` — confirming the goldenset gate was a genuine RED, not
      vacuous.
- [x] 8.2 `test/helpers/build.ts`: `buildHarness` now calls `resolveRoots(REPO_ROOT, [docsDir])` and
      passes `root.prefix` as the third `FileDocumentSource` argument; the "mirroring production
      wiring" comment doc-block was extended to say why (calls the real function, never
      `basename(docsDir)`, so it can't independently drift — same argument as Decision 11's
      `vector-reach.mjs`). `test/application/index-progress.test.ts`'s direct
      `FileDocumentSource(EXAMPLES_DOCS, ["INDEX.md"])` construction was prefixed the same way, same
      commit.
- [x] 8.3 Re-addressed `ejemplos/goldenset.yaml`'s 22 `esperado` values with the `docs/` prefix.
      `git diff --stat` on this file alone: 44 lines changed (22 insertions / 22 deletions) —
      addresses only; zero `pregunta` text, filenames, or frontmatter touched (confirmed by reading
      the diff).
- [x] 8.4 Re-addressed every harness-dependent literal across the 5 files the design named, **plus
      two files the design didn't name that broke anyway** — see Deviations below for the full,
      honest accounting (29 literals across the 5 named files, not 26; 2 additional files).
- [x] 8.5 [invert] `goldenset-addresses.test.ts` reran green (2/2) after 8.3-8.4. Added a new
      `describe("multi-root integration — two declared roots, ...")` block to
      `index-and-search.test.ts`: a temp two-root project (`alpha/`, `beta/`), `forceLexical: true`,
      through real `createContainer` — indexes both roots under their own alias, confirms
      `["alpha/one.md", "beta/two.md"]` are both indexed, searches for a term unique to the second
      root and gets it back prefixed, then round-trips that exact `path` through `read_doc`.
- [x] 9.1 Cross-checked `specs/configuration/spec.md`'s three relevant requirements ("`docsDir` Is a
      Non-Empty Array of Declared Roots", "Colliding, Nested, Duplicate, or Empty Declared Root Sets
      Are Rejected at Construction", "`exclude` Matches a Directory Prefix...") against the 4.1-7.1
      implementation and tests: every scenario (including the case-differing-duplicate and
      inner-root-first ones) has a corresponding test, message wording matches verbatim, and no delta
      edit was needed — it was already drafted correctly for this change.
- [x] 9.2 Manual Gate 1, both runs — see "Manual Verification" below for full transcripts.
- [x] 9.3 Manual Gate 2c — see "Manual Verification" below.
- [x] 9.4 `npm test`, `npm run typecheck`, `npm run build` — all green, real output pasted below.

### TDD Cycle Evidence (PR 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1-4.4 | `test/infrastructure/config.test.ts` | Unit | ✅ 13/13 (pre-change) | ✅ Written — confirmed `resolveRoots is not a function` on all 12 new tests | ✅ 25/25 passed after `resolveRoots` implementation | ✅ 12 cases: normalization ×1, two-root ×1, all 7 rejection messages, valid-accept | ➖ None needed — first-pass implementation matched the design's decision table directly |
| 5.1-5.2 | `test/infrastructure/composite-document-source.test.ts` | Unit | N/A (new file) | ✅ Written — confirmed `Cannot find module` before the class existed | ✅ 6/6 passed after `CompositeDocumentSource` | ✅ 6 cases: single-root, merge-order, cross-root sort, error/notice concatenation, throw-on-first-root, throw-on-second-root | ➖ None needed — implementation is a 30-line loop, already minimal |
| 6.1-6.3 | `test/composition.test.ts` (7.1) | Container | ✅ 611/611 full suite (pre-Phase-8) | N/A — wiring change validated by a characterization test written immediately after (7.1), not before; see 7.1's evidence note | ✅ Confirmed via 7.1's 7/7 | ➖ N/A | ➖ None needed |
| 7.1 | `test/composition.test.ts` | Container | ✅ 611/611 (pre-existing) | ➖ Sequenced after 6.1-6.3 per the task list's own ordering (wiring, then the test that proves it) — not a traditional new-feature RED. Falsifiability confirmed by reasoning: moving the `resolveRoots` call to *after* `new SqliteIndexStore` would fail every ".compendio/ does not exist" assertion here | ✅ 7/7 passed on first run | ✅ 7 cases: 2× nested (both orders), duplicate, case-differing duplicate (win32), alias clash, empty array, valid-accept | ➖ None needed |
| 8.1, 8.5 | `test/application/goldenset-addresses.test.ts` | Container/Integration | N/A (new file) | ✅ Written and run against the **unmodified** goldenset — confirmed genuine RED: Gate 1c failed on the first assertion (`leadsviewer/validacion-formulario.md` not in the indexed set) | ✅ 2/2 passed after 8.2-8.4 (goldenset + harness re-addressed) | ➖ Two properties (Gate 1b, Gate 1c), each a single assertion over the full real corpus — no further triangulation needed, this is a container-level acceptance gate, not a unit | ➖ None needed |
| 8.2, 8.4 | `evaluate.test.ts`, `index-and-search.test.ts`, `read-document.test.ts`, `excerpt-window.test.ts`, `heading-less-round-trip.test.ts`, `index-progress.test.ts`, `cli-subprocess.test.ts` | Integration | ✅ Baseline captured per-file before editing (each file's failures observed and matched the predicted "path/module now wrong" shape before any literal was touched) | ✅ Full-suite run after 8.2 alone showed the predicted 22 failures across 6 files, all `path`/`module`-shaped — confirmed the harness change was the trigger, not a coincidence | ✅ 621/621 passed (+1 intentionally skipped) after literal re-addressing | ✅ Iterative: fixed one file, reran, confirmed the next file's failures were independent (not cascading from a shared bug) | ➖ None needed — mechanical re-addressing, not new logic |

### Test Summary (PR 2)

- **Total tests written**: 25 new (`config.test.ts` resolveRoots block: 12; `composite-document-source.test.ts`: 6; `composition.test.ts`: 7; `goldenset-addresses.test.ts`: 2; the multi-root integration case: 1 — plus 1 new test added to `read-document.test.ts` to preserve the strip-fallback coverage the re-addressed literal no longer demonstrated, see Deviations)
- **Total tests passing**: 621/622 (1 intentionally `.skip`ped, see Deviations) — full suite
- **Layers used**: Unit (18: config + composite-source), Container (9: composition + goldenset-addresses), Integration (1: multi-root)
- **Approval/characterization tests**: 1 (`composition.test.ts`'s 7.1, validating the already-implemented 6.1-6.3 wiring — sequenced per the task list's own phase ordering, falsifiability reasoned rather than RED-demonstrated, noted above)
- **Pure functions created**: 1 (`resolveRoots` — no I/O, no `fs` calls; `CompositeDocumentSource.discover` is not pure, it's the composition adapter itself)

### Files Changed (PR 2)

| File | Action | What Was Done |
|------|--------|----------------|
| `src/infrastructure/config.ts` | Modified | `docsDir: string[]`, `DEFAULT_CONFIG.docsDir = ["docs"]`; new `ResolvedRoot` + `resolveRoots` |
| `src/infrastructure/fs/composite-document-source.ts` | **Created** | `CompositeDocumentSource`, `RootSource` — merge/sort, no per-root tolerance yet (PR 3) |
| `src/composition.ts` | Modified | `resolveRoots` before `new SqliteIndexStore`; one unconditional `CompositeDocumentSource` wiring path; writer target `roots[0].dir` |
| `test/infrastructure/config.test.ts` | Modified | Array-shape round trip restated; 12 new `resolveRoots` tests |
| `test/infrastructure/composite-document-source.test.ts` | **Created** | 6 tests over fake `DocumentSource`s |
| `test/composition.test.ts` | **Created** | 7 container-construction collision-guard tests |
| `test/application/goldenset-addresses.test.ts` | **Created** | Gates 1b + 1c, through real `createContainer` |
| `test/helpers/build.ts` | Modified | `buildHarness` prefixes via `resolveRoots`, no reimplemented alias logic |
| `test/application/index-progress.test.ts` | Modified | Direct `FileDocumentSource` construction prefixed the same way |
| `ejemplos/goldenset.yaml` | Modified (addresses only) | 22 `esperado` values gained the `docs/` prefix |
| `test/application/evaluate.test.ts` | Modified | 3 inline `CASES` `expected` values prefixed |
| `test/application/index-and-search.test.ts` | Modified | 10 literals prefixed (incl. strict-fixture block); "filters by module" test `.skip`ped (PR 3 dependency, see Deviations); new multi-root integration `describe` block added |
| `test/application/read-document.test.ts` | Modified | 9 literals prefixed; 1 assertion's module value updated to the honest intermediate value; 1 test renamed to reflect its new exact-match semantics; 1 new test added to preserve strip-fallback coverage |
| `test/application/excerpt-window.test.ts` | Modified | 5 literals prefixed |
| `test/application/heading-less-round-trip.test.ts` | Modified | 3 literals prefixed |
| `test/cli-subprocess.test.ts` | Modified | 3 literals prefixed (not in the design's named file list — see Deviations) |
| `test/fixtures/strict/compendio.config.json` | Modified | `docsDir: "docs"` → `["docs"]` (not in the design's named file list — see Deviations) |
| `openspec/changes/multiple-doc-roots/tasks.md` | Modified | Phase 4-9 marked `[x]`; a note added on 8.4's revised literal count and the two extra files |

### Deviations from Design

None that change the architecture or the decisions — every deviation below is either (a) something
the design already named as accepted (the PR-2-only naive-`inferModule` state) surfacing in a test the
design didn't specifically enumerate, or (b) a literal-count correction discovered by actually running
the suite rather than estimating it.

1. **The naive-`inferModule` intermediate state (Decision 7 / Phase 12, explicitly PR 3) surfaced in
   two places the design's Phase 8 task list didn't name.** With paths prefixed but `inferModule` not
   yet alias-aware (out of scope for this batch per instruction), every top-level-root document's
   first path segment is now the root's own alias (`"docs"`), not its real folder — `docs/x.md` infers
   `module: "docs"` instead of being root-level (`undefined`), and `docs/informes/y.md` infers
   `module: "docs"` instead of `"informes"`. This is `tasks.md`'s own documented shape for task 12.1's
   "baseline" (intermediate PR-2-only state), just reached one commit earlier than task 12.1 lands.
   Handled two ways, chosen per how load-bearing the assertion was to the test's actual purpose:
   - `index-and-search.test.ts`'s "filters by module (folder-inferred, zero-config)" test would need
     to filter by `module: "docs"` to pass — which, since every document in the corpus now shares
     that same value, would make the test pass without testing folder-based filtering at all (a
     trivial/vacuous assertion the strict-TDD rules explicitly ban). `it.skip`ped with a comment
     naming the exact commit that restores it (PR 3, Decision 7, Phase 12) rather than either
     weakening it into a vacuous pass or silently losing the coverage.
   - `read-document.test.ts`'s "returns the full document with its H1 restored" test asserts several
     things, only one of which (`module`) is affected; skipping the whole test would lose real,
     still-valid coverage (H1 restoration, section content). Updated just that one assertion to the
     honest current value (`"docs"`), with a comment explaining why and pointing at the same PR 3
     commit.
2. **`read-document.test.ts`'s "tolerates a leading docs-dir segment" test's premise inverted, not
   just its literal.** Before this change, requesting the on-disk path `docs/leadsviewer/x.md`
   demonstrated `ReadDocument`'s one-segment-strip fallback (indexed paths were docs-relative). After
   prefixing, that same on-disk path *is* the indexed path — Decision 12's own words, "the motivating
   case becomes the exact branch." Renamed the test to state what it now actually demonstrates (an
   exact hit), and added one new test (`"tolerates one genuinely over-prefixed leading segment on the
   path"`, requesting `repo/docs/leadsviewer/x.md`) so the strip-fallback mechanism the original test
   existed to cover is not silently lost from the suite before Phase 15 (PR 4) adds its fuller matrix.
   `read-document.ts` itself was not touched — confirmed by `git diff` showing zero lines changed
   there, matching Decision 12's "a test, not an edit."
3. **Two files outside the design's named 5-file list needed re-addressing to keep `npm test` green**,
   discovered by actually running the suite rather than by re-deriving them from the design text:
   - `test/fixtures/strict/compendio.config.json` declared `docsDir: "docs"` — the pre-array-only
     string shape. Under array-only (no back-compat, per `openspec/config.yaml`'s `rules.proposal`),
     `resolveRoots` rejects any non-array `docsDir` unconditionally, so `test/cli-subprocess.test.ts`
     (which builds a real container against this fixture through the compiled CLI) started failing
     with `docsDir must be an array of documentation root paths` on every one of its corpus-command
     tests. Fixed to `["docs"]`.
   - `test/cli-subprocess.test.ts` itself then needed its 3 literal path assertions
     (`guide-service-onboarding.md`, `test-plan-inventory-alerts.md` ×2) prefixed with `docs/`, for the
     same reason as every other harness-dependent literal. This file goes through the compiled
     `dist/cli.js` as a real subprocess, so it is exactly the "second harness-shaped divergence"
     pattern Decision 13 already named for `index-progress.test.ts` — it just wasn't visible to the
     design's own file-count audit because it constructs no `FileDocumentSource` directly (it invokes
     the CLI, which reaches `createContainer`).
4. **8.4's literal count was higher than the design's "26 harness-dependent literals" estimate once
   actually counted against the running suite**: 29 across the 5 named files (`evaluate.test.ts` 3,
   `index-and-search.test.ts` 10 incl. the strict-fixture block, `read-document.test.ts` 9,
   `excerpt-window.test.ts` 4, `heading-less-round-trip.test.ts` 3), plus the 2 extra files above.
   Recorded honestly rather than smoothed, per this project's own stated practice
   (`design.md`'s own P1/Decision-13 corrections did the same).

### Issues Found

None beyond the deviations above.

### Manual Verification (real output, not inferred)

**Manual Gate 1 — `compendio eval` before/after the goldenset re-addressing, on `ejemplos/`.**

First, `ejemplos/` was indexed with the new (already-wired) prefixed paths, using the transformers.js
model already cached locally from prior manual gates on this project (`node_modules/@huggingface/
transformers/.cache`, ~130 MB — no download needed):

```
node dist/cli.js --root ejemplos index
...
Indexed 11 documents (29 chunks) in 4297 ms [mode hybrid]
```

All 11 indexed paths carried the `docs/` prefix (`docs/glosario.md`, `docs/leadsviewer/...`, etc).

**Before** (goldenset.yaml temporarily reverted to its pre-change, unprefixed `HEAD` content via
`git show HEAD:ejemplos/goldenset.yaml`, then restored immediately after this measurement):

```
node dist/cli.js --root ejemplos eval

Goldenset: 22 questions | k = 5

mode      recall@5   MRR      failures
--------------------------------------
hybrid    0.00       0.000    22
lexical   0.00       0.000    22
```

Matches the design's predicted MRR 0.000 / recall 0.00 exactly — proving the re-addressing is
load-bearing, not cosmetic.

**After** (the real, re-addressed `ejemplos/goldenset.yaml` restored):

```
node dist/cli.js --root ejemplos eval

Goldenset: 22 questions | k = 5

mode      recall@5   MRR      failures
--------------------------------------
hybrid    1.00       0.943    0
lexical   0.95       0.856    1

Failures in lexical mode:
- "¿Qué endpoint hay que llamar para crear un lead?" -> docs/leadsviewer/alta-leads.md (position 11)
```

hybrid recall@5 = 1.00, MRR = 0.943 — **identity** with `CLAUDE.md`'s documented pre-change baseline
("hybrid MRR 0.943"). Top-1 count computed directly via a one-off script calling
`container.searchDocuments.execute` for each goldenset question and checking whether the expected path
ranked first: **20/22** — identity with the documented "top-1 ≥ 20/22" baseline. The two non-top-1
cases (`"¿Por qué dejamos de usar MongoDB?"` at rank 2, `"¿Qué endpoint hay que llamar para crear un
lead?"` at rank 4) are pre-existing, unrelated to this change — the same questions were never top-1
before prefixing either (nothing about ranking changed, only the path string gained a prefix).

**Manual Gate 2c — the motivating case, on this repository.**

A temporary `compendio.config.json` (`{ "docsDir": ["docs", "openspec"], "exclude": ["INDEX.md",
"openspec/changes/archive"] }`) was written at the repo root, `compendio index --lexical` was run, the
resulting `.compendio/compendio.db` was queried directly, and the temporary config was deleted
immediately after (never committed):

```
node dist/cli.js index --lexical
...
Indexed 17 documents (266 chunks) in 261 ms [mode lexical]
```

```sql
SELECT count(*) FROM documents WHERE path LIKE 'openspec/changes/archive/%';  -- 0
SELECT count(*) FROM documents;                                              -- 17
SELECT path FROM documents WHERE path NOT LIKE 'docs/%' AND path NOT LIKE 'openspec/%';  -- 0 rows
```

Zero indexed paths under `openspec/changes/archive/` (would read 79 if the directory-prefix `exclude`
were being matched against the wrong path — Approach 5's named failure mode). Every indexed path
carries either the `docs/` or `openspec/` prefix, unconditionally.

**Note for `sdd-verify`**: `openspec/changes/multiple-doc-roots/verify-report.md` does not exist yet —
it is an `sdd-verify` artifact (confirmed by checking every archived change under
`openspec/changes/archive/*/verify-report.md`, all created during that phase, not during apply). The
two manual gate transcripts above are the source `sdd-verify` should carry into that file; they are
recorded here in full rather than only summarized, so nothing is lost in the handoff.

### Verification (real output, not inferred)

`npm test` — full suite, after all Phase 4-9 work:

```
Test Files  43 passed (43)
     Tests  621 passed | 1 skipped (622)
```

`npm run typecheck`: clean (`tsc --noEmit && tsc -p tsconfig.test.json`, no output, exit 0).

`npm run build`: clean (`tsc`, no output, exit 0).

Real diff stat (`git diff --cached --stat`, everything except this file and `tasks.md`'s checkbox
edits):

```
18 files changed, 694 insertions(+), 99 deletions(-)
```

793 changed lines — inside the design's own forecast band for this slice (~730-1130) for the first
time in this project's recorded forecasting history (compare: `bounded-chunk-size` and
`match-centred-excerpt` both landed 2-4x over their design-phase forecasts). Recorded as observed, not
assumed to generalize — the pattern that motivated `auto-chain`/chained delivery in the first place
still holds for PR 3 and PR 4 until they are actually measured too.

### Workload / PR Boundary (PR 2)

- Mode: chained PR slice (`feature-branch-chain`)
- Current work unit: PR 2 — the structural core (array `docsDir`, `resolveRoots`, the collision guard,
  `CompositeDocumentSource` with no per-root tolerance yet, composition wiring, goldenset + harness
  re-addressing)
- Boundary: starts from PR 1's branch (`feat/multiple-doc-roots-01-exclude-prefix`); ends with a
  green, typed, built suite where multi-root indexing works for the *happy* path (every declared root
  readable, no collisions) but a missing/unreadable declared root still hard-crashes the whole run —
  exactly as today's single root does. Per the design's own condition, this makes PR 2 shippable on
  its own terms without the feature being usable or announced yet (PR 3's job).
- Estimated review budget impact: 793 changed lines (694 insertions + 99 deletions) — **over the
  400-line PR review budget**, as forecast (`400-line budget risk: High`, `Chained PRs recommended:
  Yes` in `tasks.md`'s Review Workload Forecast). This is the largest of the four planned slices by
  design; splitting it further was considered and rejected in `design.md`/`tasks.md` because
  prefixing and the collision guard cannot land in separate PRs (the intermediate state would ship the
  uncaught SQLite UNIQUE-constraint crash), and the goldenset/harness re-addressing cannot be deferred
  past the commit that changes the path shape without leaving `compendio eval` red between slices.
- Branches: tracker `feat/multiple-doc-roots` (off `main`, draft/no-merge); PR 1 child
  `feat/multiple-doc-roots-01-exclude-prefix` (off the tracker); PR 2 child
  `feat/multiple-doc-roots-02-structural-core` (off the PR 1 branch, per Feature Branch Chain naming).
- Commits (local only, not pushed): see the actual commit log for this batch — split by work unit per
  `work-unit-commits`, not by file type; tests land with the behavior they verify.

### Status

PR 1 (Phase 1-3): **9/9 tasks complete.**
PR 2 (Phase 4-9): **26/26 tasks complete** (4.1-4.4, 5.1-5.2, 6.1-6.3, 7.1, 8.1-8.5, 9.1-9.4).

**35/35 tasks complete across PR 1 + PR 2.** PR 2 is ready for `sdd-verify` on its own scope, or for
the next `sdd-apply` batch to begin PR 3 (base: this PR 2 branch) — Phase 10 (composite per-root
tolerance + alias-as-`ReadError.path`), Phase 11 (Gate 4b), Phase 12 (alias-aware `inferModule`,
which restores the `index-and-search.test.ts` test skipped in this batch and the `read-document.test.ts`
module assertion to their real, folder-inferred values), Phase 13 (spec + verification).

## Batch 3 — PR 3 (this batch)

**Scope**: `tasks.md` §"PR 3 — behavioural companions" — Phase 10 (composite per-root tolerance +
alias-as-`ReadError.path`), Phase 11 (Gate 4b), Phase 12 (alias-aware `inferModule`), Phase 13 (spec +
verification). Branch `feat/multiple-doc-roots-03-behavioural-companions`, off PR 2's branch
(`feat/multiple-doc-roots-02-structural-core`), per Feature Branch Chain. Explicitly **not** in scope,
per instruction and per the design's own PR boundary: combined `INDEX.md`, `read_doc` tolerance tests,
`vector-reach.mjs`, README/CLAUDE.md updates (Phases 14-17, PR 4).

### Completed Tasks

- [x] 10.1 [RED] Extended `composite-document-source.test.ts`: replaced the two PR-2 "propagates
      immediately" tests with tolerant-catch equivalents (one root throws → other's files + one
      `ReadError`; second-root-throws mirror), added a dedicated alias-vs-declared test, an all-roots-fail
      aggregate-message test, and an N=1-degenerates-to-all-fail test. Confirmed genuine RED: 5/9 tests
      failed against the unmodified (no-`try`/`catch`) PR 2 implementation before any production edit.
- [x] 10.2 [GREEN] `composite-document-source.ts`: wrapped each root's `discover()` in `try`/`catch`;
      on catch, pushes `{ path: root.prefix, error: 'declared documentation root "<declared>" (<dir>)
      could not be read: <reason>' }` into `readErrors` and continues; after the loop, rethrows one
      aggregate error (`no documentation root could be read: "<declared>" (<dir>): <reason>; ...`,
      one clause per failed root) only when every root threw. Confirmed GREEN: 9/9 passed.
- [x] 10.3 Re-confirmed `file-document-source.test.ts:99` and the 2.3 seeded-prefix test both pass
      unchanged — `git diff --stat` shows zero changes to `file-document-source.ts` or its test in this
      batch; both files' 14/14 tests still pass.
- [x] 11.1 [RED-by-construction] `sync-index.test.ts`: added a dedicated "Gate 4b" describe block —
      (a) a direct `SyncIndex` protection test with `readErrors: [{ path: "openspec" }]` (the alias)
      against existing `openspec/**` documents → `deleted` is empty; (b) the inverse, with
      `readErrors: [{ path: "packages/app/docs" }]` (the declared string) against existing `docs/**`
      documents → `deleted` includes them (purged, proving why the alias matters); (c) an end-to-end
      test wiring the REAL `CompositeDocumentSource` over a nested, differently-aliased root
      (`declared: "packages/app/docs"`, `prefix: "docs"`) into `SyncIndex`, asserting the failed root's
      subtree survives a second pass. **Empirically falsified, not just reasoned about**: temporarily
      flipped 10.2's `path: root.prefix` to `path: root.declared`, reran (c) and the alias test from
      10.1 — both failed exactly as predicted (test (c): `deleted` became `['docs/a.md',
      'docs/nested/b.md']`, i.e. the whole subtree purged), then reverted and reconfirmed 28/28 green.
      This is the single most load-bearing property in this PR — kept as its own describe block, never
      folded into another test, per explicit instruction.
- [x] 11.2 Confirmed green — satisfied entirely by 10.2, no separate implementation change (19/19 in
      `sync-index.test.ts`, including the pre-existing 16 unaffected by this batch).
- [x] 12.1 [baseline] `convention.test.ts`: landed `inferModule("docs/documentation-convention.md")`
      (no `rootPrefixes` argument) → `"docs"`, confirmed passing on unmodified code — the intermediate
      PR-2-only naive state, matching the already-existing `read-document.test.ts`/
      `index-and-search.test.ts` PR-2 deviations named in Batch 2.
- [x] 12.2 [GREEN] `src/domain/convention.ts`: `inferModule(path, rootPrefixes?: readonly string[])`
      strips at most one matching `<prefix>/` (via `Array.find`, so "first match wins" — unambiguous
      only because `resolveRoots` rejects nested roots) before taking the first remaining segment;
      `createConventionPolicy(cfg, rootPrefixes?)` threads it into `createLoosePolicy`'s resolver;
      `createStrictPolicy` ignores the parameter entirely (it only validates `module`'s presence, never
      infers it). RED confirmed first: 5 new assertions failed against the unmodified 1-arg
      `inferModule`/`createConventionPolicy` (wrong values returned, not a type error, since the extra
      arg is silently ignored at runtime); GREEN confirmed after: 34/34 in `convention.test.ts`.
- [x] 12.3 `composition.ts`: `createConventionPolicy(config.convention, roots.map(r => r.prefix))`,
      unconditional, no branch. Also extended `test/helpers/build.ts`'s `createConventionPolicy` call
      the same way (not separately named in tasks.md, but required for the un-skip in 12.4 below to be
      real: `buildHarness` is the harness the "filters by module" test actually runs through, and
      Decision 13's own argument — "a harness that diverges from production on the most visible
      contract is what produced finding 2" — applies identically here).
- [x] 12.4 [invert] Ran the full suite after the wiring change: exactly one pre-existing assertion
      failed (`read-document.test.ts`'s `module: "docs"`), confirming the wiring reaches production
      correctly and isolating precisely the deviation that needed restoring. Restored it to `module:
      "leadsviewer"`. Un-skipped `index-and-search.test.ts`'s "filters by module" test (removed the
      `it.skip` and its PR-2-deviation comment; restored the original assertion body unweakened). Added
      a new dedicated test (`IndexDocuments — alias-aware module inference across roots`) proving
      `docs/documentation-convention.md` → `module` absent, `openspec/specs/indexing/spec.md` → `module:
      "specs"`, and `GetOverview`'s `byModule` has no `docs`/`openspec` bucket at all (Gate 3, the
      `byModule` clause tasks.md called for).
- [x] 13.1 Cross-checked `specs/indexing/spec.md`'s "Read Failures Protect the Affected `path` Subtree
      From Deletion" MODIFIED requirement against 10.1-11.1: all four scenarios (one-of-several-unreadable,
      sole-root-degenerates-to-all-fail, every-root-fails, alias-protects-subtree) match the
      implementation and tests exactly, including the literal `ReadError.path` value named in the
      fourth scenario. The requirement narrows the pre-existing MUST (root failure is still reported and
      still protects its subtree) rather than deleting it — confirmed by reading the "Previously:" note,
      which states the generalization explicitly. No edit needed — already drafted correctly.
- [x] 13.2 Cross-checked the "Field Inference in `loose` Mode" MODIFIED requirement (`module` relative to
      the containing root) against 12.1-12.4: every scenario in the delta (empty-string-frontmatter,
      folder-segment on the default root, root-top-level-has-no-module, frontmatter-wins,
      deeper-second-root) is satisfied by the implementation. No edit needed.
- [x] 13.3 Manual Gate 4, both halves — see Manual Verification below for full transcripts (exit 0 /
      exit 1 with real stdout).
- [x] 13.4 Manual Gate 3 on this repository — see Manual Verification below for the before/after `By
      module` transcript, including an empirically reproduced "before" baseline (not just quoted from
      the task prompt).
- [x] 13.5 `npm test`, `npm run typecheck`, `npm run build` — all green, real output pasted below.

### TDD Cycle Evidence (PR 3)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 10.1-10.2 | `test/infrastructure/composite-document-source.test.ts` | Unit | ✅ 4/4 (pre-change, unaffected tests) | ✅ Written — confirmed 5/9 failing against the unmodified no-`try`/`catch` composite | ✅ 9/9 passed after the `try`/`catch` + aggregate-rethrow implementation | ✅ 6 cases: one-root-fails, second-root-fails, alias-vs-declared, all-fail aggregate, N=1-degenerate, (plus the 3 pre-existing merge/sort cases unaffected) | ➖ None needed — a 20-line loop, already minimal |
| 10.3 | `test/infrastructure/file-document-source.test.ts` | Unit | ✅ 14/14 (unchanged, diff-confirmed) | N/A — no change to this file in this batch | ✅ 14/14 | ➖ N/A | ➖ N/A |
| 11.1-11.2 | `test/application/sync-index.test.ts` | Integration | ✅ 16/16 (pre-existing, unaffected) | ✅ Written; falsifiability confirmed **empirically** (not just reasoned): temporarily flipping `root.prefix`→`root.declared` in production code reproduced the exact predicted failure (`deleted` gained `docs/a.md`, `docs/nested/b.md`), then reverted | ✅ 19/19 passed (16 pre-existing + 3 new) | ✅ 3 cases: direct-protect, inverse-purge, end-to-end-through-real-composite | ➖ None needed — no production code changed in this phase |
| 12.1-12.2 | `test/domain/convention.test.ts` | Unit | ✅ 29/29 (pre-change) | ✅ Written — confirmed 5/5 new assertions failing against the unmodified 1-arg `inferModule`/`createConventionPolicy` | ✅ 34/34 passed after the `rootPrefixes` parameter + strip logic | ✅ 6 cases for `inferModule` (baseline, strip, invert-to-undefined, second-root, no-match-fallthrough, omitted/empty-fallthrough) + 4 for `createConventionPolicy` threading (loose-strip, loose-root-level, loose-no-arg-default, strict-ignores) | ➖ None needed — a 4-line `find`+`slice` |
| 12.3-12.4 | `src/composition.ts`, `test/helpers/build.ts`, `test/application/read-document.test.ts`, `test/application/index-and-search.test.ts` | Container/Integration | ✅ 638/639 full suite (pre-Phase-12.4, one deferred assertion still failing as predicted) | N/A — wiring change; falsifiability confirmed by running the full suite immediately after the wiring edit and observing exactly the one predicted pre-existing failure (`read-document.test.ts`'s `module: "docs"`), nothing else moved | ✅ 639/639 (0 skipped) after restoring the deferred assertion, un-skipping the "filters by module" test, and adding the `byModule` bucket-absence test | ✅ 2 real scenarios in the new byModule test (root-level-under-alias → absent, nested-second-root → real folder) | ➖ None needed |

### Test Summary (PR 3)

- **Total tests written**: 15 new (`composite-document-source.test.ts`: 4 net-new beyond the 2 rewritten
  in place; `sync-index.test.ts`: 3; `convention.test.ts`: 10 across the two new describe blocks; 1 new
  `byModule` test in `index-and-search.test.ts`) plus 2 tests rewritten in place (the former "propagates
  immediately" pair) and 1 un-skipped (`index-and-search.test.ts`'s "filters by module")
- **Total tests passing**: 639/639 (0 skipped) — full suite, up from 621 passed / 1 skipped at the end
  of PR 2
- **Layers used**: Unit (composite-document-source, convention: 19), Integration/Container
  (sync-index, index-and-search, read-document, composition-adjacent: rest)
- **Approval/characterization tests**: 1 (12.3-12.4's full-suite-rerun-after-wiring, matching the same
  falsifiability-by-reasoning-then-confirmed-by-running pattern used for PR 2's 7.1)
- **Pure functions modified**: 1 (`inferModule` — still zero I/O, zero `fs` calls, now takes an
  optional `readonly string[]`)
- **Empirical falsifications performed** (beyond the standard RED/GREEN cycle): 1 — Gate 4b's
  alias-vs-declared property, verified by actually breaking the production code, observing the
  predicted failure, then reverting (see 11.1's evidence row)

### Files Changed (PR 3)

| File | Action | What Was Done |
|------|--------|----------------|
| `src/infrastructure/fs/composite-document-source.ts` | Modified | Per-root `try`/`catch` tolerance; `ReadError.path` is `root.prefix` (alias); all-fail aggregate rethrow |
| `src/domain/convention.ts` | Modified | `inferModule(path, rootPrefixes?)`; `createConventionPolicy(cfg, rootPrefixes?)` threading into `createLoosePolicy` only |
| `src/composition.ts` | Modified | `createConventionPolicy(config.convention, roots.map(r => r.prefix))`, unconditional |
| `test/infrastructure/composite-document-source.test.ts` | Modified | Tolerance tests replacing the PR-2 "propagates immediately" pair; alias-vs-declared test; all-fail aggregate test; N=1-degenerate test |
| `test/application/sync-index.test.ts` | Modified | New "Gate 4b" describe block: direct-protect, inverse-purge, end-to-end-through-real-composite |
| `test/domain/convention.test.ts` | Modified | `inferModule` alias-aware block (6 tests); `createConventionPolicy` rootPrefixes-threading block (4 tests) |
| `test/helpers/build.ts` | Modified | `createConventionPolicy(convention, [root!.prefix])`, mirroring production wiring |
| `test/application/index-and-search.test.ts` | Modified | Un-skipped "filters by module"; new `byModule` bucket-absence test; import for `GetOverview` |
| `test/application/read-document.test.ts` | Modified | Module assertion restored from `"docs"` to `"leadsviewer"` |
| `openspec/changes/multiple-doc-roots/tasks.md` | Modified | Phase 10-13 marked `[x]` |

### Deviations from Design

None that change the architecture or the decisions. One clarification worth naming:

1. **`test/helpers/build.ts`'s `createConventionPolicy` call was extended, though tasks.md's Phase 12
   list only names `composition.ts:74` explicitly.** This is required, not optional, for 12.4's un-skip
   to be a real, non-vacuous restoration: `index-and-search.test.ts`'s "filters by module" test runs
   through `buildHarness` (the in-memory test composition root), not through `createContainer`. Without
   this change, the test would still see the naive (root-alias) module value and either fail or need to
   stay weakened — exactly the divergence Decision 13 already named and fixed once for
   `FileDocumentSource`'s prefix argument ("a harness that diverges from production on the most visible
   contract is what produced finding 2"). Same argument, same fix, applied to the same file for a second
   parameter.

### Issues Found

None.

### Manual Verification (real output, not inferred)

**Manual Gate 3 — module inference is alias-aware, measured on this repository, with an empirically
reproduced "before" baseline.**

Rather than trusting the orchestrator-supplied "before" figure, it was reproduced independently: `git
stash` set the working tree back to the PR 2 tip (confirmed via `git log -1` showing `1a214f6`), built,
indexed this repo with a temporary root `compendio.config.json` (`docsDir: ["docs","openspec"], exclude:
["INDEX.md","openspec/changes/archive"]`), and ran `overview`:

```
node dist/cli.js index --lexical
Indexed 17 documents (284 chunks) in 211 ms [mode lexical]

node dist/cli.js overview
Indexed documents: 17
By type: guide (1)
By module: transversal (1), openspec (16)
```

Identity with the orchestrator-quoted PR 2 figure (`transversal (1), openspec (16)`) — confirms the
"before" is real, not assumed. Cleaned up (`rm -f compendio.config.json && rm -rf .compendio`),
`git stash pop` restored the PR 3 working tree exactly (`git status --short` showed the same 10 modified
files as before the stash), then rebuilt with PR 3's changes and re-ran the identical steps:

```
node dist/cli.js index --lexical
Indexed 17 documents (284 chunks) in 200 ms [mode lexical]

node dist/cli.js overview
Indexed documents: 17
By type: guide (1)
By module: transversal (1), changes (9), specs (6)
```

No `docs`/`openspec` bucket in either run's "after" — `changes (9)` and `specs (6)` are the real
`openspec/changes/*` and `openspec/specs/*` folders (9 + 6 + 1 transversal = 16, plus the one root-level
`docs/documentation-convention.md` with no module at all = 17 total, matching Gate 3's exact prediction
in design.md's table). Chunk count identical (284) between before/after, confirming this change touches
only `module` classification, nothing about chunking or content.

**Manual Gate 4 — a missing root does not crash; every root missing still throws.**

One of two declared roots missing (`docsDir: ["docs", "nonexistent-root"]`):

```
node dist/cli.js index --lexical
Discovering documents
Indexing 1 documents
[1/1] docs/documentation-convention.md
WARNING nonexistent-root: declared documentation root "nonexistent-root" (C:\Users\Raul\Workspace\compendio-mcp\nonexistent-root) could not be read: cannot read the documentation directory "C:\Users\Raul\Workspace\compendio-mcp\nonexistent-root": ENOENT: no such file or directory, scandir 'C:\Users\Raul\Workspace\compendio-mcp\nonexistent-root'
WARNING indexed without embeddings (provider unavailable): search runs in lexical mode
Indexed 1 documents (13 chunks) in 29 ms [mode lexical]
Skipped 1 documents with invalid frontmatter.
EXIT CODE: 0
```

Every declared root missing (`docsDir: ["nonexistent-a", "nonexistent-b"]`):

```
node dist/cli.js index --lexical
Discovering documents
no documentation root could be read: "nonexistent-a" (C:\Users\Raul\Workspace\compendio-mcp\nonexistent-a): cannot read the documentation directory "C:\Users\Raul\Workspace\compendio-mcp\nonexistent-a": ENOENT: no such file or directory, scandir 'C:\Users\Raul\Workspace\compendio-mcp\nonexistent-a'; "nonexistent-b" (C:\Users\Raul\Workspace\compendio-mcp\nonexistent-b): cannot read the documentation directory "C:\Users\Raul\Workspace\compendio-mcp\nonexistent-b": ENOENT: no such file or directory, scandir 'C:\Users\Raul\Workspace\compendio-mcp\nonexistent-b'
EXIT CODE: 1
```

Exit 0 with the readable root fully indexed and the missing one named by alias in the first case; exit 1
with BOTH declared roots and reasons named in one aggregate message in the second — exactly Decision
2/3's specified behaviour. Temporary config and `.compendio/` deleted immediately after each run;
`git status --short` confirmed clean (only the 10 intentional source/test files modified) before
committing.

### Verification (real output, not inferred)

`npm test` — full suite, after all Phase 10-13 work:

```
Test Files  43 passed (43)
     Tests  639 passed (639)
```

Zero skipped. The two remaining conditional skips in the repo (`test/cli-subprocess.test.ts`'s
`ctx.skip` when the platform can't create a symlink/junction, and `config.test.ts`'s/`composition.test.ts`'s
`it.skipIf(process.platform !== "win32")`) are pre-existing, environment-conditional, unrelated to this
PR's scope, and evaluate to "run" on this Windows development machine — confirmed by the 639 count
including them.

`npm run typecheck`: clean (`tsc --noEmit && tsc -p tsconfig.test.json`, no output, exit 0).

`npm run build`: clean (`tsc`, no output, exit 0).

Real diff stat (`git diff --numstat` across both feature commits, excluding `tasks.md`):

```
9 files changed, 346 insertions(+), 40 deletions(-)
```

386 changed lines — the first PR in this 4-PR chain to land **inside** the 400-line review budget
outright (design's own forecast for this slice was ~230-370; this landed at the top of that band, not
over it like PR 2's 793). Recorded as observed, not assumed to generalize to PR 4.

### Workload / PR Boundary (PR 3)

- Mode: chained PR slice (`feature-branch-chain`)
- Current work unit: PR 3 — behavioural companions (composite per-root tolerance, alias-as-`ReadError.path`,
  Gate 4b, alias-aware `inferModule`)
- Boundary: starts from PR 2's branch (`feat/multiple-doc-roots-02-structural-core`); ends with a green,
  typed, built suite where multi-root indexing is actually usable — a missing/unreadable declared root no
  longer crashes the whole run, its subtree is protected from deletion, and `module` inference is a real
  per-root folder signal again. This is the first PR after which the feature may be documented/announced
  (per the design's own condition) — though that documentation itself is PR 4 scope, not done here.
- Estimated review budget impact: 386 changed lines (346 insertions + 40 deletions), inside the 400-line
  PR review budget.
- Branches: tracker `feat/multiple-doc-roots` (off `main`, draft/no-merge); PR 1 child
  `feat/multiple-doc-roots-01-exclude-prefix` (off the tracker); PR 2 child
  `feat/multiple-doc-roots-02-structural-core` (off the PR 1 branch); PR 3 child
  `feat/multiple-doc-roots-03-behavioural-companions` (off the PR 2 branch, per Feature Branch Chain
  naming).
- Commits (local only, not pushed): two work-unit commits — `feat(fs): tolerate per-root read failures
  in CompositeDocumentSource` (Phase 10+11, tests land with the behavior they verify) and `feat(domain):
  thread declared root aliases through module inference` (Phase 12, including the two restored PR-2
  deferred assertions and the harness wiring that makes the restoration real) — plus this docs(sdd)
  commit.

### Status

PR 1 (Phase 1-3): **9/9 tasks complete.**
PR 2 (Phase 4-9): **26/26 tasks complete.**
PR 3 (Phase 10-13): **16/16 tasks complete** (10.1-10.3, 11.1-11.2, 12.1-12.4, 13.1-13.5).

**51/51 tasks complete across PR 1 + PR 2 + PR 3.** PR 3 is ready for `sdd-verify` on its own scope, or
for the next `sdd-apply` batch to begin PR 4 (base: this PR 3 branch) — Phase 14 (combined `INDEX.md`),
Phase 15 (`read_doc` tolerance tests — note the exact-hit and over-prefixed-hit cases this phase called
for are already covered by Batch 2's Deviation #2, so Phase 15 there only owns the aliased-collision
residual case and the bare-basename-miss case), Phase 16 (`vector-reach.mjs` + docs), Phase 17 (spec +
final verification).

## Remaining Tasks (PR 4 — not started)

- [ ] Phase 14: Combined `INDEX.md`
- [ ] Phase 15: `read_doc` tolerance — tests only (exact-hit and over-prefixed-hit already covered by
      Batch 2's Deviation #2; Phase 15 still owns the aliased-collision residual case and the
      bare-basename-miss case)
- [ ] Phase 16: `vector-reach.mjs` + docs
- [ ] Phase 17: Spec + final verification (PR 4)
