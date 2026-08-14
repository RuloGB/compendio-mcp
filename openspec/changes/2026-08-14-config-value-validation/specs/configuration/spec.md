# Delta for Configuration

## ADDED Requirements

### Requirement: Declared Numeric Configuration Values Are Validated

The system MUST validate `chunk.minTokens`, `chunk.maxTokens`, and `search.k` with the same policy `sync.throttleMs` already applies: a declared value is honored only when it is a finite number greater than zero; otherwise it MUST be treated the same as an absent key and fall back to that key's default. `search.k` additionally MUST be a whole number: a non-integer declared value (e.g. `5.01`) MUST fall back to the default, because both input adapters that accept a per-call `k` already require an integer, and a non-integer default reaches the vector store's integer-typed candidate-count constraint. No key clamps to a floor or ceiling — any finite positive value, however small, MUST be accepted.

| Declared value | Outcome |
|---|---|
| non-numeric (incl. a quoted number), `null`, boolean, array, object | falls back to default |
| `0`, negative, `Infinity` (e.g. `1e400`) | falls back to default |
| `search.k` non-integer (e.g. `5.01`) | falls back to default |
| any finite positive value (incl. `1`) | honored, never clamped |

#### Scenario: An invalid `chunk.maxTokens` falls back without exploding chunking

- GIVEN `compendio.config.json` declares `chunk.maxTokens` as `0`, `null`, `"abc"`, or the quoted number `"600"`
- WHEN documents are indexed
- THEN `chunk.maxTokens` resolves to `480`, and no emitted chunk exceeds `480` tokens

#### Scenario: `search.k` falls back when invalid or non-integer

- GIVEN `compendio.config.json` declares `search.k` as `0`, `"abc"`, or `5.01`
- WHEN a `search_docs` call omits `k`
- THEN `search.k` resolves to its default, and the call returns results for a matching query rather than an empty or erroring result

#### Scenario: A valid value is honored, never clamped

- GIVEN `chunk.maxTokens: 1`, `search.k: 3`, or `sync.throttleMs: 100` are declared
- WHEN config is loaded
- THEN each resolves exactly as declared

### Requirement: Config Load Reports Invalid Values and Unrecognized Keys

When `loadConfig` falls back an invalid declared numeric value, ignores a key not recognized under `chunk`, `embeddings`, `search`, or `convention.frontmatterFields`, or observes `chunk.minTokens` declared greater than `chunk.maxTokens` (both individually valid, neither corrected), the system MUST report that fact — this contract pins only that a report is produced and where it surfaces (CLI stderr; the `docs_overview` MCP tool), never the rendered wording. A config declaring no invalid value, no unrecognized key, and no inverted `chunk.minTokens`/`chunk.maxTokens` pair MUST produce no report at all, including a project with no `compendio.config.json` file. Config-load reporting MUST NOT appear in `search_docs` responses.

#### Scenario: An invalid value is reported

- GIVEN `compendio.config.json` declares an invalid `chunk.maxTokens`
- WHEN `compendio index` runs or `compendio serve` starts
- THEN a report naming `chunk.maxTokens` appears on CLI stderr

#### Scenario: An unrecognized key is reported instead of silently ignored

- GIVEN `compendio.config.json` declares `chunk.maxtokens` (wrong case) or `search.excludedStatuses`
- WHEN config is loaded
- THEN the key is absent from the loaded config, exactly as before, and its presence is reported

#### Scenario: An inverted `chunk.minTokens`/`chunk.maxTokens` pair is reported, not corrected

- GIVEN `compendio.config.json` declares `chunk.minTokens` greater than `chunk.maxTokens`
- WHEN config is loaded
- THEN both declared values are honored unchanged — neither swapped, dropped, nor reset — and the pair is reported

#### Scenario: A clean config reports nothing

- GIVEN a project with no `compendio.config.json`, or one declaring only valid, recognized keys with `chunk.minTokens` at or below `chunk.maxTokens`
- WHEN `compendio index`, `compendio serve`, or `docs_overview` runs
- THEN CLI stderr carries no report and `docs_overview` renders no configuration-warning content

## MODIFIED Requirements

### Requirement: Default `chunk.maxTokens` Is 480 and Is a Guaranteed Upper Bound

