# Delta for Search

## ADDED Requirements

### Requirement: Search Without an Index Returns an Empty Response

Queries against a project with no `.compendio/compendio.db` MUST return a well-formed empty `SearchResponse` rather than throwing. The response MUST contain the normal search `mode` and an empty `results` array; an unfiltered miss MUST NOT require a diagnostic explanation.

#### Scenario: Search with no database

- GIVEN no database exists and the configured roots are missing or empty
- WHEN `search_docs` is called with a query
- THEN the call succeeds with an empty `results` array and no database error

#### Scenario: Filtered search with no database

- GIVEN no database exists
- WHEN `search_docs` is called with a query and valid filters
- THEN the call succeeds with a well-formed empty response and does not attempt to create the database

#### Scenario: CLI search with no database

- GIVEN no `.compendio/compendio.db` exists
- WHEN the `search` command runs
- THEN it exits successfully and reports no matching documents rather than failing on a missing table
