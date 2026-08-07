# Design: A Chunk Heading Is Never Empty

## Technical Approach

**The invariant is enforced once, at the `index-pipeline` seam, by a pure domain function applied to
the output of both chunk producers. Nothing about `chunkOutline`'s signature changes, so the 15 test
call sites are untouched.**

```
chunks = withNonEmptyHeadings(
           isNoChunking(...) ? wholeDocumentChunk(...) : chunkOutline(parsed.outline, ...),
           documentHeading(resolution.meta.title, file.path),
         )
```

Three moving parts, each answering one of the three questions design owns:

| Question | Answer | Where |
|---|---|---|
| The value | `resolution.meta.title` — the humanized filename under `loose` (user decision) | `index-pipeline.ts:63-69`, already computed |
| The fallback when that is `""` | the document's `path`, then a domain constant | `documentHeading()`, new, pure |
| How it crosses the seam | a post-hoc `Chunk[] → Chunk[]` map, not a parameter | `withNonEmptyHeadings()`, new, pure |

Plus a one-expression well-formedness rule inside `chunkOutline` (drop empty path segments before
joining), and a new `ReadResult` variant that makes `read_doc`'s "nothing to list" answer a
compiler-enforced case rather than an empty bullet.

`src/domain/` gains two pure functions and no dependency; `ports.ts` is untouched — nothing here is
an adapter (precedent: `2026-08-06-match-centred-excerpt` Decision 8, `2026-08-06-encoding-aware-reads`
Decision 6).

## Architecture Decisions

### Decision 1: one invariant at the seam, one well-formedness rule in the domain

**Choice.** `withNonEmptyHeadings(chunks, fallback)` runs at `index-pipeline.ts:75-77`, after the
branch. Separately, `chunkOutline`'s join (`chunking.ts:59`) filters empty segments out of the path
before joining.

**Why the seam, and why once.** `transformFile` is the **only** production caller of both producers,
and both persistence paths funnel through it — verified: `chunkOutline` has exactly one production
call site (`index-pipeline.ts:77`) and 15 in `test/domain/chunking.test.ts`
(`:19,26,40,53,59,70,79,96,127,174,190,208,223,243,266`); `wholeDocumentChunk` is module-private
(`:91`); `transformFile` is called from `index-documents.ts:98` (full rebuild) and `sync-index.ts:131`
(incremental sync) and nowhere else. One expression therefore covers every path by which a chunk
reaches SQLite, including any producer added to that branch later. Enforcing inside each producer
would be two implementations of one rule — the divergence shape this repository keeps paying for.

**Why the domain also filters segments — and what would make this fail.** The seam only sees the
joined string, so it cannot repair a *malformed* one. `chunking.ts:50` builds `path` as
`[section.title, child.title]`; if `child.title` is `""` the join yields `"Business rules > "` —
non-empty, so a pure emptiness check passes while the value is garbage. That state is reachable: an
empty ATX heading (`##`) is valid CommonMark, `textOf` returns `""` for a heading node with no
children (`remark-markdown-parser.ts:120-128`), and `buildOutline` pushes the event without checking
its title (`:48-49`, `:92-96`). So a document with a perfectly good H1 and one empty `##` produces
`heading: ""` today — a second live path to the reported defect that neither the exploration nor the
proposal names. Filtering makes `[""] → [] → ""` (caught by the seam) and `["A", ""] → ["A"] → "A"`
(the ordinary shared-heading case).

**Epistemic label.** That the *domain* input `{ title: "", ... }` in `outline.sections` produces an
empty heading is arithmetic on quoted code. That `RemarkMarkdownParser` *emits* such a section for
`##` is derived from CommonMark plus `textOf`, **not executed** — no Bash in this phase. Task P1
below turns it into a five-line test; either outcome is information, and the unit invariant holds
regardless because the domain input is directly constructible.

**Rejected**: enforcing inside `chunkOutline` only — leaves `wholeDocumentChunk` uncovered and gives
the domain a value it cannot compute. Enforcing in both producers — two rules, no extra coverage.

### Decision 2: the fallback chain, and why its last level is unreachable on purpose

**Choice**: `documentHeading(title, path) = title.trim() || path.trim() || UNTITLED_HEADING`, with
`UNTITLED_HEADING = "Untitled document"`.

