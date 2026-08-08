# Exploration: `docsDir` as an array — multi-root documentation indexing (`docs` + `openspec`)

Change: `multiple-doc-roots` · Date: 2026-08-07 · Phase: sdd-explore (done)

> **Q4's recommendation is SUPERSEDED — read `proposal.md` for the decision in force.** This document
> recommends `docsDir: string | string[]`, and its stated reason is that array-only "would force every
> existing single-root project to touch its config just to keep working". The user reaffirmed on
> 2026-08-07 that Compendio is not in production and nobody has it installed, so that protected set is
> empty and the argument is void. The change is **array-only** (`docsDir: string[]`, default
> `["docs"]`, every path root-alias-prefixed including the zero-config case). The reasoning below is
> kept unedited as the record of how the decision was reached, not as guidance to implement.

> Investigation performed by the sdd-explore agent; persisted verbatim by the orchestrator (the explore
> agent runs without write tooling). Product context: the project is in beta with no installed users —
> breaking the public contract (config keys, MCP params, SQLite schema) is an accepted cost, not a risk
> to mitigate. Artifact store for this cycle: `openspec` (Engram was unavailable in the exploring
> session).

> **Orchestrator verification.** The load-bearing claims below were re-checked independently against the
> code before persisting, because an exploration that measures wrong sends every later phase the wrong
> way. Confirmed: `path TEXT UNIQUE NOT NULL` (`sqlite-index-store.ts:48`); `docsDir: string`
> (`config.ts:7`) resolved once into a single absolute path (`composition.ts:58`);
> `store.saveDocument(...)` at `index-documents.ts:106` carries no `try`/`catch` while every neighbouring
> failure mode does; `isExcluded` is exact equality on full path or basename with no glob support
> (`file-document-source.ts:84-86`); the root `readdir` failure throws only when `prefix === ""`
> (`file-document-source.ts:47-52`); `inferModule` takes the first path segment (`convention.ts:39`);
> `generate-index-md.ts:46` compares `file.path === INDEX_FILE` by exact string. File counts re-measured
> with `find`: `docs/**/*.md` = **2**, `openspec/**/*.md` = **86**, of which **79** live under
> `openspec/changes/archive/`.

## Current State

**Load-bearing structural finding first**: the use-case layer (`src/application/`) and the domain layer
never assume "one root" — they assume "one `DocumentSource`" (`src/domain/ports.ts:48-50`).
`IndexDocuments`, `SyncIndex`, `GenerateIndexMd`, `ReadDocument` all take an injected
`DocumentSource`/`IndexFileWriter`/`IndexStore` and never reference `docsDir` themselves — they call
`source.discover()` once and iterate the flat `files`/`DiscoverResult` it returns. Multi-root is
therefore structurally an **infrastructure + composition-root concern**, not an application/domain one
(with one exception in `domain/convention.ts`, covered under Q7).

Where "one root" is actually assumed, concretely:

- `src/infrastructure/config.ts:7` — `CompendioConfig.docsDir: string` (single-string type).
- `src/infrastructure/config.ts:54` — `DEFAULT_CONFIG.docsDir = "docs"`.
- `src/infrastructure/config.ts:93` — `mergeConfig`: `docsDir: override.docsDir ?? base.docsDir`, a
  whole-value replace with **zero runtime shape validation** — `loadConfig` never checks `docsDir` is
  actually a string at runtime, it is a bare TypeScript cast over `JSON.parse` output (`config.ts:88`).
  If a project today puts `docsDir: ["docs","openspec"]` in its config, nothing at the config layer
  rejects it.
- `src/composition.ts:58` — `const docsDir = resolve(options.root, options.docsDir ?? config.docsDir);`
  — resolved to **one** absolute path, once, for the whole container.
  - **INFERRED** (Node docs, not executed): `path.resolve` validates its arguments are strings and
    throws `TypeError [ERR_INVALID_ARG_TYPE]` on a non-string. So today's misconfiguration case
    (`docsDir` as an array with zero validation upstream) would already hard-crash container
    construction with a native TypeError rather than a helpful message — worth confirming with `node -e`
    before relying on it, but not central to this design.
