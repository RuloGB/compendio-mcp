# Delta for MCP Contract

## ADDED Requirements

### Requirement: Sync-Status Visibility in `docs_overview` Response

The `docs_overview` MCP tool response MUST include a `sincronizacion` field surfacing the outcome of the most recent incremental sync pass: at minimum, any `omitidos` (documents skipped, with reasons) and any `avisoEmbeddings` degradation notice produced by that pass. The field MUST be omitted when the most recent sync pass had nothing to report (no skips, no degradation), consistent with the project's convention of omitting empty/absent fields rather than rendering placeholders.

#### Scenario: Sync pass skipped a document

- GIVEN the most recent incremental sync pass reported a document in `omitidos`
- WHEN `docs_overview` is called
- THEN its response's `sincronizacion` field surfaces that skip and its reason to the calling agent

#### Scenario: Sync pass had nothing to report

- GIVEN the most recent incremental sync pass skipped no documents and hit no embeddings degradation
- WHEN `docs_overview` is called
- THEN the response omits the `sincronizacion` field rather than rendering it empty

#### Scenario: Embeddings degrade during an incremental sync

- GIVEN the embeddings provider fails during an incremental sync pass, forcing lexical-only mode
- WHEN `docs_overview` is called afterward
- THEN its `sincronizacion` field surfaces the resulting `avisoEmbeddings`, matching how the CLI already reports `avisoEmbeddings` for `compendio index`
