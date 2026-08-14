# Delta for Configuration

## ADDED Requirements

### Requirement: `docsDir` Is a Non-Empty Array of Declared Roots

The system MUST accept `docsDir` only as a non-empty array of strings in `compendio.config.json`. There is no single-string form and no `multi` flag — a wrong-type `docsDir` value is not specially validated (config loading stays untyped by deliberate design), but the array shape is the only one this system's behavior is specified against. Each declared entry becomes one root; every discovered document `path` MUST be prefixed with that root's alias — the basename of the declared root's path (see Indexing spec for the prefixed-`path` contract). Aliases MUST NOT be a project-declarable config key. When `docsDir` is absent, the default MUST be `["docs"]`. A one-element array is not a special case: it runs through the same root-resolution and prefixing behavior as any other declared root count, including the default.

#### Scenario: No config file defaults to `["docs"]`, still prefixed

- GIVEN a project with no `compendio.config.json`
- WHEN `compendio index` runs
- THEN `docsDir` resolves to `["docs"]`, and every discovered `path` carries the `docs/` prefix — not the unprefixed shape a bare string `docsDir` produced before this change

#### Scenario: A one-element array behaves identically to any other array

- GIVEN `docsDir: ["docs"]` declared explicitly
- WHEN `compendio index` runs
- THEN every discovered `path` is prefixed with the `docs` alias (`docs/x.md`), identical in shape to the zero-config default

#### Scenario: A two-root array derives one alias per root

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `compendio index` runs
- THEN documents from the first root are prefixed `docs/...` and documents from the second are prefixed `openspec/...`

### Requirement: Colliding, Nested, Duplicate, or Empty Declared Root Sets Are Rejected at Construction

The system MUST reject the configuration — throwing before any document is discovered, chunked, or written to the index — when any of: (a) two declared roots resolve to the same absolute path, including a case-differing duplicate on a case-insensitive filesystem; (b) one declared root's absolute path is nested inside another declared root's absolute path, checked as an ordered pair in BOTH declaration orders (the outer root declared first, and the outer root declared second/inner-first); (c) the array contains duplicate entries; (d) two declared roots derive the same alias (basename collision); or (e) the array is empty. The thrown error MUST name the offending root(s). This validation MUST run at config load or container construction time, strictly before any existing index is reset or modified, and strictly before any `.compendio/` directory is created for a fresh project.

#### Scenario: Nested roots are rejected, outer root declared first

- GIVEN `docsDir: ["docs", "docs/adr"]`
- WHEN the container is constructed
- THEN construction throws naming both offending roots, and no existing `.compendio/compendio.db` is reset, dropped, or otherwise modified

#### Scenario: Nested roots are rejected, inner root declared first

- GIVEN `docsDir: ["docs/adr", "docs"]` (the inner root declared before its containing outer root)
- WHEN the container is constructed
- THEN construction throws naming both offending roots — a one-directional nesting check that only tests the first declaration order would miss this case

#### Scenario: Duplicate entries are rejected

- GIVEN `docsDir: ["docs", "docs"]`
- WHEN the container is constructed
- THEN construction throws naming the duplicated root

#### Scenario: A case-differing duplicate is rejected on a case-insensitive filesystem

- GIVEN `docsDir: ["Docs", "docs"]` on a case-insensitive filesystem (e.g. Windows), where both resolve to the same directory
- WHEN the container is constructed
- THEN construction throws naming both offending roots, exactly as the literal-duplicate case does

#### Scenario: An alias clash is rejected

- GIVEN `docsDir: ["a/docs", "b/docs"]` (both basenames are `docs`)
- WHEN the container is constructed
- THEN construction throws naming both roots and the colliding alias

#### Scenario: An empty declared root set is rejected

- GIVEN `docsDir: []`
- WHEN the container is constructed
- THEN construction throws

#### Scenario: A fresh project with an invalid root set gets no `.compendio/` directory at all

- GIVEN a fresh temp project with no pre-existing `.compendio/` directory, and a `docsDir` matching any rejection case above
- WHEN the container is constructed
- THEN construction throws before `.compendio/` is created, so no `.compendio/compendio.db` exists afterward

#### Scenario: A valid, non-colliding array is accepted

- GIVEN `docsDir: ["docs", "openspec"]`, two distinct, non-nested absolute paths with distinct aliases
- WHEN the container is constructed
- THEN construction succeeds

### Requirement: `exclude` Matches a Directory Prefix, Evaluated Against the Emitted (Prefixed) Path

The system MUST extend `exclude` entry matching beyond exact path/basename equality to also match a directory prefix: an entry excludes a discovered document when `entry === path`, `entry === basename`, or `path` starts with `entry + "/"`. This is not glob syntax — no wildcard, brace, or character-class matching is introduced. `exclude` entries MUST always be evaluated against the root-alias-prefixed `path` — the same shape that reaches `search_docs`, `docs_overview`, and `INDEX.md`. There is exactly one rule; it does not vary with how many roots are declared. An `exclude` entry written against an unprefixed root-relative form (e.g. `"changes/archive"` instead of `"openspec/changes/archive"`) MUST NOT match, since the emitted path it is compared against always carries the prefix.

#### Scenario: Directory-prefix exclude, matched against the prefixed path

- GIVEN `docsDir: ["docs", "openspec"]` and `exclude: ["openspec/changes/archive"]`
- WHEN files at `openspec/changes/archive/x/proposal.md` and `openspec/changes/other/y.md` are discovered
- THEN the first is excluded and the second is not

