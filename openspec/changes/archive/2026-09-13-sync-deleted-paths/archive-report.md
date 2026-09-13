# Archive Report: sync-deleted-paths

**Archived**: 2026-09-13
**Verdict carried from verify**: PASS (36/36 tasks complete, 1062 tests passed / 0 failed / 1 pre-existing skip, typecheck clean, build clean, 3/3 targeted mutations caught, ejemplos eval baseline reproduced exactly, no CRITICAL/WARNING issues)

## Summary

Discovery-mode sync/index used to lock the whole index when a whole top-level documentation root was deleted from disk: `lstat` on the vanished alias rethrew `ENOENT` exactly like any other failure, so `compendio sync`/`compendio index` exited 1 and `serve` served a stale index forever. This change teaches `validateDiscoveredRootAlias` (`src/infrastructure/fs/discover-markdown-roots.ts`) to tell a clean `ENOENT` apart from every other `lstat` failure: `ENOENT` now returns `undefined` ("deleted") instead of throwing, and `DynamicDiscoveryDocumentSource.discover()` skips that alias instead of propagating an error. The existing path-presence diff then purges the deleted root's documents on the very next pass, with no new `SyncReport` field and no MCP contract change. Every other failure (`EACCES`, `EIO`, `EPERM`, `ENOTDIR`, a codeless error, symlink/junction, non-directory, or a `realpath` mismatch) still aborts before mutation, unchanged.

This reverses part of the `auto-discover-markdown-roots` (2026-08-30) decision that made any disappeared root fail closed; the reversal was explicit, proposed, and user-approved (see proposal.md "Proposal question round").

## Files Changed

- `src/infrastructure/fs/discover-markdown-roots.ts` — `validateDiscoveredRootAlias` returns `DiscoveredMarkdownRoot | undefined`; `ENOENT` on `lstat` (checked via `error.code`, not message matching) returns `undefined`; every other error still rethrows.
- `src/infrastructure/fs/dynamic-discovery-document-source.ts` — `discover()` skips an alias when `validateDiscoveredRootAlias` returns `undefined` instead of propagating an error.
- `test/infrastructure/discover-markdown-roots.test.ts` — new direct unit tests for `validateDiscoveredRootAlias` (present dir, file, junction, `EACCES`, `EPERM`, codeless-but-ENOENT-message error, `realpath` failure, deleted, deleted-then-recreated race).
- `test/composition.test.ts` — two tests inverted (deleted root now purges instead of aborting), one retargeted to a non-`ENOENT` trigger to keep fail-closed coverage, three new tests (full-reindex purge, empty-index-after-full-delete, `serve`/`SyncScheduler` recovery).
- `docs/design-decisions.md` — rewrote the closing clause of "Unreadable roots fail closed in discovery mode" to state the `ENOENT`-is-deleted reversal and why it's authoritative.
- `AGENTS.md` — one clause added in place to the existing "unreadable roots fail closed" bullet (net zero lines added), anchor preserved.
- `openspec/changes/sync-deleted-paths/specs/indexing/spec.md` — delta spec (merged into main spec by this archive).
- `openspec/specs/indexing/spec.md` — merged: MODIFIED "Nested Roots Are Not Created Independently" (dropped the "Unreadable existing root aborts sync without mutation" scenario, which moved to the new requirement), ADDED "Discovery Mode Distinguishes a Deleted Root From an Unreadable One" with all 5 scenarios, placed immediately after the modified requirement.

`src/infrastructure/fs/composite-document-source.ts` was reviewed (task 7.3) but left unedited — its doc comment already described `failOnRootError` generically and needed no change. `src/domain/ports.ts` and `src/server.ts` are confirmed byte-identical (no `SyncReport`/MCP contract change); the MCP surface stays exactly 3 tools.

## Deferred Follow-ups (explicitly out of scope, recorded in tasks.md)

- Align explicit mode's `reason.includes("ENOENT")` string match (`FileDocumentSource.walk`) to `error.code`, matching the discovery-mode fix's approach. Different mode, needs its own tests.
- Windows case-only root rename selecting both aliases — not addressed by this change.

## Archive Contents

- proposal.md
- exploration.md
- design.md
- tasks.md
- apply-progress.md
- verify-report.md
- specs/indexing/spec.md (delta)
- archive-report.md (this file)
