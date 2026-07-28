# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Manual smoke test for `index` progress reporting (not automatable in CI: a real cold download is
~129 MB). **Run `node dist/cli.js`, not `compendio`** — the bare name resolves to whatever is
installed globally from npm, which is how a change like this gets reported as "not working" while
being perfectly fine in `dist/`. Clear the transformers.js model cache
(`node_modules/@huggingface/transformers/.cache`, ~130 MB), then in an interactive terminal:

```bash
node dist/cli.js --root ejemplos index
COMPENDIO_PROGRESS=bar node dist/cli.js --root ejemplos index 2>frames.txt
COMPENDIO_PROGRESS=none node dist/cli.js --root ejemplos index
```

What to expect (measured, not assumed — see `timing-measurement.md`'s addendum in the archived
change):

- **Cold cache**: the bar tracks the download live, climbing 4% → 100% with the elapsed counter
  advancing. This is the case the feature exists for. Observed: 20 frames, 1 681 bytes on stderr.
- **Warm cache**: the run still crosses `BAR_MIN_ELAPSED_MS` (1 500 ms) and draws, but **few
  frames** — `onnxruntime-node` blocks Node's main thread for the whole of each inference call, so
  the repaint heartbeat only fires during network download and in the gaps between batches, never
  during inference itself. A near-empty `frames.txt` on a warm one-batch corpus is expected, not a
  regression.
- **`COMPENDIO_PROGRESS=none`**: stderr carries no progress output. `stdout` is byte-identical in
  every mode apart from the run-duration figure.

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

Registered in `server.ts`. Progressive disclosure is a set of rungs, **not a mandatory sequence**: `search_docs` is the entry point for a specific question (it usually answers outright, in one call), `docs_overview` is for enumerating the corpus or picking filter values, and `read_doc` is the last resort — with a `section`, since a whole document costs several times more. The tool descriptions carry this routing, so it holds without any per-project agent configuration.

1. `docs_overview()` — corpus map (counts by type/module, ~10 tokens/doc). `byType`/`byModule` buckets and per-document `[type]`/`(status)` segments are omitted entirely when a document/corpus has no value for that field — never a synthetic "no type" bucket or `[undefined]`.
2. `search_docs({ query, type?, module?, tags?, k?, include_excluded? })` — hybrid search, top-k fragments with a **graduated excerpt budget**: the rank-1 fragment gets `LEAD_EXCERPT_CHARS` (1400) so it can answer outright, the rest get `SUPPORTING_EXCERPT_CHARS` (120), enough to judge whether rank 1 is the right one. A trailing `…` is the documented truncation signal that tells an agent to call `read_doc`. `type` is an open, project-defined string (no enum). Docs whose `status` is listed in the project's `convention.excludedStatuses` are excluded unless `include_excluded` is set; with nothing declared (the default), nothing is excluded and the flag is a no-op.
3. `read_doc({ path, section? })` — one section or the full document; `type:`/`module:`/`status:` header lines render only when present. Unknown `path` returns the 3 closest matches instead of erroring.

### Non-obvious decisions (verified against code, not just docs)

