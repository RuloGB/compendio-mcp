# compendio-mcp

*Your project's documentation, served to any agent in the fewest possible tokens.*

Compendio is an MCP server that indexes a project's markdown documentation and exposes it to any AI agent through local hybrid search: lexical (FTS5/BM25) + semantic (embeddings), combined with Reciprocal Rank Fusion. Everything runs locally: a single SQLite file, an embeddings model on CPU, and zero network calls in operation.

Compendio works on **any folder of `.md` files with zero configuration** — no required frontmatter, no config file. If your project already maintains a documentation taxonomy (types, modules, lifecycle states), an optional [documentation convention](docs/convencion-documentacion.md) lets you additionally enforce it.

## Requirements

- Node.js ≥ 20.
- Nothing else: no Docker, no services, no API keys.

## Quick start

Use Compendio in any project that has (or will have) markdown documentation.

1. **Install it.** Either globally, to get the short `compendio` command:

   ```bash
   npm install -g compendio-mcp
   ```

   or run it on demand through `npx` with no install step — in that case use `npx compendio-mcp <command>` instead of `compendio <command>` everywhere below (`npx` does not add `compendio` to your PATH):

   ```bash
   npx compendio-mcp index
   ```

2. **Point it at your `.md` files.** By default Compendio reads `docs/` at the project root. There is nothing else to do: files with no frontmatter at all index fine — the H1 heading becomes the title (falling back to a humanized filename when there is no H1), and the folder a file lives in becomes its module. If you want to filter by `tipo`/`estado` later, add frontmatter for those fields as you go; nothing requires it up front, and no config file is needed to get started.

3. **Index it** from the project root:

   ```bash
   compendio index
   ```

   This creates `.compendio/compendio.db` (add `.compendio/` to your `.gitignore`). On the first run the embeddings model is downloaded (`Xenova/multilingual-e5-small`, tens of MB) and cached to disk; from then on operation is 100% offline. If the model download or load fails, Compendio **does not crash**: it indexes and searches in lexical-only mode and signals it in its responses with `"modo": "lexico"`.

4. **Try it from the terminal** (optional, before wiring up a client):

   ```bash
   compendio overview
   compendio search "your question here"
   ```

