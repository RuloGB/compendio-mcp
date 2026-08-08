# Delta for MCP Contract

## ADDED Requirements

### Requirement: Root-Alias-Prefixed `path` Flows Through `search_docs`, `read_doc`, and `docs_overview`, Always

Every `path` value returned by `search_docs` result items and `docs_overview`'s per-document lines MUST carry its document's root-alias prefix, unchanged from the value persisted at index time — regardless of how many roots are declared, including the default single-element `["docs"]` root set. `read_doc({ path })` MUST accept that same root-prefixed value verbatim and resolve it to the corresponding document: a `path` returned by `search_docs` or `docs_overview` MUST round-trip through `read_doc` with no caller-side stripping or rewriting.

#### Scenario: `search_docs` returns a root-prefixed path

- GIVEN `docsDir: ["docs", "openspec"]` and a query whose only match lives under the `openspec` root
- WHEN `search_docs` returns
- THEN the matching result item's `path` carries the `openspec/` prefix

#### Scenario: A root-prefixed path round-trips through `read_doc`

- GIVEN a `path` value returned by `search_docs` or `docs_overview`
- WHEN that exact value is passed as `read_doc({ path })`
- THEN the response is a `"document"` (or `"section"`) result, never `"path-not-found"`

#### Scenario: `docs_overview` lists root-prefixed paths across every declared root

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `docs_overview` is called
- THEN its per-document lines include documents from both roots, each shown under its own root-prefixed `path`

#### Scenario: The default single-root set still prefixes every path

- GIVEN no config file, so `docsDir` defaults to `["docs"]`
- WHEN `search_docs`, `read_doc`, and `docs_overview` are called
- THEN every `path` value returned or accepted carries the `docs/` prefix — not the unprefixed shape prior versions produced

### Requirement: `read_doc` Tolerates Exactly One Extra Leading Path Segment

`read_doc({ path })` MUST attempt to resolve the literal `path` value against the index first. When the literal value does not match any indexed document, the system MUST retry exactly once with the path's leftmost segment stripped (e.g. `repo/docs/x.md` → `docs/x.md`), and MUST use that match if found. This tolerance MUST NOT be applied recursively — only one segment is ever stripped, and only as a fallback attempted after the literal path has already missed, so a genuine document whose own `path` is the stripped form always loses to an exact match at the deeper, literal path when both would otherwise apply. The tolerance MUST NOT add a segment: a `path` value with fewer segments than an indexed document's `path` (e.g. a bare basename supplied for a document indexed as `docs/x.md`) MUST NOT be resolved by this mechanism.

#### Scenario: A one-segment-over-prefixed path resolves via the stripped fallback

- GIVEN a document indexed as `docs/x.md`
- WHEN `read_doc` is called with `path: "repo/docs/x.md"`
- THEN the literal value misses, the system retries with the leading segment stripped (`docs/x.md`), and that match resolves the document

#### Scenario: An exact match always wins over the stripped fallback

- GIVEN `docsDir: ["docs", "adr"]`, a document indexed as `docs/adr/x.md` (a file under the `docs` root, in its `adr/` subdirectory) and another indexed as `adr/x.md` (a file at the top of the `adr` root)
- WHEN `read_doc` is called with `path: "docs/adr/x.md"`
- THEN the literal exact match resolves directly, and the stripped-fallback lookup is never attempted

#### Scenario: A miss whose stripped form names another root's document resolves to that document

- GIVEN `docsDir: ["docs", "adr"]` and a document indexed as `adr/x.md`, with **no** document indexed as `docs/adr/x.md`
- WHEN `read_doc` is called with `path: "docs/adr/x.md"`
- THEN the literal value misses, the one-segment strip yields `adr/x.md`, and that document is returned — the tolerance MUST NOT special-case this, because the stripped form is a legitimate indexed path and the mechanism cannot distinguish it from the over-prefixed case it exists to serve

> **This is a documented non-guarantee, not an oversight.** Because every alias is exactly one segment,
> a stripped path can name a different root's document whenever the first segment of the requested
> path happens to equal another declared alias. It fires **only** when the requested path does not
> exist, so it converts a "path not found" into a plausible neighbouring document rather than
> corrupting a correct lookup. An earlier design revision claimed such a hit was "not representable";
> that claim was too strong and is withdrawn here. Callers that need certainty pass a `path` returned
> by `search_docs` or `docs_overview`, which always exists and therefore always takes the exact branch.

#### Scenario: A bare basename does not recover a root prefix

- GIVEN a document indexed as `docs/x.md` and no document indexed as the bare `x.md`
- WHEN `read_doc` is called with `path: "x.md"`
- THEN the literal value misses, the one-segment tolerance offers no further reduction of a single-segment path, and the response is the documented "unknown path" result with the 3 closest matches — not a resolved document
