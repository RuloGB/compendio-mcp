# Proposal: Multiple Documentation Roots

## Revision note — 2026-08-07 (supersedes the first version's config decision)

The first version of this proposal made `docsDir` a `string | string[]` union and justified it at
Approach 2 with a backward-compatibility argument: *"array-only would force every existing config to
change for no gain, which is gratuitous breakage."*

**That argument is void.** The user reaffirmed, explicitly and after being shown the artifacts, that
Compendio is in beta, that **nobody has it installed**, and that nothing in this change may be
designed to keep current indexes or current configs working (`openspec/config.yaml`,
`rules.proposal`; decisions of 2026-07-24, 2026-07-25, reaffirmed 2026-08-07). The set of configs the
union protected is empty, so it protected nothing and cost two whole classes of conditional
behaviour.

**The decision is now array-only: `docsDir: string[]`, default `["docs"]`, always prefixed.** No
union, no `multi` flag, no dual mode. The reasoning that survives — root-prefixed identity, the
collision guard, alias-aware `inferModule`, the unreadable-root amendment, directory-prefix
`exclude` — is carried forward unchanged. What changed is recorded here rather than quietly
overwritten, per this project's practice of keeping superseded reasoning legible.

`design.md` was written against the union and is revised separately, after this document.

## Intent

Compendio indexes one folder. `docsDir` is a single string (`src/infrastructure/config.ts:7`),
resolved once into one absolute path (`src/composition.ts:58`), handed to one `FileDocumentSource`
(`:72`) and one `FileIndexWriter` (`:82`). Whatever a project wrote outside that folder does not
exist as far as `search_docs` is concerned.

That is the wrong shape for how projects actually keep their written record. A team's decisions,
rationale and constraints are rarely all in `docs/` — they are in `adr/`, in `rfcs/`, in a spec
directory, in a process folder. **This repository is its own counter-example**: `docs/` holds
**2** markdown files, `openspec/` holds **87** (measured with `Glob`, 2026-08-07). The
intent-and-rationale content Compendio exists to serve — why a decision was made, which alternatives
were rejected, what a rule is meant to guarantee, exactly what the server instructions promise an
agent it will find here — lives almost entirely in the folder Compendio cannot see.

The workaround available today is to move or symlink files into `docs/`, which means reorganising a
repository to suit an indexing tool. The product answer is the opposite: the tool adapts to the
project. That is the same principle the `configurable-convention` cycle established for frontmatter,
applied to location.

**After this change a project declares one or more documentation roots and gets one searchable
corpus across all of them, with provenance visible in every result's `path`.**

### Why now

`docsDir` is the last remaining hard assumption about corpus shape. Everything else has already been
made project-defined: `type`/`module`/`status` are open strings, the convention is configurable, the
frontmatter keys are mappable, `excludedStatuses` is a project-declared deny-list. Location is the
outlier — and it is the one that decides whether a document is *reachable at all*, which makes it
strictly more limiting than any of the ones already fixed.

There is also a structural window. The exploration's load-bearing finding is that **`src/application/`
and `src/domain/` never assume "one root" — they assume "one `DocumentSource`"**
(`src/domain/ports.ts:48-50`). `IndexDocuments`, `SyncIndex`, `GenerateIndexMd` and `ReadDocument`
call `source.discover()` once and iterate a flat list; none of them reads `docsDir`. Multi-root is
therefore an infrastructure-and-composition-root change, not an architectural one — the hexagonal
seam already anticipated it. Exactly one domain function is genuinely touched (`inferModule`), for a
reason stated below.

### The failure mode this change must not ship

`path TEXT UNIQUE NOT NULL` (`src/infrastructure/sqlite/sqlite-index-store.ts:48`) is the sole
document key, and `IndexDocuments.execute()` calls `this.store.saveDocument(meta, chunks)` — a plain
`INSERT` — **with no `try`/`catch`** (`src/application/index-documents.ts:106`), unlike every
neighbouring failure mode in that same loop. Two roots each containing `a.md`, both discovered as the
root-relative `a.md`, produce a UNIQUE-constraint violation that propagates uncaught past
`IndexDocuments` to the CLI's top-level `.catch()` (`src/cli.ts:297-300`) and aborts the entire
`compendio index` run.

Read that against this codebase's resilience philosophy — `skipped`, `readErrors`, `noMatchReason`,
`filterWarning`, `embeddingsWarning` are all loud-and-continue — and it is the single worst-behaved
failure path the project would own. Path identity is not a detail of this change; it is the change.

## What array-only buys, stated plainly

This is the payoff of the revision, not a side effect, so it is stated before the scope.

**1. The `path` shape no longer depends on how many roots were declared.** Under the union, the same
file was `x.md` with `docsDir: "docs"` and `docs/x.md` with `docsDir: ["docs"]` — a path shape that
changed when a project added its *second* root, retroactively re-addressing its *first* one. Now
there is one shape: `<alias>/<root-relative path>`, from one root to ten.

**2. `exclude` no longer changes meaning with the mode.** The union forced the same entry to match
root-relative paths under a string `docsDir` and prefixed paths under an array (`design.md:317-321`
made this explicit and had to defend it in `README.md`). Now there is one rule, and it is the rule a
user can actually hold: **`exclude` matches what `search_docs` returns.**

**3. Everything previously conditional becomes unconditional.** Prefixing, per-root failure
reporting, alias-aware `module` inference and the collision guard were all gated on "multi-root
mode". There is no mode. Every one of them runs on every run, which is also why every one of them is
covered by the default path rather than by an opt-in nobody exercises.

### The cost, named honestly: zero-config behaviour changes

With **no config file at all**, `docs/documentation-convention.md` becomes the indexed `path`, where
today it is `documentation-convention.md`. That is a real change to the default experience, and it is
now correct rather than a cost:

- **The prefixed path *is* the project-root-relative path.** For a top-level root — the motivating and
  default shape — `docs/documentation-convention.md` names the file exactly where it sits on disk.