- `src/composition.ts:72` — `new FileDocumentSource(docsDir, config.exclude)` — **one** discovery
  adapter for the whole container.
- `src/composition.ts:82` — `new FileIndexWriter(docsDir, INDEX_FILE)` — **one** writer, into the same
  single resolved dir.
- `src/composition.ts:29` — `ContainerOptions.docsDir?: string` — the CLI `--dir` override is typed as a
  single string.
- `src/cli.ts:35`, `src/cli.ts:76` — `--dir <dir>` (commander, single value) on both `index` and
  `index-md`.
- `src/infrastructure/fs/file-document-source.ts:21-25` — constructor takes **one** `docsDir: string`;
  `discover()` walks from that one root and builds `DocumentFile.path` **relative to it alone**
  (`walk(this.docsDir, "", ...)`, prefix starts at `""` — no root identity survives into the emitted
  `path` at all).
- `src/infrastructure/fs/file-index-writer.ts:11-17` — constructor takes **one** `docsDir`, writes
  `join(this.docsDir, this.fileName)`.

`ReadDocument.resolve` (`src/application/read-document.ts:44-50`) is the sharpest consumer of the "one
implicit root" assumption even though it never touches `docsDir` directly: its one-leading-segment-strip
tolerance exists *specifically* because indexed paths are relative to the single `docsDir` and a caller
who saw the file on disk holds the docsDir-prefixed path. That heuristic's meaning changes under
multi-root (see Q2).

## Affected Areas

- `src/infrastructure/config.ts` — `docsDir` type, default, merge, and a new root-collision validation.
- `src/infrastructure/fs/file-document-source.ts` — stays the per-root primitive, likely unchanged.
- **New**: a composing `DocumentSource` adapter (e.g.
  `src/infrastructure/fs/composite-document-source.ts`) that fans out to N `FileDocumentSource`s and
  prefixes paths.
- `src/composition.ts` — branches on `docsDir` being a string vs an array; decides where the combined
  `INDEX.md` lands.
- `src/domain/convention.ts` — `inferModule` (`:39-42`), to decide what "module" means once `path`
  carries a root prefix (Q7).
- `src/application/read-document.ts` — `ReadDocument.resolve`'s one-leading-segment tolerance needs
  re-examination against root-prefixed paths (still safe by construction, but worth a fresh test pass —
  see Q2).
- `src/application/generate-index-md.ts` — its own `file.path === INDEX_FILE` self-exclusion check
  (`:46`) breaks silently under root-prefixed paths if a project overrides `exclude` (see Q3).
- `src/infrastructure/sqlite/sqlite-index-store.ts:48` — `path TEXT UNIQUE NOT NULL` — the constraint at
  the center of the whole design problem (Q2).
- `openspec/specs/configuration/spec.md`, `openspec/specs/indexing/spec.md`,
  `openspec/specs/index-md/spec.md`, `openspec/specs/mcp-contract/spec.md` — all need deltas (Q10).
- `README.md` (docsDir table, `:148-150`) and `CLAUDE.md` — prose documenting the new shape.
- Tests: `test/infrastructure/config.test.ts`, `test/infrastructure/file-document-source.test.ts`,
  `test/domain/convention.test.ts`, `test/application/generate-index-md.test.ts`,
  `test/application/read-document.test.ts`, `test/application/index-and-search.test.ts`, plus a new
  composite-source test file.

---

### Q1 — Current threading of `docsDir`

Answered above under "Current State".

### Q2 — Path identity: the central problem

Confirmed at `src/infrastructure/sqlite/sqlite-index-store.ts:48`: `path TEXT UNIQUE NOT NULL`. `path` is
the sole document key everywhere: `getDocumentByPath` (`:385-390`), `deleteDocument` (`:221-230`),
`upsertDocument`'s existing-row lookup (`:243,255`), and every
`SearchResultItem.path`/`OverviewLine.path`/`IndexEntry.path`.

