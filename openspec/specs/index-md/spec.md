# Delta for Index-MD

## ADDED Requirements

### Requirement: Default Alphabetical Ordering in `libre` Mode

Under `convencion.modo: "libre"` (or no config), `INDEX.md` generation MUST order entries alphabetically by `ruta`.

#### Scenario: Mixed corpus, libre mode

- GIVEN a corpus indexed under `libre` with documents at various paths
- WHEN `compendio index-md` runs
- THEN entries appear in ascending alphabetical order of `ruta`

### Requirement: Declared-Taxonomy Ordering in `estricto` Mode

Under `convencion.modo: "estricto"` with a declared `convencion.tipos` list, `INDEX.md` generation MUST order entries following the declared `tipos` sequence, falling back to alphabetical order by `ruta` within each `tipo` group.

#### Scenario: Estricto with declared tipos order

- GIVEN `convencion.tipos: ["adr", "guia"]` and documents of both tipos
- WHEN `compendio index-md` runs
- THEN all `"adr"` entries precede all `"guia"` entries, matching the declared order

#### Scenario: Estricto with no declared tipos

- GIVEN `convencion.modo: "estricto"` and no `convencion.tipos` declared
- WHEN `compendio index-md` runs
- THEN entries fall back to alphabetical ordering by `ruta`

### Requirement: Per-Document Line Omits Absent `tipo`/`estado` Segments

The per-document line rendered by `INDEX.md` generation (the shared line format also used by `docs_overview`) MUST omit the `[tipo]` bracket segment entirely when `tipo` is absent, and MUST omit the `(estado)` parenthesized segment entirely when `estado` is absent. The system MUST NOT render `[undefined]`, empty brackets, or any placeholder text in either segment's place.

#### Scenario: Document with no tipo and no estado

- GIVEN a document with no `tipo` and no `estado`
- WHEN `INDEX.md` renders that document's line
- THEN the line contains neither a `[...]` segment nor a `(...)` segment for those fields — never `[undefined]` or empty brackets

#### Scenario: Document with tipo but no estado

- GIVEN a document with `tipo: "guia"` and no `estado`
- WHEN `INDEX.md` renders that document's line
- THEN the line includes the `[guia]` segment and omits the `(estado)` segment entirely

### Requirement: Skip-and-Report Resilience Matches Indexing

`compendio index-md` MUST apply the same per-file resilience guarantees as `compendio index` (see the Indexing spec's "Resilience Skip Reasons Apply in Both Modes" requirement): a file that is unreadable, or that fails markdown/frontmatter parsing, MUST be reported in `omitidos` with its error message, and generation MUST continue with the remaining files rather than aborting the run. These resilience reasons are mode-independent — they apply identically whether `convencion.modo` is `libre` or `estricto`, ahead of and regardless of any mode-specific metadata validation.

#### Scenario: Malformed frontmatter is skipped during index-md generation

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse
- WHEN `compendio index-md` runs
- THEN the file is reported in `omitidos` with its error message, and `INDEX.md` is generated from the remaining files

#### Scenario: Malformed frontmatter is skipped during index-md generation, under estricto too

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse and `convencion.modo: "estricto"` is configured
- WHEN `compendio index-md` runs
- THEN the file is reported in `omitidos` with its error message, and `INDEX.md` is generated from the remaining files — identically to how it would be handled under `libre`

#### Scenario: Unreadable file is skipped during index-md generation, under estricto too

- GIVEN a `.md` file that cannot be read (an I/O error occurs while reading its content) and `convencion.modo: "estricto"` is configured
- WHEN `compendio index-md` runs
- THEN the file is reported in `omitidos` with its error message, and `INDEX.md` is generated from the remaining files

### Requirement: No Compatibility Ordering Path

The system MUST NOT preserve a legacy `TIPOS`-indexOf ordering path as a fallback or compatibility mode. Since no installed base of `docs/INDEX.md` files exists in production, the alphabetical/declared-taxonomy rules above are the only orderings the system MUST support.

#### Scenario: Re-running index-md on an existing file

- GIVEN an existing `docs/INDEX.md` generated under the retired convention
- WHEN `compendio index-md` runs again under the new rules
- THEN the file is regenerated and re-sorted per the applicable rule above, with no attempt to preserve the previous ordering