- **`ReadDocument.resolve` gets more correct, not less.** Its one-leading-segment tolerance
  (`read-document.ts:44-50`) tries the literal path first; a caller holding the on-disk
  `docs/func/x.md` now hits the **exact** branch instead of the strip fallback. The fallback survives
  for genuine over-prefixing (`repo/docs/x.md`).
- **The consequence in the other direction, stated:** `read_doc({ path: "x.md" })` — a bare basename
  that used to resolve in the zero-config case — now misses, and returns the documented
  `path-not-found` with the 3 closest matches. It degrades into the recovery path the tool already
  owns, rather than into an error.

The uniform shape is the better shape. The union existed only to protect an empty set of users.

## Scope

### In Scope

- **`docsDir` is `string[]`** (`src/infrastructure/config.ts:7`, `:54`, `:93`). Default `["docs"]`.
  There is no single-string form and no `multi` flag. A one-element array is not a special case.
- **Root-alias-prefixed document paths, always.** Every emitted `DocumentFile.path`, `ReadError.path`
  and `EncodingNotice.path` carries its root's alias (`docs/x.md`,
  `openspec/specs/indexing/spec.md`). Those are the values that flow into `search_docs`, `read_doc`,
  `docs_overview` and `INDEX.md`.
- **A composing `DocumentSource` adapter** that fans out to N per-root `FileDocumentSource`
  instances, merges their results and re-sorts by `path` (preserving the sorted-output contract at
  `file-document-source.ts:32`). `FileDocumentSource` stays the per-root primitive. It runs for a
  one-element root set too — that is what removes the branch.
- **A collision guard that rejects an invalid root set before anything is written**: two roots
  resolving to the same directory, one root nested inside another (**in either declaration order**),
  or two roots deriving the same alias.
- **Per-root unreadable-root handling, uniformly.** A declared root that cannot be read is reported
  and the run continues on the remaining roots; the run throws only when *every* declared root fails.
  **This is a normative spec amendment**, see "Required spec action".
- **Root-alias-aware `inferModule`** (`src/domain/convention.ts:39-42`), so `module` keeps meaning
  "the folder this document sits in" rather than degrading into "which root it came from".
- **Directory-prefix `exclude` matching** (`file-document-source.ts:84-86`). Today `isExcluded` is
  exact equality on the full relative path or the basename, so it **cannot exclude a directory at
  all**. Extended to `entry === path || entry === basename || path.startsWith(entry + "/")`, matched
  against the emitted (prefixed) path. Explicit user decision, 2026-08-07: this ships **inside** this
  change.
- **One combined `INDEX.md`**, written into the first declared root, listing every document from
  every root under its prefixed path — plus repair of the three now-dead `INDEX_FILE` equality checks
  (below).
- **Re-addressing the retrieval regression suite.** `ejemplos/goldenset.yaml`'s **22** `esperado`
  values are root-relative (`leadsviewer/validacion-formulario.md`) and `EvaluateSearch` compares
  them by exact string (`evaluate-search.ts:49`). Under unconditional prefixing every one of them
  misses. See Risks — this is a verified finding, not a hypothetical.
- **Spec deltas** across `configuration`, `indexing`, `index-md` and `mcp-contract`, and prose in
  `README.md` and `CLAUDE.md`.

### Out of Scope

| Item | Why |
|---|---|
| **A `string` form of `docsDir`, or any dual mode** | The decision this revision exists to record. Beta, no installed users; the union protected an empty set and cost two classes of conditional behaviour |
| **Per-root `convention` blocks** | `ConventionPolicy` is built once, project-wide (`composition.ts:74`), with zero per-root indirection anywhere. One convention applying uniformly is the YAGNI-respecting default |
| **Per-root `exclude` blocks** | The directory-prefix extension already expresses `openspec/changes/archive` against the prefixed path. A per-root map doubles the config surface for nothing this change needs |
| **Full glob syntax in `exclude`** | This codebase uses no glob dependency anywhere. Directory-prefix matching covers the motivating case; a glob engine is a materially larger dependency and behaviour surface |
| **Roots escaping the project root** (`../elsewhere`) | Pre-existing, not new: a single `docsDir: "../elsewhere"` already works today with zero guard. Declared a non-goal, same shape as the existing "Concurrent Readers … Out of Scope" pattern |
| **A multi-valued `--dir` CLI flag** | Decided: `--dir` stays single-valued — see Approach decision 7 |
| **Per-root `INDEX.md` files** | Would force `IndexMdReport` (`generate-index-md.ts:7-19`, `path: string` / `documents: number`) to become array-shaped, for a benefit nobody requested |
| **An explicit per-root alias object form** (`[{ path, alias }]`) | Basename-derived aliases cover the motivating case. The object form is a purely additive future extension. The collision guard is what makes deferring it safe — an alias clash is rejected loudly rather than silently merged |
| **A `root` / `source` SQLite column** (exploration Q2 Option B) | Re-implements Option A's information across two fields, forces a second parameter onto every `IndexStore` method keyed by `path`, and breaks `read_doc({ path })` as a one-parameter address. Rejected in Approach decision 1 |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users; breaking the public contract is an accepted cost (`openspec/config.yaml`, `rules.proposal`) |
| **Translating the pre-existing Spanish error strings** (`file-document-source.ts:49`, `config.ts:85`) | Out of scope as a cleanup. But the root-failure message *this change rewrites*, and every new validation message, MUST be English per the project language contract |

## Capabilities

### New Capabilities

- None as a new spec domain. Multi-root is a generalisation of existing `configuration`, `indexing`,
  `index-md` and `mcp-contract` behaviour, not a new capability area.

### Modified Capabilities

- **`configuration`** — `docsDir` is a non-empty array of strings; declared roots are validated for
  duplication, nesting (both orders) and alias collision, and an invalid set is rejected at
  container construction rather than producing a partially indexed corpus. `exclude` entries
  additionally match a directory prefix, always against the emitted path.
