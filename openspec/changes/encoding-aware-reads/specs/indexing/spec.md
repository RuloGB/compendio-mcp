# Delta for Indexing

## ADDED Requirements

### Requirement: Encoding-Aware Decoding Before Content Reaches the Pipeline

Before a discovered file's bytes become a `DocumentFile.content` string, the system MUST decode them on evidence rather than assume UTF-8. Detection MUST proceed in this order: (1) sniff a byte-order mark identifying UTF-8, UTF-16LE, or UTF-16BE and decode accordingly; (2) when no BOM is present, decode as UTF-8 only when the bytes are exactly valid UTF-8; (3) when the bytes are not valid UTF-8, decode as CP1252 only when every byte maps to a defined CP1252 code point — including the `0x80–0x9F` range mapping to its assigned punctuation (curly quotes, en/em dash, ellipsis, etc.), never to a C1 control code and never to the code point Latin-1 would produce for that same byte. Detection coverage is limited to UTF-8, UTF-16-with-BOM, and CP1252; the system MUST NOT extend this to any other encoding by guessing. A file whose bytes are already valid UTF-8 MUST decode identically to current behavior and MUST NOT be reported as transcoded.

#### Scenario: CP1252 curly quotes, dash, and ellipsis decode correctly

- GIVEN a CP1252-encoded document containing curly quotes (`0x93`/`0x94`), an en dash (`0x96`), and an ellipsis (`0x85`)
- WHEN it is indexed
- THEN the decoded content contains the code points `U+201C`, `U+201D`, `U+2013`, `U+2026`, and zero `U+FFFD`

#### Scenario: CP1252 accented vowels decode correctly

- GIVEN a CP1252-encoded document containing only accented characters in `0xA0–0xFF` (e.g. `ó`)
- WHEN it is indexed
- THEN the decoded content contains the correct accented code points (e.g. `U+00F3`) and zero `U+FFFD`

#### Scenario: Valid UTF-8 is unaffected

- GIVEN a valid UTF-8 document
- WHEN it is indexed
- THEN it decodes exactly as it does today, and no transcoding notice is produced for it

#### Scenario: UTF-8 BOM is consumed

- GIVEN a UTF-8-encoded document with a leading byte-order mark
- WHEN it is indexed
- THEN the BOM is consumed and the remaining content decodes correctly

#### Scenario: UTF-16 BOM, little-endian and big-endian, decodes correctly

- GIVEN a UTF-16LE-encoded document and a UTF-16BE-encoded document, each with its byte-order mark present
- WHEN each is indexed
- THEN both decode to their correct string content

### Requirement: A Successfully Transcoded Document Is Always Reported

Whenever a document's bytes are not valid UTF-8 but are successfully decoded via BOM detection or the CP1252 fallback, the system MUST report that document as transcoded to every consumer of the index/sync report (`compendio index`, `compendio index-md`, and the sync pass feeding `docs_overview`) — even when the transcoded content is byte-for-byte the string a correct decoder would have produced anyway. The document MUST still be indexed normally and MUST NOT appear in `skipped`; a transcoded document is a reportable event, not a failure.

#### Scenario: A perfect transcode is still reported

- GIVEN a CP1252 document whose bytes decode via the fallback with no lossy substitution
- WHEN `compendio index` runs
- THEN the document is indexed successfully, does not appear in `skipped`, and the run's report still names it as transcoded

#### Scenario: The transcode notice reaches CLI output

- GIVEN a transcoded document reported by an `index` or `index-md` run
- WHEN the CLI prints its summary
- THEN a transcoding notice for that document's path is printed, alongside the existing `skipped`/`embeddingsWarning` warnings

### Requirement: Corrected Decoding Self-Heals via Incremental Sync

Because the change fingerprint (`computeHash(content)`) hashes the already-decoded string rather than the raw bytes (see "Fingerprint-Based Incremental Diff"), fixing this decoding defect for a previously mis-decoded document changes its stored hash even though the file's bytes on disk are unchanged. An incremental `serve` sync pass MUST therefore treat that document as changed and re-index it; no full `compendio index` MUST be required to apply corrected decoding to an already-indexed corpus. This is the inverse of "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents": there, bytes were unchanged and only chunking config moved, so the hash never changed and a full reindex was mandatory; here, bytes are unchanged but decoded output differs, so the hash does change and an incremental pass suffices.

#### Scenario: An incremental pass alone re-indexes a previously mis-decoded document

- GIVEN a document previously indexed under the old, UTF-8-only decoder, whose bytes on disk have not changed
- WHEN the encoding-aware decoder is deployed and an incremental `serve` sync pass runs
- THEN the document's recomputed content hash differs from its stored hash, so it is re-parsed, re-chunked, and re-embedded by that pass alone, with no full `compendio index` required

## MODIFIED Requirements

### Requirement: Resilience Skip Reasons Apply in Both Modes

Independently of `convention.mode`, the system MUST report a file in `skipped` for any of four resilience reasons — the file is unreadable, the file's bytes are genuinely undecodable (neither valid UTF-8 nor plausibly CP1252), the file fails markdown/frontmatter parsing, or the file yields zero indexable chunks after parsing/chunking ("the document has no indexable content") — and these four reasons apply identically under both `loose` and `strict`: the per-file unreadable/undecodable/parse-failure containment sits ahead of any mode-specific metadata validation, so a file can be skipped for a resilience reason under `strict` exactly as it would under `loose`, before `strict`'s own taxonomy/presence checks ever run. The undecodable-encoding message MUST be distinguishable from the plain "could not open the file" I/O message — they are different failures with different fixes — and undecodable content MUST NOT be transcoded under any fallback.
(Previously: three resilience reasons — unreadable, parse failure, no indexable content. Genuinely undecodable encoding is a fourth, added by `encoding-aware-reads`, with its own distinct message.)

#### Scenario: I/O-unreadable file is skipped and the run continues, under strict too

- GIVEN a `.md` file that cannot be read (an I/O error occurs while reading its content)
- WHEN indexed under `strict`
- THEN the file is reported in `skipped` with its error message, and indexing continues with the remaining files — identically to how it would be handled under `loose`

#### Scenario: Malformed frontmatter fails to parse and the run continues

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse
- WHEN indexed under `loose`
- THEN the file is reported in `skipped` with its error message, and indexing continues with the remaining files

#### Scenario: Malformed frontmatter fails to parse and the run continues, under strict too

- GIVEN a `.md` file with malformed YAML frontmatter that fails to parse, and `convention.mode: "strict"` configured
- WHEN indexed under `strict`
- THEN the file is reported in `skipped` with its error message, and indexing continues with the remaining files — identically to how it would be handled under `loose`

#### Scenario: Document with no indexable content is skipped

- GIVEN a `.md` file that parses successfully but yields zero indexable chunks after chunking (e.g., an empty body)
- WHEN indexed under `loose` or `strict`
- THEN the file is reported in `skipped` with the reason "the document has no indexable content"

#### Scenario: Genuinely undecodable content is skipped with a distinct message, never transcoded

- GIVEN a file whose bytes are neither valid UTF-8 nor plausibly CP1252 (e.g., binary content misnamed `.md`)
- WHEN it is discovered during indexing, under either `loose` or `strict`
- THEN it is reported in `skipped` with a message distinguishable from the generic "could not open the file" I/O error, and it is never transcoded or indexed
