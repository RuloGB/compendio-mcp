# Delta for Indexing

## ADDED Requirements

### Requirement: Root-Alias-Prefixed Document `path`, Always

Every discovered `DocumentFile.path`, `ReadError.path`, and `EncodingNotice.path` MUST be prefixed with its declared root's alias, joined with `/` (e.g. `docs/x.md`, `openspec/specs/indexing/spec.md`). This applies uniformly regardless of how many roots are declared, including the default single-element `["docs"]` root set — there is no unprefixed shape anywhere in the system. `path` MUST remain the sole document identity key (`documents.path TEXT UNIQUE`); this change introduces no schema change. Two documents that would otherwise share a relative path under different roots (e.g. `docs/a.md` and `openspec/a.md`) MUST both index successfully as distinct documents.

#### Scenario: A document's path carries its root's alias

- GIVEN `docsDir: ["docs", "openspec"]`
- WHEN a file at `<openspec-root>/specs/indexing/spec.md` is discovered
- THEN its `path` is `openspec/specs/indexing/spec.md`

#### Scenario: Same-basename files under different roots do not collide

- GIVEN `docsDir: ["docs", "openspec"]`, with an `a.md` file directly under each root
- WHEN `compendio index` runs
- THEN both are indexed successfully as `docs/a.md` and `openspec/a.md`, with no UNIQUE-constraint error

#### Scenario: The default root set prefixes too

- GIVEN no config file, so `docsDir` defaults to `["docs"]`
- WHEN a file at `<default-root>/documentation-convention.md` is discovered
- THEN its `path` is `docs/documentation-convention.md`, not the unprefixed `documentation-convention.md` produced before this change

### Requirement: Removing a Declared Root Purges Its Indexed Documents on the Next Sync Pass

Because "Fingerprint-Based Incremental Diff" already deletes any indexed `path` absent from the discovered corpus, removing a declared root from `docsDir` MUST be treated identically to any other set of files disappearing from disk: on the next incremental sync pass, or the next full `compendio index`, every document previously indexed under that root's prefix MUST be deleted — even though the files still exist on disk outside the configured roots. No root-removal-specific detection or special-casing is introduced; the existing path-presence diff produces this outcome unmodified.

#### Scenario: Removing a root from a live `serve` purges its documents

- GIVEN a running `compendio serve` process configured with `docsDir: ["docs", "openspec"]`, then reconfigured to `docsDir: ["docs"]`
- WHEN the next throttled incremental sync pass runs
- THEN every previously indexed `openspec/...` document is deleted, even though those files still exist on disk

#### Scenario: Adding a root indexes its files as new documents

- GIVEN a project reconfigured from `docsDir: ["docs"]` to `docsDir: ["docs", "openspec"]`
- WHEN the next sync pass or full `compendio index` runs
- THEN every file under the newly declared root appears as an unknown `path` and is indexed as a new document, with no special detection mechanism

### Requirement: The Retrieval Evaluation Corpus Stays Addressable After a Path-Shape Change

`ejemplos/goldenset.yaml`'s expected document addresses (`esperado:`) MUST match the `path` shape `compendio index` produces for the same corpus. When a change alters how document `path` values are produced, the evaluation corpus's addresses MUST be updated in the same change, and the retrieval quality baseline (recall@5 and MRR measured against `compendio eval`) MUST be re-measured and recorded rather than assumed to hold unchanged. A change to `path` production that leaves the evaluation corpus's addressing stale MUST be a detectable, measurable failure when the evaluation is actually run — it MUST NOT be a state the automated test suite can report as passing while never exercising the addressing that changed. This is the goldenset's role: a falsifier of retrieval quality, not a fixture whose own drift can go unnoticed.

#### Scenario: Evaluation addresses are re-established after a path-shape change

- GIVEN a change that alters how document `path` values are produced (e.g. adding a root-alias prefix)
- WHEN the evaluation corpus's `esperado` addresses are updated to the new `path` shape in the same change
- THEN `compendio eval` reports recall@5 and MRR figures consistent with the pre-change baseline, and that comparison is recorded

