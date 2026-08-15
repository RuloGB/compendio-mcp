# Delta for Search

## ADDED Requirements

### Requirement: Open `module` Filtering

`SearchFilters.module` MUST accept any non-empty string, matched verbatim and case-sensitively — consistent with `type`'s open-string handling (see "Open `type` Filtering"). `module` MUST NOT be lowercased. A blank `module` value (empty string, or whitespace-only) MUST be treated as absent: no filtering by `module` is applied, silently, with no diagnostic emitted to explain the normalization.

#### Scenario: Empty or whitespace-only module is treated as absent

- GIVEN a corpus with documents that declare various `module` values
- WHEN `search_docs`/`--module` is called with `module: ""` or a whitespace-only string
- THEN the filter is treated as absent — no filtering by `module` is applied, and the result set matches an identical call that omits `module` entirely

#### Scenario: Module matching is case-preserving, never lowercased

- GIVEN a corpus with a document declaring `module: "Identity"`
- WHEN `search_docs` is called with `module: "identity"`
- THEN the document is not returned — `module` matching stays verbatim and case-sensitive

#### Scenario: A blank module filter against a module-less corpus produces no configuration advice

- GIVEN a corpus where no document declares a `module`
- WHEN `search_docs` is called with `module: ""`
- THEN results are returned unfiltered, and the response carries no configuration-advice warning suggesting `convention.frontmatterFields` — a blank value is never treated as a filter that "could never match" a declared field

### Requirement: Tags Filtering Trims Entries And Drops Empties

Each entry in a caller-supplied `tags` filter MUST be trimmed before matching, mirroring the normalization a document's own declared tags already receive when indexed. An entry that is empty after trimming MUST be dropped from the filter rather than matched literally. The existing lowercasing of `tags` entries MUST be retained alongside trimming. When every entry of a supplied `tags` array is empty after trimming, the whole `tags` filter MUST be treated as absent, exactly like an omitted `tags` filter.

#### Scenario: A tag with surrounding whitespace matches its stored form

- GIVEN a corpus with a document declaring `tags: ["api"]`
- WHEN `search_docs` is called with `tags: [" api"]`
- THEN the document is returned, identically to a call with `tags: ["api"]`

#### Scenario: A mixed array keeps valid entries and drops blank ones

- GIVEN a corpus with a document declaring `tags: ["api"]`
- WHEN `search_docs` is called with `tags: ["api", "  "]`
- THEN the result set matches a call with `tags: ["api"]` alone — the blank entry is dropped from the filter, not matched literally against any document

#### Scenario: An array that becomes empty after trimming is treated as absent

- GIVEN a corpus with documents carrying various `tags`
- WHEN `search_docs` is called with `tags: ["  "]`
- THEN the filter is treated as absent — no filtering by `tags` is applied, and the result set matches an identical call that omits `tags` entirely