**Concrete, not hypothetical failure if identity is left unaddressed**: `IndexDocuments.execute()`
(`src/application/index-documents.ts:106`) calls `this.store.saveDocument(meta, chunks)` — a plain
`INSERT`, never an upsert — with **no try/catch** around it (unlike every other resilience-guarded step
in that loop). If two roots produced the same relative path (`docs/a.md` and `openspec/a.md`, both
discovered as `a.md`), the second `INSERT` throws a SQLite UNIQUE-constraint violation that propagates
uncaught out of `execute()`, past `IndexDocuments`, straight to the CLI's top-level `.catch()`
(`cli.ts:297-300`), aborting the **entire** `compendio index` run — not a per-file skip like every other
failure mode this codebase is built around, but a full crash, leaving the DB with only whatever committed
before the throw. This is the strongest argument against doing nothing about identity.

**Options:**

| Option | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. Root-prefixed paths** | Every emitted `path` becomes `<rootAlias>/<relativePath>` (e.g. `docs/a.md`, `openspec/a.md`) | No SQLite schema change (`path` stays one `TEXT UNIQUE` column); `docs_overview`/`search_docs` results become self-explanatory about provenance; `SyncIndex`'s existing path+hash diff needs zero changes (it just diffs a flat list) | Changes the path shape callers see for every multi-root project (accepted per this project's beta policy); shifts `inferModule`'s meaning (Q7); `ReadDocument.resolve`'s one-segment-strip heuristic needs re-verification, not redesign | Medium |
| **B. Per-root namespace column** | Add `root`/`source` column to `documents`, change constraint to `UNIQUE(root, path)`, keep `path` root-relative | Preserves today's exact `path` values (`a.md`) unchanged even in multi-root mode | Forces a new field onto `SearchResultItem`/`OverviewLine`/`IndexEntry` AND onto `read_doc`'s request shape (a bare `path` param can no longer resolve one document) — this just re-implements A's information via two fields instead of one, for no benefit given breaking changes are already accepted; every `IndexStore` method signature touching `path` grows a parameter; `ReadDocument.resolve`'s fallback needs disambiguation logic across roots for close matches | Medium-High |
| **C. First-match-wins / no identity handling** | Do nothing; let paths collide | Zero design cost | **Not actually "silent"** — it is an uncaught crash of the whole `compendio index` run on first collision (see above), the worst failure mode in the codebase relative to its established resilience philosophy (`skipped`, `readErrors`, `noMatchReason`, `filterWarning` are all loud-and-continues; this is silent-until-it-explodes) | — (ruled out) |

**Recommendation: Option A**, gated so it only activates in multi-root mode:

- `docsDir` as a **string** (default `"docs"`, or an explicit single-string override) → byte-identical to
  today: unprefixed paths, `FileDocumentSource` used exactly as it is now. This is what makes
  "zero-config behaviour stays exactly as it is today" true without any special-casing.
- `docsDir` as an **array** (any length, including 1) → multi-root mode: every discovered
  `DocumentFile.path` gets prefixed with its root's alias (recommend: the basename of the declared root
  path, e.g. `"docs"`/`"openspec"` — sufficient for the stated motivating case; an explicit-alias object
  form is a natural, additive future extension, not needed now).
- New composing adapter (not a modification of `FileDocumentSource`) fans out to N per-root
  `FileDocumentSource` instances, prefixes `files[].path`, `readErrors[].path`, and
  `encodingNotices[].path`, merges, and re-sorts by `path` (matching `file-document-source.ts:32`'s
  existing contract).
