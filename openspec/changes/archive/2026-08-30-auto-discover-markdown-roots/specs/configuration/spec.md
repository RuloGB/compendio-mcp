# Delta for Configuration

## MODIFIED Requirements

### Requirement: `docsDir` Is an Explicit Array of Declared Roots

The system MUST treat `docsDir` as the authoritative explicit root list when it is present as an array of strings in `compendio.config.json`. There is no single-string form and no compatibility fallback: when `docsDir` is malformed or wrong-typed, configuration loading MUST fail and MUST NOT fall back to discovery mode or any hidden default. When `docsDir` is absent, omitted, or declared as `[]`, the system MUST switch to discovery mode instead of inventing a default root list. In explicit mode, each declared entry becomes one root; every discovered document `path` MUST be prefixed with that root's alias — the basename of the declared root's path. Aliases MUST NOT be a project-declarable config key.
(Previously: absent `docsDir` defaulted to `["docs"]`; empty arrays were rejected; discovery mode did not exist.)

#### Scenario: Populated `docsDir` remains authoritative

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN `compendio index` runs
- THEN only those declared roots are indexed, and every discovered `path` is root-alias-prefixed

#### Scenario: Malformed or wrong-typed `docsDir` fails with no fallback

- GIVEN `docsDir` is a string, object, number, or other non-array value
- WHEN configuration is loaded
- THEN loading fails before indexing starts, and discovery mode is not entered

## ADDED Requirements

### Requirement: Missing `docsDir` or Empty `docsDir` Enables Discovery Mode

The system MUST enter discovery mode only when `compendio.config.json` is genuinely absent or when `docsDir` is omitted or declared as `[]`. A missing config file means an ENOENT/not found result; EACCES, EIO, or any other read failure MUST fail configuration loading and MUST NOT broaden into discovery mode. Discovery mode MUST derive roots from the filesystem and MUST NOT synthesize a `["docs"]` default.

#### Scenario: No config file uses discovery mode

- GIVEN no `compendio.config.json`
- WHEN `compendio index` starts
- THEN root discovery is used instead of a hidden `docs` default

#### Scenario: Empty `docsDir` also uses discovery mode

- GIVEN `docsDir: []`
- WHEN configuration is loaded
- THEN discovery mode is selected and no fallback root list is invented

#### Scenario: A config read failure does not broaden into discovery

- GIVEN `compendio.config.json` exists but cannot be read because of EACCES or EIO
- WHEN configuration is loaded
- THEN loading fails and discovery mode is not selected
