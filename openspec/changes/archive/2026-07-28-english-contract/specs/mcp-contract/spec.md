# Delta for MCP Contract

## ADDED Requirements

### Requirement: Renamed MCP Tool Signatures And Response Field Names

The `search_docs` tool MUST accept `{ query, type?, module?, tags?, k?, include_excluded? }`. The `read_doc` tool MUST accept `{ path, section? }`. The `docs_overview` tool MUST accept no parameters. Every param and response field this domain's other requirements reference (`path`, `title`, `section`, `excerpt`, `status`, `score`, `mode: "hybrid" | "lexical"`, `indexed`, `skipped`, `deleted`, `embeddingsWarning`, `byType`, `byModule`, `syncStatus`) MUST use its English form; the three tool names (`docs_overview`, `search_docs`, `read_doc`) are already English and unchanged. No retired Spanish param or field name (`tipo`, `modulo`, `etiquetas`, `ruta`, `seccion`, `incluir_no_vigentes`, `omitidos`, `indexados`, `avisoEmbeddings`) MUST remain reachable through any tool call or response.

#### Scenario: Full call with renamed params succeeds

- GIVEN a running MCP server
- WHEN `search_docs` is called with `{ query: "auth", type: "guide", module: "identity", tags: ["security"], k: 5, include_excluded: false }`
- THEN the call succeeds and every field is interpreted under its English name, with ranking behavior identical to the pre-rename contract

#### Scenario: Retired Spanish param names are not recognized

- GIVEN a running MCP server
- WHEN `search_docs` is called with a payload using `tipo`/`modulo`/`etiquetas`/`incluir_no_vigentes` instead of their English equivalents
- THEN those keys are not recognized as filters — the call behaves as if no such filter were supplied, since the retired Zod keys no longer exist on the schema

### Requirement: Unknown `path` Suggests the 3 Closest Matches

When `read_doc` is called with a `path` that does not match any indexed document, the system MUST respond with the 3 closest matching paths instead of raising an error. This behavior predates this change and is unaffected by the rename — it is stated here because the suggestion payload now carries `path` fields under their English name.

#### Scenario: Unknown path returns closest matches instead of an error

- GIVEN a corpus with no document at `docs/authh/login.md`
- WHEN `read_doc` is called with `path: "docs/authh/login.md"`
- THEN the response returns the 3 closest matching `path` values rather than throwing an error

## MODIFIED Requirements

### Requirement: Open `type` Across MCP Tool and CLI

The MCP `search_docs` tool's `type` parameter MUST be an optional open string (no enum). The CLI `--type` flag MUST accept any string value and MUST NOT exit with a non-zero code for a value outside any declared taxonomy; it MAY emit a warning.
(Previously: Spanish `tipo` param / `--tipo` flag)

#### Scenario: MCP accepts an arbitrary type value

- GIVEN a running MCP server
- WHEN `search_docs` is called with `type: "playbook"`
- THEN the call succeeds and schema validation does not reject the value

#### Scenario: CLI warns but does not fail

- GIVEN the CLI is invoked with `--type notarealtype`
- WHEN the command runs
- THEN the process does not call `process.exit(2)` and MAY print a warning

### Requirement: Conditional Frontmatter Rendering in `read_doc`

`read_doc`'s rendered header MUST include a `type:`, `module:`, or `status:` line only when that field is present on the document. Absent fields MUST be omitted from the rendered output, never shown as empty or placeholder values.
(Previously: Spanish `tipo:`/`modulo:`/`estado:` header lines)

#### Scenario: Document with no module

- GIVEN a document with `type` and `status` set but no `module`
- WHEN `read_doc` renders the header
- THEN the header includes `type:` and `status:` lines and no `module:` line

#### Scenario: Document with none of the three fields

- GIVEN a document with no `type`, `module`, or `status`
- WHEN `read_doc` renders the header
- THEN none of those three lines appear in the rendered output

### Requirement: `search_docs` Omits Absent `status` from Result Items

When a matched document has no `status`, the corresponding `search_docs` result item MUST omit the `status` field (or leave it absent) rather than rendering an empty string or a placeholder value.
(Previously: Spanish `estado` field)

