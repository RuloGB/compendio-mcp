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
