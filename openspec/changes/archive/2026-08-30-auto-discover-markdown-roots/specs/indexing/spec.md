# Delta for Indexing

## MODIFIED Requirements

### Requirement: Root-Alias-Prefixed Document `path`, Always

Every indexed document MUST keep a root-prefixed `path`: the declared-root basename in explicit mode and discovered-root basename in discovery mode. Persisted and MCP-facing paths MUST match.
(Previously: discovery-mode paths were not specified.)

#### Scenario: Explicit roots keep prefixed paths
- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN indexing runs
- THEN every indexed document path is prefixed with `docs/` or `openspec/`

#### Scenario: Discovery roots keep prefixed paths
- GIVEN no config and a Markdown-bearing top-level `openspec` folder
- WHEN indexing runs
- THEN discovered documents under that folder are indexed as `openspec/...`

## ADDED Requirements

### Requirement: Discovery Mode Selects Top-Level Markdown-Bearing Roots

Discovery MUST scan only top-level entries, select folders containing a `.md` file at any depth, and recurse within them. Probing and traversal MUST ignore `.git`, `.compendio`, `node_modules`, `dist`, `build`, and `coverage`; MUST NOT follow symbolic links for candidate roots, directories, or `.md` files; and MUST abort before mutation on candidate-scan permission or I/O failure.

#### Scenario: Technical roots are ignored
- GIVEN a project root containing `.git`, `node_modules`, `dist`, `build`, `coverage`, `.compendio`, and `openspec`
- WHEN discovery runs
- THEN the technical roots are ignored and Markdown-bearing `openspec` is selected

#### Scenario: Symlinked content is ignored
- GIVEN a top-level candidate root or nested directory is a symbolic link outside the project
- WHEN discovery runs
- THEN the symlink target is not traversed and no external Markdown is indexed

#### Scenario: Read failure aborts discovery
- GIVEN discovery cannot stat or read a candidate directory because of permissions or I/O failure
- WHEN discovery runs
- THEN the pass aborts before index mutation

### Requirement: Existing `exclude` Semantics Still Apply to Discovery-Selected Roots

After selecting roots, discovery mode MUST apply `exclude` to emitted root-prefixed paths. Exact-path, basename, and directory-prefix matching MUST equal explicit mode, including trailing-slash normalization. Technical-root filtering MUST remain separate.

#### Scenario: All exclude forms apply
- GIVEN discovery selects `openspec` with exact, basename, and directory-prefix excludes, including a trailing-slash prefix
- WHEN matching and non-matching Markdown files are discovered
- THEN matching files are excluded with the trailing slash normalized, while non-matching files are indexed

### Requirement: Discovery Mode Covers the Whole Current OpenSpec Corpus

Discovery MUST index every `.md` file under `openspec`, including direct, arbitrarily nested, and archived files. The historical 170-file baseline MUST remain evidence, not a threshold.

#### Scenario: Current OpenSpec corpus is fully discoverable
- GIVEN the repository's current `openspec` tree
- WHEN discovery-mode indexing runs
- THEN every direct, nested, and archived Markdown file is indexed

#### Scenario: Case-insensitive `.md` extensions are included
- GIVEN `openspec` contains files with `.md`, `.MD`, or mixed-case `.Md` extensions
- WHEN discovery-mode indexing runs
- THEN all such Markdown files are indexed

#### Scenario: Discovery root order is deterministic
- GIVEN multiple top-level Markdown-bearing roots exist
- WHEN discovery runs twice on the same filesystem state
- THEN the selected root ordering is the same in both runs

### Requirement: Nested Roots Are Not Created Independently

The system MUST NOT create a separate discovered root beneath an owning discovered root.

#### Scenario: Nested folders stay under the parent root
- GIVEN a Markdown-bearing top-level root containing a nested Markdown-bearing subfolder
- WHEN discovery runs
- THEN the nested folder's files are indexed under the parent root's alias

#### Scenario: A nested symlink does not create a discovered root
- GIVEN a nested directory is a symbolic link
- WHEN discovery runs
- THEN it is not treated as an independently discovered root

#### Scenario: Unreadable existing root aborts sync without mutation
- GIVEN a discovery-mode index already contains documents for a root and that root becomes unreadable during the next sync
- WHEN discovery runs
- THEN the sync aborts before mutation and existing indexed documents remain