- **`type`/`module`/`status` are optional, project-defined open strings**, not a closed taxonomy — `src/domain/model.ts`'s old `Tipo`/`Estado`/`TIPOS`/`ESTADOS` are retired. Resolution is driven by `convention.mode` (`src/domain/convention.ts`, injected as a `ConventionPolicy`): `"loose"` (default, zero-config) infers `title`/`module` and never skips a file for missing/unknown metadata; `"strict"` (opt-in) is a linter that requires an H1 and non-empty `type`/`module`/`status`, validating `type`/`status` independently against a project's declared `convention.types`/`convention.statuses` when present (presence-only otherwise — `module` is always presence-only, it has no taxonomy). See `docs/documentation-convention.md` for the full behavior table.
- **`status` filtering is a NULL-aware deny-list** (`convention.excludedStatuses`, default `[]`), not a closed allow-list — a document with no `status` is never excluded. `mergeConfig` builds `search` from an explicit whitelist rather than a spread, so an unrecognized key in a project's config can never leak into the loaded config (`src/infrastructure/config.ts`).
- **SQLite `type`/`module`/`status` columns are nullable.** `migrate()` (constructor path — runs on *every* container construction: `search`, `overview`, `eval`, `index-md`, `serve`, `index`) stays a non-destructive `CREATE TABLE IF NOT EXISTS`. The current-schema guarantee — including upgrading a pre-existing database created under the old `NOT NULL` schema, with no manual `.compendio/` deletion — lives in `reset()` instead, which runs only once, at the start of `IndexDocuments.execute()`, as a single-transaction drop-and-recreate (`src/infrastructure/sqlite/sqlite-index-store.ts`). Concurrent readers (e.g. a live `compendio serve`) during that transaction are a declared non-goal — they may see empty results or a transient error for its duration; retrying after the `index` run completes is the supported behavior.
- **`docs/INDEX.md` and `docs_overview` order entries alphabetically by `path` by default** (`src/domain/index-markdown.ts`'s `renderIndexMd`/`createIndexComparator`). Under `strict` with a declared `convention.types`, ordering follows that declared sequence instead, falling back to alphabetical by `path` within each `type` group. There is no legacy `TIPOS.indexOf` compatibility path.
- **`sqlite-vec` requires `BigInt` primary keys** with `better-sqlite3` — passing a `number` throws "Only integers are allowed" (`src/infrastructure/sqlite/sqlite-index-store.ts:153-154`).
- **Embeddings are normalized in the provider; the `vec0` table uses plain L2**, not `distance_metric=cosine`. With normalized vectors, L2 order == cosine order, and it sidesteps a fragile cross-version syntax.
- **`compendio index-md` reads the filesystem, not the SQLite index** (`GenerateIndexMd` in `src/application/generate-index-md.ts` uses `DocumentSource` + `MarkdownParser` directly). This means `docs/INDEX.md` can never lag behind a stale DB index. `INDEX.md` never lists itself even if config `exclude` is overridden.
- **Graceful degradation on embeddings failure**: if the embeddings provider is missing or throws, `IndexDocuments` completes indexing in lexical-only mode (`mode: "lexical"`) instead of crashing, and reports why via `embeddingsWarning`.
- **Heading-based chunking** (H2, H3 if a section exceeds the token max) — cuts only happen at heading boundaries, so tables are never split mid-row.
- **RRF** (`score = Σ 1/(60 + rank)`) fuses lexical and vector rankings — no weights to tune.
- **A structurally impossible filter is dropped, not honoured** (`dropImpossibleFilters` in `src/domain/search-diagnostics.ts`). An agent told to go straight to `search_docs` cannot know the project's taxonomy, so it infers `type` from directory names (`docs/uc/` → `type: "uc"`); against a project whose frontmatter keys were never mapped, that filter can never match. Prose could not stop this — parameter descriptions saying "never infer it from directory names" were observed being ignored three times in one session, with the agent escalating `k` from 5 to 10 rather than dropping the filter `noMatchReason` told it to drop. So the mechanism changed instead: a filter targeting a field **no document declares** is removed, the search re-runs unfiltered, and `filterWarning` says what was ignored and names `convention.frontmatterFields` as the real fix. Nothing is hidden — the fallback is loud. The narrower line matters: a filter on a *declared* field with an unknown value is kept, because that request is answerable and the caller gets the real values back to correct itself with.
- **An empty `search_docs` result explains itself** via `noMatchReason` (`explainEmptyResult`), covering the value-does-not-exist case (declared values listed), individually-valid filters whose combination matches nothing, and the project's own `convention.excludedStatuses` deny-list — that last being the case a caller cannot possibly guess, since it comes from config rather than the request. Deliberately absent on an *unfiltered* miss: a bare query matching nothing needs no explanation, and inventing one would be noise on every empty search.
- **`read_doc` tolerates one leading path segment** (`ReadDocument.resolve`). Indexed paths are docs-relative (`func/x.md`) but a caller that just saw the file on disk holds `docs/func/x.md`. Both name exactly one document; rejecting the second was observed costing a failed call per document, then a retry with the prefix stripped — doubling every read in a session. Only attempted when the literal path misses, and only one segment deep, so a genuine document at `a/b.md` always wins over stripping into `b.md`.
- **The excerpt budget is graduated by rank, not uniform** (`src/domain/excerpt.ts`'s `excerptBudget`). A flat cap loses either way: small enough to keep `k` results affordable is too small to answer with. Measured over `ejemplos/` + a 17-doc external corpus, the previous flat 240 truncated ~93% of fragments and withheld ~70% of their content, so `search_docs` paid answer prices for router value while `read_doc` stayed mandatory anyway. The policy is only sound because rank 1 usually *is* the answer (hybrid MRR 0.943, top-1 20/22 on `ejemplos/`) — if that regresses, revisit this first.
- A file that is unreadable, fails frontmatter parsing, or (under `strict`) fails validation is skipped and reported in `skipped` — both by `index` and by `index-md` — never a hard failure of the whole run; these resilience reasons are mode-independent (identical under `loose` and `strict`).
- Test doubles: `test/helpers/fake-embeddings.ts` provides a deterministic embeddings stub (stem-grouped, no model download) used by integration tests against the real `ejemplos/` corpus. `test/fixtures/strict/` is a small synthetic corpus + `compendio.config.json` that exercises `convention.mode: "strict"` end to end.

## Working conventions

- **Everything in this repo is English** — prose, source identifiers, the MCP tool contract (`path`, `type`, `module`, `tags`, `section`, response fields like `skipped`/`indexed`/`embeddingsWarning`), config keys (`convention`, `mode`, `loose`, `strict`, `excludedStatuses`, `frontmatterFields`, `docsDir`), CLI flags, SQLite columns and default frontmatter keys.
- **The one deliberate exception is `ejemplos/` and `goldenset.yaml`, which stay Spanish.** They are the retrieval regression suite and the living evidence that an English codebase indexes Spanish documentation without loss. Do not translate them — doing so would invalidate the published quality numbers and destroy the control group that makes "works with Spanish docs" falsifiable rather than aspirational. The only English inside `ejemplos/` is three frontmatter *keys*; every value and every word of prose is Spanish.
- Why this is safe, and worth re-deriving before doubting it: frontmatter keys never reach the index (`matter(raw)` yields `{ data, content }` and only `content` is chunked and embedded), FTS5 uses `unicode61 remove_diacritics 2` with no language-specific stemmer, and `EvaluateSearch` passes no metadata filters. Code language and retrieval quality are structurally independent.
- A project whose documents use non-English frontmatter keys maps them back with `convention.frontmatterFields` (e.g. `{ "status": "estado" }`) — the same mechanism that used to serve English projects, inverted.
- `compendio.config.json` fields all have defaults (see README) — don't assume a project has one; `ejemplos/` itself ships with none, to prove the zero-config path is real.
- Documents live under `docs/` (configurable via `docsDir`); frontmatter (`type`/`module`/`status`) is optional by default (`convention.mode: "loose"`) and only enforced when a project opts into `convention.mode: "strict"`. This repo's own `docs/documentation-convention.md` documents the project's *chosen* team convention (a style/taxonomy the team follows), but this repo indexes its own `docs/` under the default zero-config `loose` mode — there is no `compendio.config.json` at the repository root.
