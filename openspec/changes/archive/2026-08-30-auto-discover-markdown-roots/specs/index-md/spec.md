# Delta for index-md

## MODIFIED Requirements

### Requirement: `INDEX.md` Never Lists Itself, Under Any Root Count

`compendio index-md` generation MUST NOT include the generated `INDEX.md` file itself among its listed entries, `skipped` entries, or `encodingNotices` — regardless of how many roots are declared, whether discovery mode is active, and regardless of whether a project's `exclude` configuration would otherwise leave `INDEX.md` un-excluded. Self-exclusion MUST be evaluated against the generated file's actual `path`, which is always root-alias-prefixed in explicit mode and exactly `INDEX.md` in discovery mode, never against a fixed literal.
(Previously: self-exclusion only described declared roots.)

#### Scenario: Self-exclusion holds under discovery mode

- GIVEN discovery mode is active and `INDEX.md` is generated at the project root
- WHEN `compendio index-md` runs
- THEN the generated file does not appear among its own listed entries

## ADDED Requirements

### Requirement: Discovery Mode Writes Project-Root `INDEX.md`

When discovery mode finds at least one Markdown-bearing top-level root, `compendio index-md` MUST write `INDEX.md` at the project root. When `--dir` is used, it is effective explicit mode and MUST write inside the override root, never as project-root `INDEX.md`. In explicit config mode, it MUST keep writing to the first declared root.

#### Scenario: Discovery mode targets the project root

- GIVEN no config file and at least one discovered root
- WHEN `compendio index-md` runs
- THEN `INDEX.md` is written as `INDEX.md` in the project root

#### Scenario: `--dir` writes inside the override root

- GIVEN `compendio index-md --dir notes`
- WHEN generation runs
- THEN `INDEX.md` is written inside `notes/`, not at the project root

#### Scenario: Explicit mode keeps first-root placement

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `compendio index-md` runs
- THEN `INDEX.md` is written to the first declared root