- Root-collision guard (needed regardless of A/B): reject the config (throw, matching `loadConfig`'s
  existing throw-on-invalid-JSON precedent, `config.ts:83-87`) when two declared roots resolve to the
  same absolute path, or one is a path-prefix of another (nested roots — see Q5), or two aliases
  collide. This is the one new validation earning its place: unlike a wrong `docsDir` *type* (already
  untolerated broadly and consistently across this config loader, so adding type-schema validation here
  would be inconsistent with the project's established minimal-validation style), an undetected root
  collision leads straight back into the Option-C crash **even under Option A**, since nested roots
  (`docs` and `docs/adr`) double-discover the same file under the same final prefixed path.

### Q3 — `INDEX.md` generation with N roots

Recommend **one combined `INDEX.md`**, written to `docsDir[0]` (the first declared root), listing every
document from every root with its root-prefixed path. Reasoning: `GenerateIndexMd`/`IndexMdReport`
(`src/application/generate-index-md.ts:7-19`) is currently a single-writer, single-count report shape
(`path: string`, `documents: number`); N per-root files would force that interface to become
array-shaped, a materially bigger change for a benefit (per-root index files) nobody has asked for. One
combined file with root-prefixed paths is a natural generalization of "one index of everything indexed."

**Does "`INDEX.md` never lists itself" hold?** Partially, and with a real gap worth calling out
precisely. `FileDocumentSource.isExcluded` (`file-document-source.ts:84-86`) already excludes by
basename, and the default `exclude: [INDEX_FILE]` (`config.ts:55`) matches `"INDEX.md"` by basename
regardless of directory — so under default config, INDEX.md self-exclusion continues to "just work" for
any root, unchanged. But `GenerateIndexMd`'s own **explicit** guard (`generate-index-md.ts:46`,
`if (file.path === INDEX_FILE) continue;`) is a bare string-equality check against the root-relative
literal `"INDEX.md"`. Under root-prefixing, the generated file's path would be e.g. `docs/INDEX.md` —
that check would **never** match again, silently going dead. It only matters for a project that overrides
`exclude` to *not* exclude `INDEX.md` (an edge case, but the project's convention elsewhere is to never
let a guard silently stop working) — recommend updating that check to compare basenames, or to compare
against `<docsDir[0]-alias>/INDEX.md` explicitly, rather than leave a dead literal in place.

### Q4 — Config shape

Recommend `docsDir: string | string[]` (honoring the shape the user explicitly requested), not
array-only:

- A single string keeps every existing config, README example (`README.md:132,148-150`), and the config
  test (`test/infrastructure/config.test.ts:42,62-70`, which asserts `docsDir: "documentation"`
  round-trips as a string) working with **zero** required migration — array-only would force every
  existing single-root project to touch its config just to keep working, which is gratuitous breakage
  the "beta, breaking changes accepted" policy does not actually call for (that policy is about not
  over-investing in compatibility shims, not about maximizing blast radius for no gain).
- `mergeConfig` (`config.ts:91-105`) keeps its existing whole-value-replace pattern for `docsDir`
  unchanged; only the type and a small "is this an array → multi-root mode" branch (in `composition.ts`,
  not `config.ts`) need to change.
- **Alternative, presented honestly**: a new key (`docsDirs` or `roots`) instead of overloading
  `docsDir`. Pro: avoids "string vs 1-element-array both mean one root, but with different path shapes"
  ambiguity entirely, and leaves room for a richer per-root shape (alias, later per-root exclude) without
  contorting `docsDir`'s original simple contract. Con: one more concept to document, and it diverges
  from the shape the user explicitly asked for. Given no strong technical reason favors the new key over
  the requested overload, **the recommendation stands with `docsDir: string | string[]`**, with the
  new-key path named here as the honest alternative should design disagree.

### Q5 — Root edge cases

