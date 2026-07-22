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

`prepublishOnly` runs `build` then `test` — publishing fails if either fails.

Tests use `pool: "forks"` (vitest.config.ts) because `better-sqlite3` is a native addon loaded once per worker; don't switch this to threads. `CI=true` turns on `forbidOnly` so a stray `it.only` can't silently slim down the suite outside CI.

## Architecture

Hexagonal. The domain layer has zero dependencies on SQLite, transformers.js, or the filesystem — those live only in `infrastructure/` behind ports.

```
src/
├── domain/            # pure: model, chunking, RRF fusion, metrics, frontmatter validation, ports.ts
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

Registered in `server.ts`, designed to be used in this order: orient cheaply → search cheaply → read only what's needed.

1. `docs_overview()` — corpus map (counts by type/module, ~10 tokens/doc).
2. `search_docs({ query, tipo?, modulo?, etiquetas?, k?, incluir_no_vigentes? })` — hybrid search, top-k fragments. Docs in `borrador`/`obsoleto` state are excluded unless `incluir_no_vigentes` is set.
3. `read_doc({ ruta, seccion? })` — one section or the full document. Unknown `ruta` returns the 3 closest matches instead of erroring.

### Non-obvious decisions (verified against code, not just docs)

- **`sqlite-vec` requires `BigInt` primary keys** with `better-sqlite3` — passing a `number` throws "Only integers are allowed" (`src/infrastructure/sqlite/sqlite-index-store.ts:153-154`).
- **Embeddings are normalized in the provider; the `vec0` table uses plain L2**, not `distance_metric=cosine`. With normalized vectors, L2 order == cosine order, and it sidesteps a fragile cross-version syntax.
- **`compendio index-md` reads the filesystem, not the SQLite index** (`GenerateIndexMd` in `src/application/generate-index-md.ts` uses `DocumentSource` + `MarkdownParser` directly). This means `docs/INDEX.md` can never lag behind a stale DB index. `INDEX.md` never lists itself even if config `exclude` is overridden.
- **Graceful degradation on embeddings failure**: if the embeddings provider is missing or throws, `IndexDocuments` completes indexing in lexical-only mode (`modo: "lexico"`) instead of crashing, and reports why via `avisoEmbeddings`.
- **Heading-based chunking** (H2, H3 if a section exceeds the token max) — cuts only happen at heading boundaries, so tables are never split mid-row.
- **RRF** (`score = Σ 1/(60 + rank)`) fuses lexical and vector rankings — no weights to tune.
- Frontmatter with a `tipo` outside `TIPOS = ["funcional", "adr", "api", "qa", "guia"]` (`src/domain/model.ts`), or otherwise invalid, causes the file to be skipped and reported in `omitidos` — both by `index` and by `index-md` — never a hard failure of the whole run.
- Test doubles: `test/helpers/fake-embeddings.ts` provides a deterministic embeddings stub (stem-grouped, no model download) used by integration tests against the real `ejemplos/` corpus.

## Working conventions

- The written prose in this repo (README, comments explaining *why*) is in English; source identifiers, the MCP tool contract (`ruta`, `tipo`, `modulo`, `etiquetas`, `seccion`, response fields like `omitidos`/`indexados`/`avisoEmbeddings`), and the `ejemplos/` corpus stay in Spanish — this is deliberate, not an inconsistency to "fix".
- `compendio.config.json` fields all have defaults (see README) — don't assume a project has one.
- Documents live under `docs/` and are matched against `TIPOS` (`funcional`, `adr`, `api`, `qa`, `guia`) via frontmatter — this repo's own `docs/` directory follows that same convention and can be used as a live example.
