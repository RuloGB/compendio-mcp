# Delta for Configuration

## ADDED Requirements

### Requirement: Optional `convencion` Configuration Block

The system MUST accept an optional `convencion` block in `compendio.config.json`. When the block (or the whole config file) is absent, the system MUST default `convencion.modo` to `"libre"`.

#### Scenario: No config file at all

- GIVEN a project directory with `.md` files and no `compendio.config.json`
- WHEN `compendio index` runs
- THEN every readable `.md` file is indexed under `libre` behavior

#### Scenario: `docsDir`-only config

- GIVEN a `compendio.config.json` containing only `{ "docsDir": "documentation" }`
- WHEN `compendio index` runs
- THEN `convencion.modo` defaults to `"libre"` and no file is skipped for metadata reasons

#### Scenario: Partial `convencion` block merges with defaults

- GIVEN a `compendio.config.json` containing only `{ "convencion": { "modo": "estricto" } }`
- WHEN the config is loaded
- THEN `convencion.estadosExcluidos` defaults to `[]`, `convencion.camposFrontmatter` defaults to the identity mapping, and no `tipos`/`estados` taxonomy is declared — declaring the `convencion` block does not wipe the defaults of its sibling fields

### Requirement: `convencion.modo` Toggle

The system MUST support `convencion.modo: "estricto" | "libre"` as the single switch selecting the validation policy applied during indexing and index-md generation.

#### Scenario: Explicit `libre` declared

- GIVEN `convencion.modo: "libre"` in config
- WHEN indexing runs
- THEN the libre inference policy applies (see Indexing spec)

#### Scenario: Explicit `estricto` declared

- GIVEN `convencion.modo: "estricto"` in config
- WHEN indexing runs
- THEN the estricto validation policy applies (see Indexing spec)

### Requirement: `estadosExcluidos` Lives Under `convencion`

The system MUST read the search-exclusion list from `convencion.estadosExcluidos`. The system MUST NOT read a `search.estadosExcluidos` key — that key is retired without a compatibility shim.

#### Scenario: Legacy key has no effect

- GIVEN a config with `search.estadosExcluidos: ["borrador"]` and no `convencion.estadosExcluidos`
- WHEN search runs
- THEN no `estado` is excluded from results

#### Scenario: Legacy key emits a deprecation notice and is not honored

- GIVEN a config with `search.estadosExcluidos: ["borrador"]` present
- WHEN the config is loaded
- THEN the system emits a one-line deprecation notice to stderr naming `convencion.estadosExcluidos`, AND the legacy value is not honored (warn-and-ignore, not a compatibility shim)

### Requirement: `camposFrontmatter` Field Mapping

The system MUST support an optional `convencion.camposFrontmatter` mapping of `tipo`/`modulo`/`estado` to non-standard frontmatter field names. When a mapping is declared and the mapped field is present, its value MUST take precedence over any inferred value. Each of the three mappable fields (`tipo`/`modulo`/`estado`) independently reads its own declared source key; two fields mapping to the same source key is permitted, and both fields MUST read that key's value — there is no collision error or dedup machinery. A declared `camposFrontmatter` object MUST merge per key against the identity defaults (`{ "tipo": "tipo", "modulo": "modulo", "estado": "estado" }`) — declaring only some of the three keys MUST NOT wipe the defaults of the remaining keys; the object is never replaced wholesale.

#### Scenario: Custom field name mapped

- GIVEN `convencion.camposFrontmatter: { "tipo": "type" }` and a document with frontmatter `type: "guide"`
- WHEN the document is indexed
- THEN `tipo` resolves to `"guide"`

#### Scenario: Partial `camposFrontmatter` merges per key with the identity defaults

- GIVEN a `compendio.config.json` containing only `{ "convencion": { "camposFrontmatter": { "tipo": "type" } } }`
- WHEN the config is loaded
- THEN `camposFrontmatter.tipo` resolves to `"type"`, while `camposFrontmatter.modulo` and `camposFrontmatter.estado` remain at their identity defaults (`"modulo"` and `"estado"`) — declaring one key never wipes the others

#### Scenario: No mapping declared

- GIVEN no `convencion.camposFrontmatter` in config and a document with frontmatter `tipo: "guia"`
- WHEN the document is indexed
- THEN `tipo` resolves to `"guia"` read from the standard field name

#### Scenario: Two fields mapped to the same source key

- GIVEN `convencion.camposFrontmatter: { "tipo": "clasificacion", "estado": "clasificacion" }` and a document with frontmatter `clasificacion: "guia-vigente"`
- WHEN the document is indexed
- THEN both `tipo` and `estado` resolve to `"guia-vigente"` — no error is raised for the shared source key