5. **Register it as an MCP server** in your client — see [Registration in MCP clients](#registration-in-mcp-clients) below.

No configuration file is required to index a project — every field in `compendio.config.json` has a default (see [Configuration](#configuration-compendioconfigjson) below), and the bundled `ejemplos/` corpus ships with no config file at all.

## CLI

| Command | What it does |
|---|---|
| `compendio index` | Reindexes all documentation (`--dir` for another directory, `--lexico` to skip embeddings) |
| `compendio index-md` | Generates or updates `docs/INDEX.md` — one line per document — from the corpus frontmatter (`--dir` for another directory) |
| `compendio search "..."` | Hybrid search with filters: `--tipo`, `--modulo`, `--etiquetas`, `-k`, `--todos`, `--lexico` |
| `compendio overview` | Map of the indexed corpus |
| `compendio eval` | Evaluates the goldenset and compares hybrid vs lexical (`--goldenset`, `-k`) |
| `compendio serve` | Starts the MCP server over stdio |

Global option `-C, --root <dir>`: project root (where `compendio.config.json` and `.compendio/` live).

`--tipo` accepts any string — it is a project-defined open value, not a fixed list, and an unrecognized value is never treated as an error. `--todos` includes documents that a project's `convencion.estadosExcluidos` would otherwise exclude from search (nothing is excluded by default — see [Documentation convention](#documentation-convention-optional) below).

## MCP tools

Designed as *progressive disclosure*: orient cheaply → search cheaply → read only what is needed.

1. **`docs_overview()`** — corpus map: counts by type and module (each bucket appears only when at least one document defines that field), and one line per document (`[tipo] ruta — resumen (estado)`, with the `[tipo]`/`(estado)` segments omitted for documents that don't define them). ~10 tokens per document.
2. **`search_docs({ query, tipo?, modulo?, etiquetas?, k?, incluir_no_vigentes? })`** — the top k fragments (5 by default, at most 2 per document), with path, section, excerpt and score (`estado` is included only when the document has one). `tipo` is an open, project-defined string. Documents whose `estado` is listed in the project's `convencion.estadosExcluidos` are excluded unless `incluir_no_vigentes` is set; with nothing declared (the default), nothing is excluded and the flag is a no-op.
3. **`read_doc({ ruta, seccion? })`** — a specific section (or the full document) with its frontmatter (`tipo:`/`modulo:`/`estado:` lines are rendered only when present). If the path does not exist, it responds with the 3 most similar paths instead of a blunt error.

## Documentation convention (optional)

Compendio has two modes, selected by `convencion.modo` in `compendio.config.json`:

- **`libre`** (default, zero-config) — never rejects a file for missing metadata. `titulo` comes from the first H1 (falling back to a humanized filename when there is none); `modulo` is inferred from the first folder segment under `docsDir` (a file directly under `docsDir` has no `modulo`); `tipo` and `estado` are read from frontmatter when present and left absent otherwise — they are never invented. An empty string or YAML `null` in frontmatter is treated exactly as if the field were absent. Frontmatter always wins over inference when both are available.
- **`estricto`** (opt-in) — a linter, not an inference engine: every document needs an H1 (no filename fallback) and non-empty `tipo`/`modulo`/`estado`. If a project declares `convencion.tipos`/`convencion.estados`, each of `tipo`/`estado` is checked against its own declared list independently (`modulo` never has a taxonomy — it is always presence-only, whatever is declared for the other two). If a taxonomy isn't declared for a field, that field falls back to presence-only validation. Files that fail validation are skipped and reported in `omitidos`, exactly as under `libre`'s own resilience rules (unreadable file, unparseable frontmatter, or a document with no indexable content).

Reproducing a fixed taxonomy (`tipo`/`estado` restricted to a declared list, `borrador`/`obsoleto` hidden from search by default) is an explicit opt-in — see `test/fixtures/estricto/compendio.config.json` in this repository for a complete worked example:

```jsonc
{
  "convencion": {
    "modo": "estricto",
    "tipos": ["funcional", "adr", "api", "qa", "guia"],
    "estados": ["borrador", "vigente", "obsoleto"],
    "estadosExcluidos": ["borrador", "obsoleto"]
  }
}
```

See [`docs/convencion-documentacion.md`](docs/convencion-documentacion.md) for the fully authored convention this repository's own `docs/` follows, including file-naming and internal-structure guidance beyond what Compendio itself validates.

## Configuration (`compendio.config.json`)

Optional; every field has a default value:

```json
{
  "docsDir": "docs",
  "exclude": ["INDEX.md"],
  "db": ".compendio/compendio.db",
  "embeddings": { "provider": "local", "model": "Xenova/multilingual-e5-small" },
  "chunk": { "minTokens": 100, "maxTokens": 800 },
  "search": { "k": 5 },
  "convencion": {
    "modo": "libre",
    "estadosExcluidos": [],
    "camposFrontmatter": { "tipo": "tipo", "modulo": "modulo", "estado": "estado" }
  }
}
```

Declaring only part of the `convencion` block (or of `camposFrontmatter`) merges with these defaults field by field — it never wipes the sibling fields you didn't mention.

`camposFrontmatter` lets a project map `tipo`/`modulo`/`estado` to non-standard frontmatter keys (e.g. `{ "tipo": "type" }` reads a document's `type:` field as `tipo`). Two fields can map to the same source key; both simply read that key's value.

**`search.estadosExcluidos` is retired** — `estadosExcluidos` now lives under `convencion` (shown above). A config that still declares `search.estadosExcluidos` prints a one-line deprecation notice to stderr and the value is otherwise ignored; it is not silently migrated.

## Registration in MCP clients

Compendio is a standard MCP server over stdio and is registered the same way in all four clients. The package is published on [npm](https://www.npmjs.com/package/compendio-mcp), so the examples below use `npx`; to run a local checkout instead (development), replace it with `node <path-to-compendio>/dist/cli.js serve`.

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "compendio": {
      "type": "local",
      "command": ["npx", "compendio-mcp", "serve"],
      "enabled": true
    }
  }
}
```

**Claude Code** (`.mcp.json` at the repo root):

```json
{
  "mcpServers": {
    "compendio": {
      "command": "npx",
      "args": ["compendio-mcp", "serve"]
    }
  }
}
```

**VS Code / Copilot** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "compendio": {
      "type": "stdio",
      "command": "npx",
      "args": ["compendio-mcp", "serve"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "compendio": {
      "command": "npx",
      "args": ["compendio-mcp", "serve"]
    }
  }
}
```

The server does **not** reindex on its own: run `compendio index` before starting the client (or after changing the documentation). Incremental reindexing and file-watching are phase 2.

This repository includes a `.mcp.json` that serves the `ejemplos/` corpus so you can try the tools from Claude Code with zero configuration.

## How much does semantics add over grep?

Measured with `compendio eval` on the example corpus (`ejemplos/`: 11 documents, 27 chunks, **no `compendio.config.json`** — the zero-config path itself) and its goldenset of 22 real questions:

| mode | recall@5 | MRR | failures |
|---|---|---|---|
| hybrid | **1.00** | **0.943** | 0 |
| lexical | 0.95 | 0.857 | 1 |

- Lexical mode is already strong when the question uses the corpus terminology.
- The semantic gap appears with paraphrases and synonyms: «¿Qué endpoint hay que llamar para crear un lead?» drops out of the top 5 in lexical mode and the hybrid leg recovers it; questions with zero lexical overlap with the matching document's wording are solved only by the semantic leg.
- Full index of the example corpus: a few seconds including model download/load. With the model warm, hybrid search responds in 5–20 ms and lexical in <5 ms (MVP requirement: <500 ms).

`compendio eval` reproduces this table at any time; it is also the instrument for tuning chunking and `k` without guessing.

## Architecture

Hexagonal: the core knows nothing about SQLite, transformers.js, or the filesystem.

```
src/
├── domain/            # pure, no dependencies: model, chunking, RRF, metrics, convencion policy
│   └── ports.ts       # DocumentSource, MarkdownParser, IndexStore, EmbeddingsProvider
├── application/       # use cases: IndexDocuments, SearchDocuments, GetOverview,
│                      # ReadDocument, EvaluateSearch, GenerateIndexMd
├── infrastructure/    # adapters: SQLite (FTS5 + sqlite-vec), remark + gray-matter,
│                      # filesystem, transformers.js, configuration
├── composition.ts     # composition root (wiring)
├── cli.ts             # input adapter: commander
└── server.ts          # input adapter: MCP server (stdio)
```

Key decisions:

- **SQLite + sqlite-vec** instead of a dedicated vector database: zero ops, right for corpora of hundreds of documents. The vector leg is isolated in the adapter; migrating would be a local change.
- **Heading-based chunking** (H2, and H3 if the section exceeds the maximum), merging tiny sections. Cuts happen only at heading boundaries, so **tables are never split**.
- **RRF** (`score = Σ 1/(60 + rank)`) to fuse rankings: no weights to tune blindly.
- **FTS5 with `remove_diacritics 2`**: «validación» and «validacion» match — essential in a Spanish corpus.
- **Graceful degradation**: any failure of the embeddings runtime leaves the system in lexical mode, never takes it down.
- **`tipo`/`modulo`/`estado` are optional, project-defined strings**, resolved by an injected `ConvencionPolicy` (`libre` inference vs `estricto` validation) — see [Documentation convention](#documentation-convention-optional).

## Development

```bash
npm install
npm run build       # compiles to dist/
npm test            # vitest: domain, adapters and integration
npm run dev -- ...  # CLI without compiling (tsx)
```

The integration tests use a deterministic embeddings provider (no downloads) and the real `ejemplos/` corpus.

Try the CLI against the bundled example corpus without installing the package:

```bash
node dist/cli.js --root ejemplos index
node dist/cli.js --root ejemplos eval
node dist/cli.js --root ejemplos search "¿cuándo se considera duplicado un lead?"
```
