# Tasks: Auto-discover Markdown Roots

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 500-900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: config + discovery + traversal; PR 2: composition + index-md + MCP/docs |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Root selection + discovery plumbing | PR 1 | config, discovery helper, source traversal tests |
| 2 | Wiring + surface regressions | PR 2 | composition, index-md placement, MCP round-trip, docs |

Approved single-PR exception; keep work-unit commits reviewable inside one PR.

## Phase 1: Config and discovery

- [x] 1.1 RED: Add config tests in `test/infrastructure/config.test.ts` for absent config, `[]`, omitted `docsDir`, malformed/read errors, and explicit arrays.
- [x] 1.2 GREEN: Implement `DocumentationRootSelection` and ENOENT-only loading in `src/infrastructure/config.ts`.
- [x] 1.3 REFACTOR: Keep `docsDir` fail-fast, no hidden default, and preserve explicit validation helpers.
- [x] 1.4 RED: Add discovery tests for deterministic order, case-insensitive `.md`, recursive technical ignores, symlink refusal, and abort-vs-empty behavior.
- [x] 1.5 GREEN: Create `src/infrastructure/fs/discover-markdown-roots.ts` with the discovery helper.
- [x] 1.6 REFACTOR: Make discovery ordering/path filtering deterministic and isolated to infrastructure.

## Phase 2: Source traversal and wiring

- [x] 2.1 RED: Add traversal tests proving discovery-only `FileDocumentSource` options skip technical/symlink content while explicit mode remains unchanged.
- [x] 2.2 GREEN: Extend `FileDocumentSource` with discovery-only traversal options in `src/infrastructure/fs/file-document-source.ts`.
- [x] 2.3 REFACTOR: Keep explicit excludes and recursion semantics unchanged outside discovery mode.
- [x] 2.4 RED: Add composition/index-md/MCP tests for zero roots, lazy DB, discovered path round-trips, explicit `--dir`, both `INDEX.md` placement modes, three-tool surface, unreadable discovered-root sync abort, and the dynamic exact `openspec/**/*.md` path-set gate.
- [x] 2.5 GREEN: Update `src/composition.ts` so root selection happens before store construction and preserves aliases, excludes, module inference, and sync preservation.
- [x] 2.6 REFACTOR: Keep discovery-mode `INDEX.md` at project root and explicit mode at the first/override root; migrate `scripts/vector-reach.mjs` and every real `config.docsDir` consumer, but do not predeclare `src/application/generate-index-md.ts` or `src/application/sync-index.ts` changes unless a RED test proves they are required.

## Phase 3: Verification

- [x] 3.1 REFACTOR: Verify path round-trips, self-exclusion in both modes, zero-config `INDEX.md`, and three-tool surface regression.
- [x] 3.2 REFACTOR: Run the dynamic exact `openspec/**/*.md` path-set gate and the unreadable-root sync-abort regression after wiring.
- [x] 3.3 REFACTOR: Keep all new behavior tests beside their units and ensure explicit-mode invariance still passes.

## Phase 4: Cleanup / Docs

- [x] 4.1 Update user-facing docs/config examples and any stale `AGENTS.md` claims affected by discovery mode.
- [x] 4.2 Run `npm run build`, `npm run typecheck`, and `npm test`; fix regressions and leave the single PR ready pending size:exception.