#### Scenario: A stale evaluation corpus produces a measurable failure, not a silent gap

- GIVEN a change to `path` production that leaves the evaluation corpus's `esperado` addresses in the old, now-incorrect shape
- WHEN `compendio eval` is run against the updated index
- THEN recall@5 and MRR drop toward zero because no `esperado` address matches any indexed `path`, and this is a measurable, reportable outcome of actually running the evaluation — not something a passing `npm test` run can substitute for

## MODIFIED Requirements

### Requirement: Read Failures Protect the Affected `path` Subtree From Deletion

`DocumentSource.discover()` MUST report a failure to read a directory below a declared root in `readErrors`, instead of silently returning as it does today. Every file beneath a directory that failed to be read is absent from `files` for that pass, so an unreported directory failure would make the incremental diff treat that entire subtree as deleted.

For every entry in `readErrors`, an incremental sync pass MUST exclude from that pass's delete-candidate set both the reported `path` itself and every indexed `path` beneath it (prefix `<path>/`), MUST retain those existing rows as-is, and MUST report the failure in `skipped`. A `ReadError` for a declared root's own read failure MUST carry that root's alias as its `path` value — not the declared root string — because delete-protection and subtree matching operate on the alias-prefixed `path` shape every indexed document uses; the declared root string MAY still appear in the failure's human-readable message text.

A failure to read one declared root's directory MUST NOT throw by itself: it MUST be reported (in `readErrors`/`skipped` shape, keyed by the root's alias) and the run MUST continue indexing the remaining, readable roots. Only when EVERY declared root fails to read MUST the run throw — the same "nothing to index is a configuration error" semantics, generalized from one root to N. This is uniform across every declared root count: with a single declared root, "one root fails" and "every root fails" are the same event, so a one-element root set preserves the pre-existing always-throws behavior without any special case.
(Previously: a failure to read the root docs directory always threw, unconditionally, with no notion of multiple declared roots or of a `ReadError.path` distinct from the declared root string. The dual single-root/multi-root split this delta first introduced is retired along with the `docsDir` union: with `docsDir` always an array, "N roots, throw only when all N fail" is the one rule, and it degenerates correctly to "throw" for N=1.)

#### Scenario: Unreadable subdirectory does not delete its documents

- GIVEN indexed documents under `guides/` and a `readdir` failure on that subdirectory during a pass (e.g. a Windows permissions hiccup or a network-share blip)
- WHEN an incremental sync pass runs
- THEN the directory failure is reported in `readErrors`, every indexed `path` under `guides/` is excluded from the delete-candidate set and retained as-is, and the failure is reported in `skipped`

#### Scenario: One of several declared roots is unreadable — reported, run continues

- GIVEN `docsDir: ["docs", "openspec"]` and no `openspec/` directory exists in this project
- WHEN `compendio index` runs
- THEN the run completes with exit code 0, every `docs/` document is indexed, and the missing root is reported (in `skipped`/`readErrors` shape) with `ReadError.path` equal to `"openspec"` (its alias)

#### Scenario: The sole declared root failing is "every root failing" and still throws

- GIVEN `docsDir: ["docs"]` (the default shape) and `docs/` cannot be read
- WHEN `compendio index` runs
- THEN it throws — with exactly one declared root, "one root fails" and "every root fails" are the same event, so the pre-existing always-throws behavior holds without a special case

#### Scenario: Every declared root fails to read

- GIVEN `docsDir` is an array and none of its declared roots can be read
- WHEN `compendio index` runs
- THEN it throws, mirroring the "nothing to index is a configuration error" semantics generalized from one root to N

#### Scenario: A failed root's `ReadError.path` is its alias, protecting its subtree from deletion

