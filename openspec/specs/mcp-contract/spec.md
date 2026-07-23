# Delta for MCP Contract

## ADDED Requirements

### Requirement: Open `tipo` Across MCP Tool and CLI

The MCP `search_docs` tool's `tipo` parameter MUST be an optional open string (no enum). The CLI `--tipo` flag MUST accept any string value and MUST NOT exit with a non-zero code for a value outside any declared taxonomy; it MAY emit a warning.

#### Scenario: MCP accepts an arbitrary tipo value

- GIVEN a running MCP server
- WHEN `search_docs` is called with `tipo: "playbook"`
- THEN the call succeeds and schema validation does not reject the value

#### Scenario: CLI warns but does not fail

- GIVEN the CLI is invoked with `--tipo notarealtype`
- WHEN the command runs
- THEN the process does not call `process.exit(2)` and MAY print a warning

### Requirement: Conditional Frontmatter Rendering in `read_doc`

`read_doc`'s rendered header MUST include a `tipo:`, `modulo:`, or `estado:` line only when that field is present on the document. Absent fields MUST be omitted from the rendered output, never shown as empty or placeholder values.

#### Scenario: Document with no modulo

- GIVEN a document with `tipo` and `estado` set but no `modulo`
- WHEN `read_doc` renders the header
- THEN the header includes `tipo:` and `estado:` lines and no `modulo:` line

#### Scenario: Document with none of the three fields

- GIVEN a document with no `tipo`, `modulo`, or `estado`
- WHEN `read_doc` renders the header
- THEN none of those three lines appear in the rendered output

### Requirement: `search_docs` Omits Absent `estado` from Result Items

When a matched document has no `estado`, the corresponding `search_docs` result item MUST omit the `estado` field (or leave it absent) rather than rendering an empty string or a placeholder value.

#### Scenario: Result item for a document with no estado

- GIVEN a matched document with no `estado`
- WHEN `search_docs` returns its result items
- THEN the item for that document has no `estado` field, never `estado: ""` or a placeholder value

### Requirement: `docs_overview` Per-Document Line Omits Absent `tipo`/`estado` Segments

`docs_overview`'s per-document text line (the shared line format also used by `INDEX.md` generation) MUST omit the `[tipo]` bracket segment entirely when `tipo` is absent, and MUST omit the `(estado)` parenthesized segment entirely when `estado` is absent. The system MUST NOT render `[undefined]`, empty brackets, or any placeholder text in either segment's place. Per-document lines MUST be ordered alphabetically by `ruta`.

#### Scenario: Document with no tipo and no estado in the docs_overview line

- GIVEN a document with no `tipo` and no `estado`
- WHEN `docs_overview` renders that document's line
- THEN the line contains neither a `[...]` segment nor a `(...)` segment for those fields — never `[undefined]` or empty brackets

#### Scenario: Document with tipo but no estado in the docs_overview line

- GIVEN a document with `tipo: "guia"` and no `estado`
- WHEN `docs_overview` renders that document's line
- THEN the line includes the `[guia]` segment and omits the `(estado)` segment entirely

#### Scenario: Per-document lines ordered alphabetically by ruta

- GIVEN a corpus with documents at various paths, some with `tipo` absent
- WHEN `docs_overview` renders its per-document lines
- THEN the lines appear in ascending alphabetical order of `ruta`

### Requirement: `docs_overview` Omits Empty Taxonomy Buckets

`docs_overview`'s rendered text output MUST omit the "Por tipo:" line entirely when no document in the corpus defines a `tipo`, and MUST omit the "Por modulo:" line entirely when no document defines a `modulo`. The system MUST NOT synthesize a "sin tipo"/"sin modulo" catch-all bucket, and MUST NOT render either line as empty (e.g. `Por tipo: —`) when there is nothing to report. This applies to both the MCP `docs_overview` tool's text response and the CLI's `overview` command, since both render through the same `formatOverview`/`formatCounts` functions.

#### Scenario: Corpus with no tipo anywhere

- GIVEN a corpus where no document defines `tipo`
- WHEN `docs_overview` is called
- THEN the rendered output contains no "Por tipo:" line at all

#### Scenario: Corpus with partial tipo coverage

- GIVEN a corpus where some documents define `tipo` and others do not
- WHEN `docs_overview` is called
- THEN the "Por tipo:" line includes counts only for documents that define a `tipo`; documents without `tipo` are not counted in any synthetic bucket, and the rendered line MUST NOT contain the literal text "undefined"