- **`indexing`** — document `path` is root-alias-prefixed, unconditionally; the unreadable-root MUST
  is amended (below); `module` inference is defined relative to the containing root, not to the
  corpus.
- **`index-md`** — one combined index, written into the first declared root, listing prefixed paths;
  the "never lists itself" guarantee is restated so it holds under prefixed paths.
- **`mcp-contract`** — the `path` values returned by `search_docs`/`docs_overview` and accepted by
  `read_doc` carry the root prefix, always.

### Required spec action (not optional)

`openspec/specs/indexing/spec.md:350` states, as a normative MUST: *"A failure to read the ROOT docs
directory MUST still throw, unchanged — an unreadable docs root is a configuration error, not a
transient per-subtree hiccup."* The scenario at `:358-362` pins it, and
`test/infrastructure/file-document-source.test.ts:99` pins it in code (verified 2026-08-07: the test
constructs `new FileDocumentSource(dir, [])` and asserts `discover()` rejects).

Looped naively per declared root, that MUST turns the change's own motivating example into a hard
crash: `docsDir: ["docs", "openspec"]` in any project without an `openspec/` folder aborts indexing
entirely. `sdd-spec` **MUST** emit a delta amending it. Array-only makes the amended rule **uniform**,
which is simpler than the version this proposal first carried — there is no single-root mode to carve
out:

> A declared root that cannot be read is reported as a read failure whose `path` is the root's alias,
> and the run continues on the remaining roots. The run throws only when **every** declared root
> fails.

**One consequence the union deliberately avoided, and that array-only makes unavoidable — the
revised design must settle it rather than leave it implied.** With no single-root mode, the
corpus-level "unreadable root throws" behaviour is owned by whatever layer converts a per-root
failure into a `ReadError`. **Which layer throws is now a design decision, not a leftover:**

- If `FileDocumentSource` keeps throwing at its own root and the composite catches and converts,
  then `file-document-source.test.ts:99` passes **unchanged** — it is a unit test on the primitive,
  and the primitive's contract is untouched. The observable change is one level up: a one-root set
  whose root is unreadable now surfaces the composite's aggregate message, not the raw one.
- If the design instead moves the throw out of `FileDocumentSource`, `:99` **cannot** pass unchanged,
  and the test must be rewritten with its intent restated rather than deleted.

Either split is defensible. Discovering which one was taken at verify time is not. `sdd-design` must
name the layer explicitly and say what happens to `:99`.

Two further spec facts to carry: `indexing/spec.md:106` documents `module` as "First path segment
under `docsDir`" (needs the root-relative restatement), and the one-leading-segment `read_doc`
tolerance is currently **spec-silent** — it exists only in `read-document.ts:32-50` and `CLAUDE.md`.
This change alters what "one leading segment" means, so pinning it now is strongly recommended;
`sdd-spec` owns the call.

## Approach

Root-prefixed paths, unconditionally. Stated as decisions with rationale, because the later phases
must not re-litigate them.

**1. Identity lives in `path`, not in a new column.** The corpus needs one globally unique key per
document because `path` *is* the key — `getDocumentByPath` (`sqlite-index-store.ts:385-390`),
`deleteDocument` (`:221-230`), `upsertDocument`'s existing-row lookup (`:243,255`), and every
`SearchResultItem.path` / `OverviewLine.path` / `IndexEntry.path`. Prefixing keeps that single key
and buys three things a `(root, path)` composite would not: the SQLite schema comes out
byte-identical, `SyncIndex` needs zero changes (it diffs a flat `path`+`hash` list and has no notion
of root at all — `sync-index.ts:73-102`), and `read_doc({ path })` stays a one-parameter address.
Provenance becomes *readable* rather than a second field the caller must learn.

**2. There is no mode, and that is the decision this revision records.** `docsDir: string[]`, default
`["docs"]`, every path prefixed, every root run through the same composing adapter regardless of how
many there are. The previous version's Approach 2 ("single-string `docsDir` is byte-identical to
today") is **withdrawn**: it rested on protecting existing configs, and there are none. The
properties it was buying — no surprise for existing users — are replaced by a stronger one: there is
only one behaviour to reason about, so there is no combination in which the wrong one runs.

**3. The alias is the basename of the declared root.** `"docs"`, `"openspec"`. Sufficient for the
motivating case, requires no new config surface, and makes the prefixed path readable. The collision
guard is what makes it safe to defer an explicit-alias form.

**4. The collision guard is a prerequisite, not a follow-up — and it must compare ordered pairs in
both directions.** Nested roots (`docs` and `docs/adr`) resolve every file under `docs/adr` to the
*identical* final prefixed path, reproducing the exact uncaught `INSERT` crash prefixing was chosen
to avoid, with prefixing fully in place. Duplicates (`["docs","docs"]`) and alias clashes
(`["a/docs","b/docs"]`) do the same.

