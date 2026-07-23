# Delta for Search

## ADDED Requirements

### Requirement: Open `tipo` Filtering

`SearchFilters.tipo` MUST accept any non-empty string, not a closed union. (There is no direct `estado` filter parameter — `estado` is reachable only through the deny-list; see the "Config-Driven `estadosExcluidos`" requirement below for `estado` semantics.)

#### Scenario: Filter by a project-specific tipo

- GIVEN a corpus with documents typed `"runbook"` (not part of any hardcoded list)
- WHEN `search_docs` is called with `tipo: "runbook"`
- THEN only documents with `tipo: "runbook"` are returned

#### Scenario: Empty or whitespace-only tipo is treated as absent

- GIVEN a corpus with documents of various `tipo` values
- WHEN `search_docs`/`--tipo` is called with `tipo: ""` or a whitespace-only string
- THEN the filter is treated as absent — no filtering by `tipo` is applied, consistent with the indexing spec's empty-string-as-absent rule

### Requirement: Config-Driven `estadosExcluidos`

Search MUST exclude documents whose `estado` is listed in `convencion.estadosExcluidos`, unless the caller requests `incluir_no_vigentes: true`. When `convencion.estadosExcluidos` is not declared, search MUST exclude nothing on the basis of `estado`.

#### Scenario: No estadosExcluidos declared

- GIVEN no `convencion.estadosExcluidos` in config
- WHEN `search_docs` is called without `incluir_no_vigentes`
- THEN documents of every `estado` (and documents with no `estado`) are eligible for results

#### Scenario: estadosExcluidos declared, default call

- GIVEN `convencion.estadosExcluidos: ["borrador", "obsoleto"]`
- WHEN `search_docs` is called without `incluir_no_vigentes`
- THEN documents with `estado: "borrador"` or `estado: "obsoleto"` are excluded from results

#### Scenario: estadosExcluidos declared, override requested

- GIVEN `convencion.estadosExcluidos: ["borrador", "obsoleto"]`
- WHEN `search_docs` is called with `incluir_no_vigentes: true`
- THEN documents of every `estado` are eligible for results

#### Scenario: Document with no estado remains eligible under a declared deny-list

- GIVEN `convencion.estadosExcluidos: ["borrador"]` is declared and a document has no `estado` field at all
- WHEN `search_docs` is called without `incluir_no_vigentes`
- THEN the document remains eligible for results — an absent `estado` is never excluded by the deny-list (NULL-aware deny-list: absence is never excluded)

### Requirement: `incluir_no_vigentes` Is a No-Op Without Declared Exclusions

When `convencion.estadosExcluidos` is not declared, the `incluir_no_vigentes` flag MUST have no observable effect on the returned result set.

#### Scenario: Flag toggled with nothing to include

- GIVEN no `convencion.estadosExcluidos` declared
- WHEN `search_docs` is called once with `incluir_no_vigentes: false` and once with `incluir_no_vigentes: true`
- THEN both calls return the same result set