- **Non-existent root** (motivating case: no `openspec/` in some project): today,
  `FileDocumentSource.walk` throws when the **root** `readdir` fails
  (`file-document-source.ts:44-52`), confirmed by the existing test
  `test/infrastructure/file-document-source.test.ts:99` ("still throws when the docs root itself cannot
  be read") and pinned by `openspec/specs/indexing/spec.md`'s "Read Failures Protect the Affected `path`
  Subtree From Deletion" requirement ("A failure to read the ROOT docs directory MUST still throw,
  unchanged"). Naively looping this per declared root would make `docsDir: ["docs", "openspec"]`
  **hard-crash indexing entirely** on any project lacking `openspec/` — directly breaking the change's
  own motivating example. This requires an explicit spec amendment: a missing/unreadable **declared**
  root, in multi-root mode, should be reported (folded into `skipped`/`readErrors`-shaped reporting, with
  the root's own path as the failing "file") and the run continues with the remaining roots; only when
  **every** declared root fails should the run throw (mirrors today's single-root "nothing to index"
  semantics, generalized to zero-of-N).
- **Nested/overlapping roots** (`docs` and `docs/adr`): under Option A, both resolve every file under
  `docs/adr` to the **identical** final prefixed path, reproducing Q2's INSERT-crash even with
  root-prefixing in place. Recommend rejecting this at config-load/container-construction time (same
  throw-early pattern as invalid JSON).
- **A root that is a parent of another**: same case as above, same recommendation (reject).
- **Absolute vs relative roots**: already tolerated today — `resolve(options.root, docsDir)`
  (`composition.ts:58`) passes an absolute second argument through unchanged per Node's documented
  `path.resolve` semantics; no new work needed to keep this working per-entry in an array.
- **Roots escaping the project root** (`../elsewhere`): pre-existing, not new to multi-root — a single
  `docsDir: "../elsewhere"` already works today with zero guard. Recommend treating as an explicit
  non-goal, same shape as the project's existing "Concurrent Readers ... Out of Scope" pattern, rather
  than solving it as part of this change.
- **Duplicate entries** (`["docs", "docs"]`): caught by the same equal-resolved-path validation as the
  nested-root case.

### Q6 — `exclude` patterns and `convention`

`exclude` today is **not** glob-based, contrary to what "patterns" might suggest — `isExcluded`
(`file-document-source.ts:84-86`) does exact equality only: `entry === path || entry === basename`. The
README confirms this framing precisely: "Filenames to skip when indexing" (`README.md:150`), not
"patterns". Today it is implicitly relative-to-`docsDir`, since the single `FileDocumentSource`'s walk
starts with an empty prefix at that root.

**A real, load-bearing finding for the motivating use case**: because `exclude` only matches whole file
paths/basenames, it **cannot exclude a directory at all** — not `openspec/changes/archive/`, not
anything hierarchical — short of listing every file individually. Measured: `openspec/` currently holds
**86 markdown files** (**79** across the 8 archived-change folders alone: `proposal.md`, `design.md`,
`exploration.md`, `tasks.md`, `verify-report.md`, `apply-progress.md`, `archive-report.md`, and each
change's own `specs/**/spec.md` deltas, plus the 6 active `openspec/specs/*/spec.md` files and
`testing-capabilities.md`) versus **2** files under `docs/` (`INDEX.md`,
`documentation-convention.md`) — a ~43x disparity. Indexing `openspec/` as a second root "as-is" would
technically work under Option A, but would flood `search_docs`/`docs_overview` with superseded
proposals, completed verify-reports, and archived process artifacts that are not current
documentation — directly undermining the value of the motivating use case, not just adding noise.
Recommend a small, additive extension to `isExcluded`: also match when a discovered path starts with
`<entry>/` (directory-prefix matching), which is enough to write `exclude: ["openspec/changes/archive"]`
without introducing full glob syntax (a much larger dependency/behavior surface this codebase does not
use anywhere else). This is a genuine scope decision, not a detail — flagged as a strongly recommended
companion to this change rather than folded in silently, per the review-budget concern in Q10.

**Per-root convention** (different frontmatter keys per folder): explicit **non-goal** for this change.
`ConventionPolicy`/`ConventionConfig` is built once, project-wide (`composition.ts:74`,
`createConventionPolicy(config.convention)`) with zero per-root indirection anywhere today. One
`convention` block continuing to apply uniformly across all declared roots is the natural,
YAGNI-respecting default; a future change can add per-root overrides if a real need appears.

### Q7 — Loose-mode `module` inference

`inferModule` (`src/domain/convention.ts:39-42`) takes the **first POSIX segment** of `path`. Under
Option A's root-prefixed paths, that segment becomes the root alias for every top-level file
(`docs/auth/login.md` → `"docs"` instead of today's `"auth"`) — a real regression in usefulness for
exactly the projects this feature targets, and it makes `docs_overview`'s `byModule` bucket by root
instead of by folder.

Recommend: keep `inferModule`'s existing per-root-relative meaning intact by having it strip a matching
declared root-alias prefix before taking the first segment (e.g. `inferModule(path, knownRootAliases)`),
so `docs/auth/login.md` still infers `module: "auth"` and `openspec/specs/search/spec.md` infers
`module: "specs"`. Single-root callers pass an empty `knownRootAliases` list, a structural no-op that
keeps today's behavior byte-for-byte (satisfying the "zero-config identical to today" requirement, and
not regressing any existing single-string-`docsDir` project either). "Which corpus this came from"
remains visible via the path prefix itself — root and module stay two different, both-useful signals
rather than collapsing into one. This is a small, contained change to one domain function plus its
resolver call sites; it is the one point where multi-root does touch `domain/`.

### Q8 — Incremental sync across roots

`SyncIndex.execute()` (`src/application/sync-index.ts:73-102`) diffs `source.discover()`'s flat `files`
against `store.listDocuments()` by `path`+`hash` — it has no notion of "root" at all. Given Option A
produces a flat, globally-unique `path` list (once the Q5 collision guard is in place), **`SyncIndex`
needs zero changes** — it already treats the corpus as a flat set.

- **Adding a root** to config: on the next sync pass (startup or throttled) or full `index`, the new
  root's files simply appear as unknown `path`s → indexed as new documents. No special detection
  mechanism needed.
- **Removing a root** from config: the next sync pass's `files` no longer contains that root's paths at
  all → `deleteMissingDocuments` (`sync-index.ts:165-178`) treats every one of them as "indexed but
  absent from disk" and **deletes** them, even though the files still physically exist on disk (just no
  longer a configured root). This is correct and consistent with existing single-root
  delete-on-absence behavior, but worth stating explicitly as an operational consequence: removing a
  root from config on a live `serve` process purges its indexed documents on the very next sync pass,
  not just "stops watching" it silently.
- The "Chunk Boundary Changes Require a Full Reindex" caveat (`openspec/specs/indexing/spec.md:490-505`)
  does **not** apply to root add/remove — that requirement is about the content-hash fingerprint not
  reaching *unchanged* content when chunking/heading logic moves; root add/remove is detected via **path
  presence/absence** in `files`, an entirely different mechanism that already works correctly without a
  full reindex.

### Q9 — Indexing `openspec/` specifically — measured, not assumed

Measured (file counts; no byte-size measurement was taken — this is a floor on file count):

- `docs/**/*.md` → **2 files** (`docs/INDEX.md`, `docs/documentation-convention.md`).
- `openspec/**/*.md` → **86 files**: 6 active `openspec/specs/*/spec.md` files (the largest,
  `indexing/spec.md`, alone is **546 lines**), `openspec/testing-capabilities.md`, and **79 files across
  the 8 archived change folders** (`proposal.md`, `design.md`, `exploration.md` — one example,
  `2026-08-07-addressable-chunks/exploration.md`, is **397 lines** on its own — `tasks.md`,
  `verify-report.md`, `apply-progress.md`, `archive-report.md`, plus each change's own
  `specs/**/spec.md` snapshot).

This is a genuine ~43x file-count disparity, and the archived-change content is qualitatively the
noisiest kind of documentation to serve through hybrid search: completed proposals, superseded design
decisions, and process reports that are true-as-history but not current guidance — exactly the kind of
content `convention.excludedStatuses` exists to filter for frontmatter-bearing docs, except these files
carry no such status field at all. This is the strongest evidence for Q6's directory-exclude
recommendation being load-bearing, not optional polish, for the motivating use case to actually deliver
value rather than just "technically index."

### Q10 — Blast radius and size forecast

**Spec deltas needed:**

- `openspec/specs/configuration/spec.md` — `docsDir` array shape, root-collision rejection, alias
  derivation.
- `openspec/specs/indexing/spec.md` — amend "Unreadable docs root still throws" to the
  per-root/all-roots-fail rule; new module-inference-with-roots requirement.
- `openspec/specs/index-md/spec.md` — combined-INDEX.md location, self-exclusion-with-roots fix.
- `openspec/specs/mcp-contract/spec.md` — root-prefixed `path` shape flowing through
  `search_docs`/`read_doc`/`docs_overview`.

**Tests needing updates or new files:** `test/infrastructure/config.test.ts`, a new composite-source test
(comparable in scope to the existing `test/infrastructure/file-document-source.test.ts`),
`test/domain/convention.test.ts` (module inference with roots),
`test/application/generate-index-md.test.ts`, `test/application/read-document.test.ts` (`resolve()` under
root-prefixed paths), likely `test/application/index-and-search.test.ts` (a multi-root integration case).

**Honest range, explicitly a floor**: code ~150-250 lines, spec deltas ~300-550 lines (this project's
spec style is verbose — Given/When/Then per scenario, several scenarios per requirement), tests ~300-600
lines, docs (README/CLAUDE.md) ~30-60 lines → **roughly 780-1460 changed lines as a floor**. This
project's own recorded history (the "forecast grows every phase" pattern: 240-420 at explore → 555-695 at
tasks → 773 real for one cycle; `incremental-reindex`'s forecast missing by 2x) says exploration-stage
estimates here have consistently landed low by 2-3x. Applying that multiplier honestly: **expect
somewhere in the 1500-2500+ line range by apply**, which clears the 400-line PR review budget by a wide
margin regardless of which end of the range is real. Recommend planning this as **chained/stacked PRs
from the start** (e.g. PR1: config shape + composite source + composition wiring + core tests; PR2:
module-inference-with-roots + directory-exclude extension; PR3: spec deltas + README/CLAUDE.md docs +
INDEX.md multi-root behavior) rather than a single PR — this is a call for `sdd-tasks`, not decided here,
but the forecast alone is reason enough to flag it now.

---

## Recommendation

Adopt **root-prefixed paths** (Option A from Q2), gated on `docsDir`'s runtime type (`string` = today's
exact single-root behavior, unprefixed; `string[]` = multi-root mode, prefixed), paired with three
structurally-necessary companions that are not optional add-ons but prerequisites for the design to hold:
(1) a root-collision/nesting validation at config load, without which Option A itself reproduces the
crash it was chosen to avoid; (2) relaxing "unreadable root throws" to a per-root report in multi-root
mode, without which the motivating "docs + openspec, and openspec might not exist" case hard-crashes;
(3) root-alias-aware `inferModule`, without which multi-root silently degrades `module` from a useful
per-folder signal to a useless per-root one. A directory-prefix `exclude` extension is strongly
recommended as a companion (not structurally required, but required for the motivating use case to be
*useful* given the measured 86-vs-2 file disparity under `openspec/`).

