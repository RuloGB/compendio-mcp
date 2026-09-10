# AGENTS.md

This file provides guidance to working with code in this repository.

**Keeping this file small.** This file is loaded into every agent session, so it holds only what an agent must know before touching code and cannot deduce from reading it — one line per item, with a pointer to where the detail lives (file + symbol, never a line number — those go stale).
Measurements, manual gates, before/after tables and history go to `docs/` (`docs/manual-gates.md`, `docs/design-decisions.md`, `docs/release-and-registry.md`) or to the change's `openspec/` artifacts.
Rationale that belongs to one piece of code goes in a comment next to that code. Do not repeat here what a code comment or a test already states.

## What this is

Compendio is an MCP server that indexes a project's markdown documentation and exposes it to AI agents through local hybrid search (BM25/FTS5 + embeddings via RRF fusion). Everything runs locally: one SQLite file, embeddings on CPU (transformers.js), zero network calls at query time.

## Commands

```bash
npm run build            # compiles to dist/ (tsc)
npm test                 # vitest run — full suite
npm run test:watch       # vitest watch mode
npx vitest run test/domain/chunking.test.ts   # single file
npx vitest run -t "name of the test"          # single test by name
npm run typecheck        # tsc --noEmit
npm run dev -- <args>    # run the CLI without compiling (tsx src/cli.ts)
```

There is no lint script configured.

Manual smoke test against the example corpus:

```bash
node dist/cli.js --root ejemplos index
node dist/cli.js --root ejemplos eval
node dist/cli.js --root ejemplos search "¿cuándo se considera duplicado un lead?"
```

- **Manual gates** (progress-bar smoke test, vector reach, fence handling, excerpt anchoring, chunk bound, word boundaries): procedures, expected numbers and RED verifications in `docs/manual-gates.md`. Always run `node dist/cli.js`, never a bare `compendio` (that resolves to the global npm install).
- **Releases and the MCP registry** (`mcpName`, namespace case, `server.json`, `mcp-publisher`): `docs/release-and-registry.md`.

`prepublishOnly` runs `build` then `test` — publishing fails if either fails.

Tests use `pool: "forks"` (vitest.config.ts) because `better-sqlite3` is a native addon loaded once per worker; don't switch this to threads. `CI=true` turns on `forbidOnly` so a stray `it.only` can't silently slim down the suite outside CI.

## Architecture

Hexagonal. The domain layer has zero dependencies on SQLite, transformers.js, or the filesystem — those live only in `infrastructure/` behind ports.

```
src/
├── domain/            # pure: model, chunking, RRF fusion, metrics, convention policy (convention.ts),
│                        # frontmatter shape helpers, ports.ts
├── application/        # use cases: IndexDocuments, SearchDocuments, GetOverview, ReadDocument,
│                        # EvaluateSearch, GenerateIndexMd
├── infrastructure/      # adapters: SQLite (FTS5 + sqlite-vec), remark + gray-matter, filesystem,
│                        # transformers.js, config
├── composition.ts       # composition root — wires adapters into use cases (start here to see the whole app)
├── cli.ts               # input adapter: commander
└── server.ts            # input adapter: MCP server over stdio, registers the 3 tools
```

`src/domain/ports.ts` defines the seams: `DocumentSource`, `MarkdownParser`, `IndexStore`, `EmbeddingsProvider`, `IndexFileWriter`. Any new adapter (a different vector DB, a different embeddings provider) implements one of these; use cases never import from `infrastructure/` directly.

### MCP tools (progressive disclosure)