The system MUST default `chunk.maxTokens` to `480` when not overridden in `compendio.config.json`, replacing the previous default of `800`. This value MUST be honored as a guaranteed upper bound on every emitted chunk (see Indexing spec's chunk-size-bound requirements) — not merely a hint that heading-based descent may exceed. The value 480 keeps margin below the measured ~500-token effective model window, since `estimateTokens` (`chars/4`) under-counts non-English prose (e.g. Spanish) relative to its true token count. The bound MUST hold against a validated `chunk.maxTokens`: an invalid declared value MUST fall back to 480 (or to another validated override) rather than defeat the bound (see "Declared Numeric Configuration Values Are Validated").
(Previously: the bound requirement did not account for an invalid declared `chunk.maxTokens` — a value such as `0` or `NaN` made the guarantee unreachable, since every relational comparison against it was false.)

#### Scenario: No config file or no declared `chunk` block defaults to 480

- GIVEN a project with no `compendio.config.json`, or one that does not declare a `chunk` block
- WHEN config is loaded
- THEN `chunk.maxTokens` resolves to `480`

#### Scenario: A declared `chunk.maxTokens` overrides the default but stays a guaranteed bound

- GIVEN `compendio.config.json` declaring `{ "chunk": { "maxTokens": 600 } }`
- WHEN config is loaded and documents are indexed
- THEN `chunk.maxTokens` resolves to `600`, and no chunk emitted during indexing exceeds `600` tokens

#### Scenario: An invalid declared `chunk.maxTokens` cannot defeat the bound

- GIVEN `compendio.config.json` declares `chunk.maxTokens` as `0`
- WHEN config is loaded and documents are indexed
- THEN `chunk.maxTokens` resolves to `480`, and no emitted chunk exceeds `480` tokens — not one chunk per code point

### Requirement: `sync` Configuration Section With a Per-Project Throttle Default

The system MUST accept an optional `sync` block in `compendio.config.json` with a `throttleMs` key controlling the minimum interval between throttled incremental sync passes (see Indexing spec). When the block or the key is absent, the system MUST default `sync.throttleMs` to `30000` (30 seconds), following the project's existing "every key has a default" convention. A declared `throttleMs` that is not a finite positive number (non-numeric, negative, or `0`) MUST be treated the same as an absent key, MUST fall back to the default `30000`, and MUST be reported (see "Config Load Reports Invalid Values and Unrecognized Keys"); any finite positive value, however small, MUST be accepted, with the tradeoff (more frequent per-call filesystem diffs) left to the project's choice.
(Previously: an invalid `throttleMs` fell back silently, with no reporting obligation.)

#### Scenario: No `sync` block declared

- GIVEN a `compendio.config.json` with no `sync` block
- WHEN `compendio serve` starts
- THEN the throttled sync check uses the default 30-second interval

#### Scenario: Custom throttle declared

- GIVEN `compendio.config.json` containing `{ "sync": { "throttleMs": 60000 } }`
- WHEN `compendio serve` starts
- THEN the throttled sync check uses a 60-second interval instead of the default

#### Scenario: Invalid throttle value falls back to the default and is reported

- GIVEN `compendio.config.json` containing a `sync.throttleMs` value that is non-numeric, negative, or `0`
- WHEN `compendio serve` starts
- THEN the throttled sync check uses the default 30-second interval instead of the invalid value, and the fallback is reported

### Requirement: `excludedStatuses` Lives Under `convention`

The system MUST read the search-exclusion list from `convention.excludedStatuses`. The system MUST NOT read a `search.excludedStatuses` key — that key is retired without a compatibility shim.

#### Scenario: Legacy key has no effect

- GIVEN a config with `search.excludedStatuses: ["draft"]` and no `convention.excludedStatuses`
- WHEN search runs
- THEN no `status` is excluded from results

#### Scenario: Legacy key is silently dropped from the config, but its presence is reported

- GIVEN a config with `search.excludedStatuses: ["draft"]` present
- WHEN the config is loaded
- THEN `mergeConfig` builds `search` from an explicit whitelist of recognized keys (currently only `k`), so `excludedStatuses` never reaches the returned config and is not honored — no compatibility shim is added — and its presence is reported as an unrecognized key, exactly as any other unrecognized key under a whitelisted branch is
(Previously: asserted that no deprecation warning is emitted for this key; superseded once config-load reporting covers unrecognized keys generally — there is no special case carved out for this one.)
