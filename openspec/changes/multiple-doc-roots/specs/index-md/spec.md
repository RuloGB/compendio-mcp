# Delta for Index-MD

## ADDED Requirements

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
