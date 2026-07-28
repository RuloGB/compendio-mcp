# Delta for Configuration

## ADDED Requirements

### Requirement: Optional `convention` Configuration Block

The system MUST accept an optional `convention` block in `compendio.config.json`. When the block (or the whole config file) is absent, the system MUST default `convention.mode` to `"loose"`.

#### Scenario: No config file at all

- GIVEN a project directory with `.md` files and no `compendio.config.json`
- WHEN `compendio index` runs
- THEN every readable `.md` file is indexed under `loose` behavior

#### Scenario: `docsDir`-only config

- GIVEN a `compendio.config.json` containing only `{ "docsDir": "documentation" }`
- WHEN `compendio index` runs
- THEN `convention.mode` defaults to `"loose"` and no file is skipped for metadata reasons

#### Scenario: Partial `convention` block merges with defaults

- GIVEN a `compendio.config.json` containing only `{ "convention": { "mode": "strict" } }`
- WHEN the config is loaded
- THEN `convention.excludedStatuses` defaults to `[]`, `convention.frontmatterFields` defaults to the identity mapping, and no `types`/`statuses` taxonomy is declared — declaring the `convention` block does not wipe the defaults of its sibling fields

### Requirement: `convention.mode` Toggle

The system MUST support `convention.mode: "strict" | "loose"` as the single switch selecting the validation policy applied during indexing and index-md generation.

#### Scenario: Explicit `loose` declared

- GIVEN `convention.mode: "loose"` in config
- WHEN indexing runs
- THEN the loose inference policy applies (see Indexing spec)

#### Scenario: Explicit `strict` declared

- GIVEN `convention.mode: "strict"` in config
- WHEN indexing runs
- THEN the strict validation policy applies (see Indexing spec)

### Requirement: `excludedStatuses` Lives Under `convention`

The system MUST read the search-exclusion list from `convention.excludedStatuses`. The system MUST NOT read a `search.excludedStatuses` key — that key is retired without a compatibility shim.

#### Scenario: Legacy key has no effect

- GIVEN a config with `search.excludedStatuses: ["draft"]` and no `convention.excludedStatuses`
- WHEN search runs
- THEN no `status` is excluded from results

#### Scenario: Legacy key is silently dropped, not merged

- GIVEN a config with `search.excludedStatuses: ["draft"]` present
- WHEN the config is loaded
- THEN `mergeConfig` builds `search` from an explicit whitelist of recognized keys (currently only `k`), so the unrecognized `excludedStatuses` key under `search` never reaches the returned config and is not honored — no deprecation warning is emitted, and there is no compatibility shim

### Requirement: `frontmatterFields` Field Mapping

The system MUST support an optional `convention.frontmatterFields` mapping of `type`/`module`/`status` to non-standard frontmatter field names. When a mapping is declared and the mapped field is present, its value MUST take precedence over any inferred value. Each of the three mappable fields (`type`/`module`/`status`) independently reads its own declared source key; two fields mapping to the same source key is permitted, and both fields MUST read that key's value — there is no collision error or dedup machinery. A declared `frontmatterFields` object MUST merge per key against the identity defaults (`{ "type": "type", "module": "module", "status": "status" }`) — declaring only some of the three keys MUST NOT wipe the defaults of the remaining keys; the object is never replaced wholesale.

#### Scenario: Custom field name mapped

- GIVEN `convention.frontmatterFields: { "type": "tipo" }` and a document with frontmatter `tipo: "guide"`
- WHEN the document is indexed
- THEN `type` resolves to `"guide"`

#### Scenario: Partial `frontmatterFields` merges per key with the identity defaults

- GIVEN a `compendio.config.json` containing only `{ "convention": { "frontmatterFields": { "type": "tipo" } } }`
- WHEN the config is loaded
- THEN `frontmatterFields.type` resolves to `"tipo"`, while `frontmatterFields.module` and `frontmatterFields.status` remain at their identity defaults (`"module"` and `"status"`) — declaring one key never wipes the others

#### Scenario: No mapping declared

- GIVEN no `convention.frontmatterFields` in config and a document with frontmatter `type: "guide"`
- WHEN the document is indexed
- THEN `type` resolves to `"guide"` read from the standard field name

#### Scenario: Two fields mapped to the same source key

- GIVEN `convention.frontmatterFields: { "type": "classification", "status": "classification" }` and a document with frontmatter `classification: "guide-current"`
- WHEN the document is indexed
- THEN both `type` and `status` resolve to `"guide-current"` — no error is raised for the shared source key

### Requirement: `sync` Configuration Section With a Per-Project Throttle Default

The system MUST accept an optional `sync` block in `compendio.config.json` with a `throttleMs` key controlling the minimum interval between throttled incremental sync passes (see Indexing spec). When the block or the key is absent, the system MUST default `sync.throttleMs` to `30000` (30 seconds), following the project's existing "every key has a default" convention. A declared `throttleMs` that is not a finite positive number (non-numeric, negative, or `0`) MUST be treated the same as an absent key and MUST also fall back to the default `30000`, rather than being accepted as-is; any finite positive value, however small, MUST be accepted, with the tradeoff (more frequent per-call filesystem diffs) left to the project's choice.

#### Scenario: No `sync` block declared

- GIVEN a `compendio.config.json` with no `sync` block
- WHEN `compendio serve` starts
- THEN the throttled sync check uses the default 30-second interval

#### Scenario: Custom throttle declared

- GIVEN `compendio.config.json` containing `{ "sync": { "throttleMs": 60000 } }`
- WHEN `compendio serve` starts
- THEN the throttled sync check uses a 60-second interval instead of the default

#### Scenario: Invalid throttle value falls back to the default

- GIVEN `compendio.config.json` containing a `sync.throttleMs` value that is non-numeric, negative, or `0`
- WHEN `compendio serve` starts
- THEN the throttled sync check uses the default 30-second interval instead of the invalid value
