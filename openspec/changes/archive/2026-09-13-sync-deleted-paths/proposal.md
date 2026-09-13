# Proposal: Deleting a Discovered Root Purges Its Documents Instead of Locking the Index

## Intent

With no `compendio.config.json`, deleting a whole top-level documentation folder (e.g. `guides/`) locks the index:

- `compendio sync` and `compendio index` both exit 1 with `previously discovered documentation root "guides" could not be inspected: ENOENT ...`.
- The deleted documents stay returned by `search_docs` and `docs_overview`.
- No CLI command recovers. `index` is locked as well because discovery reads root aliases from the existing index.
- `serve` swallows the error on every tool call (`incremental sync failed: ...`) and serves the stale index until the folder comes back.

Deleting a single file or a subfolder already works, and so does deleting a root in explicit mode. Only discovery mode with a whole root removed is broken. Deleting a folder is a normal action and must not need a workaround.

Root cause: `validateDiscoveredRootAlias` (`src/infrastructure/fs/discover-markdown-roots.ts`) rethrows every `lstatSync` error, `ENOENT` included, and `DynamicDiscoveryDocumentSource.discover()` does not catch it.

**This reverses a documented decision.** The `auto-discover-markdown-roots` cycle (2026-08-30) made a disappeared root fail closed on purpose. `docs/design-decisions.md` ("if it disappeared or became a symlink/junction, the pass fails closed") and three tests in `test/composition.test.ts` pin that behaviour. The change amends the spec. It is not a silent bugfix.

## Scope

### In Scope
- When `lstat` of a previously discovered root alias fails with `error.code === "ENOENT"`, the root counts as deleted. The alias is not re-added, and the existing path-presence diff purges its documents.
- `compendio index` succeeds in the same situation.
- Every other failure still aborts before any store mutation (fail-closed): `EACCES`, `EIO`, `EPERM`, `ENOTDIR`, an error with no code, the root now being a symlink or junction, the root no longer being a directory, a `realpath` failure after a successful `lstat`, or the root resolving outside the project.
- Reporting is the existing count only (`N deleted`).
- Deleting every discovered root empties the index silently. This matches explicit mode and the existing "Empty reindex clears stale rows" scenario.
- Updates: the spec delta, the fail-closed section of `docs/design-decisions.md` (the "disappeared" clause is rewritten, not only extended), and one clause in the existing `AGENTS.md` bullet. The doc comment in `composite-document-source.ts` changes only if its wording covers deletion.

### Out of Scope
- A CLI purge flag or a `sync --purge-root`.
- Any change to explicit-mode behaviour, including its `reason.includes("ENOENT")` string match.
- Any change to single-file or subfolder deletion.
- New `SyncReport` fields, a new warning, or any change to the MCP contract. The surface stays 3 tools.
- Showing sync failures in `serve`.
- Failures during the fresh top-level scan (`discoverMarkdownRootDetails`).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `indexing`:
  - **Narrow** the scenario "Unreadable existing root aborts sync without mutation" so it covers only non-`ENOENT` failures. It currently sits under "Nested Roots Are Not Created Independently". The spec phase should decide whether to move it, and must carry the whole requirement block in a MODIFIED delta.
  - **Add** the scenario "A discovered root deleted from disk is purged on the next sync or index", covering both `sync` and `index`.

## Approach

This is exploration Approach 1. `validateDiscoveredRootAlias` tells a clean `ENOENT` on `lstat` apart from every other outcome, for example with a distinct result or a typed signal instead of a throw. `DynamicDiscoveryDocumentSource.discover()` drops that alias from the selected roots. After that, `SyncIndex.deleteMissingDocuments` and `IndexDocuments` purge without changes. Every other error keeps its current throw. The design phase chooses the exact signalling shape.