#### Scenario: Result item for a document with no status

- GIVEN a matched document with no `status`
- WHEN `search_docs` returns its result items
- THEN the item for that document has no `status` field, never `status: ""` or a placeholder value

### Requirement: `docs_overview` Per-Document Line Omits Absent `type`/`status` Segments

`docs_overview`'s per-document text line (the shared line format also used by `INDEX.md` generation) MUST omit the `[type]` bracket segment entirely when `type` is absent, and MUST omit the `(status)` parenthesized segment entirely when `status` is absent. The system MUST NOT render `[undefined]`, empty brackets, or any placeholder text in either segment's place. Per-document lines MUST be ordered alphabetically by `path`.
(Previously: Spanish `[tipo]`/`(estado)` segments, ordered by `ruta`)

#### Scenario: Document with no type and no status in the docs_overview line

- GIVEN a document with no `type` and no `status`
- WHEN `docs_overview` renders that document's line
- THEN the line contains neither a `[...]` segment nor a `(...)` segment for those fields — never `[undefined]` or empty brackets

#### Scenario: Document with type but no status in the docs_overview line

- GIVEN a document with `type: "guide"` and no `status`
- WHEN `docs_overview` renders that document's line
- THEN the line includes the `[guide]` segment and omits the `(status)` segment entirely

#### Scenario: Per-document lines ordered alphabetically by path

- GIVEN a corpus with documents at various paths, some with `type` absent
- WHEN `docs_overview` renders its per-document lines
- THEN the lines appear in ascending alphabetical order of `path`

### Requirement: `docs_overview` Omits Empty Taxonomy Buckets

`docs_overview`'s rendered text output MUST omit the "By type:" line entirely when no document in the corpus defines a `type`, and MUST omit the "By module:" line entirely when no document defines a `module`. The system MUST NOT synthesize a "no type"/"no module" catch-all bucket, and MUST NOT render either line as empty (e.g. `By type: —`) when there is nothing to report. This applies to both the MCP `docs_overview` tool's text response and the CLI's `overview` command, since both render through the same `formatOverview`/`formatCounts` functions over the `byType`/`byModule` buckets.
(Previously: Spanish "Por tipo:"/"Por modulo:" lines over `porTipo`/`porModulo` buckets)

#### Scenario: Corpus with no type anywhere

- GIVEN a corpus where no document defines `type`
- WHEN `docs_overview` is called
- THEN the rendered output contains no "By type:" line at all

#### Scenario: Corpus with partial type coverage

- GIVEN a corpus where some documents define `type` and others do not
- WHEN `docs_overview` is called
- THEN the "By type:" line includes counts only for documents that define a `type`; documents without `type` are not counted in any synthetic bucket, and the rendered line MUST NOT contain the literal text "undefined"

### Requirement: Sync-Status Visibility in `docs_overview` Response

The `docs_overview` MCP tool response MUST include a `syncStatus` field surfacing the outcome of the most recent incremental sync pass: at minimum, any `skipped` (documents skipped, with reasons) and any `embeddingsWarning` degradation notice produced by that pass. The field MUST be omitted when the most recent sync pass had nothing to report (no skips, no degradation), consistent with the project's convention of omitting empty/absent fields rather than rendering placeholders.
(Previously: `sincronizacion` field surfacing `omitidos`/`avisoEmbeddings`)

#### Scenario: Sync pass skipped a document

- GIVEN the most recent incremental sync pass reported a document in `skipped`
- WHEN `docs_overview` is called
- THEN its response's `syncStatus` field surfaces that skip and its reason to the calling agent

#### Scenario: Sync pass had nothing to report

- GIVEN the most recent incremental sync pass skipped no documents and hit no embeddings degradation
- WHEN `docs_overview` is called
- THEN the response omits the `syncStatus` field rather than rendering it empty

#### Scenario: Embeddings degrade during an incremental sync

- GIVEN the embeddings provider fails during an incremental sync pass, forcing lexical-only mode
- WHEN `docs_overview` is called afterward
- THEN its `syncStatus` field surfaces the resulting `embeddingsWarning`, matching how the CLI already reports `embeddingsWarning` for `compendio index`
