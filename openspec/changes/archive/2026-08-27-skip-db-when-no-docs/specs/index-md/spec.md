# Delta for Index-MD

## ADDED Requirements

### Requirement: Empty Discovery Writes a Header-Only INDEX.md

When `compendio index-md` discovers zero documents because the configured roots are missing or empty, it MUST succeed and write the generated `INDEX.md` to the first declared root, as today. The file MUST contain only the standard header and no document entries. This operation MUST NOT initialize or create the SQLite database.

#### Scenario: Empty default root writes the header

- GIVEN the default `docs` root is missing or empty and no database exists
- WHEN `compendio index-md` runs
- THEN it succeeds, writes `docs/INDEX.md` with only the standard header, and creates no `.compendio/`

#### Scenario: Missing first root still writes the target file

- GIVEN the first declared root does not exist and discovery finds zero documents
- WHEN `compendio index-md` runs
- THEN it creates the first root as needed, writes a header-only `INDEX.md`, and does not create a database

#### Scenario: Existing database is not used to populate an empty INDEX.md

- GIVEN an existing database contains stale documents but current filesystem discovery finds none
- WHEN `compendio index-md` runs
- THEN the generated file contains only the header and does not list stale database rows
