# Delta for Indexing

## MODIFIED Requirements

### Requirement: Nested Roots Are Not Created Independently

The system MUST NOT create a separate discovered root beneath an owning discovered root.
(Previously: also included the "Unreadable existing root aborts sync without mutation" scenario; moved to "Discovery Mode Distinguishes a Deleted Root From an Unreadable One" because that scenario is about root disappearance/unreadability, not nesting, and now sits alongside its ENOENT counterpart.)

#### Scenario: Nested folders stay under the parent root

- GIVEN a Markdown-bearing top-level root containing a nested Markdown-bearing subfolder
- WHEN discovery runs
- THEN the nested folder's files are indexed under the parent root's alias

#### Scenario: A nested symlink does not create a discovered root

- GIVEN a nested directory is a symbolic link
- WHEN discovery runs
- THEN it is not treated as an independently discovered root

## ADDED Requirements

### Requirement: Discovery Mode Distinguishes a Deleted Root From an Unreadable One

When `lstat` of a previously discovered root alias fails during discovery, the system MUST tell a clean `ENOENT` apart from every other failure. A clean `ENOENT` MUST be treated as the root having been deleted: the alias MUST NOT be re-added to the selected roots, and the existing path-presence diff MUST purge that root's previously indexed documents — including their chunks, FTS, and vector rows — on the same pass, with no error, no CLI failure, and no new `SyncReport` field; reporting stays the existing deleted-count only. Every other failure (`EACCES`, `EIO`, `EPERM`, `ENOTDIR`, an error with no `code`, the root now being a symlink/junction, the root no longer being a directory, or a `realpath` mismatch after a successful `lstat`) MUST still abort the pass before any store mutation, with existing indexed documents preserved. `compendio index` and `compendio sync` MUST apply this distinction identically. `compendio serve`'s throttled pass requires no special handling: once discovery stops throwing for the deleted alias, the next throttled pass purges it like any other incremental change. Deleting every discovered root MUST leave an empty index with no error, matching explicit-mode behavior for a fully removed corpus.

#### Scenario: A discovered root deleted from disk is purged on the next sync

- GIVEN a discovery-mode index with documents indexed under root alias `guides`, and the `guides` directory is deleted from disk before the next sync
- WHEN `compendio sync` runs
- THEN it exits 0, every document previously indexed under `guides/` is deleted, and the deleted count reflects them

#### Scenario: A discovered root deleted from disk is purged by a full reindex

- GIVEN the same deleted-root situation
- WHEN `compendio index` runs instead of `sync`
- THEN it exits 0 and rebuilds the index without the deleted root's documents

#### Scenario: Unreadable existing root aborts sync without mutation

- GIVEN a discovery-mode index already contains documents for a root and that root becomes unreadable during the next sync for a reason other than a clean `ENOENT` (e.g. `EACCES`, the root becoming a symlink, or a `realpath` mismatch)
- WHEN discovery runs
- THEN the sync aborts before mutation and existing indexed documents remain

#### Scenario: Deleting every discovered root empties the index without error

- GIVEN a discovery-mode index with documents under two or more root aliases, and every one of their directories is deleted from disk
- WHEN `compendio sync` or `compendio index` runs
- THEN it exits 0 and the index ends with no document rows, exactly as an ordinary empty reindex

#### Scenario: `serve` recovers on its next throttled pass after a root is deleted

- GIVEN a running `compendio serve` process serving documents from a discovery-mode root that is then deleted from disk
- WHEN the next throttled incremental sync pass runs
- THEN it purges the deleted root's documents with no special handling, and subsequent tool calls no longer return them
