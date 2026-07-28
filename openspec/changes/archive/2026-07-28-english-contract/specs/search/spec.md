# Delta for Search

## MODIFIED Requirements

### Requirement: Open `type` Filtering

`SearchFilters.type` MUST accept any non-empty string, not a closed union. (There is no direct `status` filter parameter — `status` is reachable only through the deny-list; see the "Config-Driven `excludedStatuses`" requirement below for `status` semantics.)
(Previously: Spanish `SearchFilters.tipo`/`estado`)

#### Scenario: Filter by a project-specific type

- GIVEN a corpus with documents typed `"runbook"` (not part of any hardcoded list)
- WHEN `search_docs` is called with `type: "runbook"`
- THEN only documents with `type: "runbook"` are returned

#### Scenario: Empty or whitespace-only type is treated as absent

- GIVEN a corpus with documents of various `type` values
- WHEN `search_docs`/`--type` is called with `type: ""` or a whitespace-only string
- THEN the filter is treated as absent — no filtering by `type` is applied, consistent with the indexing spec's empty-string-as-absent rule

### Requirement: Config-Driven `excludedStatuses`

Search MUST exclude documents whose `status` is listed in `convention.excludedStatuses`, unless the caller requests `include_excluded: true`. When `convention.excludedStatuses` is not declared, search MUST exclude nothing on the basis of `status`.
(Previously: Spanish `convencion.estadosExcluidos`, `incluir_no_vigentes`)

#### Scenario: No excludedStatuses declared

- GIVEN no `convention.excludedStatuses` in config
- WHEN `search_docs` is called without `include_excluded`
- THEN documents of every `status` (and documents with no `status`) are eligible for results

#### Scenario: excludedStatuses declared, default call

- GIVEN `convention.excludedStatuses: ["draft", "deprecated"]`
- WHEN `search_docs` is called without `include_excluded`
- THEN documents with `status: "draft"` or `status: "deprecated"` are excluded from results

#### Scenario: excludedStatuses declared, override requested

- GIVEN `convention.excludedStatuses: ["draft", "deprecated"]`
- WHEN `search_docs` is called with `include_excluded: true`
- THEN documents of every `status` are eligible for results

#### Scenario: Document with no status remains eligible under a declared deny-list

- GIVEN `convention.excludedStatuses: ["draft"]` is declared and a document has no `status` field at all
- WHEN `search_docs` is called without `include_excluded`
- THEN the document remains eligible for results — an absent `status` is never excluded by the deny-list (NULL-aware deny-list: absence is never excluded)

### Requirement: `include_excluded` Is a No-Op Without Declared Exclusions

When `convention.excludedStatuses` is not declared, the `include_excluded` flag MUST have no observable effect on the returned result set.
(Previously: Spanish `incluir_no_vigentes` flag)

#### Scenario: Flag toggled with nothing to include

- GIVEN no `convention.excludedStatuses` declared
- WHEN `search_docs` is called once with `include_excluded: false` and once with `include_excluded: true`
- THEN both calls return the same result set
