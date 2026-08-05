# Delta for Configuration

## ADDED Requirements

### Requirement: Default `chunk.maxTokens` Is 480 and Is a Guaranteed Upper Bound

The system MUST default `chunk.maxTokens` to `480` when not overridden in `compendio.config.json`, replacing the previous default of `800`. This value MUST be honored as a guaranteed upper bound on every emitted chunk (see Indexing spec's chunk-size-bound requirements) — not merely a hint that heading-based descent may exceed. The value 480 keeps margin below the measured ~500-token effective model window, since `estimateTokens` (`chars/4`) under-counts non-English prose (e.g. Spanish) relative to its true token count.

#### Scenario: No config file or no declared `chunk` block defaults to 480

- GIVEN a project with no `compendio.config.json`, or one that does not declare a `chunk` block
- WHEN config is loaded
- THEN `chunk.maxTokens` resolves to `480`

#### Scenario: A declared `chunk.maxTokens` overrides the default but stays a guaranteed bound

- GIVEN `compendio.config.json` declaring `{ "chunk": { "maxTokens": 600 } }`
- WHEN config is loaded and documents are indexed
- THEN `chunk.maxTokens` resolves to `600`, and no chunk emitted during indexing exceeds `600` tokens
