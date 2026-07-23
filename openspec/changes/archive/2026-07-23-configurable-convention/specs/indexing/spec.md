# Delta for Indexing

## ADDED Requirements

### Requirement: Resilience Skip Reasons Apply in Both Modes

Independently of `convencion.modo`, the system MUST report a file in `omitidos` for any of three resilience reasons — the file is unreadable, the file fails markdown/frontmatter parsing, or the file yields zero indexable chunks after parsing/chunking ("el documento no tiene contenido indexable") — and these three reasons apply identically under both `libre` and `estricto`: the per-file unreadable/parse-failure containment sits ahead of any mode-specific metadata validation, so a file can be skipped for a resilience reason under `estricto` exactly as it would under `libre`, before `estricto`'s own taxonomy/presence checks ever run.

#### Scenario: I/O-unreadable file is skipped and the run continues, under estricto too

- GIVEN a `.md` file that cannot be read (an I/O error occurs while reading its content)
- WHEN indexed under `estricto`
- THEN the file is reported in `omitidos` with its error message, and indexing continues with the remaining files — identically to how it would be handled under `libre`

#### Scenario: Malformed frontmatter fails to parse and the run continues

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse
- WHEN indexed under `libre`
- THEN the file is reported in `omitidos` with its error message, and indexing continues with the remaining files

#### Scenario: Malformed frontmatter fails to parse and the run continues, under estricto too

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse, and `convencion.modo: "estricto"` configured
- WHEN indexed under `estricto`
- THEN the file is reported in `omitidos` with its error message, and indexing continues with the remaining files — identically to how it would be handled under `libre`

#### Scenario: Document with no indexable content is skipped

- GIVEN a `.md` file that parses successfully but yields zero indexable chunks after chunking (e.g., an empty body)
- WHEN indexed under `libre` or `estricto`
- THEN the file is reported in `omitidos` with the reason "el documento no tiene contenido indexable"

### Requirement: `libre` Mode Never Skips Files for Metadata Reasons

Under `convencion.modo: "libre"` (the default), the convention policy (resolver) MUST NOT skip a file for missing, unknown, or absent `tipo`/`modulo`/`estado` values.

#### Scenario: File with no frontmatter at all

- GIVEN a `.md` file with no frontmatter and no H1
- WHEN indexed under `libre`
- THEN the file is indexed successfully with `tipo`, `modulo`, and `estado` absent

### Requirement: `estricto` Mode Validates Declared Taxonomies Per Field, Independently

Under `convencion.modo: "estricto"`, the convention policy (resolver) MUST validate `tipo` and `estado` independently against the project's declared `convencion.tipos` and `convencion.estados`, respectively: when a taxonomy is declared for a field, its value MUST belong to that list; when a taxonomy is not declared for a field, that field falls back to presence-only validation (see the requirement below) rather than being rejected. `modulo` has no taxonomy of any kind — it MUST always be validated for presence only, regardless of what is or isn't declared for `tipo`/`estado`. Files with a `tipo`/`estado` value outside its declared taxonomy, or missing a required field, MUST be reported in `omitidos`.

#### Scenario: Value outside declared taxonomy

- GIVEN `convencion.tipos: ["guia"]`, a document with `tipo: "adr"`, and a valid `modulo`
- WHEN indexed under `estricto`
- THEN the document is skipped and reported in `omitidos`

#### Scenario: Mixed declaration — one taxonomy declared, the other not

- GIVEN `convencion.tipos: ["guia"]` is declared and `convencion.estados` is not declared
- WHEN a document has `tipo: "guia"`, `estado: "anything-non-empty"`, and a valid `modulo`
- THEN the document is accepted: `tipo` is validated against the declared list and `estado` is accepted by presence only

### Requirement: `estricto` Without a Declared Taxonomy Falls Back to Presence-Only Validation, Per Field

For each of `tipo`/`estado`, when `convencion.modo: "estricto"` is set but that field's corresponding taxonomy (`convencion.tipos`/`convencion.estados`) is not declared, the system MUST validate only that the field is present and non-empty; any non-empty value MUST be accepted. This fallback is evaluated independently per field — one taxonomy being declared does not affect the fallback for the other. `modulo` has no taxonomy to declare and MUST always follow this presence-only rule.

#### Scenario: Estricto with no declared tipos, non-empty value

- GIVEN `convencion.modo: "estricto"` and no `convencion.tipos` declared
- WHEN a document has `tipo: "anything"`
- THEN the document is accepted

#### Scenario: Estricto with no declared tipos, missing value

- GIVEN `convencion.modo: "estricto"` and no `convencion.tipos` declared
- WHEN a document has no `tipo` field (or an empty string)
- THEN the document is skipped and reported in `omitidos`

#### Scenario: Estricto, missing modulo

- GIVEN `convencion.modo: "estricto"` (`modulo` has no taxonomy and is always presence-only)
- WHEN a document has no `modulo` field (or an empty string), regardless of whether `tipo`/`estado` are otherwise valid
- THEN the document is skipped and reported in `omitidos`

### Requirement: `estricto` Requires an H1 Title, With No Filename Fallback

