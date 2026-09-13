# Design: Deleting a Discovered Root Purges Its Documents

## Technical Approach

Exploration Approach 1, confined to `src/infrastructure/fs/`. `validateDiscoveredRootAlias` returns `undefined` when `lstatSync` fails with `code === "ENOENT"`. `DynamicDiscoveryDocumentSource.discover()` then leaves that alias out of the selected roots. The deleted root produces no files and no `ReadError`, so the existing path-presence diff purges its documents (`SyncIndex.deleteMissingDocuments`, and `IndexDocuments` because it rebuilds from `discover()`). `src/application/*`, `src/domain/*`, `SyncReport` and the MCP surface stay unchanged.

## Architecture Decisions

| # | Option | Tradeoff | Decision |
|---|---|---|---|
| 1 | Return `undefined` on ENOENT | One caller and one line. Matches the existing `trustedRootRealPath === undefined` idiom. | **Chosen** |
| 1 | Discriminated union `{ kind: "deleted" } \| { kind: "present", root }` | More explicit, but the extra ceremony only serves a single call site | Rejected |
| 1 | Throw a typed `DiscoveredRootDeletedError` and catch it in `discover()` | Uses exceptions for control flow and splits the ENOENT knowledge across two modules | Rejected |
| 2 | ENOENT test: `(error as NodeJS.ErrnoException).code === "ENOENT"` | Cannot be fooled by a path or message that happens to contain "ENOENT" | **Chosen** (message matching is forbidden) |
| 3 | Race: the root vanishes after it was selected (`FileDocumentSource.validateDiscoveryRoot` lstat, the realpath step inside `validateDiscoveredRootAlias`, or the root `readdir`) | That pass aborts and fails closed. The next pass no longer sees the alias in the fresh scan, gets `undefined` from validation, and purges it. The result is correct one pass later, with no change to `FileDocumentSource`. | **Chosen: stays fail-closed** |
| 3 | Also carve ENOENT out of `FileDocumentSource` discovery mode | Widens the change into a second module and its tests to save one pass in a window of milliseconds | Rejected |
| 3 | ENOENT inside the fresh scan (`discoverMarkdownRootDetails` / `containsMarkdown` readdir-then-lstat race) | Aborts one pass, then self-heals. The proposal puts it out of scope. | Unchanged |
| 4 | Explicit mode's `reason.includes("ENOENT")` (`FileDocumentSource.walk`) | Aligning it to `error.code` looks trivial, but it touches a different mode that has its own tests. The only false positive is theoretical: a root path that contains "ENOENT" and fails with a different error. | **Out of scope**; noted as a follow-up |
| 5 | Error messages for non-ENOENT cases | Existing tests and users rely on them | **Byte-identical** |

**Windows.** A directory in delete-pending state reports `EPERM` from `lstat`. It stays fail-closed for one pass, and the next pass purges it once its handles close. The change adds no realpath call. The `canonicalRealPath = realpathSync.native` header comment and constant stay untouched. That `.native` choice is deliberate and is the opposite of `cli.ts`'s DO NOT CHANGE rule, so the two must not be "harmonised".

**All roots deleted.** `selectedRoots` is empty, so `roots = []`. `CompositeDocumentSource` returns an empty result without throwing, and the index ends up empty with no error.

## Data Flow

    discover()
      discoverMarkdownRootDetails(projectRoot)   fresh scan (any throw -> abort)
      for alias in store aliases, not in fresh set:
        validateDiscoveredRootAlias
          lstat ENOENT        -> undefined -> alias skipped
          any other failure   -> throw     -> abort, no mutation
          ok                  -> selected
      CompositeDocumentSource(selected, failOnRootError)
    SyncIndex / IndexDocuments
      skipped alias: no files, no ReadError -> path diff purges its documents

After the purge the alias is no longer in the store, so later passes never revalidate it. That is the steady state.

## File Changes

