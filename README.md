# compendio-mcp

*Your project's documentation, served to any agent in the fewest possible tokens.*

Compendio is an MCP server that indexes a project's markdown documentation (written following the [documentation convention](docs/convencion-documentacion.md)) and exposes it to any AI agent through local hybrid search: lexical (FTS5/BM25) + semantic (embeddings), combined with Reciprocal Rank Fusion. Everything runs locally: a single SQLite file, an embeddings model on CPU, and zero network calls in operation.

## Requirements

- Node.js ≥ 20.
- Nothing else: no Docker, no services, no API keys.

## Quick start

```bash
npm install
npm run build

# Index the example corpus and evaluate it
node dist/cli.js --root ejemplos index
node dist/cli.js --root ejemplos eval

# Search from the terminal
node dist/cli.js --root ejemplos search "¿cuándo se considera duplicado un lead?"
```

On the first index the embeddings model is downloaded (`Xenova/multilingual-e5-small`, tens of MB) and cached to disk; from then on operation is 100% offline. If the model download or load fails, Compendio **does not crash**: it indexes and searches in lexical-only mode and signals it in its responses with `"modo": "lexico"`.

In a repository that follows the convention no configuration is needed: `compendio index` from the root indexes `docs/` into `.compendio/compendio.db` (add `.compendio/` to your `.gitignore`).

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

## MCP tools

Designed as *progressive disclosure*: orient cheaply → search cheaply → read only what is needed.

1. **`docs_overview()`** — corpus map: counts by type and module, and one line per document (`[tipo] ruta — resumen (estado)`). ~10 tokens per document.
2. **`search_docs({ query, tipo?, modulo?, etiquetas?, k?, incluir_no_vigentes? })`** — the top k fragments (5 by default, at most 2 per document), with path, section, excerpt and score. Documents in `borrador` (draft) or `obsoleto` (obsolete) state are excluded unless explicitly requested.
3. **`read_doc({ ruta, seccion? })`** — a specific section (or the full document) with its frontmatter. If the path does not exist, it responds with the 3 most similar paths instead of a blunt error.

## Configuration (`compendio.config.json`)

Optional; every field has a default value:

```json
{
  "docsDir": "docs",
  "exclude": ["INDEX.md"],
  "db": ".compendio/compendio.db",
  "embeddings": { "provider": "local", "model": "Xenova/multilingual-e5-small" },
  "chunk": { "minTokens": 100, "maxTokens": 800 },
  "search": { "k": 5, "estadosExcluidos": ["borrador", "obsoleto"] }
}
```

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

Measured with `compendio eval` on the example corpus (`ejemplos/`: 11 documents, 27 chunks) and its goldenset of 22 real questions, run on 2026-07-19 on a laptop without a GPU:

| mode | recall@5 | MRR | failures |
|---|---|---|---|
| hybrid | **1.00** | **0.920** | 0 |
| lexical | 0.95 | 0.885 | 1 |

- Lexical mode is already strong when the question uses the corpus terminology (the documentation convention pushes in exactly that direction).
- The semantic gap appears with paraphrases and synonyms: «¿Qué endpoint hay que llamar para crear un lead?» drops to position 7 in lexical mode and the hybrid recovers it; «fichas repetidas de clientes potenciales» (zero lexical overlap with «duplicado») is only solved by the semantic leg.
- Full index of the example corpus: ~6.5 s including model download/load. With the model warm, hybrid search responds in 5–20 ms and lexical in <5 ms (MVP requirement: <500 ms).

`compendio eval` reproduces this table at any time; it is also the instrument for tuning chunking and `k` without guessing.

## Architecture

Hexagonal: the core knows nothing about SQLite, transformers.js, or the filesystem.

```
src/
├── domain/            # pure, no dependencies: model, chunking, RRF, metrics, validation
│   └── ports.ts       # DocumentSource, MarkdownParser, IndexStore, EmbeddingsProvider
├── application/       # use cases: IndexDocuments, SearchDocuments, GetOverview,
│                      # ReadDocument, EvaluateSearch
├── infrastructure/    # adapters: SQLite (FTS5 + sqlite-vec), remark + gray-matter,
│                      # filesystem, transformers.js, configuration
├── composition.ts     # composition root (wiring)
├── cli.ts             # input adapter: commander
└── server.ts          # input adapter: MCP server (stdio)
```

Key decisions (see [docs/compendio-mvp.md](docs/compendio-mvp.md)):

- **SQLite + sqlite-vec** instead of a dedicated vector database: zero ops, right for corpora of hundreds of documents. The vector leg is isolated in the adapter; migrating would be a local change.
- **Heading-based chunking** (H2, and H3 if the section exceeds the maximum), merging tiny sections. Cuts happen only at heading boundaries, so **tables are never split**.
- **RRF** (`score = Σ 1/(60 + rank)`) to fuse rankings: no weights to tune blindly.
- **FTS5 with `remove_diacritics 2`**: «validación» and «validacion» match — essential in a Spanish corpus.
- **Graceful degradation**: any failure of the embeddings runtime leaves the system in lexical mode, never takes it down.

## Development

```bash
npm run build       # compiles to dist/
npm test            # 56 tests (vitest): domain, adapters and integration
npm run dev -- ...  # CLI without compiling (tsx)
```

The integration tests use a deterministic embeddings provider (no downloads) and the real `ejemplos/` corpus.

## Phases

- **MVP (this)**: full indexing, hybrid search with filters, 3 MCP tools, CLI (index/index-md/search/overview/eval), degraded mode, goldenset with metrics, `INDEX.md` generator.
- **Phase 2**: incremental reindexing by hash, file-watching, Ollama provider (bge-m3), lightweight reranking.
- **Phase 3**: role-aware retrieval, multi-repo, synonym table fed by the glossary.