Under `convencion.modo: "estricto"`, `titulo` MUST come from the document's H1 heading. A document with no H1 MUST be reported in `omitidos`. The `libre` filename-humanization fallback MUST NOT apply under `estricto` — `estricto` performs no inference of any kind, only validation.

#### Scenario: Document with no H1 is skipped under estricto

- GIVEN a document with no H1 heading, otherwise satisfying all declared `tipo`/`modulo`/`estado` requirements
- WHEN indexed under `estricto`
- THEN the document is skipped and reported in `omitidos`, and `titulo` is NOT humanized from the filename

### Requirement: Field Inference in `libre` Mode

The system MUST infer `titulo` and `modulo` when not otherwise supplied, and MUST NOT invent `tipo`/`estado`. A frontmatter field that is present but empty (an empty string, or YAML `null`) MUST be treated exactly as absent for `tipo`, `modulo`, and `estado`: `tipo`/`estado` stay absent, and `modulo` falls through to folder-segment inference.

| Field | Inference source | Fallback |
|---|---|---|
| `titulo` | First H1 | Humanized filename |
| `resumen` | First paragraph | Unchanged existing behavior |
| `modulo` | First path segment under `docsDir` | Absent for root-level files |
| `tipo` | None | Absent unless frontmatter/mapping supplies it |
| `estado` | None | Absent unless frontmatter/mapping supplies it |

#### Scenario: No H1 present

- GIVEN a `.md` file with no H1 heading
- WHEN indexed under `libre`
- THEN `titulo` is set to a humanized version of the filename

#### Scenario: Humanized filename, concrete example

- GIVEN a file at `docs/mi-guia_de-uso.md` with no H1
- WHEN indexed under `libre`
- THEN `titulo` resolves to `"Mi guia de uso"` (strip `.md`, replace `-`/`_` with spaces, collapse and trim whitespace, sentence-case the first letter)

#### Scenario: Empty-string frontmatter treated as absent

- GIVEN `docsDir: "docs"`, a file at `docs/auth/login.md`, and frontmatter `modulo: ""`
- WHEN indexed under `libre`
- THEN `modulo` resolves to `"auth"` via folder inference, not the empty string

#### Scenario: Empty tipo/estado frontmatter treated as absent

- GIVEN a document with frontmatter `tipo: ""` and `estado: null`
- WHEN indexed under `libre`
- THEN `tipo` and `estado` are both absent, not empty strings

#### Scenario: `modulo` from folder segment

- GIVEN `docsDir: "docs"` and a file at `docs/auth/login.md`
- WHEN indexed under `libre`
- THEN `modulo` resolves to `"auth"`

#### Scenario: Root-level file has no modulo

- GIVEN `docsDir: "docs"` and a file at `docs/readme.md`
- WHEN indexed under `libre`
- THEN `modulo` is absent

#### Scenario: Frontmatter wins over inference

- GIVEN `docsDir: "docs"`, a file at `docs/auth/login.md`, and frontmatter `modulo: "identity"`
- WHEN indexed under `libre`
- THEN `modulo` resolves to `"identity"`, not `"auth"`

### Requirement: Optional Persisted Metadata

`DocumentMeta.tipo`/`.modulo`/`.estado` MUST be optional strings, not closed unions. The corresponding SQLite columns MUST be nullable. Every `compendio index` run MUST guarantee the current schema — including against a database file created by a prior version with `NOT NULL` `tipo`/`modulo`/`estado` columns — without requiring the user to manually delete `.compendio/`. The system MUST NOT provide separate migration tooling beyond this guarantee.

#### Scenario: Absent fields persist as NULL

- GIVEN a document indexed with no `tipo`
- WHEN the SQLite row is written
- THEN the `tipo` column is `NULL`

#### Scenario: Pre-existing database with the old NOT NULL schema is upgraded in place

- GIVEN a `.compendio/compendio.db` created by a prior version, with `NOT NULL` `tipo`/`modulo`/`estado` columns
- WHEN `compendio index` runs against a corpus containing a frontmatter-less document
- THEN the schema is dropped and recreated with nullable columns, and the document is indexed successfully — with no manual deletion of `.compendio/` required

### Requirement: Concurrent Readers During `compendio index` Are Out of Scope

Concurrent access from another process (e.g. a long-lived `compendio serve`, or a concurrent CLI reader) while a `compendio index` run is in flight is a declared non-goal: it is OUT OF SCOPE / best-effort. Because `reset()`'s schema drop-and-recreate runs inside a single transaction, a concurrent reader MAY observe empty results or a transient error (e.g. "no such table") for the duration of that transaction; the single transaction minimizes but does not eliminate this window. The supported behavior for a concurrent reader is to re-run the query after the `compendio index` run completes.

#### Scenario: Concurrent reader during an in-flight index run

- GIVEN a long-lived `compendio serve` process (or another CLI reader) querying the index
- WHEN a separate `compendio index` run's `reset()` transaction is in flight
- THEN the concurrent reader MAY observe empty results or a transient error, and retrying the query after the `index` run completes MUST return correct results