Registered in `server.ts`. The rungs are **not a mandatory sequence**; the tool descriptions carry the routing. Full contract: [design-decisions](docs/design-decisions.md#mcp-tool-surface-and-progressive-disclosure).

1. `docs_overview()` — corpus map (counts by type/module, ~10 tokens/doc). `byType`/`byModule` buckets and per-document `[type]`/`(status)` segments are omitted entirely when a document/corpus has no value for that field — never a synthetic "no type" bucket or `[undefined]`.
2. `search_docs({ query, type?, module?, tags?, k?, include_excluded? })` — the entry point; hybrid top-k with a graduated excerpt budget (rank 1: 1400 chars, others: 120), each centred on its matched span; a `…` edge means "call `read_doc`". `convention.excludedStatuses` docs are hidden unless `include_excluded`.
3. `read_doc({ path, section? })` — one section or the full document; `type:`/`module:`/`status:` header lines render only when present. Unknown `path` returns the 3 closest matches instead of erroring.

**The MCP surface stays exactly these 3 tools.** `compendio sync` is a human-only CLI escape hatch, never a fourth tool (every tool call already triggers `serve`'s throttled sync).

### Non-obvious decisions (verified against code, not just docs)

One line each; full rationale and measurements in `docs/design-decisions.md` (one `##` section per item, linked as "more"). **DO NOT CHANGE** marks a trap that looks simplifiable and silently breaks something.

- **Roots are explicit (`docsDir` array, `--dir`) or discovered — never a hidden `["docs"]` default.** Every indexed `path` carries its root alias; duplicate, nested or same-alias roots are rejected. `resolveRoots`, `src/infrastructure/config.ts` — [more](docs/design-decisions.md#root-selection-is-explicit-or-discovery)
- **`exclude` is not glob syntax** — full path, basename or directory prefix, matched against the prefixed path. `FileDocumentSource.isExcluded` — [more](docs/design-decisions.md#exclude-matching-semantics)
- **An unreadable explicit root keeps its rows; discovery mode fails closed before any store mutation.** Removing a root from `docsDir` purges its documents on the next sync. `composite-document-source.ts`, `sync-index.ts` — [more](docs/design-decisions.md#unreadable-roots-fail-closed-in-discovery-mode)
- **`module` inference strips at most one root-alias prefix** (safe only because nested roots are rejected). `inferModule`, `src/domain/convention.ts` — [more](docs/design-decisions.md#module-inference-strips-the-root-alias)
- **`type`/`module`/`status` are optional open strings;** `convention.mode` `"loose"` (default) infers, `"strict"` lints. `src/domain/convention.ts`, `docs/documentation-convention.md` — [more](docs/design-decisions.md#type-module-and-status-are-open-strings)
- **`status` filtering is a NULL-aware deny-list** (`convention.excludedStatuses`, default `[]`); `mergeConfig` whitelists keys. `src/infrastructure/config.ts` — [more](docs/design-decisions.md#status-filtering-is-a-null-aware-deny-list)
- **Numeric config keys accept only finite positive `number`s** — a quoted `"480"` falls back to the default; `search.k` must be an integer. `src/infrastructure/config.ts` — [more](docs/design-decisions.md#numeric-config-validation)
- **Metadata columns are nullable; `migrate()` is non-destructive and schema upgrades happen only in `reset()`** (start of `compendio index`). `sqlite-index-store.ts` — [more](docs/design-decisions.md#nullable-metadata-columns-and-schema-upgrades)
- **DO NOT CHANGE: `reset()` deletes and recreates the `.db` when `chunks_vec` exists but sqlite-vec cannot load.** Guarding the DROP instead leaves a half-destroyed or mispaired index. D7 canary in `test/infrastructure/sqlite-index-store-degraded.test.ts` — [more](docs/design-decisions.md#reset-recreates-the-database-file-when-vec0-cannot-load)
- **`INDEX.md` and `docs_overview` sort by `path`**, or by declared `convention.types` under `strict`. `src/domain/index-markdown.ts` — [more](docs/design-decisions.md#indexmd-and-docs_overview-ordering)
- **Overview buckets use a `Map` + `Object.fromEntries`** so keys like `__proto__`/`constructor` survive. `src/application/get-overview.ts` — [more](docs/design-decisions.md#overview-buckets-keyed-by-arbitrary-strings)
- **DO NOT CHANGE: `cli.ts`'s entry-point guard uses `realpathSync`, not `realpathSync.native`** — `.native` breaks it on Windows 8.3 paths (exit 0, empty stdout). `test/cli-subprocess.test.ts` — [more](docs/design-decisions.md#cli-entry-point-guard-uses-realpathsync-not-realpathsyncnative)
- **DO NOT CHANGE: `sqlite-vec` needs `BigInt` primary keys** — a `number` throws "Only integers are allowed". Every `BigInt(chunkId)` in `sqlite-index-store.ts` — [more](docs/design-decisions.md#sqlite-vec-requires-bigint-primary-keys)
- **Embeddings are normalized in the provider; `vec0` uses plain L2**, not `distance_metric=cosine` (same order, no fragile syntax). — [more](docs/design-decisions.md#normalized-embeddings-with-plain-l2)
- **`compendio index-md` reads the filesystem, not the SQLite index**, and never lists `INDEX.md` itself. `src/application/generate-index-md.ts` — [more](docs/design-decisions.md#index-md-reads-the-filesystem-not-the-index)
- **Embeddings failure degrades to lexical-only** (`mode: "lexical"` + `embeddingsWarning`) for both provider failures and `canPersistVectors() === false`; `SyncIndex` checks once per pass. — [more](docs/design-decisions.md#graceful-degradation-on-embeddings-failure)
- **DO NOT CHANGE: never decode with `TextDecoder('windows-1252')` or `readFile(path, 'latin1')`** — on the Node floor both turn `0x80–0x9F` into C1 controls; `src/infrastructure/fs/decode-text.ts` hand-writes the CP1252 table. Repro command in [more](docs/design-decisions.md#textdecoder-windows-1252-is-wrong-on-the-node-floor)
- **Chunking cuts on H2/H3, then `splitToBound` enforces `chunk.maxTokens`**, splitting tables and fences when it must. `src/domain/split-text.ts` — [more](docs/design-decisions.md#heading-based-chunking-with-a-hard-size-bound)
- **Chunking or heading changes need a full `compendio index`** — incremental sync fingerprints content only, and there is deliberately no re-chunk migration. — [more](docs/design-decisions.md#chunk-boundary-changes-need-a-full-reindex)
- **No persisted chunk has an empty `heading`** — enforced once in `transformFile` via `withNonEmptyHeadings` (heading path → title → path → `"Untitled document"`). `src/application/index-pipeline.ts` — [more](docs/design-decisions.md#no-chunk-has-an-empty-heading)
- **DO NOT CHANGE: `RRF_K = 5`, not the literature-default 60** — 60 flattens rank leverage and buried a BM25 #1 answer. `src/domain/fusion.ts` — [more](docs/design-decisions.md#rrf-fusion-constant-is-5-not-60)
- **A filter on a field no document declares is dropped and the search re-run**, with a loud `filterWarning`; unknown values on declared fields are kept. `src/domain/search-diagnostics.ts` — [more](docs/design-decisions.md#impossible-filters-are-dropped)
- **Empty filtered results carry `noMatchReason`**; unfiltered misses deliberately do not. `explainEmptyResult` — [more](docs/design-decisions.md#empty-results-explain-themselves)
- **Filter strings are normalized once, in `SearchDocuments.buildFilters`** (tags via the shared `normalizeTags`); downstream diagnostics are deliberately not defensive. — [more](docs/design-decisions.md#filter-strings-are-normalized-once)
- **`read_doc` strips at most one leading path segment on a miss**; a bare basename does not resolve. `ReadDocument.resolve` — [more](docs/design-decisions.md#read_doc-tolerates-one-leading-path-segment)
- **`read_doc` section lookup ignores headings inside balanced fences, per chunk**, via the chunker's own `isFenceDelimiter`; four non-guarantees documented. `src/application/read-document.ts` — [more](docs/design-decisions.md#read_doc-section-lookup-is-fence-aware)
- **DO NOT CHANGE: excerpt flattening (S1) keeps fence-interior heading lines** — S2 needs both delimiters to drop the fence; do not copy `read_doc`'s `continue`. `src/domain/flatten-map.ts` — [more](docs/design-decisions.md#excerpt-flattening-is-fence-aware)
- **DO NOT CHANGE: S2's fence-drop regex is style-agnostic and non-greedy — `*?` is load-bearing**; unlike S1 it is not parity-gated. `flattenWithMap`, `src/domain/flatten-map.ts` — [more](docs/design-decisions.md#s2-fence-drop-is-delimiter-agnostic)
- **`isFenceDelimiter` stays exported from `src/domain/split-text.ts` (three importers)**; the next change that adds a fourth importer must move it to its own module. — [more](docs/design-decisions.md#isfencedelimiter-module-move-is-deferred)
- **DO NOT CHANGE: `HEADING_LINE` is `/^#{2,6}\s+(.+)\r?$/`** — without `\r?` every heading of a CRLF document is lost. `src/application/read-document.ts` — [more](docs/design-decisions.md#heading_line-needs-an-optional-cr-before-its-end-anchor)
- **Excerpt budget is graduated by rank (1400 / 120 chars)**; sound only while rank 1 is usually the answer — revisit first if MRR regresses. `src/domain/excerpt.ts` — [more](docs/design-decisions.md#graduated-excerpt-budget)
- **Supporting excerpts centre on their matched span**, falling back to a prefix only when no query term is locatable; the both-ellipsis cost is accepted. — [more](docs/design-decisions.md#what-supporting-excerpt-anchoring-did-not-change)
- **`matchedTerms` per result is a named, deferred follow-up** — revisit on traces of excess `read_doc` chaining or the next `SearchResultItem` change. — [more](docs/design-decisions.md#matchedterms-is-a-deferred-follow-up)
- **DO NOT CHANGE: `locateSpans` accepts whole-token matches only, tested in folded coordinates, and `WORD_CHAR` stays unexported** (exporting it would make the gate probe tautological). `src/domain/match-location.ts` — [more](docs/design-decisions.md#locatespans-requires-word-boundaries)
- **Unreadable, undecodable, bad-frontmatter or (strict) invalid files are skipped and reported in `skipped`**, never a run failure; non-UTF-8 files that decode are indexed and reported as transcoded. — [more](docs/design-decisions.md#skipped-files-never-fail-the-run)
- **Test doubles**: `test/helpers/fake-embeddings.ts` (deterministic, no model download) and the `test/fixtures/strict/` corpus. — [more](docs/design-decisions.md#test-doubles-and-fixtures)

## Working conventions

- **Everything in this repo is English** — prose, source identifiers, the MCP tool contract (`path`, `type`, `module`, `tags`, `section`, response fields like `skipped`/`indexed`/`embeddingsWarning`), config keys (`convention`, `mode`, `loose`, `strict`, `excludedStatuses`, `frontmatterFields`, `docsDir`), CLI flags, SQLite columns and default frontmatter keys.
- **The one deliberate exception is `ejemplos/` and `goldenset.yaml`, which stay Spanish.** They are the retrieval regression suite and the living evidence that an English codebase indexes Spanish documentation without loss. Do not translate them — doing so would invalidate the published quality numbers and destroy the control group that makes "works with Spanish docs" falsifiable rather than aspirational. The only English inside `ejemplos/` is three frontmatter *keys*; every value and every word of prose is Spanish.
- Why this is safe to rely on (frontmatter keys never reach the index): [more](docs/design-decisions.md#why-english-code-indexes-spanish-docs-without-loss).
- A project whose documents use non-English frontmatter keys maps them back with `convention.frontmatterFields` (e.g. `{ "status": "estado" }`) — the same mechanism that used to serve English projects, inverted.
- `compendio.config.json` is optional (see README) — don't assume a project has one; `ejemplos/` itself ships with none, to prove the zero-config discovery path is real.
- Documents live under one or more explicit or discovered roots; frontmatter (`type`/`module`/`status`) is optional by default (`convention.mode: "loose"`) and only enforced when a project opts into `convention.mode: "strict"`. This repo has no `compendio.config.json` at the repository root, so zero-config discovery indexes Markdown-bearing top-level folders such as `docs/` and `openspec/`, with every indexed `path` carrying that top-level root prefix.