- GIVEN a declared root `packages/app/docs` (alias `docs`) whose documents are persisted under the `docs/...` prefix, and that root becomes unreadable during an incremental sync pass
- WHEN the pass runs
- THEN the resulting `ReadError.path` is `"docs"` (the alias), so every indexed `docs/...` path is excluded from the delete-candidate set and retained; a `ReadError.path` carrying the declared string `"packages/app/docs"` instead would match no persisted path and would let `deleteMissingDocuments` purge that root's entire corpus

### Requirement: Field Inference in `loose` Mode

The system MUST infer `title` and `module` when not otherwise supplied, and MUST NOT invent `type`/`status`. A frontmatter field that is present but empty (an empty string, or YAML `null`) MUST be treated exactly as absent for `type`, `module`, and `status`: `type`/`status` stay absent, and `module` falls through to folder-segment inference. `module` inference MUST be relative to the document's containing declared root: the root's alias prefix MUST be stripped from the document's `path` before taking the first remaining path segment, so `module` keeps meaning "the folder this document sits in within its own root" rather than degrading into "which root it came from". This applies uniformly regardless of how many roots are declared, including the default single-element `["docs"]` root set — `docs/auth/login.md` MUST infer `module: "auth"`, never `"docs"`.

| Field | Inference source | Fallback |
|---|---|---|
| `title` | First H1 | Humanized filename |
| `summary` | First paragraph | Unchanged existing behavior |
| `module` | First path segment within the document's containing root (alias prefix always stripped first) | Absent for a file at its root's top level |
| `type` | None | Absent unless frontmatter/mapping supplies it |
| `status` | None | Absent unless frontmatter/mapping supplies it |
(Previously: `module` was the first path segment under an unprefixed `docsDir` path, with no root-alias to strip — `docsDir` could be a single string and `path` could be unprefixed. With `docsDir` always an array and `path` always prefixed, alias-stripping is unconditional rather than gated on a "multi-root mode" that no longer exists.)

#### Scenario: No H1 present

- GIVEN a `.md` file with no H1 heading
- WHEN indexed under `loose`
- THEN `title` is set to a humanized version of the filename

#### Scenario: Humanized filename, concrete example

- GIVEN a file at `docs/getting-started_with-search.md` with no H1
- WHEN indexed under `loose`
- THEN `title` resolves to `"Getting started with search"` (strip `.md`, replace `-`/`_` with spaces, collapse and trim whitespace, sentence-case the first letter)

#### Scenario: Empty-string frontmatter treated as absent

- GIVEN `docsDir` defaults to `["docs"]`, a file whose `path` is `docs/auth/login.md`, and frontmatter `module: ""`
- WHEN indexed under `loose`
- THEN `module` resolves to `"auth"` via folder inference (alias stripped, then the first remaining segment), not the empty string

#### Scenario: Empty type/status frontmatter treated as absent

- GIVEN a document with frontmatter `type: ""` and `status: null`
- WHEN indexed under `loose`
- THEN `type` and `status` are both absent, not empty strings

#### Scenario: `module` from folder segment, default root set

- GIVEN `docsDir` defaults to `["docs"]` and a file whose `path` is `docs/auth/login.md`
- WHEN indexed under `loose`
- THEN `module` resolves to `"auth"`, not `"docs"`

#### Scenario: A file at its root's top level has no module, even prefixed

- GIVEN `docsDir: ["docs", "openspec"]` and a file whose `path` is `docs/documentation-convention.md`
- WHEN indexed under `loose`
- THEN `module` is absent, not `"docs"`

#### Scenario: Frontmatter wins over inference

- GIVEN `docsDir` defaults to `["docs"]`, a file whose `path` is `docs/auth/login.md`, and frontmatter `module: "identity"`
- WHEN indexed under `loose`
- THEN `module` resolves to `"identity"`, not `"auth"`

#### Scenario: `module` on a deeper, second-root document

- GIVEN `docsDir: ["docs", "openspec"]` and a file whose `path` is `openspec/specs/indexing/spec.md`
- WHEN indexed under `loose`
- THEN `module` resolves to `"specs"`, not `"openspec"`
