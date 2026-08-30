# Delta for MCP Contract

## MODIFIED Requirements

### Requirement: Root-Alias-Prefixed `path` Flows Through `search_docs`, `read_doc`, and `docs_overview`, Always

Every `path` value returned by `search_docs` result items and `docs_overview`'s per-document lines MUST carry its document's root-alias prefix in explicit mode and its discovered top-level root prefix in discovery mode, unchanged from the value persisted at index time. `read_doc({ path })` MUST accept that same value verbatim and resolve it to the corresponding document. The zero-config path shape MUST remain round-trippable.
(Previously: only the declared-root shape was specified; discovery-mode path shape was absent.)

#### Scenario: Zero-config paths round-trip without stripping

- GIVEN discovery mode is active and `search_docs` returns a path under `openspec/`
- WHEN that exact path is passed to `read_doc`
- THEN the document resolves successfully

#### Scenario: Explicit-mode paths remain unchanged

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `docs_overview` or `search_docs` returns a path
- THEN the path still carries the declared root alias unchanged

## ADDED Requirements

### Requirement: MCP Zero-Config Expectations Reflect Discovery Mode

The system MUST preserve the same three-tool MCP surface (`docs_overview`, `search_docs`, `read_doc`) and MUST accept zero-config usage by returning discovery-mode paths instead of a hidden `docs/` default. Tool names, parameters, and response shapes MUST remain unchanged.

#### Scenario: Tool surface stays unchanged

- GIVEN a running MCP server
- WHEN the tool list is inspected
- THEN only `docs_overview`, `search_docs`, and `read_doc` are exposed

#### Scenario: Zero-config paths are discovery-shaped

- GIVEN no config file and a discovered root named `openspec`
- WHEN `search_docs` returns a result
- THEN its `path` is discovery-shaped and round-trips through `read_doc`
