# Delta for MCP Contract

## ADDED Requirements

### Requirement: MCP Tools Operate Without Documents or an Index

`compendio serve` MUST start successfully when all configured document roots are missing or empty and no database exists. Each MCP tool MUST return its normal response shape with empty content, rather than throwing because the store has not been initialized.

#### Scenario: Server starts without docs

- GIVEN no configured document root contains any indexable file and no database exists
- WHEN `compendio serve` starts
- THEN the server starts normally and is ready to accept tool calls

#### Scenario: Empty overview is well formed

- GIVEN the server is running without an index
- WHEN `docs_overview` is called
- THEN it succeeds with zero documents, no document lines, and no fabricated taxonomy buckets

#### Scenario: Empty search is well formed

- GIVEN the server is running without an index
- WHEN `search_docs` is called
- THEN it succeeds with the normal `mode` field and `results: []`, without a database error

#### Scenario: Unknown path remains a well-formed read result

- GIVEN the server is running without an index
- WHEN `read_doc` is called for any path
- THEN it returns the normal path-not-found response with zero available matches, without throwing