| Level | Value | Reachable when | Reached by |
|---|---|---|---|
| 0 | the chunk's own non-empty heading path | any document with a usable H1/H2/H3 | every `ejemplos/` document |
| 1 | `meta.title` — the humanized filename under `loose` | no H1 (the reported defect) | `manual-extenso.md` → `"Manual extenso"` |
| 2 | `file.path` | `humanizeFileName` collapses to `""` — `-.md`, `_.md` (`convention.ts:45-51`; `FileDocumentSource` skips only names starting with `.`, `file-document-source.ts:57`) | **Gate 2** |
| 3 | `"Untitled document"` | `path` is also empty | nothing — see below |

**Why the path at level 2, not a literal.** It round-trips by construction: `normalize` lowercases and
strips diacritics only, leaving punctuation intact (`similarity.ts:37-42`), so
`read_doc({ path: "-.md", section: "-.md" })` matches through `normalize(c.heading).includes(wanted)`
(`read-document.ts:77`). It is also a string the caller is already holding — `search_docs` returns
`path` on the same result item (`search-documents.ts:118`). Redundant beats meaningless. A fixed
literal would additionally render two different documents identically in one result list.

**Level 3 is a totality terminator, not a gate.** `DocumentFile.path` comes from a directory entry, so
it cannot be empty through `FileDocumentSource`; no state of the world reaches level 3 in production.
It exists so `documentHeading` is total over its type rather than over its current callers, and it is
tested by calling the pure function with `("", "")`. Saying that plainly is the point: a branch whose
failure state does not exist is not a gate, and this design does not dress it up as one.

**Rejected**: Option B (synthesize from the document's leading line). It needs its own
well-definedness rules (4 000-character line, table row, identical across documents) and introduces a
second notion of "what this document is called" alongside `DocumentMeta.title` — which is exactly
what `read_doc({ path })` already prints at `read-document.ts:67`. The user's decision (state.yaml,
`section_value_decision`) is that those two surfaces show the **same string**; B guarantees they do
not.

### Decision 3: the seam is crossed by a post-hoc map, not by a signature or options change

| Option | Test churn | Covers `wholeDocumentChunk` | Verdict |
|---|---|---|---|
| Extra required parameter on `chunkOutline` | 15 call sites | No | Rejected |
| Optional field on `ChunkingOptions` | 0 | No | Rejected |
| **Post-hoc map at `transformFile`** | 0 | **Yes** | **Chosen** |

The options-field variant is the tempting one and it is wrong for a reason worth writing down:
`ChunkingOptions` is the **config** shape. `DEFAULT_CONFIG.chunk` (`config.ts:58`) is assigned
straight into `PipelineOptions.chunking` (`test/helpers/build.ts:86`), so a per-document heading would
ride inside a per-project settings object — a category error that also makes the invariant depend on a
caller remembering to populate a field. That is precisely the "data source instead of invariant" trap
Gate 2 exists to fail.

The map costs one wrapper call and leaves `chunkOutline`'s contract intact: its heading path still
derives from the outline and nothing else, which is what its 15 tests assert.

### Decision 4: `read_doc` gains a `no-sections` variant — and it is reachable for a real reason

**Choice**: a fifth member of `ReadResult`:
`{ type: "no-sections"; meta: DocumentMeta; section: string }`, returned when the requested section
matches nothing **and** the assembled available-section set has no non-empty member. `ReadDocument`
also filters empty members out of `availableSections` (`read-document.ts:80-92`), so
`section-not-found` now carries the invariant "non-empty list, non-empty members".

**The question a reviewer will ask, answered first: after Decision 1, is this branch dead?** No — and
the reason is the most useful thing in this design. Every chunk written by the *new* code has a
non-empty heading, so a freshly indexed corpus can never reach it. But `heading` is **persisted**, and
incremental sync's fingerprint is the content hash alone (`index-pipeline.ts:33-35`,
`indexing/spec.md:468-482`), so a corpus indexed by a pre-fix build and never fully reindexed keeps
its empty headings forever while being read by the new server. **That corpus is exactly the population
Gate 6 is about.** Decision 1 is the write-side fix and requires `compendio index` to land; Decision 4
is the read-side half, and it is the only part of this change that reaches an installation that never
reindexes. That is also why the proposal's PR 2 is genuinely independent — see the cut line.

Reachable in a test without any pipeline trickery: `store.saveDocument(meta, [{ heading: "", ... }])`
against `SqliteIndexStore(":memory:")` writes precisely the stale-corpus state.

