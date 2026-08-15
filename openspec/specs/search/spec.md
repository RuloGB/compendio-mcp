# Delta for Search

## ADDED Requirements

### Requirement: Open `type` Filtering

`SearchFilters.type` MUST accept any non-empty string, not a closed union. (There is no direct `status` filter parameter — `status` is reachable only through the deny-list; see the "Config-Driven `excludedStatuses`" requirement below for `status` semantics.)

#### Scenario: Filter by a project-specific type

- GIVEN a corpus with documents typed `"runbook"` (not part of any hardcoded list)
- WHEN `search_docs` is called with `type: "runbook"`
- THEN only documents with `type: "runbook"` are returned

#### Scenario: Empty or whitespace-only type is treated as absent

- GIVEN a corpus with documents of various `type` values
- WHEN `search_docs`/`--type` is called with `type: ""` or a whitespace-only string
- THEN the filter is treated as absent — no filtering by `type` is applied, consistent with the indexing spec's empty-string-as-absent rule

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

### Requirement: Config-Driven `excludedStatuses`

Search MUST exclude documents whose `status` is listed in `convention.excludedStatuses`, unless the caller requests `includeExcluded: true`. When `convention.excludedStatuses` is not declared, search MUST exclude nothing on the basis of `status`.

#### Scenario: No excludedStatuses declared

- GIVEN no `convention.excludedStatuses` in config
- WHEN `search_docs` is called without `includeExcluded`
- THEN documents of every `status` (and documents with no `status`) are eligible for results

#### Scenario: excludedStatuses declared, default call

- GIVEN `convention.excludedStatuses: ["draft", "deprecated"]`
- WHEN `search_docs` is called without `includeExcluded`
- THEN documents with `status: "draft"` or `status: "deprecated"` are excluded from results

#### Scenario: excludedStatuses declared, override requested

- GIVEN `convention.excludedStatuses: ["draft", "deprecated"]`
- WHEN `search_docs` is called with `includeExcluded: true`
- THEN documents of every `status` are eligible for results

#### Scenario: Document with no status remains eligible under a declared deny-list

- GIVEN `convention.excludedStatuses: ["draft"]` is declared and a document has no `status` field at all
- WHEN `search_docs` is called without `includeExcluded`
- THEN the document remains eligible for results — an absent `status` is never excluded by the deny-list (NULL-aware deny-list: absence is never excluded)

### Requirement: `includeExcluded` Is a No-Op Without Declared Exclusions

When `convention.excludedStatuses` is not declared, the `includeExcluded` flag MUST have no observable effect on the returned result set.

#### Scenario: Flag toggled with nothing to include

- GIVEN no `convention.excludedStatuses` declared
- WHEN `search_docs` is called once with `includeExcluded: false` and once with `includeExcluded: true`
- THEN both calls return the same result set