## Risks

- **Underestimated size, again.** This project's own forecast-accuracy history says treat the ~780-1460
  line floor as low by 2-3x; plan chained PRs from the start rather than discovering the overrun
  mid-apply.
- **The root-collision guard is easy to under-scope.** If design/apply implements Option A's prefixing
  without the nesting/duplicate-root validation, `docs` + `docs/adr` (or any nested pair) reproduces the
  exact SQLite UNIQUE-constraint crash this design exists to avoid — it must ship together with Option A,
  not as a follow-up.
- **The "unreadable root throws" relaxation is a spec-level behavior change**, not just an implementation
  detail — `openspec/specs/indexing/spec.md`'s existing requirement is a normative MUST that needs an
  explicit, reasoned amendment (not a silent code change that leaves the spec wrong).
- **Without the directory-exclude companion**, the motivating `docs` + `openspec` case technically works
  but serves ~86 mostly-archival files against 2 real docs — a materially worse outcome than the
  feature's own motivating story implies. Worth deciding explicitly in the proposal, not discovering
  after apply.
- **`ReadDocument.resolve`'s one-leading-segment tolerance** needs a fresh look (not necessarily a
  redesign — its exact-match-first ordering already provides the key safety property) once "one leading
  segment" means "a root alias" instead of "the docsDir name."
- **Q9's measurement is file-count only**, with no byte/token backing — file count alone is a reasonable
  proxy for noise, but a real byte/token measurement would strengthen the exclude-companion argument
  further before locking design.

## Ready for Proposal

**Yes**, with one open decision to settle in the proposal: whether the directory-prefix `exclude`
companion (Q6/Q9) ships bundled with this change or as an immediately-following one.