**Rejected**: overloading `section-not-found` with an empty `availableSections`. `formatReadResult`'s
switch is exhaustive over the union inside a function declared `: string`, and `tsconfig.json` sets
`strict: true`, so a new member is a **compile error** until handled (TS2366). That converts the
proposal's "`formatReadResult` ships wrong, silently" risk into a build failure. An
`availableSections.length === 0` branch buys none of that, and leaves the use case returning an
"available section" that is not available.

**Scope note**: this is additive to a union in beta with no installed users. No migration, no shim
(`openspec/config.yaml`, `rules.proposal`).

### Decision 5: `formatReadResult` is exported and made total for any input

**Choice**: export it, retype its parameter from `ReturnType<Container["readDocument"]["execute"]>` to
`ReadResult` (already importable — `server.ts` imports `formatFrontmatter` from the same module), and
filter empty labels **again** in the `section-not-found` case, falling through to the no-sections prose
if the filtered list is empty.

**Why the duplicate filter.** Gate 4 is written as a property of `formatReadResult` *for any input*.
With filtering only in `ReadDocument`, the renderer's guarantee is conditional on its caller, and
`string[]` cannot express "no empty members" in the type system. One `.filter()` makes the gate a
property of the function under test rather than of a pair of functions. In-repo precedent for
exporting solely to test: `toFtsQuery`, "Exported (only) for the regression test that asserts this
emitted MATCH" (`sqlite-index-store.ts:434`).

### Decision 6: correction — the heading IS a retrieval input, on both legs

The proposal's Approach constraint 4 says this change is "metadata, not retrieval". **As stated that is
false**, and a reviewer can falsify it in two greps:

- **Lexical**: `chunks_fts` is declared over `(content, heading)` (`sqlite-index-store.ts:66-69`),
  populated with both (`:161`), and queried as `chunks_fts MATCH ?` (`:341-344`) — which searches every
  column.
- **Vector**: the embedded string is `` `passage: ${chunk.heading}\n${chunk.content}` ``
  (`index-documents.ts:110,143`; `sync-index.ts:146,193`).

What survives, restated precisely, is the part the gates actually rest on: **`Chunk.content` is not
modified, and retrieval cannot move on a corpus whose headings do not change.** Consequences:

1. **Gate 5's eval identity assertion stands, and is now better grounded.** No `ejemplos/` document
   changes heading: all 12 carry exactly one H1 (orchestrator-measured) and none contains an empty ATX
   heading (verified: `^#{1,6}\s*$` matches nothing under `ejemplos/`). Byte-identical FTS5 rows,
   byte-identical embedding inputs, identical MRR/recall/top-1. Identity, not a tolerance band.
2. **On a heading-less corpus, retrieval does move — by design and in the right direction.** The
   humanized filename becomes both a lexical token and part of the embedded passage. Worth naming in
   `CLAUDE.md`; not a gate, since nothing pins those corpora.
3. **Manual Gate 1b's recorded numbers become stale.** `CLAUDE.md`'s `vector-reach` table (rank 1,
   cosine ≥ 0.855 versus the filler band) was measured with `heading: ""`, i.e. embedding
   `"passage: \n<content>"`. After this change every chunk in `test/fixtures/vector-reach/docs/` embeds
   `"passage: Manual extenso\n<content>"` or `"passage: Distractor 0n\n<content>"`, so **every stored
   vector in that fixture changes**. That the vectors change is deterministic; the magnitude and
   direction are **not** predicted here. Required action: a one-line caveat in `CLAUDE.md` next to the
   table saying the figures predate `addressable-chunks` and must be re-measured on the next chunking
   change. Deliberately **not** promoted to a blocking gate for this change — Gate 1b needs a ~130 MB
   model download and no gate in the proposal covers it. Without the caveat, the next cycle reads a
   real baseline shift as a regression.

## Flow notes

Per `rules.design`. Line numbers are current, pre-change.

```
transformFile (index-pipeline.ts:49)
  │
  ├─ parsed  = parser.parse(file.content)                       :58   ── unchanged
  │      └─ no H1  ⇒ outline.title = ""   (remark-markdown-parser.ts:30,44-47)
  │      └─ no H2  ⇒ outline.sections = [] , intro = whole body (:66-68)
  ├─ resolution = policy.resolver({ ..., title: parsed.outline.title })  :63-69
  │      └─ loose: title = input.title || humanizeFileName(path)  (convention.ts:66-68)
  │                                        └─ "" for "-.md"      (convention.ts:45-51)
  │
  ├─ fallback = documentHeading(resolution.meta.title, file.path)        NEW  (Decision 2)
  │
  └─ chunks = withNonEmptyHeadings(                                      NEW  (Decision 1)
        isNoChunking ? wholeDocumentChunk(meta.title, body, maxTokens)   :76  ── unchanged
                     : chunkOutline(parsed.outline, chunking),           :77  ── unchanged signature
        fallback)
```