`src/application/*` is expected to stay untouched.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/infrastructure/fs/discover-markdown-roots.ts` | Modified | Treat `ENOENT` separately in `validateDiscoveredRootAlias` |
| `src/infrastructure/fs/dynamic-discovery-document-source.ts` | Modified | Skip deleted aliases |
| `src/infrastructure/fs/composite-document-source.ts` | Possibly | Doc comment wording only |
| `test/infrastructure/discover-markdown-roots.test.ts` | Extended | First direct tests of `validateDiscoveredRootAlias` |
| `test/composition.test.ts` | Modified | Invert two tests and switch one to a non-`ENOENT` failure (see below) |
| `docs/design-decisions.md`, `AGENTS.md` | Modified | Rewrite the section; one clause added to the existing bullet |
| `openspec/specs/indexing/spec.md` | Delta | Via `sdd-spec` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A transient `ENOENT` (a network share or a sync client briefly hiding a folder) purges a root that is still valid | Low | See the argument below |
| The existing tests stay green because they still use `rm` as the trigger, so the fail-closed guarantee loses coverage without anyone noticing | Med | Test plan item 4 |
| Windows "delete pending" directories return `EPERM` instead of `ENOENT` | Low | Stays fail-closed; the next pass purges once handles close |
| Renaming a root re-embeds all its documents under the new alias | Low | Accepted; this is how any rename already works |
| `serve` does not recover by itself | Low | Integration test through `SyncScheduler` |

**Why `ENOENT` is authoritative here.** The alias is a direct child of the project root, and the same pass has just read that project root successfully. Discovery never selects a symlinked root, so the child cannot be a mount point that comes and goes. An `ENOENT` from `lstat` therefore means the entry is gone from the directory, not that it is unreachable.

**Residual risk.** A tool that removes and recreates the folder non-atomically (a sync client, `git checkout` between branches) can cause a purge followed by a full re-index. The documents come back on the next pass. The cost is embedding time, not lost data, because the source files are the source of truth.

## Test Plan (strict TDD: every test is written and seen failing before code)

1. Unit tests for `validateDiscoveredRootAlias` on a real temporary directory:
   - `ENOENT` gives the "deleted" outcome.
   - A present directory is validated.
   - A file or `ENOTDIR`, a junction, a mocked `EACCES`, and an error with no code all still throw.
2. Integration test in discovery mode on a real filesystem, using `rm(root, { recursive: true })`:
   - `sync` returns `deleted` for that root and leaves the healthy roots unchanged.
   - `index` rebuilds without the root.
   - A reconstructed container behaves the same way.
   - Deleting every root leaves an empty index.
3. `serve` recovery: after the root is deleted, the next throttled pass through `SyncScheduler` purges it.
4. Fail-closed still holds:
   - Invert the tests at `composition.test.ts` "aborting sync when a discovered root disappears with ENOENT" and "...freshly reconstructed container".
   - Switch "fails closed on any unreadable discovered root before mutating healthy roots" to a non-`ENOENT` failure (a file replacing the folder, or a mocked `EACCES`), so it still proves no mutation happens.
5. Before finishing: `npm test`, `npm run typecheck`, `npm run build`, and the discovery-mode reproduction from the exploration run with `node dist/cli.js`.

## Rollback Plan

Revert the change commits and rebuild. Nothing persisted changes: no schema, config key or report field is added. An index purged under the new behaviour rebuilds with `compendio index` once the folder is restored.

## Dependencies

- None.

## Size Estimate

About 200–320 changed lines in `src/`, `test/` and `docs/`: roughly 20 in `src/`, 170–270 in tests and 15 in docs, plus the openspec artifacts. This is a lower bound, because forecasts in this project have grown at every phase.

## Success Criteria

- [ ] The exploration's scenarios C and D exit 0; the deleted root's documents are gone from `search_docs` and `docs_overview`.
- [ ] A non-`ENOENT` failure on a previously discovered root still aborts with zero store mutation.
- [ ] `SyncReport` and the MCP contract are byte-identical in shape; the surface stays 3 tools.
- [ ] `ejemplos/` eval is unchanged; `npm test`, `typecheck` and `build` pass.

## Proposal question round

Resolved 2026-09-13: the user approved the proposal and accepted all four assumptions below. Guiding principle stated by the user: Compendio must always reflect the current state of the project; a deleted folder must not stay indexed.

1. Reversing the 2026-08-30 fail-closed-on-disappearance decision is intended. The documented rationale (a transient unmount) is answered by the `ENOENT` argument above, not dropped.
2. Renaming a root (delete plus a new alias) purges and re-indexes silently, with no hint that it was a rename.
3. Windows `EPERM` on a delete-pending folder may block one pass. Waiting for the next pass is acceptable.
4. A root that is removed and recreated non-atomically by tooling (branch switch, sync client) may be re-embedded once. That cost is acceptable.
