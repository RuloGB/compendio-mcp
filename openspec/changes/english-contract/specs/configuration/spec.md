# Delta for Configuration

## MODIFIED Requirements

### Requirement: Optional `convention` Configuration Block

The system MUST accept an optional `convention` block in `compendio.config.json`. When the block (or the whole config file) is absent, the system MUST default `convention.mode` to `"loose"`.
(Previously: Spanish `convencion` block, defaulting `modo` to `"libre"`)

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
(Previously: Spanish `convencion.modo: "estricto" | "libre"`)

#### Scenario: Explicit `loose` declared

- GIVEN `convention.mode: "loose"` in config
- WHEN indexing runs
- THEN the loose inference policy applies (see Indexing spec)

#### Scenario: Explicit `strict` declared

- GIVEN `convention.mode: "strict"` in config
- WHEN indexing runs
- THEN the strict validation policy applies (see Indexing spec)

### Requirement: `frontmatterFields` Field Mapping

The system MUST support an optional `convention.frontmatterFields` mapping of `type`/`module`/`status` to non-standard frontmatter field names. When a mapping is declared and the mapped field is present, its value MUST take precedence over any inferred value. Each of the three mappable fields (`type`/`module`/`status`) independently reads its own declared source key; two fields mapping to the same source key is permitted, and both fields MUST read that key's value — there is no collision error or dedup machinery. A declared `frontmatterFields` object MUST merge per key against the identity defaults (`{ "type": "type", "module": "module", "status": "status" }`) — declaring only some of the three keys MUST NOT wipe the defaults of the remaining keys; the object is never replaced wholesale.
(Previously: Spanish `camposFrontmatter` mapping `tipo`/`modulo`/`estado`, identity defaults `{ "tipo": "tipo", "modulo": "modulo", "estado": "estado" }`)

#### Scenario: Custom field name mapped

- GIVEN `convention.frontmatterFields: { "type": "kind" }` and a document with frontmatter `kind: "guide"`
- WHEN the document is indexed
- THEN `type` resolves to `"guide"`

#### Scenario: Partial `frontmatterFields` merges per key with the identity defaults

- GIVEN a `compendio.config.json` containing only `{ "convention": { "frontmatterFields": { "type": "kind" } } }`
- WHEN the config is loaded
- THEN `frontmatterFields.type` resolves to `"kind"`, while `frontmatterFields.module` and `frontmatterFields.status` remain at their identity defaults (`"module"` and `"status"`) — declaring one key never wipes the others

#### Scenario: No mapping declared

- GIVEN no `convention.frontmatterFields` in config and a document with frontmatter `type: "guide"`
- WHEN the document is indexed
- THEN `type` resolves to `"guide"` read from the standard field name

#### Scenario: Two fields mapped to the same source key

- GIVEN `convention.frontmatterFields: { "type": "classification", "status": "classification" }` and a document with frontmatter `classification: "current-guide"`
- WHEN the document is indexed
- THEN both `type` and `status` resolve to `"current-guide"` — no error is raised for the shared source key

#### Scenario: A Spanish project maps `status` to its own Spanish frontmatter key

- GIVEN `convention.frontmatterFields: { "status": "estado" }` (a project-chosen source key value, not a retired identifier) and a document with frontmatter `estado: "borrador"`
- WHEN the document is indexed
- THEN `status` resolves to `"borrador"` — this mapping is the documented mechanism that lets a non-English project keep Spanish frontmatter keys under the English-keyed default schema

## REMOVED Requirements

### Requirement: `estadosExcluidos` Lives Under `convencion`

(Reason: Its exclusion-source statement is superseded by the renamed "Optional `convention` Configuration Block" requirement above (`convention.excludedStatuses` defaults to `[]`) and by the Search domain's "Config-Driven `excludedStatuses`" requirement. Its two scenarios existed only to document the retired `search.estadosExcluidos` warn-and-ignore path (`warnIfLegacyEstadosExcluidos`). Under the no-shims policy that key and its deprecation-notice behavior are deleted outright, not translated to warn about an English key that never shipped under any version.)
(Migration: None. `warnIfLegacyEstadosExcluidos` and its `config.test.ts` coverage are deleted; there is no legacy key left to warn about.)