Inside `chunkOutline`, the only edit (`chunking.ts:58-62`):

```
mergeTinyPieces(bounded, opts).map((piece, position) => ({
  heading: piece.path.filter(s => s.trim().length > 0).join(" > "),   ← was piece.path.join(" > ")
  ...
}))
```

Read path, for a corpus still holding empty headings (Decision 4):

```
ReadDocument.execute (read-document.ts:51)
  └─ section requested, matching.length === 0                      :80
       ├─ available = { non-empty chunk.heading } ∪ { headingsIn(content) }   ← filter added
       ├─ available.size === 0  → { type: "no-sections", meta, section }      NEW
       └─ else                  → { type: "section-not-found", ... }          unchanged shape
```

## Interfaces / Contracts

```ts
// src/domain/chunking.ts  (added)

/** Last-resort chunk heading. Reached only when a document has neither a
 *  resolved title nor a path — unreachable through FileDocumentSource, kept so
 *  `documentHeading` is total over its type rather than over its callers. */
export const UNTITLED_HEADING = "Untitled document";

/** The heading every chunk of a document falls back to when its own heading
 *  path is empty. `title` is the convention-resolved DocumentMeta.title (the
 *  humanized filename under `loose`); `path` is the docs-relative file path. */
export function documentHeading(title: string, path: string): string;

/** Guarantees the invariant: no returned chunk has an empty heading, and every
 *  chunk of one document that needed the fallback carries the SAME value —
 *  the shared-heading shape `read_doc({ section })` reassembles from. */
export function withNonEmptyHeadings(chunks: Chunk[], fallback: string): Chunk[];

// src/application/read-document.ts  (union member added)
export type ReadResult =
  | ...
  | { type: "no-sections"; meta: DocumentMeta; section: string };

// src/server.ts  (visibility + parameter type)
export function formatReadResult(result: ReadResult): string;
```

`Chunk` (`src/domain/model.ts`), `IndexStore` (`ports.ts`), `SCHEMA_DDL`
(`sqlite-index-store.ts:45-70`) and `ChunkingOptions` are **unchanged** — asserted, not assumed
(Gate 5).

## The gates, made mechanically checkable

### P1 — the parser probe, first task of `apply`, before any implementation

Five lines, settling Decision 1's one unexecuted claim:
`RemarkMarkdownParser.parse("# T\n\nintro\n\n## \n\nbody")` → assert what `outline.sections[0].title`
is. If `""`, the empty-H2 path is live and the domain filter has a real failure state; if remark drops
the node, record that and keep the filter as a total-function guard with its justification amended.
**Neither outcome blocks the change** — it decides one sentence of rationale and one test case.

### Gate 1 — red-first, and what makes it capable of failing

Case A has zero coverage today (`grep 'title: ""' test/` → only `convention.test.ts:69,187`;
`grep 'heading).toBe("")' test/` → nothing), so a green suite carries no information. Sequence, per
`strict_tdd`:

1. Land the baseline test named `BASELINE (to be inverted)` over
   `test/fixtures/vector-reach/docs/manual-extenso.md`, asserting today's behaviour: every chunk's
   `heading === ""`, `search_docs` returns `section: ""`, `read_doc({ path, section: "anything" })`
   returns `section-not-found` with `availableSections` exactly `[""]`. Run `npm test` on unmodified
   `src/`. **It must pass.** If any assertion fails, the fixture is void and MUST be rebuilt. Record
   the run in the apply notes.
2. Invert it: `heading === "Manual extenso"` for every chunk, `section === "Manual extenso"`, round
   trip resolves. Now red.
3. Implement to green.

Harness: `buildHarness(null, EXAMPLES_CONVENTION, VECTOR_REACH_DOCS)` (`test/helpers/build.ts:71`) —
**null embeddings provider**, so the six committed heading-less documents (~30 KB, already committed,
already the exact failing shape) run lexical-only, deterministic, no model download. No new fixture
corpus is committed.