| File | Action | Description | ~Lines |
|---|---|---|---|
| `src/infrastructure/fs/discover-markdown-roots.ts` | Modify | Return type `DiscoveredMarkdownRoot \| undefined`; ENOENT check in the `lstatSync` catch; JSDoc | 8 |
| `src/infrastructure/fs/dynamic-discovery-document-source.ts` | Modify | Skip `undefined`; one comment at the call site stating that deletion is purged by the path diff | 5 |
| `src/infrastructure/fs/composite-document-source.ts` | None | The `failOnRootError` comment is still accurate: a deleted root is never selected, and the race case is still "a later root failure" | 0 |
| `test/infrastructure/discover-markdown-roots.test.ts` | Extend | New `describe("validateDiscoveredRootAlias")` | 90-120 |
| `test/composition.test.ts` | Modify | Invert 2 tests, retarget 1, add 3 | 110-160 |
| `docs/design-decisions.md` | Modify | Rewrite the last sentence of "Unreadable roots fail closed in discovery mode" (title and anchor kept): ENOENT on `lstat` means deleted and purged on `sync`/`index`; every other outcome (EACCES, EPERM incl. delete-pending, EIO, symlink/junction, non-directory, realpath failure or escape) fails closed; a mid-pass race aborts one pass; add the "why ENOENT is authoritative" argument and the 2026-09-13 reversal | ~4 |
| `AGENTS.md` | Modify | Same bullet, still one line: "...discovery mode fails closed before any store mutation, except a root whose `lstat` reports `ENOENT`, which is purged." The anchor is unchanged, so the link keeps working | 1 |

Total is about 220-300 changed lines. This is a lower bound.

## Interfaces / Contracts

```ts
/** `undefined` = the alias was deleted (`lstat` failed with code ENOENT).
 * Every other failure throws; nothing else is treated as deletion. */
export function validateDiscoveredRootAlias(projectRoot: string, alias: string): DiscoveredMarkdownRoot | undefined;
```

## Testing Strategy (strict TDD)

| Layer | Test | RED before change? |
|---|---|---|
| Unit (real tmp) | Missing alias returns `undefined` | Yes |
| Unit (real tmp) | Present dir returns `trustedRealPath === await realpath(...)`; a file throws `/is not a directory/`; a junction throws `/symlink or junction/` | No (characterization) |
| Unit (`vi.doMock("node:fs")`, existing pattern) | `lstatSync` throws with code EACCES, EPERM, or no code but "ENOENT" in the message: all still throw `/could not be inspected/`. `lstat` succeeds but `realpathSync.native` throws ENOENT: throws `/could not be resolved/` | No. Validate each by temporarily applying a string-match or catch-all mutation and watching it fail |
| Unit (real tmp) | Alias deleted then recreated empty is validated, not skipped | No |
| Integration | L347 rewritten: two roots, `rm openspec`, `sync` resolves, `deleted == ["openspec/keep.md"]`, `docs` untouched | Yes |
| Integration | L384 rewritten (reconstructed container): `sync` resolves, store empty (this also covers all roots deleted on `sync`) | Yes |
| Integration | L451 retargeted: `rm` then `writeFile` at `openspec` (file replaces folder), expect `/openspec.*not a directory/s`, healthy `docs` not mutated. No chmod: unreliable on Windows and ignored as root on CI | Stays green; confirm it fails if the ENOENT check is widened to a catch-all |
| Integration | New: `index` after deleting one of two roots rebuilds without it | Yes |
| Integration | New: every root deleted, then `index` resolves with an empty index and `getOverview().totalDocuments === 0` | Yes |
| Integration | New: serve path. Index, `rm`, `container.syncScheduler.maybeSync()` (the first call always runs), then store purged, `lastReport.deleted` has the path, and no `incremental sync failed` on `console.error` | Yes |

L331 (file replaces folder, single root) and L478 (junction) stay unchanged. The rewritten tests are new tests, not flipped assertions: their titles, comments and fixtures change together.

## Migration / Rollout

No migration required. Nothing persisted changes.

## Open Questions

- None blocking.
