# Apply Progress: Auto-discover Markdown Roots

## Summary

Implemented all 17 tasks for `auto-discover-markdown-roots` in strict TDD mode. The change replaces the hidden zero-config `docsDir: ["docs"]` default with filesystem root discovery, preserves explicit config/`--dir` behavior, adds discovery-only traversal protections, keeps the MCP surface unchanged, and updates user-facing documentation.

## Workload / PR Boundary

- Mode: single PR with approved `size:exception`
- Delivery strategy: `single-pr`
- Chain strategy: `size-exception`
- Boundary: complete `auto-discover-markdown-roots` implementation, tests, docs, and SDD task completion in one PR-sized work unit
- Current review budget impact: tracked and untracked worktree measurement is 26 files, +1356/-87 lines after this progress update. That includes production, tests, documentation, scripts, and untracked OpenSpec artifacts, so the approved `size:exception` remains required.

## Completed Tasks

- [x] 1.1 RED: Add config tests in `test/infrastructure/config.test.ts` for absent config, `[]`, omitted `docsDir`, malformed/read errors, and explicit arrays.
- [x] 1.2 GREEN: Implement `DocumentationRootSelection` and ENOENT-only loading in `src/infrastructure/config.ts`.
- [x] 1.3 REFACTOR: Keep `docsDir` fail-fast, no hidden default, and preserve explicit validation helpers.
- [x] 1.4 RED: Add discovery tests for deterministic order, case-insensitive `.md`, recursive technical ignores, symlink refusal, and abort-vs-empty behavior.
- [x] 1.5 GREEN: Create `src/infrastructure/fs/discover-markdown-roots.ts` with the discovery helper.
- [x] 1.6 REFACTOR: Make discovery ordering/path filtering deterministic and isolated to infrastructure.
- [x] 2.1 RED: Add traversal tests proving discovery-only `FileDocumentSource` options skip technical/symlink content while explicit mode remains unchanged.
- [x] 2.2 GREEN: Extend `FileDocumentSource` with discovery-only traversal options in `src/infrastructure/fs/file-document-source.ts`.
- [x] 2.3 REFACTOR: Keep explicit excludes and recursion semantics unchanged outside discovery mode.
- [x] 2.4 RED: Add composition/index-md/MCP tests for zero roots, lazy DB, discovered path round-trips, explicit `--dir`, both `INDEX.md` placement modes, three-tool surface, unreadable discovered-root sync abort, and the dynamic exact `openspec/**/*.md` path-set gate.
- [x] 2.5 GREEN: Update `src/composition.ts` so root selection happens before store construction and preserves aliases, excludes, module inference, and sync preservation.
- [x] 2.6 REFACTOR: Keep discovery-mode `INDEX.md` at project root and explicit mode at the first/override root; migrate `scripts/vector-reach.mjs` and every real `config.docsDir` consumer, without changing `GenerateIndexMd` or `SyncIndex`.
- [x] 3.1 REFACTOR: Verify path round-trips, self-exclusion in both modes, zero-config `INDEX.md`, and three-tool surface regression.
- [x] 3.2 REFACTOR: Run the dynamic exact `openspec/**/*.md` path-set gate and the unreadable-root sync-abort regression after wiring.
- [x] 3.3 REFACTOR: Keep all new behavior tests beside their units and ensure explicit-mode invariance still passes.
- [x] 4.1 Update user-facing docs/config examples and any stale `AGENTS.md` claims affected by discovery mode.
- [x] 4.2 Run `npm run build`, `npm run typecheck`, and `npm test`; fix regressions and leave the single PR ready pending size:exception.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/infrastructure/config.test.ts` | Unit | ✅ Existing focused config suite included in RED run | ✅ New rootSelection/malformed/read-error tests failed before implementation (`rootSelection` undefined, malformed docsDir did not throw) | ✅ Focused suite passed: `npx vitest run test/infrastructure/config.test.ts ...` → 130/130 | ✅ Covered absent config, omitted docsDir, empty array, explicit arrays, wrong-typed docsDir, non-string entries, and mocked EACCES | ✅ Kept validation in `resolveRootSelection` and left `resolveRoots` for explicit root-set structural validation |
| 1.2 | `test/infrastructure/config.test.ts` | Unit | ✅ Same focused suite | ✅ Tests required `DocumentationRootSelection` and ENOENT-only behavior before code existed | ✅ `loadConfigReport` returns `{ config, rootSelection, warnings }` and rejects non-ENOENT read failures | ✅ Explicit/discovery cases exercise both union arms | ✅ `loadConfig` remains a thin compatibility wrapper over `.config` |
| 1.3 | `test/infrastructure/config.test.ts` | Unit | ✅ `resolveRoots` rejection tests remained green after behavior change except intentional empty-array discovery update | ✅ No-hidden-default tests failed against `DEFAULT_CONFIG.docsDir: ["docs"]` | ✅ `DEFAULT_CONFIG.docsDir` is absent and populated docsDir still validates fail-fast | ✅ Malformed docsDir cases ensure no fallback to discovery | ✅ Numeric/config-warning helpers were left unchanged |
| 1.4 | `test/infrastructure/discover-markdown-roots.test.ts` | Unit | N/A (new file) | ✅ New test file initially failed because module did not exist | ✅ Discovery helper tests passed in focused run | ✅ Cases cover raw ordering, mixed-case `.Md`, recursive technical ignores, symlink root/dir refusal, empty result, and scan abort | ✅ Discovery logic kept in infrastructure helper |
| 1.5 | `test/infrastructure/discover-markdown-roots.test.ts` | Unit | N/A (new file) | ✅ Import failure for missing `discoverMarkdownRoots` | ✅ Created `src/infrastructure/fs/discover-markdown-roots.ts`; tests pass | ✅ Technical and normal roots prove selection is not hardcoded | ✅ Shared `isDiscoveryIgnoredDirectory` exported for traversal reuse |
| 1.6 | `test/infrastructure/discover-markdown-roots.test.ts` | Unit | ✅ Discovery tests green before refactor | ✅ Raw ordering expectations rejected locale/readdir-dependent ordering | ✅ Sorting uses raw `<`/`>` comparison and ignores are case-insensitive | ✅ Repeated discovery assertion pins deterministic results | ✅ Path filtering isolated to helper plus exported ignore predicate |
| 2.1 | `test/infrastructure/file-document-source.test.ts` | Integration/unit with fs adapter mocks | ✅ Existing FileDocumentSource tests included in focused run | ✅ Discovery-mode constructor option did not exist; symlink/technical expectations failed | ✅ Focused suite passed after traversal option implementation | ✅ Companion explicit-mode test proves technical dirs and symlinked markdown files remain included outside discovery mode | ✅ Avoided changing default explicit traversal/exclude semantics |
| 2.2 | `test/infrastructure/file-document-source.test.ts` | Integration/unit | ✅ Existing decoding/exclude/root-error tests stayed green | ✅ Discovery-only options missing | ✅ `FileDocumentSourceOptions` implemented with `discoveryMode` | ✅ One test exercises skipped symlink/technical content; another exercises explicit inclusion | ✅ Reused discovery ignore predicate; no new domain dependency |
| 2.3 | `test/infrastructure/file-document-source.test.ts` | Integration/unit | ✅ Existing exclude and hidden-directory tests stayed green | ✅ Explicit-mode regression test would fail if discovery rules leaked globally | ✅ Explicit mode unchanged; discovery mode skips symlinks/technical dirs only | ✅ Basename, exact, and prefix excludes still pass existing tests | ✅ Constructor default `{}` preserves previous callers |
| 2.4 | `test/composition.test.ts`, `test/server.test.ts`, `test/cli-subprocess.test.ts` | Integration | ✅ Existing composition/server/CLI suites included in focused/full runs | ✅ New composition tests failed with old hidden `docs` default; server surface test added | ✅ Focused suite passed and full `npm test` passed | ✅ Cases cover zero roots/lazy DB, discovered round-trip paths, dynamic exact OpenSpec path set, index-md placement, explicit `--dir`, sync abort, and exactly three tools | ✅ Removed stale empty-docs CLI expectation for `docs/INDEX.md` |
| 2.5 | `test/composition.test.ts` | Integration | ✅ Existing explicit multi-root and `--dir` invariance tests stayed green | ✅ Discovery path-set and round-trip tests failed before composition wiring | ✅ `createContainer` resolves root mode before store construction and passes discovered roots through `resolveRoots` | ✅ Dynamic OpenSpec gate compares every current `.md` under copied `openspec/` | ✅ Store construction stays after discovery/root validation |
| 2.6 | `test/composition.test.ts`, `scripts/vector-reach.mjs` | Integration/script maintenance | ✅ `npm run typecheck` after script/config consumer migration | ✅ Index-md placement tests failed before discovery target branch | ✅ Discovery mode writes project-root `INDEX.md`; `--dir` writes inside override root | ✅ Both placement modes asserted in one test; `vector-reach.mjs` now resolves roots from `rootSelection` | ✅ Did not alter `GenerateIndexMd` or `SyncIndex`; existing seams were sufficient |
| 3.1 | Focused + full suites | Integration/regression | ✅ All focused suites passing before full verification | ✅ Added/updated tests would catch broken round-trips/self-exclusion/tool-surface drift | ✅ `npx vitest run ...` passed; `npm test` passed | ✅ Search result path round-trips through `read_doc`, CLI index-md no-db path updated, server tools exact set asserted | ✅ No extra MCP tools or response shape changes |
| 3.2 | `test/composition.test.ts` | Integration/acceptance | ✅ Dynamic gate included in focused run | ✅ Old composition indexed zero docs for copied `openspec/` | ✅ Dynamic exact `openspec/**/*.md` path set passes in lexical mode; unreadable-root sync abort preserves stored docs | ✅ Gate counts source paths at runtime, including active/archive/top-level nested files | ✅ Kept acceptance lexical-only: no embedding/model download |
| 3.3 | All tests | Regression | ✅ Existing tests retained | ✅ Full suite exposed one stale CLI expectation | ✅ Updated stale CLI no-root `INDEX.md` assertion; `npm test` passed 891/891 | ✅ Explicit-mode `--dir` and multi-root tests remain green | ✅ New tests live beside affected units |
| 4.1 | `README.md`, `AGENTS.md`, `docs/documentation-convention.md` | Documentation | N/A (docs-only) | ✅ Stale docs identified by `Select-String` (`docsDir` default, `docs/INDEX.md`) | ✅ Docs updated to describe discovery mode, explicit `docsDir`, `--dir`, and INDEX.md placement | ✅ README + AGENTS + convention wording cover user-facing and agent-facing claims | ✅ Kept artifact language English and avoided changing OpenSpec main specs before archive |
| 4.2 | Full repo commands | Build/test | ✅ Focused tests and typecheck green before final full run | ✅ Full `npm test` initially failed on stale CLI expectation, proving regression test relevance | ✅ Final commands passed: build, typecheck, and full test suite | ✅ Full suite: 51 files / 891 tests | ✅ No production changes needed after final green run |

## Test Commands and Results

| Command | Result |
|---|---|
| `npx vitest run test/infrastructure/config.test.ts test/infrastructure/discover-markdown-roots.test.ts test/infrastructure/file-document-source.test.ts test/composition.test.ts test/server.test.ts` | RED: failed as expected before implementation (missing discovery module, `rootSelection` undefined, hidden docs default still active, index-md placement old behavior) |
| `npx vitest run test/infrastructure/config.test.ts test/infrastructure/discover-markdown-roots.test.ts test/infrastructure/file-document-source.test.ts test/composition.test.ts test/server.test.ts` | GREEN: passed — 5 files, 130 tests |
| `npm run typecheck` | Passed — `tsc --noEmit && tsc -p tsconfig.test.json` |
| `npm test` | First full run failed one stale CLI expectation for no-root `index-md` writing `docs/INDEX.md` |
| `npm run build` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed — 51 files, 891 tests |
| `npx vitest run test/composition.test.ts` | Passed after writing `apply-progress.md`, re-validating the dynamic OpenSpec path-set gate with the new artifact present — 1 file, 17 tests |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `src/infrastructure/config.ts` | Modified | Added `DocumentationRootSelection`, removed hidden `docsDir` default, made only ENOENT select discovery, and made malformed docsDir fail fast. |
| `src/infrastructure/fs/discover-markdown-roots.ts` | Created | Added deterministic discovery helper with technical-name ignores, symlink refusal, case-insensitive `.md`, and fail-fast scan errors. |
| `src/infrastructure/fs/file-document-source.ts` | Modified | Added discovery-only traversal mode to skip symlinks and technical dirs while keeping explicit mode unchanged. |
| `src/infrastructure/fs/composite-document-source.ts` | Modified | Allowed zero-root discovery to return an empty result instead of throwing. |
| `src/composition.ts` | Modified | Wired root selection before store construction, discovery roots through existing alias pipeline, and mode-specific `INDEX.md` target/selfPath. |
| `scripts/vector-reach.mjs` | Modified | Migrated root resolution away from `config.docsDir` to `rootSelection` plus discovery. |
| `test/infrastructure/config.test.ts` | Modified | Added root-selection and malformed/read-error tests; updated no-hidden-default expectations. |
| `test/infrastructure/discover-markdown-roots.test.ts` | Created | Added discovery helper tests. |
| `test/infrastructure/file-document-source.test.ts` | Modified | Added discovery-only traversal vs explicit-mode invariance tests. |
| `test/composition.test.ts` | Modified | Added discovery wiring, index-md placement, dynamic OpenSpec acceptance, and sync-abort preservation tests. |
| `test/server.test.ts` | Modified | Added exact three-tool MCP surface regression. |
| `test/cli-subprocess.test.ts` | Modified | Updated no-root index-md expectation to project-root discovery mode. |
| `README.md` | Modified | Updated zero-config, `docsDir`, discovery, path-shape, and CLI/index-md documentation. |
| `AGENTS.md` | Modified | Updated stale agent-facing root-selection and index-md claims. |
| `docs/documentation-convention.md` | Modified | Updated module-inference wording for explicit or discovered roots. |
| `openspec/changes/auto-discover-markdown-roots/tasks.md` | Modified | Marked all tasks complete. |
| `openspec/changes/auto-discover-markdown-roots/apply-progress.md` | Created | Persisted this progress/evidence artifact. |

## Deviations from Design

The final implementation remains within the approved change scope, but the earlier blanket "None" was too strong. The design did not explicitly name the post-construction discovered-root replacement case; final remediation pins each discovered root's trusted realpath during composition and validates it on every discovery-mode traversal. `GenerateIndexMd` and `SyncIndex` still did not require direct changes; composition-level target/selfPath/source wiring and filesystem adapter behavior satisfy the relevant requirements.

## Issues Found

- Existing CLI subprocess test encoded the old hidden `docs/INDEX.md` default; it was updated after the first full-suite run failed.
- Windows symlink permissions required adapter symlink behavior to be tested with the existing fs mock seam rather than creating real file symlinks.

## Post-Apply 4R Remediation Addendum

### Summary

Remediated the confirmed 4R blockers without changing task completion state. The implementation now fails closed across the full discovery probe and discovery-mode sync pass, rejects malformed top-level config JSON shapes, verifies MCP behavior through a real client transport, and strengthens discovery-mode symlink checks with `lstat`/`realpath` at scan/traversal boundaries.

### Additional RED Evidence

| Command | Result |
|---|---|
| `npx vitest run test/infrastructure/config.test.ts test/infrastructure/discover-markdown-roots.test.ts test/infrastructure/file-document-source.test.ts test/composition.test.ts test/server.test.ts test/cli-subprocess.test.ts` | RED: failed as expected — 8 failing assertions covered malformed top-level config JSON, early-markdown/later-EACCES discovery probing, lstat-boundary symlink refusal, discovery selected-root ENOENT preservation, and discovery multi-root fail-closed preservation. |

### Additional GREEN / Verification Evidence

| Command | Result |
|---|---|
| `npx vitest run test/infrastructure/config.test.ts test/infrastructure/discover-markdown-roots.test.ts test/infrastructure/file-document-source.test.ts test/composition.test.ts test/server.test.ts test/cli-subprocess.test.ts` | GREEN: passed — 6 files, 167 tests. |
| `npm run build` | Passed — `tsc`. |
| `node -e "import('./dist/infrastructure/fs/discover-markdown-roots.js').then(({discoverMarkdownRoots})=>{ const {performance}=require('node:perf_hooks'); const root=process.cwd(); const t0=performance.now(); const roots=discoverMarkdownRoots(root); const ms=performance.now()-t0; console.log(JSON.stringify({roots, durationMs:Number(ms.toFixed(3))}, null, 2)); })"` | Measurement only, no SLO gate: repository discovery helper returned `[".atl",".claude","docs","ejemplos","harness","openspec","test"]` in `185.715 ms`, with no embeddings involved. |
| `npm run typecheck` | Passed — `tsc --noEmit && tsc -p tsconfig.test.json`. |
| `$env:CI='true'; npm test` | Passed — 51 files, 901 tests. |

### Additional Files Changed

| File | Action | What Was Done |
|---|---|---|
| `src/infrastructure/config.ts` | Modified | Rejected non-object top-level JSON shapes before merge; clarified `loadConfig` as config-only compatibility and `loadConfigReport` as root-selection carrier. |
| `src/infrastructure/fs/discover-markdown-roots.ts` | Modified | Kept found-Markdown state while continuing the full candidate-tree scan; added `lstat`/`realpath` containment checks; made the ignored-directory set private/immutable from consumers. |
| `src/infrastructure/fs/file-document-source.ts` | Modified | Discovery mode now treats root ENOENT as a hard failure, uses `lstat`/`realpath` before recurse/read, and still leaves explicit mode unchanged. |
| `src/infrastructure/fs/composite-document-source.ts` | Modified | Added discovery-mode fail-on-any-root-error behavior while preserving explicit multi-root partial-failure tolerance. |
| `src/composition.ts` | Modified | Passed discovery fail-closed mode into the composite source. |
| `test/infrastructure/config.test.ts` | Modified | Added malformed top-level JSON shape coverage for string, number, array, and null. |
| `test/infrastructure/discover-markdown-roots.test.ts` | Modified | Added early Markdown plus later failing subtree regression independent of scan order. |
| `test/infrastructure/file-document-source.test.ts` | Modified | Added fs-mock lstat/read-boundary symlinked Markdown-file coverage. |
| `test/composition.test.ts` | Modified | Added discovery selected-root ENOENT preservation and multi-root fail-closed no-mutation regressions. |
| `test/server.test.ts` | Modified | Added public in-memory MCP client/transport coverage: list exactly three tools, call `search_docs`, pass its exact discovery-shaped returned path to `read_doc`. |
| `test/cli-subprocess.test.ts` | Modified | Added subprocess coverage proving `index-md --dir notes` creates `notes/INDEX.md` and not project-root `INDEX.md`. |
| `README.md` and `AGENTS.md` | Modified | Documented discovery fail-closed behavior and residual symlink TOCTOU limitation. |
| `scripts/vector-reach.mjs` | Modified | Removed stale `config.docsDir` comment assumptions and described root-selection-based resolution. |

### Deviations / Corrections

- The earlier “No deviations” statement was too strong. `loadConfig` intentionally remains a config-only compatibility wrapper; `loadConfigReport` carries `rootSelection`. That implementation split is now recorded here as the source of truth for apply progress.
- `GenerateIndexMd` and `SyncIndex` still did not require direct changes; the remediation changed their input source behavior through composition and filesystem adapters.

### Residual Risks

- Symlink safety is strengthened with `lstat`/`realpath` at discovery scan and traversal boundaries, but it is not a kernel-level sandbox. A filesystem race between check and read/recurse remains a residual TOCTOU risk and is documented honestly.
- Accepted tradeoff preserved: no stale-index/read-only fallback was added for startup discovery failures; discovery fails closed before store construction.

## Status

17/17 tasks remain complete. Root-replacement remediation has been implemented and verified.

## Final Root-Replacement Boundary Remediation Addendum

### Summary

Remediated the final 4R blocker: a root selected in discovery mode can no longer be replaced by a symlink/junction or other directory after container construction and then treated as the new trusted root. Composition now pins each discovered root's trusted realpath and passes it into discovery-mode `FileDocumentSource`; each traversal revalidates the root before reading or recursing. Explicit mode remains unchanged.

### RED Evidence

| Command | Result |
|---|---|
| `npx vitest run test/infrastructure/file-document-source.test.ts test/composition.test.ts -t "root replacement|replaced by a link"` after temporarily removing discovery-mode root validation | RED: failed as expected — 2 focused regressions failed. `FileDocumentSource` returned `docs/external.md` instead of rejecting, and composition sync resolved with `deleted: ["docs/keep.md"]` plus `indexed: [{ path: "docs/external.md" }]` instead of failing closed. The source file was restored immediately after the RED probe. |

### GREEN / Verification Evidence

| Command | Result |
|---|---|
| `npx vitest run test/infrastructure/path-containment.test.ts test/infrastructure/discover-markdown-roots.test.ts test/infrastructure/file-document-source.test.ts test/composition.test.ts` | GREEN: passed — 4 files, 48 tests, 1 skipped platform-specific case. |
| `npm run typecheck` | Passed — `tsc --noEmit && tsc -p tsconfig.test.json`. |
| `npx vitest run test/infrastructure/path-containment.test.ts test/infrastructure/discover-markdown-roots.test.ts test/infrastructure/file-document-source.test.ts test/composition.test.ts test/server.test.ts test/cli-subprocess.test.ts` | Passed — 6 files, 91 tests, 1 skipped platform-specific case. |
| `npm run build` | Passed — `tsc`. |
| `npm run typecheck` | Passed — `tsc --noEmit && tsc -p tsconfig.test.json`. |
| `$env:CI='true'; npm test` | Passed — 52 files, 905 tests, 1 skipped platform-specific case. |
| `npx vitest run test/composition.test.ts -t "indexes the exact dynamic openspec markdown path set"` | Final dynamic composition gate passed after updating `apply-progress.md` — 1 file, 1 test, 19 skipped. |

### Additional Files Changed

| File | Action | What Was Done |
|---|---|---|
| `src/infrastructure/fs/path-containment.ts` | Created | Extracted one shared realpath comparison/containment helper with platform-appropriate case handling. |
| `src/infrastructure/fs/discover-markdown-roots.ts` | Modified | Discovery now exposes trusted realpaths for composition while keeping the existing `discoverMarkdownRoots()` string API for script callers. |
| `src/infrastructure/fs/file-document-source.ts` | Modified | Discovery mode validates the root with `lstat`/`realpath`, rejects root symlink/junction replacement, and fails if the current realpath differs from the pinned trusted realpath. |
| `src/composition.ts` | Modified | Pins discovered root realpaths before store construction and passes them to discovery-mode file sources. |
| `src/infrastructure/fs/composite-document-source.ts` | Modified | Comments/API docs now state that explicit mode tolerates partial root failure while discovery mode rejects any root failure. |
| `test/infrastructure/path-containment.test.ts` | Created | Covers shared containment helper behavior and platform-specific realpath equality. |
| `test/infrastructure/file-document-source.test.ts` | Modified | Adds a mocked root-replacement regression proving external markdown is not read. |
| `test/composition.test.ts` | Modified | Adds an end-to-end no-mutation regression for a discovered root replaced by a link to external markdown after container creation. |

### Current Diff Measurement

- Tracked + untracked after this progress-file update: 26 files, +1356/-87 lines.
- Measurement command counted `git diff --numstat` plus untracked files from `git ls-files --others --exclude-standard`; the OpenSpec artifacts are included.

### Residual Risks

- Generic filesystem TOCTOU remains: user-space `lstat`/`realpath` checks cannot provide kernel-level sandboxing between validation and later reads. The implementation narrows the known replacement window by revalidating every discovery traversal and skipping link entries, but it is not a hard filesystem jail.
- Explicit mode intentionally retains previous behavior and does not receive discovery-mode trusted-root enforcement.


## Final Discovery Sync Remediation Addendum

### Summary

Remediated the final discovery/sync blockers from the fresh 4R review. Discovery mode now re-runs top-level root discovery on every pass, so a long-running `serve` can see newly added Markdown-bearing top-level folders. Previously indexed discovered root aliases are revalidated even across fresh container/process startup: if an alias disappeared, became a symlink/junction, became unreadable, or resolves outside the project, discovery aborts before index/sync mutation and preserves existing rows. If the alias still exists as a readable directory, it remains selected even with zero Markdown so legitimate deletions inside that root still reconcile normally. Discovery-mode nested traversal/read failures now reject the pass instead of becoming partial `readErrors`; explicit mode keeps its existing partial-root and per-file/subtree tolerance.

### RED Evidence

| Command | Result |
|---|---|
| `npx vitest run test/composition.test.ts -t "discovers a new top-level markdown root|freshly reconstructed|nested markdown read failure"` | RED: failed as expected before implementation. Dynamic-root test returned no `notes/b.md`; fresh reconstructed-container test resolved and deleted `docs/keep.md` instead of rejecting; nested-read test initially exposed the new mocked regression setup before the production fix. |

### GREEN / Final Verification Evidence

| Command | Result |
|---|---|
| `npx vitest run test/composition.test.ts -t "discovers a new top-level markdown root|freshly reconstructed|nested markdown read failure"` | GREEN: passed — 1 file, 3 tests, 20 skipped. |
| `npx vitest run test/composition.test.ts test/infrastructure/file-document-source.test.ts test/infrastructure/discover-markdown-roots.test.ts test/infrastructure/path-containment.test.ts` | Passed — 4 files, 51 tests, 1 skipped. |
| `npm run build` | Passed — `tsc`. |
| `npm run typecheck` | Passed — `tsc --noEmit && tsc -p tsconfig.test.json`. |
| `$env:CI='true'; npm test` | Passed — 52 files, 908 tests, 1 skipped. |
| `npx vitest run test/composition.test.ts -t "indexes the exact dynamic openspec markdown path set"` | Exact dynamic recursive OpenSpec composition gate passed — 1 file, 1 test, 22 skipped. |

### Additional Files Changed

| File | Action | What Was Done |
|---|---|---|
| `src/infrastructure/fs/dynamic-discovery-document-source.ts` | Created | Added a port-shaped dynamic discovery source that builds the per-pass discovered root set from current Markdown-bearing top-level folders plus previously indexed aliases that still validate as readable in-project directories. |
| `src/infrastructure/fs/discover-markdown-roots.ts` | Modified | Added `validateDiscoveredRootAlias()` so fresh containers can fail closed for previously indexed discovered roots without depending on concrete SQLite details. |
| `src/infrastructure/fs/file-document-source.ts` | Modified | Discovery mode now rejects nested traversal and Markdown read I/O failures; explicit mode still collects them into `readErrors`. Trusted realpath pin/revalidation remains in place. |
| `src/composition.ts` | Modified | Discovery mode now wires `DynamicDiscoveryDocumentSource` and a mutable root-prefix list for loose module inference; explicit mode stays on static `CompositeDocumentSource`. |
| `test/composition.test.ts` | Modified | Added regressions for post-container root appearance, fresh-container disappeared discovered roots, and nested discovery-mode read failure causing zero mutation. |
| `README.md`, `AGENTS.md`, `openspec/changes/auto-discover-markdown-roots/design.md` | Modified | Corrected documentation to describe dynamic per-pass rediscovery, discovery-mode fail-closed traversal/read behavior, previous-alias preservation, and explicit-mode tolerance. |

### Current Diff Measurement

- Tracked + untracked after the final remediation pass: 27 files, +1594/-95 lines after this progress-file addendum.
- Measurement command counted `git diff --numstat` plus untracked files from `git ls-files --others --exclude-standard`; OpenSpec artifacts and new source/test files are included.

### Residual Risks

- Generic filesystem TOCTOU remains: user-space `lstat`/`realpath` checks cannot provide kernel-level sandboxing between validation and later reads. The implementation revalidates selected roots per pass and rejects link entries, but it is not a hard filesystem jail.
- Explicit mode intentionally retains previous tolerance semantics; it does not receive discovery-mode fail-closed traversal/read behavior.

## Status

17/17 tasks remain complete. Final discovery sync remediation implemented and verified.