### Gates 2–6

| Gate | Harness | Assertion |
|---|---|---|
| 2 | `index-pipeline.test.ts`, via its existing `run(content, options, path)` helper (`:17-24`) | `run(headingLessBody, opts, "-.md")` → every chunk `heading === "-.md"`. Plus the same file under `noChunking: ["-.md"]`, covering `wholeDocumentChunk`. Plus unit: `documentHeading("", "")  === "Untitled document"` |
| 3 | round-trip test, same file as Gate 1 | Take the `section` string `search_docs` returned, pass it **verbatim** to `read_doc({ path, section })`, assert `result.type === "section"` — never `section-not-found`, never `no-sections`. Also for the `-.md` case, whose value contains punctuation `normalize` does not strip |
| 4 | `test/server/format-read-result.test.ts` (new) | On literal output, for every variant: `[""]`, `["", "A"]`, `[]`, and `no-sections`. Assert **no line equals `"- "`** and no line matches `/^- \s*$/`, for any input. Assert the no-sections text verbatim (below) |
| 5 | `npm test`, `npm run typecheck`, `npm run build`, `compendio eval` | `read-document.test.ts:116-168` and `chunking.test.ts:74-89`/`:91-114` pass **unchanged** — this design does not touch what they assert (Decision 1 leaves the path array's non-empty segments alone, and the fallback is uniform per document, so shared headings stay shared). `SCHEMA_DDL` byte-identical. `ejemplos/`: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22, as identity (Decision 6) |
| 6 | docs | Spec requirement + `CLAUDE.md` note (below) |

**Reassembly is reinforced, not threatened.** Worth stating because a reviewer arrives expecting a
conflict: the fallback is one value per document, applied to every chunk that needs it, so the
89-chunk manual becomes 89 chunks sharing one non-empty heading — the ordinary shape
`read_doc({ section })` already joins (`read-document.ts:93-98`) and `indexing/spec.md:442-450` already
mandates. This change deletes a special case from that rule.

### Recorded observations (not gates)

Distinct-heading count and maximum chunks-per-heading for the heading-less fixture, into
`verify-report.md`. No new script: the Gate 1b setup already produces the database —
`node dist/cli.js --root test/fixtures/vector-reach index`, then
`SELECT heading, COUNT(*) FROM chunks GROUP BY heading` against
`test/fixtures/vector-reach/.compendio/compendio.db` (gitignored, `.gitignore:3`). Plus exploration
§7's `MAX_CHUNKS_PER_DOCUMENT` probe recipe restated, **not run**.

## Contract text, written out so it can be applied as a diff

**`formatReadResult`, new `no-sections` case** — two lines, no bullets, so "never an empty bullet"
holds by construction:

```
Document "<path>" has no addressable sections.
Read it whole with read_doc({ path: "<path>" }).
```

**`server.ts:176-179`, `read_doc`'s `section` param description**, appended to the existing text:

> Sections name a region of a document, not a single fragment: a large section returns all of its
> parts joined.

**`server.ts:110-111`, `search_docs` description**, replacing "Each result has path, title, section,
excerpt and score.":

> Each result has path, title, section, excerpt and score; `section` names the document region the
> fragment came from — a document with no headings reports one region for the whole file.

Both sentences claim **document-region** granularity. Per the proposal's accepted limitation, no
artifact in this change may describe `section` as fragment-level.

**`CLAUDE.md`**, three additions:

1. A non-obvious-decisions bullet: no persisted chunk has an empty `heading`; the invariant lives at
   `transformFile`, not in `chunkOutline`; the fallback chain and why level 2 is the path.
2. Same bullet, second half: a heading-only change does not reach unchanged documents through
   incremental sync — a full `compendio index` is required, for the same content-hash reason
   `bounded-chunk-size` documented.
3. Next to the Gate 1b table: the recorded cosines predate `addressable-chunks`, which changed the
   embedded string for every heading-less chunk (Decision 6.3); re-measure before trusting them.

## Spec delta guidance (for `sdd-spec`, which has not run yet)

| Domain | Requirement | Must compose with |
|---|---|---|
| `indexing` | Every persisted chunk carries a non-empty heading; the value is uniform per document; it is derived from the resolved document title, falling back to the path | `indexing/spec.md:442-450` — the path is non-empty *before* splitting, and splitting propagates it unchanged. Strictly narrowing, never competing |
| `indexing` | A heading-only change does not reach unchanged documents through incremental sync | `:468-482` is literally scoped to `chunk.maxTokens`/splitting; **add a sibling** rather than broadening — the existing scenarios are boundary-specific and a broadened requirement would silently restate them |
| `mcp-contract` | `search_docs`'s `section` is never the empty string | new; `search-documents.ts:120` is a straight copy of `chunk.heading` |
| `mcp-contract` | `read_doc`'s section-not-found response never lists an empty section, and says so in prose naming `read_doc({ path })` when there is nothing to list | new; `:130-138` covers unknown *paths* only |

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/chunking.ts` | Modify | `UNTITLED_HEADING`, `documentHeading`, `withNonEmptyHeadings`; empty-segment filter at the join (`:59`); doc comment naming where the invariant is enforced |
| `src/application/index-pipeline.ts` | Modify | Compute the fallback, wrap the branch (`:75-77`) |
| `src/application/read-document.ts` | Modify | `no-sections` union member; filter empty members out of `availableSections` (`:80-92`) |
| `src/server.ts` | Modify | Export + retype `formatReadResult`; new case; defensive label filter; two description edits |
| `src/domain/ports.ts` | **Unchanged** | No adapter added |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | **Unchanged — asserted** | `SCHEMA_DDL` byte-identical (Gate 5) |
| `src/domain/model.ts` | **Unchanged** | `Chunk` shape untouched |
| `test/domain/chunking.test.ts` | Extend | New `emptyTitleOutline()` helper (the existing `outline()` at `:13-15` hardcodes a title and cannot express the case); empty-segment case; the 15 existing call sites untouched |
| `test/domain/heading-fallback.test.ts` | Create | `documentHeading` all four levels incl. `("","")`; `withNonEmptyHeadings` — empty → fallback, non-empty preserved, uniform across chunks, position/content untouched |
| `test/application/index-pipeline.test.ts` | Extend | Gate 2, both branches; P1 parser probe |
| `test/application/heading-less-round-trip.test.ts` | Create | Gates 1 and 3 end to end over the committed fixture |
| `test/application/read-document.test.ts` | Extend | `no-sections` via a directly-seeded empty-heading store (the stale-corpus state); `availableSections` never contains `""`; `:116-168` untouched |
| `test/server/format-read-result.test.ts` | Create | Gate 4, literal output, all five variants |
| `test/helpers/build.ts` | Modify | `VECTOR_REACH_DOCS` export |
| `openspec/specs/indexing/spec.md` | Modify | Two requirements (`sdd-spec`'s output) |
| `openspec/specs/mcp-contract/spec.md` | Modify | Two requirements (`sdd-spec`'s output) |
| `CLAUDE.md` | Modify | Three additions above |

## Testing Strategy

| Layer | What | Where |
|---|---|---|
| Probe | P1 — what remark yields for an empty `##`, before any implementation | `index-pipeline.test.ts` |
| Unit | `documentHeading` four levels; `withNonEmptyHeadings` postconditions | `heading-fallback.test.ts` |
| Unit | `chunkOutline` with `title: ""` → `heading === ""` **today** (baseline), non-empty after; `["A",""]` → `"A"` | `chunking.test.ts` |
| Integration | Gate 2 at the seam, both producers, including `-.md` | `index-pipeline.test.ts` |
| Integration | Gates 1 and 3: index → search → read round trip, lexical-only | `heading-less-round-trip.test.ts` |
| Integration | `no-sections` and the empty-member filter, over a seeded stale-corpus store | `read-document.test.ts` |
| Unit | Gate 4 on literal rendered bytes | `format-read-result.test.ts` |
| Manual | Gate 5's `compendio eval` identity | `verify-report.md` |
| Manual | Distinct-heading count and max chunks-per-heading (observation) | `verify-report.md` |

> **CORRECTED 2026-08-07, after apply and verify both measured it.** The paragraph below was wrong
> and is kept — struck through — rather than deleted, because it was passed to `sdd-tasks` and
> `sdd-apply` as a constraint and the record should show what they were told. `npm run typecheck`
> **does** check `test/`: `package.json:35` runs `tsc --noEmit && tsc -p tsconfig.test.json`, and
> `tsconfig.test.json:9` sets `include: ["src/**/*", "test/**/*"]`. Only the root `tsconfig.json`
> alone is test-blind, and nothing runs it alone. The stale belief came from an orchestrator memory
> of a real gap that had already been fixed in `7b0a34f`. **Decision 4's compile-time enforcement is
> therefore stronger than this design assumed** — a test that switches on `result.type` and misses
> the new member is a typecheck error, not just a runtime surprise.

~~**One trap for `sdd-tasks` and `sdd-apply`**: `tsconfig.json:18` sets `include: ["src/**/*"]`, so
`npm run typecheck` **does not see `test/`**, and vitest transpiles without typechecking. Decision 4's
compile-time enforcement is real for `src/server.ts` and worth nothing for test files — a test that
switches on `result.type` and misses the new member fails at runtime or not at all. Do not treat a
green `typecheck` as evidence about tests (memory: `compendio-agentes-reportan-verde-falso`).~~

## Migration / Rollout

**No migration, no schema marker, no shim** — the schema is unchanged by construction. But unlike
`match-centred-excerpt`, this change **writes to persisted state**, so rolling forward is not free:

1. Revert + `npm run build` restores old behaviour; headings written under the new code are harmless
   under the old (`heading` is free-form `TEXT NOT NULL`, and every document with real headings
   already stores non-empty values).
2. **Rolling forward requires a full `compendio index`.** Incremental sync fingerprints on content
   hash alone, and this change does not touch content, so a `serve`-only upgrade keeps every empty
   heading. This is Gate 6, and Decision 4 is what makes such an installation degrade gracefully
   instead of rendering an empty bullet.
3. Byte-exact restoration in either direction is a full reindex — required for exactness, not for
   correctness.

### Delivery size — a design-phase forecast, above the proposal's

| Driver | Estimate |
|---|---|
| `chunking.ts` — three additions plus the filter and its comments | 35–45 |
| `index-pipeline.ts` seam | 10–15 |
| `read-document.ts` — variant, filter, branch | 20–30 |
| `server.ts` — export, case, filter, two descriptions | 25–40 |
| `chunking.test.ts` + `heading-fallback.test.ts` | 90–130 |
| `index-pipeline.test.ts` (Gate 2 + P1) | 60–80 |
| `heading-less-round-trip.test.ts` (Gates 1, 3, baseline-then-invert) | 80–110 |
| `read-document.test.ts` (`no-sections`, filter) | 50–70 |
| `format-read-result.test.ts` (Gate 4) | 60–90 |
| `build.ts` helper | 5 |
| Spec deltas (`indexing` ×2, `mcp-contract` ×2) | 80–120 |
| `CLAUDE.md` + contract prose | 25–35 |

**540–770 changed lines** against a 400-line PR budget — above the proposal's 290–505, which it
declared a lower bound. The pattern is recorded, not smoothed: `bounded-chunk-size` 240–420 → 555–695
→ **773**; `match-centred-excerpt` 300–470 → 750–800 → **~1521**. Tests are 60% of this figure and are
the least compressible part, because the defect's defining property is that nothing currently fails.

### Cut line — endorsed, with the reason the proposal did not state

- **PR 1 — the write side.** Decisions 1–3, the `indexing` spec delta, Gates 1/2/3/5, `CLAUDE.md`.
  Fixes the defect at its root; **needs a full `compendio index` to reach any existing corpus.**
- **PR 2 — the read side.** Decisions 4–5, the `mcp-contract` delta, Gate 4.

They are independent, and PR 2 is the one with the **wider reach**: it removes the empty bullet and
answers truthfully on every corpus indexed by an older build, without any reindex. If only one ships,
ship PR 2. The order decision belongs to the review-workload gate after `sdd-tasks`, not here.

## Open Questions

- [ ] P1's outcome (empty-`##` reachability through remark). Assumed live per CommonMark; the domain
      filter is justified either way, but one sentence of rationale depends on it.
- [ ] Whether `documentHeading`/`withNonEmptyHeadings` belong in `chunking.ts` or in a new
      `src/domain/heading.ts`. Assumed `chunking.ts` — ~15 lines, and `transformFile` already imports
      from it. A reviewer preferring one-concept-per-file is not wrong.
- [ ] The exact `UNTITLED_HEADING` string. Assumed `"Untitled document"`; unreachable in production,
      so this is a naming preference with no behavioural consequence.
- [ ] Whether Gate 1b's numbers are re-measured in this cycle or only caveated. Assumed **caveated
      only** (Decision 6.3) — re-measuring needs a ~130 MB model download that no gate here requires.
      `sdd-verify` may overrule if the download is already warm.
