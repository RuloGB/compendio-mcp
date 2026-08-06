# Delta for Index-MD

## MODIFIED Requirements

### Requirement: Skip-and-Report Resilience Matches Indexing

`compendio index-md` MUST apply the same per-file resilience guarantees as `compendio index` (see the Indexing spec's "Resilience Skip Reasons Apply in Both Modes" requirement): a file that is unreadable, that is genuinely undecodable (neither valid UTF-8 nor plausibly CP1252), or that fails markdown/frontmatter parsing, MUST be reported in `skipped` with its error message, and generation MUST continue with the remaining files rather than aborting the run. These resilience reasons are mode-independent — they apply identically whether `convention.mode` is `loose` or `strict`, ahead of and regardless of any mode-specific metadata validation. A document whose bytes were successfully transcoded from a non-UTF-8 encoding MUST still be included in `INDEX.md` and MUST be reported as transcoded in the `index-md` run's output, matching `compendio index`'s reporting.
(Previously: covered only the unreadable/parse-failure resilience reasons. This delta adds the undecodable-encoding skip reason and transcode-notice surfacing introduced by `encoding-aware-reads`.)

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
