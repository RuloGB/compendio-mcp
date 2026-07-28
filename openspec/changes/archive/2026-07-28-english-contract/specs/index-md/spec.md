# Delta for Index-MD

## MODIFIED Requirements

### Requirement: Default Alphabetical Ordering in `loose` Mode

Under `convention.mode: "loose"` (or no config), `INDEX.md` generation MUST order entries alphabetically by `path`.
(Previously: Spanish `convencion.modo: "libre"`, ordered by `ruta`)

#### Scenario: Mixed corpus, loose mode

- GIVEN a corpus indexed under `loose` with documents at various paths
- WHEN `compendio index-md` runs
- THEN entries appear in ascending alphabetical order of `path`

### Requirement: Declared-Taxonomy Ordering in `strict` Mode

Under `convention.mode: "strict"` with a declared `convention.types` list, `INDEX.md` generation MUST order entries following the declared `types` sequence, falling back to alphabetical order by `path` within each `type` group.
(Previously: Spanish `estricto` mode, `convencion.tipos`, ordered by `ruta`)

#### Scenario: Strict with declared types order

- GIVEN `convention.types: ["adr", "guide"]` and documents of both types
- WHEN `compendio index-md` runs
- THEN all `"adr"` entries precede all `"guide"` entries, matching the declared order

#### Scenario: Strict with no declared types

- GIVEN `convention.mode: "strict"` and no `convention.types` declared
- WHEN `compendio index-md` runs
- THEN entries fall back to alphabetical ordering by `path`

### Requirement: Per-Document Line Omits Absent `type`/`status` Segments

The per-document line rendered by `INDEX.md` generation (the shared line format also used by `docs_overview`) MUST omit the `[type]` bracket segment entirely when `type` is absent, and MUST omit the `(status)` parenthesized segment entirely when `status` is absent. The system MUST NOT render `[undefined]`, empty brackets, or any placeholder text in either segment's place.
(Previously: Spanish `[tipo]`/`(estado)` segments)

#### Scenario: Document with no type and no status

- GIVEN a document with no `type` and no `status`
- WHEN `INDEX.md` renders that document's line
- THEN the line contains neither a `[...]` segment nor a `(...)` segment for those fields — never `[undefined]` or empty brackets

#### Scenario: Document with type but no status

- GIVEN a document with `type: "guide"` and no `status`
- WHEN `INDEX.md` renders that document's line
- THEN the line includes the `[guide]` segment and omits the `(status)` segment entirely

### Requirement: Skip-and-Report Resilience Matches Indexing

`compendio index-md` MUST apply the same per-file resilience guarantees as `compendio index` (see the Indexing spec's "Resilience Skip Reasons Apply in Both Modes" requirement): a file that is unreadable, or that fails markdown/frontmatter parsing, MUST be reported in `skipped` with its error message, and generation MUST continue with the remaining files rather than aborting the run. These resilience reasons are mode-independent — they apply identically whether `convention.mode` is `loose` or `strict`, ahead of and regardless of any mode-specific metadata validation.
(Previously: Spanish `omitidos` report, `convencion.modo`, `libre`/`estricto`)

#### Scenario: Malformed frontmatter is skipped during index-md generation

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse
- WHEN `compendio index-md` runs
- THEN the file is reported in `skipped` with its error message, and `INDEX.md` is generated from the remaining files

#### Scenario: Malformed frontmatter is skipped during index-md generation, under strict too

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse and `convention.mode: "strict"` is configured
- WHEN `compendio index-md` runs
- THEN the file is reported in `skipped` with its error message, and `INDEX.md` is generated from the remaining files — identically to how it would be handled under `loose`

#### Scenario: Unreadable file is skipped during index-md generation, under strict too

- GIVEN a `.md` file that cannot be read (an I/O error occurs while reading its content) and `convention.mode: "strict"` is configured
- WHEN `compendio index-md` runs
- THEN the file is reported in `skipped` with its error message, and `INDEX.md` is generated from the remaining files

### Requirement: No Compatibility Ordering Path

The system MUST NOT preserve a legacy `TYPES`-indexOf ordering path as a fallback or compatibility mode. Since no installed base of `docs/INDEX.md` files exists in production, the alphabetical/declared-taxonomy rules above are the only orderings the system MUST support.
(Previously: legacy `TIPOS`-indexOf reference)

#### Scenario: Re-running index-md on an existing file

- GIVEN an existing `docs/INDEX.md` generated under the retired convention
- WHEN `compendio index-md` runs again under the new rules
- THEN the file is regenerated and re-sorted per the applicable rule above, with no attempt to preserve the previous ordering