Two measured constraints on the implementation, carried forward from the resolved probe (ran
2026-08-07, win32, Node v22.22.0 — this repo's floor):

- **Implement the predicate with `path.relative`, not with string equality of resolved paths.**
  `resolve(a) === resolve(b)` is **`false`** for `C:\A\docs` vs `C:\a\docs`, so a guard written to
  the literal prose "two roots that resolve to the same absolute path" misses case-differing
  duplicates on the development platform and lets the UNIQUE-constraint crash through.
  `path.relative` **is** case-insensitive on win32 (`relative('C:\A\docs','C:\a\docs')` → `""`), so
  no `toLowerCase()` clause is needed.
- **Sweep every ordered pair `(a, b)` with `a ≠ b`.** Measured:
  `relative('C:\A\docs\adr', 'C:\A\docs')` → `".."`, which a one-directional containment predicate
  reads as *not* contained. So `docsDir: ["docs/adr", "docs"]` — the inner root declared **first** —
  passes a one-directional sweep and reproduces exactly the double-discovery the guard exists to
  reject. This needs its own test case, with the inner root declared first.

Rejecting at container construction follows `loadConfig`'s existing throw-on-invalid-JSON precedent
(`config.ts:83-87`). This is the one new validation that earns its place: unlike a wrong `docsDir`
*type* (untyped throughout this loader by deliberate design — `config.ts:88` is a bare cast over
`JSON.parse`), an undetected collision has a concrete, catastrophic failure mode.

**5. `exclude` MUST be evaluated against the path the caller will see.** If the composite prefixes
*after* discovery, then `FileDocumentSource` still tests `exclude` against the root-relative
`changes/archive/...`, and the motivating `exclude: ["openspec/changes/archive"]` matches **nothing**
— the feature ships, the config looks right, and 79 archived files get indexed anyway. The obvious
fix — seed `walk`'s `prefix` with the alias instead of `""` — collides with the other obvious thing
in the file: `walk` detects "this is the root" by `prefix === ""` (`file-document-source.ts:47`), so
seeding the prefix silently disables the root-failure throw. The two natural implementations
interact; design must choose deliberately and both properties must be tested independently (Gates 2c
and 4′).

Array-only sharpens this rather than softening it: there is no unprefixed path in existence anywhere,
so "which string did we test against?" has exactly one answer per file.

**6. Alias-awareness must not leak into the user-facing config.** `inferModule` is called from
`createLoosePolicy`'s resolver (`convention.ts:71`), which only sees `ConventionConfig` and
`FrontmatterInput`. The aliases are *derived* state, not something a project declares — adding a
`rootAliases` key to `ConventionConfig` would put it inside the block `mergeConfig` reads from a
project's JSON, against that function's explicit-whitelist discipline (`config.ts:98-101`). Whether
the aliases ride on the policy factory or on `FrontmatterInput` is design's call; that they are never
a declarable config key is fixed here.

**7. `--dir` stays single-valued, and no longer changes the path shape.** `--dir` is a scoping
override — "replace the corpus with this one directory" — and keeping it single-valued means it has
exactly one meaning and needs no commander variadic handling. Under array-only, `composition.ts`
normalizes it into a one-element root set (`options.docsDir !== undefined ? [options.docsDir] :
config.docsDir`), so `resolveRoots` takes a single `string[]` and **no union type survives anywhere
in the codebase**. `--dir docs` produces `docs/x.md`, identical to declaring `["docs"]`.
`ContainerOptions.docsDir?: string` (`composition.ts:29`) is unchanged. The one genuinely surprising
thing about the flag — that it *replaces* rather than *adds* — still needs documenting.

**8. One combined `INDEX.md`, in the first declared root.** Its lines are plain text —
`- [type] path — summary (status)` (`index-markdown.ts:41`) — **not markdown links**, so a combined
`docs/INDEX.md` listing `openspec/...` paths creates no broken relative links.

Three exact-equality checks against the literal `"INDEX.md"` go dead under prefixed paths, not one:
`generate-index-md.ts:41` (the `readErrors` filter), `:46` (the self-exclusion guard) and `:77` (the
`encodingNotices` filter). The exploration named only `:46`. Under default config the
`FileDocumentSource` basename exclusion (`config.ts:55` + `file-document-source.ts:85`) hides all
three, so they fail only when a project overrides `exclude` — a silent, conditional dead guard, which
is precisely the shape this project refuses to leave in place.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/infrastructure/config.ts:7,54,93` | Modified | `docsDir: string[]`, default `["docs"]`; root normalization; duplicate/nesting/alias validation over ordered pairs |
| `src/infrastructure/fs/composite-document-source.ts` | **New** | Fans out to N `FileDocumentSource`s, merges, re-sorts; per-root failure reporting; runs for one root too |
| `src/infrastructure/fs/file-document-source.ts:44-52,84-86` | Modified | Directory-prefix `exclude`; the `prefix === ""` root detection interacts with alias seeding (Approach 5). Its Spanish root-failure message is rewritten in English |
| `src/composition.ts:29,58,72,82` | Modified | `--dir` normalized to a one-element array; alias derivation; single unconditional wiring path; writer target = first root |
| `src/domain/convention.ts:39-42,71` | Modified | Alias-aware `inferModule`. **The only domain change**; no new dependency enters `src/domain/` |
| `src/application/generate-index-md.ts:41,46,77` | Modified | Three dead `INDEX_FILE` equality checks (Approach 8) |
| `src/application/read-document.ts:44-50` | **Re-verified, likely unchanged** | The tolerance is safe by construction (exact match first) and its motivating case becomes the exact branch. Needs a fresh test pass, incl. the bare-basename miss |
| `src/application/sync-index.ts` | **Unchanged — asserted** | Flat `path`+`hash` diff; needs zero changes once paths are globally unique. Any edit here means identity was not solved at discovery |
| `src/infrastructure/sqlite/sqlite-index-store.ts:48` | **Unchanged — asserted** | The DDL must come out byte-identical. A schema change means the design took Option B, which is scoped out |
| `scripts/vector-reach.mjs:204` | Modified | `resolve(root, config.docsDir, markerChunk.path)` throws `TypeError [ERR_INVALID_ARG_TYPE]` under an array config — now **unconditionally**, since no string form survives. Silently disables the manual chunking gate |
| `ejemplos/goldenset.yaml` | Modified (addresses only) | **22** `esperado` values re-prefixed. Not a translation: the corpus, its prose and its filenames stay Spanish and untouched |
| `test/helpers/build.ts:80-89` | Extended | `buildHarness` constructs `FileDocumentSource` directly with no prefix while its comment claims to mirror production wiring. Must prefix, or the comment must be corrected and the gap covered elsewhere |
| `test/application/{index-and-search,read-document,evaluate}.test.ts` | Extended | **19** unprefixed `ejemplos/docs` path literals across these 3 files (measured), plus a multi-root integration case |
| `test/infrastructure/config.test.ts` | Extended | Array shape; every rejection case incl. inner-root-first nesting. `:62-70`'s single-string round-trip **no longer applies** and must be restated as an array |
| `test/infrastructure/` (new) | New | Composite-source tests, comparable in scope to the existing `file-document-source.test.ts` |
| `test/domain/convention.test.ts:75` | Extended | Module inference with and without aliases |
| **A new container-level test** | **New** | **No test in the suite calls `createContainer` today** (measured: 0 occurrences). The zero-config path shape is therefore untested by construction — see Risks |
| `openspec/specs/{configuration,indexing,index-md,mcp-contract}/spec.md` | Modified | Deltas, including the required amendment above. `search/spec.md` to be checked for path-shape claims |
| `README.md:132,148-150` · `CLAUDE.md` | Modified | `docsDir` as an array, the always-prefixed path shape, directory-`exclude` semantics, `--dir` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The goldenset breaks silently and the automated suite stays green.** `ejemplos/goldenset.yaml`'s 22 `esperado` values are unprefixed and `EvaluateSearch` compares by exact string (`evaluate-search.ts:49`), so `compendio eval` goes to MRR 0 / recall 0. **But no automated test would notice**: `evaluate.test.ts` runs through `buildHarness`, which builds `FileDocumentSource` directly with no prefix. Verified 2026-08-07 — this is exactly the "tests green, function invisible" shape this project has been burned by | **High** | Gate 1, rewritten around it. `goldenset.yaml` re-addressing lands in the **same PR** as prefixing, never later |
| **The suite is structurally blind to the change's most visible effect.** Zero tests call `createContainer`; every integration test bypasses config and composition entirely | **High** | A container-level test is a named deliverable, not a nice-to-have. Gate 1b asserts the zero-config path shape through `createContainer` |
| **The collision guard gets under-scoped** — shipping prefixing without nesting/duplicate/alias rejection, or with a one-directional containment sweep, which the measured `relative('C:\A\docs\adr','C:\A\docs')` → `".."` result shows lets `["docs/adr","docs"]` straight through | **High** | Gate 5, blocking, with the inner-root-first case explicit. It must ship in the same PR as prefixing |
| **`exclude` is matched against the wrong path** (Approach 5), so the motivating exclusion silently no-ops and 79 archived files are indexed anyway | **High** | Gate 2c asserts **zero** indexed paths under `openspec/changes/archive/`. Would read 79 if wrong — the loudest possible failure |
| **Size overrun.** The forecast below is a floor, and this project's forecasts have landed 2-4x low three cycles running | **High** | Chained PRs recommended from the start (below); the review-workload gate resolves the shape at `sdd-tasks`, not mid-apply |
| **Alias seeding silently disables the root-failure throw** (`prefix === ""`, `file-document-source.ts:47`) | Med | Gate 4′ constructs `FileDocumentSource` with a **non-empty** prefix against an unreadable root and asserts it still rejects. Nothing else in the suite would notice |
| **`ReadError.path` for a failed root carries the declared path instead of the alias** → silent data loss. `sync-index.ts:225-226`'s `isProtected` keys delete-protection on the persisted **prefixed** path, so a transiently unreadable nested root (`packages/app/docs` → alias `docs`) matches nothing and `deleteMissingDocuments` purges its whole corpus on the next `serve` sync pass — with a green suite | Med | Gate 4″: a `ReadError` whose `path` is the alias protects its subtree from deletion. Normative in the `indexing` delta, not incidental |
| **The unreadable-root relaxation is a normative MUST change**, and array-only forces the "which layer throws" question into the open | Med | "Required spec action" above; `sdd-design` must name the layer and state what happens to `file-document-source.test.ts:99` |
| **`module` degrades from a folder signal to a root name**, making `docs_overview`'s `byModule` useless for exactly the projects this targets | Med | Gate 3, which fails on a single assertion: `docs/documentation-convention.md` must have **no** `module` |
| **Removing a root from a live `serve` purges its documents.** `deleteMissingDocuments` (`sync-index.ts:165-178`) treats absent-from-`files` as deleted, even though the files still exist on disk | Med | Correct and consistent with single-root delete-on-absence, but an operational consequence to **document**, not to special-case. Belongs in the `indexing` delta and `CLAUDE.md` |
| **Corpus dilution.** 87 openspec files against 2 docs files: even with the archive excluded, this repo's own corpus becomes mostly spec prose | Med | Directory-prefix `exclude` is in scope precisely for this. Recorded observation (not a gate): byte/token weight per root, which settles the exploration's file-count-only measurement |
| **`read_doc({ path: "x.md" })` stops resolving** in the zero-config case | Low | Degrades into the documented `path-not-found` + 3 closest matches, which is the recovery path the tool already owns. Named in a `mcp-contract` scenario so it is a decision, not a surprise |
| **`scripts/vector-reach.mjs` breaks**, silently disabling the manual chunking gate | Low | Now unconditional rather than array-only, so it cannot be missed. Gate 7 runs the script end to end |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`. Array-only makes rollback **simpler than the
union version**, because there is no config-shape ambiguity to reason about — but it makes it
**broader**, because the default path changed too.

1. Revert the change commits and `npm run build`.
2. **Revert every `compendio.config.json` that declares `docsDir` back to a string in the same step.**
   Under reverted code an array reaches `resolve(options.root, config.docsDir)` (`composition.ts:58`)
   and throws `TypeError [ERR_INVALID_ARG_TYPE]` at container **construction** — so *every* command
   fails, `search`, `serve` and `overview` included, not just `index`. Binary and config must move
   together; this is what makes the rollback ordered rather than atomic.
   **A project with no config file needs no step 2** — reverted code reads the reverted `"docs"`
   default. That is now the common case, since array-only means most projects never declared
   `docsDir` at all.
3. **Revert `ejemplos/goldenset.yaml` with the code.** Its 22 addresses are prefixed after this
   change and unprefixed before it. Leaving them out of the revert leaves `compendio eval` reporting
   MRR 0 against a correctly-working build — a false red that costs more to diagnose than the
   rollback itself.
4. Run a full `compendio index`. Persisted paths are prefixed; reverted code would see every one of
   them as absent from disk and `deleteMissingDocuments` would purge them one sync pass later anyway.
   `index`'s `reset()` (drop-and-recreate) reaches the correct state in one step instead of by
   attrition.
5. Restart any running `compendio serve`.

**No DDL to undo and no data at risk.** The schema is unchanged by construction (asserted in Affected
Areas), so `migrate()` and `reset()` are untouched and no `.compendio/` directory needs deleting. The
only artifacts carrying new-format values are the generated `INDEX.md` (step 4 rewrites it) and the
goldenset (step 3).

## Dependencies

- **Zero new npm dependencies.** No glob engine — that is a stated non-goal, and its absence is what
  keeps the directory-prefix extension small.
- **This repository is the multi-root test corpus.** `docs/` (2 files) + `openspec/` (87, of which 79
  under `changes/archive/`) is the motivating case, measured, committed and free. No fixture corpus
  needs generating for Gates 2 and 3.
- **`ejemplos/` stays Spanish and unmodified as a corpus.** The only edit is 22 `esperado` addresses
  in `goldenset.yaml` — path syntax, not language. No prose, no filename and no frontmatter value
  changes; the retrieval baseline stays comparable because the same document is still expected for
  the same question.
- **Existing instruments reused**: `compendio eval`, `compendio index-md`, `scripts/vector-reach.mjs`.
- **`test/helpers/fake-embeddings.ts`** for the automated multi-root integration case — none of these
  gates measures retrieval quality except Gate 1, so only Gate 1 needs the model.

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement
contradicting the reasoning — not on a tolerance band around a prediction (`CLAUDE.md`, Gate 2
precedent). A gate that cannot fail is not a gate.

### Gate 1 — Prefixing costs exactly one segment and nothing else (BLOCKING)

**Replaces the previous version's "single-root is byte-identical" gate, which array-only makes
meaningless.** Against `ejemplos/` (11 indexed documents, **no config file** — the zero-config path):

- [ ] Every indexed `path` equals its pre-change value with exactly `docs/` prepended, and nothing
      else moved: same set, same count, same order under `docs_overview`.
- [ ] With `goldenset.yaml`'s 22 addresses re-prefixed, `compendio eval` reports MRR ≥ 0.943,
      recall@5 = 1.00, top-1 ≥ 20/22 — **identity, not a band**. The corpus, the chunking and the
      embeddings are untouched by this change, so any movement means something other than the path
      prefix changed.
- [ ] Recorded in `verify-report.md`: the eval numbers **before** the goldenset is re-addressed.
      Expected MRR 0.000, recall 0.00. This is the assertion that proves the goldenset re-addressing
      was load-bearing rather than cosmetic — and that the suite's green state was blindness.

**STOP condition.** Metrics moving after re-addressing means prefixing did more than prefix.

### Gate 1b — The zero-config path shape is asserted through `createContainer` (BLOCKING)

- [ ] An automated test constructs a container over a temp project **with no config file** and asserts
      the indexed paths carry the `docs/` prefix.

**STOP condition.** Today zero tests call `createContainer` (measured). Without this gate the change's
single most visible effect has no automated coverage at all, and this project's record on
green-suite-with-broken-function is why the gate exists.

### Gate 2 — The motivating case runs, on this repository (BLOCKING)

`compendio index` at the repository root with
`{ "docsDir": ["docs", "openspec"], "exclude": ["INDEX.md", "openspec/changes/archive"] }`:

- [ ] **a.** The run completes with exit code 0. **No SQLite UNIQUE-constraint error, at all.**
- [ ] **b.** `indexed` equals `count(docs/**/*.md) + count(openspec/**/*.md not under
      changes/archive/) − 1` (for `docs/INDEX.md`), **computed at gate time and both numbers recorded
      in `verify-report.md`**. Measured 2026-08-07: `2 + 8 − 1 = 9`. The formula, not the constant, is
      the gate — this change's own artifacts land under `openspec/changes/multiple-doc-roots/` and
      move the count.
- [ ] **c.** **Zero** indexed paths begin with `openspec/changes/archive/`. Reads **79** if the
      directory-prefix `exclude` did not take effect (Approach 5's silent-failure mode).
- [ ] **d.** Every indexed path begins with `docs/` or `openspec/`.
- [ ] **e.** `search_docs` for a term present only under `openspec/` returns a result, with its root
      prefix visible in `path`, and that `path` passed verbatim to `read_doc` resolves.

**STOP condition.** (a) failing means identity was not solved. (c) reading 79 means `exclude` is
being matched against the wrong path.

### Gate 3 — `module` is still a folder signal, not a root name (BLOCKING)

Same run as Gate 2:

- [ ] `docs/documentation-convention.md` has **no** `module`. It is root-level *within its root*;
      naive prefixing would give it `"docs"`. **This single assertion falsifies a missing
      alias-aware `inferModule`** and is the cheapest gate in the set.
- [ ] `openspec/specs/indexing/spec.md` has `module: "specs"`, not `"openspec"`.
- [ ] `docs_overview`'s `byModule` contains no bucket named `docs` or `openspec`.

### Gate 4 — A missing root does not crash the motivating shape (BLOCKING)

- [ ] `docsDir: ["docs", "openspec"]` against a project with **no** `openspec/` directory: the run
      completes, every `docs/` document is indexed, and the unreadable root is reported (in
      `skipped`/`readErrors` shape).
- [ ] **4′ — the seeded-prefix trap.** `FileDocumentSource` constructed against an unreadable root
      **with a non-empty prefix** still rejects. This is the assertion that fails if root detection is
      left riding on `prefix === ""`; nothing else in the suite would notice.
- [ ] **4″ — a failed root protects its subtree.** A `ReadError` whose `path` is the root's **alias**
      leaves that root's documents undeleted through a `SyncIndex` pass. Fails if `ReadError.path`
      carries the declared path — the silent-data-loss case.
- [ ] **Every** declared root unreadable: still throws.
- [ ] The layer that throws is the one `sdd-design` named, and
      `test/infrastructure/file-document-source.test.ts:99` either passes unchanged or was rewritten
      deliberately with its intent restated. **Not** deleted, and not discovered here.

**STOP condition.** The first bullet failing means the change hard-crashes its own motivating example.

### Gate 5 — The collision guard fires before anything is written (BLOCKING)

Each of `["docs", "docs/adr"]` (nesting), **`["docs/adr", "docs"]` (nesting, inner root declared
first — the measured one-directional-sweep escape)**, `["docs", "docs"]` (duplicate), a
case-differing duplicate on win32, `["a/docs", "b/docs"]` (alias clash) and `[]` (empty):

- [ ] Rejected at container construction, with an error naming the offending declared strings.
- [ ] **No `.compendio/` directory exists afterwards** in a fresh temp project — stronger than "the
      database is not reset", and true only if the guard precedes `new SqliteIndexStore`.

**STOP condition.** If any of these reaches `saveDocument`, root-prefixing has reproduced the exact
crash it was chosen to avoid, and the design has failed on its own terms.

### Gate 6 — `INDEX.md`

- [ ] A combined `INDEX.md` lands in the **first** declared root, listing documents from every root
      under their prefixed paths.
- [ ] `INDEX.md` never lists itself, **including with `exclude` overridden to `[]`**. That case is the
      only one that exercises the three dead equality checks
      (`generate-index-md.ts:41,46,77`); without it the gate passes for free.

### Gate 7 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] `src/application/sync-index.ts` and the `documents` DDL (`sqlite-index-store.ts:48`) are
      unchanged. An edit to either means identity was not solved at discovery.
- [ ] `scripts/vector-reach.mjs` runs end to end against `test/fixtures/vector-reach`. It cannot be
      skipped as "single-root only" any more — there is no single-root form.

### Recorded observations (not gates)

- [ ] Byte and estimated-token weight per root for the Gate 2 corpus, written into
      `verify-report.md`. Settles the exploration's Q9 limitation (file count only).
- [ ] Whether any `search_docs` query in the Gate 2 corpus returns a spec-delta file in preference to
      the active spec — the dilution symptom, observed rather than acted on.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Path identity mechanism | **Root-prefixed `path`** (exploration Q2 Option A). No `root` column, no composite key, no schema change |
| Config shape | **`docsDir: string[]`, default `["docs"]`.** Array-only. **Revised 2026-08-07** — the previous `string \| string[]` union was justified by protecting existing configs, and there are none |
| Mode gate | **None.** There is no mode. A one-element root set behaves exactly like a ten-element one |
| Zero-config path shape | **Prefixed**: `docs/x.md` with no config file. Accepted and deliberate — it *is* the project-root-relative path |
| Alias derivation | **Basename of the declared root.** Explicit-alias object form deferred; the collision guard makes deferring it safe |
| Collision predicate | **`path.relative`, ordered pairs, both directions.** Measured: `resolve(a) === resolve(b)` misses case-differing duplicates on win32; a one-directional sweep misses `["docs/adr","docs"]` |
| Directory-prefix `exclude` | **In scope, this change.** `entry === path \|\| entry === basename \|\| path.startsWith(entry + "/")`. **Not** glob syntax |
| Which path does `exclude` match? | **The prefixed path the caller sees — one rule, always.** No longer mode-dependent |
| Unreadable declared root | **Reported per root, run continues; throws only when all roots fail.** Uniform. Requires a normative spec amendment **and** an explicit design statement of which layer throws |
| `ReadError.path` for a failed root | **The alias, not the declared path.** `sync-index.ts:225-226` keys delete-protection on the prefixed path; the declared string goes in the message |
| `inferModule` | **Alias-aware**, so `module` stays per-folder. Aliases are derived state and MUST NOT become a declarable config key |
| `INDEX.md` | **One combined file, in the first declared root**, prefixed paths. Not per-root |
| `--dir` | **Single-valued**, normalized to a one-element root set. Same prefixed path shape as any other run |
| `ejemplos/goldenset.yaml` | **Re-addressed, not translated.** 22 `esperado` values gain the `docs/` prefix; prose, filenames and frontmatter stay Spanish and untouched |
| Per-root `convention` / per-root `exclude` | **Non-goals** |
| Roots escaping the project root | **Non-goal.** Pre-existing and ungated today |
| Removing a root purges its documents | **Accepted and documented**, not special-cased. Consistent with existing delete-on-absence |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Artifact store | **openspec** (file-based). Engram MCP tools unavailable this cycle |

## Delivery size — a decision for the `sdd-tasks` gate

Revised downward from the design's 1 365–2 115, and the reason is specific rather than optimistic:
array-only deletes the mode branch, the `multi` flag, the union type, and roughly half the gate and
test matrix (every "…and single-root mode still does the old thing" assertion disappears). It also
**adds** cost the union avoided — re-addressing the goldenset and the test harness — so the drop is
real but modest, about 12% at both ends.

| Driver | Estimate |
|---|---|
| `config.ts` — `string[]`, `resolveRoots`, ordered-pair guard, messages | 55–85 |
| `composite-document-source.ts` (new) | 55–85 |
| `file-document-source.ts` — prefix, `isRoot`, `isExcluded`, English message | 20–35 |
| `composition.ts` — single wiring path, prefixes, writer target, `selfPath` | 15–30 |
| `convention.ts` — optional `rootPrefixes` | 15–25 |
| `generate-index-md.ts` — `selfPath` + three checks | 10–20 |
| `scripts/vector-reach.mjs` | 10–20 |
| `config.test.ts` — array shape + every rejection incl. inner-root-first | 90–140 |
| `file-document-source.test.ts` — prefix, exclusion, Gate 4′, baselines | 80–120 |
| `composite-document-source.test.ts` (new) | 110–170 |
| `convention.test.ts` + `sync-index.test.ts` (Gate 4″) | 70–110 |
| `generate-index-md.test.ts` + `read-document.test.ts` | 80–130 |
| `index-and-search.test.ts` multi-root + prefixed `build.ts` harness + **19** re-addressed literals | 130–200 |
| Container-construction rejection test + **Gate 1b's zero-config path-shape test** | 60–90 |
| `ejemplos/goldenset.yaml` — 22 re-addressings | 22 |
| Spec deltas (`configuration` ×3, `indexing` ×4, `index-md`, `mcp-contract` ×2) | 320–520 |
| `README.md` + `CLAUDE.md` | 55–85 |

**1 195–1 885 changed lines**, against a 400-line PR review budget — cleared by a wide margin at
*either* end, before any correction.

**A smaller estimate is still an estimate.** Measured history, unsmoothed: `bounded-chunk-size`
240–420 (explore) → 555–695 (tasks) → **773 actual**; `match-centred-excerpt` 300–470 (proposal) →
750–800 (design) → **~1 521 actual**, roughly 2x its design figure and 4x its proposal figure;
`incremental-reindex` missed by 2x. This project's forecasts have landed 2–4x low for three cycles
running. Applying that honestly puts this at **2 000–3 500 by apply**, and array-only does not change
that pattern — it only lowers the starting point. A single PR is not a live option.

**Recommended chain — still 4 slices.** The smaller scope removes lines, not boundaries: each cut
below survives for its own reason, and no two merge without exceeding the budget on their own.
`sdd-tasks` owns the final boundaries.

- **PR 1 — directory-prefix `exclude` and the enabling refactor.** Three-clause `isExcluded`, the
  English root-failure message, and the `isRoot` parameter that replaces `prefix === ""`
  (behaviour-preserving on its own). Plus the `configuration` `exclude` delta. Independently valuable
  today — a single-root project currently cannot exclude a folder at all. **The `isRoot` refactor
  belongs here, before the PR that could disable it**: landing it alongside prefixing means the same
  diff both creates and defuses the trap, which is how a trap gets waved through.
- **PR 2 — the structural core.** `docsDir: string[]`, `resolveRoots` + the ordered-pair guard,
  `pathPrefix`, the composite, composition wiring, the `configuration` deltas — **and, in the same
  PR, `ejemplos/goldenset.yaml` and the test harness**, because this is the slice where the path
  shape changes and leaving them behind makes `compendio eval` red between slices. Gates 1, 1b, 2c,
  5.
- **PR 3 — the behavioural companions.** Per-root unreadable handling with the `indexing` MUST
  amendment, alias-as-`ReadError.path` with Gate 4″, alias-aware `inferModule`. Gates 3 and 4.
- **PR 4 — surface and documentation.** Combined `INDEX.md`, the three retargeted equality checks,
  `index-md`/`mcp-contract` deltas, `scripts/vector-reach.mjs`, `README.md`, `CLAUDE.md`.

Two sequencing constraints that are **not** negotiable by the task phase:

1. **Prefixing and the collision guard cannot land in separate PRs.** Separated, the intermediate
   state ships the uncaught SQLite UNIQUE-constraint crash at `index-documents.ts:106` that this
   whole design exists to prevent.
2. **Multi-root is unusable until PR 3 lands** — after PR 2 alone, a missing declared root still hard
   crashes the run. Nothing may document or announce the feature before the chain reaches PR 3, and
   Gates 2, 3 and 4 cannot be run before it. PR 2 is still shippable in itself, because the default
   `["docs"]` set behaves exactly as a missing `docs/` does today.

## Proposal question round (open — for the user, before `sdd-spec`)

Four product questions this revision answers by assumption. Each names the assumption in force, so
silence is a valid answer and the change proceeds either way. (The first version's Q5 — "is a path
shape that depends on the declared root count acceptable?" — is **answered and closed** by the
array-only decision: it does not depend on it any more.)

1. **Should `openspec/changes/archive/` be excluded by *default*, or only when a project says so?**
   Assumed: **only when the project says so.** `exclude` defaults to `[INDEX_FILE]` and stays that
   way; Compendio knows nothing about openspec's folder layout and should not start guessing at
   project semantics. The cost: a user who adds `openspec` as a root and reads no documentation gets
   79 archived process files in their corpus and a materially worse `search_docs` than before. Is
   that the right default, or should the README's multi-root example carry the exclusion so
   prominently that missing it takes effort?

2. **Is superseded documentation genuinely noise, or is it the product?** This proposal treats
   archived proposals and completed verify-reports as dilution. The opposite reading is defensible:
   "why was this rejected in 2026-07" is exactly the intent-and-rationale content the server
   instructions promise, and no other tool holds it. Assumed: **noise for this cycle**, excludable by
   the project, with the dilution symptom recorded as an observation rather than acted on. If the
   opposite is true, the real feature is a *relevance* mechanism (recency, a status deny-list over
   inferred document age), not an exclusion mechanism — a different change entirely.

3. **When a declared root does not exist, is that an error or a normal state?** Assumed: **normal** —
   reported and skipped, because a shared config across repositories where only some have `openspec/`
   is the motivating shape. The consequence: a typo (`opnespec`) is indistinguishable from a
   deliberately absent optional root, and the project gets a quietly smaller corpus. Should a missing
   root be visible more loudly than a `skipped` entry?

4. **New, and forced by array-only: is re-addressing `ejemplos/goldenset.yaml` acceptable?** Assumed:
   **yes** — the 22 `esperado` values are addresses, not prose, and re-prefixing them changes no word
   of Spanish and no document mapping, so the published quality numbers stay comparable and the
   control group survives intact. The alternative would be teaching `EvaluateSearch` to tolerate a
   missing prefix, which weakens the project's sharpest falsifier to protect a file that is easier to
   edit than the instrument is to keep honest. Confirm the goldenset may be re-addressed, or say so
   now and the change needs a different answer.

A second question round is available if any answer moves the scope.
