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