#### Scenario: Directory-prefix exclude works against the default single-root set too

- GIVEN `docsDir` defaults to `["docs"]` and `exclude: ["docs/archive"]`
- WHEN a file at `docs/archive/old.md` is discovered
- THEN it is excluded, along with every other file under `docs/archive/`

#### Scenario: Exact-match and basename exclusion are unchanged

- GIVEN `exclude: ["INDEX.md"]` (the default)
- WHEN a file named `INDEX.md` is discovered at any depth under any declared root
- THEN it is excluded, matching current behavior

### Requirement: `--dir` Replaces the Declared Root Set With One Directory

The `--dir <path>` CLI flag MUST normalize to a one-element root set, replacing whatever `docsDir` a project's `compendio.config.json` declares — it MUST NOT be merged with, or added to, the configured roots. The resulting single root MUST go through the same `docsDir` root-resolution and validation as any other declared root set, producing the same root-alias-prefixed `path` shape (`<dirname>/<root-relative path>`) it would if `--dir <path>`'s value had instead been declared as `docsDir: ["<path>"]`.

#### Scenario: `--dir` overrides a multi-root config with a single directory

- GIVEN a project whose `compendio.config.json` declares `docsDir: ["docs", "openspec"]`
- WHEN `compendio index --dir notes` runs
- THEN only `notes/` is indexed — `docs/` and `openspec/` are not consulted at all — and every indexed `path` carries the `notes/` prefix

#### Scenario: `--dir` produces the identical path shape as an equivalent one-element `docsDir`

- GIVEN a project with no config file
- WHEN `compendio index --dir docs` runs
- THEN the resulting indexed paths are identical in shape to running `compendio index` against a project whose `compendio.config.json` declares `docsDir: ["docs"]`

### Requirement: Optional `convention` Configuration Block

The system MUST accept an optional `convention` block in `compendio.config.json`. When the block (or the whole config file) is absent, the system MUST default `convention.mode` to `"loose"`.

#### Scenario: No config file at all

- GIVEN a project directory with `.md` files and no `compendio.config.json`
- WHEN `compendio index` runs
- THEN every readable `.md` file is indexed under `loose` behavior

#### Scenario: `docsDir`-only config

- GIVEN a `compendio.config.json` containing only `{ "docsDir": ["documentation"] }`
- WHEN `compendio index` runs
- THEN `convention.mode` defaults to `"loose"` and no file is skipped for metadata reasons

#### Scenario: Partial `convention` block merges with defaults

- GIVEN a `compendio.config.json` containing only `{ "convention": { "mode": "strict" } }`
- WHEN the config is loaded
- THEN `convention.excludedStatuses` defaults to `[]`, `convention.frontmatterFields` defaults to the identity mapping, and no `types`/`statuses` taxonomy is declared — declaring the `convention` block does not wipe the defaults of its sibling fields

### Requirement: `convention.mode` Toggle

The system MUST support `convention.mode: "strict" | "loose"` as the single switch selecting the validation policy applied during indexing and index-md generation.

#### Scenario: Explicit `loose` declared

- GIVEN `convention.mode: "loose"` in config
- WHEN indexing runs
- THEN the loose inference policy applies (see Indexing spec)

#### Scenario: Explicit `strict` declared

- GIVEN `convention.mode: "strict"` in config
- WHEN indexing runs
- THEN the strict validation policy applies (see Indexing spec)

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

### Requirement: `frontmatterFields` Field Mapping

The system MUST support an optional `convention.frontmatterFields` mapping of `type`/`module`/`status` to non-standard frontmatter field names. When a mapping is declared and the mapped field is present, its value MUST take precedence over any inferred value. Each of the three mappable fields (`type`/`module`/`status`) independently reads its own declared source key; two fields mapping to the same source key is permitted, and both fields MUST read that key's value — there is no collision error or dedup machinery. A declared `frontmatterFields` object MUST merge per key against the identity defaults (`{ "type": "type", "module": "module", "status": "status" }`) — declaring only some of the three keys MUST NOT wipe the defaults of the remaining keys; the object is never replaced wholesale.

#### Scenario: Custom field name mapped

- GIVEN `convention.frontmatterFields: { "type": "tipo" }` and a document with frontmatter `tipo: "guide"`
- WHEN the document is indexed
- THEN `type` resolves to `"guide"`

#### Scenario: Partial `frontmatterFields` merges per key with the identity defaults

- GIVEN a `compendio.config.json` containing only `{ "convention": { "frontmatterFields": { "type": "tipo" } } }`
- WHEN the config is loaded
- THEN `frontmatterFields.type` resolves to `"tipo"`, while `frontmatterFields.module` and `frontmatterFields.status` remain at their identity defaults (`"module"` and `"status"`) — declaring one key never wipes the others

#### Scenario: No mapping declared

- GIVEN no `convention.frontmatterFields` in config and a document with frontmatter `type: "guide"`
- WHEN the document is indexed
- THEN `type` resolves to `"guide"` read from the standard field name

#### Scenario: Two fields mapped to the same source key

- GIVEN `convention.frontmatterFields: { "type": "classification", "status": "classification" }` and a document with frontmatter `classification: "guide-current"`
- WHEN the document is indexed
- THEN both `type` and `status` resolve to `"guide-current"` — no error is raised for the shared source key

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
