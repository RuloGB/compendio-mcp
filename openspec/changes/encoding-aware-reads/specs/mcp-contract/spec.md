# Delta for MCP Contract

## MODIFIED Requirements

### Requirement: Sync-Status Visibility in `docs_overview` Response

The `docs_overview` MCP tool response MUST include a `sync` field surfacing the outcome of the most recent incremental sync pass: any `skipped` (documents skipped, with reasons), any `embeddingsWarning` degradation notice, and any encoding-transcoding notices (which documents were transcoded from a non-UTF-8 encoding during that pass, even when the transcode was exact) produced by that pass. These three are the field's guaranteed content, not an open-ended "at minimum" left to interpretation. The field MUST be omitted only when the most recent sync pass had nothing to report across all three — no skips, no embeddings degradation, and no transcoded documents — consistent with the project's convention of omitting empty/absent fields rather than rendering placeholders.
(Previously: guaranteed only `skipped` and `embeddingsWarning` "at minimum", leaving the encoding notice's inclusion to an untested reading of that phrase. This delta makes it a named, guaranteed third component.)

#### Scenario: Sync pass skipped a document

- GIVEN the most recent incremental sync pass reported a document in `skipped`
- WHEN `docs_overview` is called
- THEN its response's `sync` field surfaces that skip and its reason to the calling agent

#### Scenario: Sync pass had nothing to report

- GIVEN the most recent incremental sync pass skipped no documents, hit no embeddings degradation, and transcoded no documents
- WHEN `docs_overview` is called
- THEN the response omits the `sync` field rather than rendering it empty

#### Scenario: Embeddings degrade during an incremental sync

- GIVEN the embeddings provider fails during an incremental sync pass, forcing lexical-only mode
- WHEN `docs_overview` is called afterward
- THEN its `sync` field surfaces the resulting `embeddingsWarning`, matching how the CLI already reports `embeddingsWarning` for `compendio index`

#### Scenario: Sync pass transcoded a document

- GIVEN the most recent incremental sync pass decoded a CP1252 document via the fallback path, even though the decode was exact
- WHEN `docs_overview` is called
- THEN its `sync` field surfaces that document as transcoded — distinct from `skipped`, since the document was indexed successfully rather than skipped
