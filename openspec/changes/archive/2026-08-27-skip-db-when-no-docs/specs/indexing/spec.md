# Delta for Indexing

## ADDED Requirements

### Requirement: Lazy Database Creation and Empty Reindex

The store MUST defer database creation until a write. Uninitialized reads MUST return empty results. Empty `index` MUST reset an existing database but MUST NOT create one; empty `sync` MUST also avoid initialization.

#### Scenario: Missing root is empty index work

- GIVEN the configured root does not exist
- WHEN `compendio index` runs
- THEN it succeeds with “nothing to index” and creates no `.compendio/`

#### Scenario: Empty reindex clears stale rows

- GIVEN an existing database has rows and discovery finds none
- WHEN `compendio index` runs
- THEN it has the current empty schema with no document rows

#### Scenario: First discovered write initializes the store

- GIVEN no database exists and discovery finds a document
- WHEN `compendio index` persists it
- THEN the database is created and it is indexed

## MODIFIED Requirements

### Requirement: Incremental Sync Triggers — Startup and Pre-Tool Check

`serve` MUST run one incremental sync at startup before tools. The three handlers MUST share a hook that runs at most one pass per throttle window. An empty pass MUST avoid database creation.
(Previously: startup sync eagerly created a database.)

#### Scenario: Startup sync catches offline edits

- GIVEN a corpus changed since the last index run
- WHEN `serve` starts
- THEN startup sync indexes changes before the first tool call

#### Scenario: Throttle window gates repeated calls

- GIVEN one call is within the throttle window and another is after it
- WHEN both calls are handled
- THEN only the later call triggers a fresh pass

#### Scenario: Missing database with a non-empty corpus initializes on write

- GIVEN no database exists and discovery finds an indexable document
- WHEN `serve` starts
- THEN startup creates the schema on first write and indexes it

#### Scenario: Empty startup remains database-free

- GIVEN all roots are missing or empty
- WHEN `serve` starts
- THEN startup succeeds without a database

### Requirement: Read Failures Protect the Affected `path` Subtree From Deletion

`discover()` MUST report directory read failures in `readErrors`. Incremental sync MUST protect the path and descendants from deletion, retain rows, and report the failure in `skipped`. A missing/empty root MUST be zero files and `index` MUST succeed with “nothing to index”. Only genuine failures of every root MUST throw.
(Previously: a missing root was treated as an error.)

#### Scenario: Unreadable subdirectory protects documents

- GIVEN indexed documents under `guides/` and a read failure there
- WHEN incremental sync runs
- THEN the failure is reported and indexed `guides/` paths remain unchanged

#### Scenario: Missing root succeeds with no work

- GIVEN `docsDir: ["docs"]`, no `docs/`, and no database
- WHEN `compendio index` runs
- THEN it succeeds with “nothing to index” and no database

#### Scenario: One of several roots is missing

- GIVEN `docsDir: ["docs", "openspec"]`, with `docs/` readable and `openspec/` absent
- WHEN `compendio index` runs
- THEN documents are indexed and it succeeds

#### Scenario: One of several roots has a genuine read failure

- GIVEN `docsDir: ["docs", "openspec"]`, with `docs/` readable and `openspec/` failing with I/O error
- WHEN `compendio index` runs
- THEN documents are indexed, the failure is reported, and it succeeds

#### Scenario: A sole root with a genuine read failure throws

- GIVEN `docsDir: ["docs"]` and reading `docs/` fails with I/O error
- WHEN `compendio index` runs
- THEN it throws because every root genuinely failed

#### Scenario: Every root has a genuine read failure

- GIVEN every declared root cannot be read because of an I/O failure
- WHEN `compendio index` runs
- THEN it throws and reports the failures

#### Scenario: Failed root protects its alias subtree

- GIVEN root alias `docs` becomes unreadable during incremental sync
- WHEN the pass runs
- THEN `ReadError.path` is `docs`, and indexed `docs/...` paths are retained
