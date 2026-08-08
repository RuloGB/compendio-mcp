# Delta for Index-MD

## ADDED Requirements

### Requirement: Default Alphabetical Ordering in `loose` Mode

Under `convention.mode: "loose"` (or no config), `INDEX.md` generation MUST order entries alphabetically by `path`.

#### Scenario: Mixed corpus, loose mode

- GIVEN a corpus indexed under `loose` with documents at various paths
- WHEN `compendio index-md` runs
- THEN entries appear in ascending alphabetical order of `path`

### Requirement: Declared-Taxonomy Ordering in `strict` Mode

Under `convention.mode: "strict"` with a declared `convention.types` list, `INDEX.md` generation MUST order entries following the declared `types` sequence, falling back to alphabetical order by `path` within each `type` group.

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

#### Scenario: Document with no type and no status

- GIVEN a document with no `type` and no `status`
- WHEN `INDEX.md` renders that document's line
- THEN the line contains neither a `[...]` segment nor a `(...)` segment for those fields — never `[undefined]` or empty brackets

#### Scenario: Document with type but no status

- GIVEN a document with `type: "guide"` and no `status`
- WHEN `INDEX.md` renders that document's line
- THEN the line includes the `[guide]` segment and omits the `(status)` segment entirely

### Requirement: Skip-and-Report Resilience Matches Indexing

`compendio index-md` MUST apply the same per-file resilience guarantees as `compendio index` (see the Indexing spec's "Resilience Skip Reasons Apply in Both Modes" requirement): a file that is unreadable, that is genuinely undecodable (neither valid UTF-8 nor plausibly CP1252), or that fails markdown/frontmatter parsing, MUST be reported in `skipped` with its error message, and generation MUST continue with the remaining files rather than aborting the run. These resilience reasons are mode-independent — they apply identically whether `convention.mode` is `loose` or `strict`, ahead of and regardless of any mode-specific metadata validation. A document whose bytes were successfully transcoded from a non-UTF-8 encoding MUST still be included in `INDEX.md` and MUST be reported as transcoded in the `index-md` run's output, matching `compendio index`'s reporting.
(Previously: covered only the unreadable/parse-failure resilience reasons. `encoding-aware-reads` added the undecodable-encoding skip reason and transcode-notice surfacing.)

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

#### Scenario: Undecodable content is skipped during index-md generation

- GIVEN a file whose bytes are neither valid UTF-8 nor plausibly CP1252
- WHEN `compendio index-md` runs
- THEN the file is reported in `skipped` with a message distinguishable from a generic I/O read error, and `INDEX.md` is generated from the remaining files

#### Scenario: A transcoded document is included in INDEX.md and reported

- GIVEN a CP1252 document that decodes successfully via the fallback
- WHEN `compendio index-md` runs
- THEN the document is included in `INDEX.md`, and the run's output reports it as transcoded

### Requirement: No Compatibility Ordering Path

The system MUST NOT preserve a legacy closed-taxonomy-indexOf ordering path as a fallback or compatibility mode. Since no installed base of `docs/INDEX.md` files exists in production, the alphabetical/declared-taxonomy rules above are the only orderings the system MUST support.

#### Scenario: Re-running index-md on an existing file

- GIVEN an existing `docs/INDEX.md` generated under the retired convention
- WHEN `compendio index-md` runs again under the new rules
- THEN the file is regenerated and re-sorted per the applicable rule above, with no attempt to preserve the previous ordering

### Requirement: One Combined `INDEX.md` Across All Declared Roots

`compendio index-md` MUST generate exactly one combined `INDEX.md`, written into the first declared root (`docsDir[0]`), listing every document discovered across every declared root under its root-alias-prefixed `path`. No per-root `INDEX.md` file MUST be generated. This applies uniformly regardless of how many roots are declared, including the default single-element `["docs"]` root set — a one-root config still writes one `INDEX.md` into that root, listing prefixed paths.

#### Scenario: Two-root generation writes one combined file to the first root

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `compendio index-md` runs
- THEN exactly one `INDEX.md` is written, at `docs/INDEX.md`, listing documents from both roots under their prefixed paths

#### Scenario: The default single-root set still writes one file, with prefixed paths

- GIVEN no config file, so `docsDir` defaults to `["docs"]`
- WHEN `compendio index-md` runs
- THEN `INDEX.md` is written to `docs/INDEX.md`, and every listed entry's `path` carries the `docs/` prefix (e.g. `docs/documentation-convention.md`) — not the unprefixed shape prior versions produced

### Requirement: `INDEX.md` Never Lists Itself, Under Any Root Count

`compendio index-md` generation MUST NOT include the generated `INDEX.md` file itself among its listed entries, `skipped` entries, or `encodingNotices` — regardless of how many roots are declared, and regardless of whether a project's `exclude` configuration would otherwise leave `INDEX.md` un-excluded. Self-exclusion MUST be evaluated against the generated file's actual `path`, which is always root-alias-prefixed (e.g. `docs/INDEX.md`), never against a fixed, unprefixed literal. This requirement is stated here for the first time as a formal spec guarantee — it previously existed only as an implementation-level guard.

#### Scenario: Self-exclusion holds under default config, default root set

- GIVEN `docsDir` defaults to `["docs"]` and the default `exclude: ["INDEX.md"]`
- WHEN `compendio index-md` runs
- THEN the generated `docs/INDEX.md` does not appear among its own listed entries

#### Scenario: Self-exclusion holds under default config, two declared roots

- GIVEN `docsDir: ["docs", "openspec"]` and the default `exclude: ["INDEX.md"]`
- WHEN `compendio index-md` runs
- THEN the generated `docs/INDEX.md` does not appear among its own listed entries, despite its `path` being root-prefixed

#### Scenario: Self-exclusion holds even when `exclude` is overridden away

- GIVEN `exclude: []` (so the config-level exclusion no longer applies), for any declared root count
- WHEN `compendio index-md` runs
- THEN the generated `INDEX.md` still does not appear among its own listed entries, `skipped` entries, or `encodingNotices`
