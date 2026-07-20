# Compendio — MVP of an MCP documentation server with RAG

Compendio is an MCP server that indexes a project's markdown documentation (written following the documentation convention) and exposes it to any AI agent through local hybrid search, spending the fewest tokens possible. This document defines the scope, architecture and success criteria of the MVP.

**Tagline:** *Your project's documentation, served to any agent in the fewest possible tokens.*

---

## 1. Problem and goal

AI agents need to consult the project's documentation to answer reliably, but reading whole files blows up token consumption, and keyword search (grep) fails when the question does not use the exact terminology of the corpus.

**MVP goal:** let an agent answer questions about the documentation by reading only the relevant fragments, with retrieval that also works when the question uses synonyms or paraphrases (semantic gap), with no external services and without any data leaving the machine.

**MVP non-goals:** graphical interface, source-code indexing, multi-repository, real-time synchronization, LLM reranking.

## 2. Requirements

### Functional

1. Index every `.md` in `docs/` that follows the convention (frontmatter with `tipo`, `modulo`, `estado`).
2. Search by natural language combining lexical search (BM25) and semantic search (embeddings), with metadata filters.
3. Exclude by default documents in `borrador` (draft) or `obsoleto` (obsolete) state.
4. Return compact results (path, section, excerpt) and allow reading a specific section on demand.
5. Work with any MCP client: OpenCode, Claude Code, Copilot (VS Code), Cursor.

### Non-functional

- **Local and private:** zero network calls in operation (only the initial download of the embeddings model, cached).
- **No infrastructure:** a single SQLite file; no Docker, no Milvus, no services.
- **Performance:** index 100 documents in under 30 seconds on a normal laptop; search in under 500 ms.
- **Graceful degradation:** if the embeddings model is unavailable, the server keeps working in lexical-only mode (FTS5) and signals it in its responses.
- **Language:** the default embeddings model must perform well in Spanish.

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│               compendio-mcp (npm)               │
│                                                 │
│  CLI                          MCP server        │
│  compendio index              (stdio)           │
│  compendio search "..."       docs_overview     │
│  compendio eval               search_docs       │
│         │                     read_doc          │
│         │                          │            │
│         └──────────┬───────────────┘            │
│                    ▼                            │
│              shared core                        │
│   frontmatter parser · chunking · embeddings    │
│   hybrid search (RRF)                           │
│                    │                            │
│                    ▼                            │
│         .compendio/compendio.db (SQLite)        │
│         FTS5 (BM25) + sqlite-vec (vectors)      │
└─────────────────────────────────────────────────┘
```

The CLI and the MCP server share the same core; the CLI exists to index, debug searches without spinning up an agent, and run the evaluations.

**Trade-offs accepted:** SQLite + sqlite-vec instead of a dedicated vector database (less scale, zero ops — right for corpora of hundreds of documents, not millions); full reindexing instead of incremental (simpler, and with small corpora it takes seconds); local embeddings instead of an API (slightly lower quality, but total privacy and zero cost).

## 4. Data model

```sql
-- Documentos: uno por fichero .md
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  ruta TEXT UNIQUE NOT NULL,        -- relative to docs/
  titulo TEXT NOT NULL,             -- H1
  resumen TEXT NOT NULL,            -- first paragraph
  tipo TEXT NOT NULL,               -- funcional | adr | api | qa | guia
  modulo TEXT NOT NULL,
  estado TEXT NOT NULL,             -- borrador | vigente | obsoleto
  propietario TEXT,
  etiquetas TEXT,                   -- JSON array
  actualizado TEXT,
  hash TEXT NOT NULL                -- SHA-256 of the content (basis for future incremental indexing)
);

-- Chunks: uno por sección (H2/H3)
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id),
  encabezado TEXT NOT NULL,         -- heading path: "Reglas de negocio > Campos"
  contenido TEXT NOT NULL,
  orden INTEGER NOT NULL
);

-- Lexical index (BM25)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  contenido, encabezado, content=chunks, content_rowid=id,
  tokenize='unicode61 remove_diacritics 2'
);

-- Vector index
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

Note: `remove_diacritics 2` makes "validación" and "validacion" match in lexical search — essential in a Spanish corpus.

## 5. Indexing pipeline (`compendio index`)

1. **Discover** the `.md` files under `docs/` (configurable; `INDEX.md` and `glosario.md` are excluded from chunking — the glossary is indexed as a normal document).
2. **Parse** the frontmatter with gray-matter and **validate** it against the convention: required fields present and holding allowed values. Invalid ones are reported and skipped — the indexer acts as a free linter of the convention.
3. **Chunk by headings** (H2, and H3 if the section exceeds the maximum). Target: chunks of 100–800 tokens. Contiguous tiny sections are merged; the full heading path ("Reglas de negocio > Duplicidad") always travels with the chunk.
4. **Generate embeddings** per chunk with the `passage: ` prefix (required by the E5 family) and store them in `chunks_vec`.
5. **Persist** everything in `.compendio/compendio.db` (gitignored, rebuildable with a single command).

MVP: full reindexing on demand. Incremental by hash and file-watching are left for phase 2.

## 6. Hybrid search

1. The query is run in parallel against FTS5 (BM25) and against sqlite-vec (cosine similarity, query with the `query: ` prefix).
2. The two rankings are combined with **Reciprocal Rank Fusion**: `score = Σ 1/(60 + rank)`. No weights to tune blindly; robust by default.
3. **Pre-filters** by metadata (`tipo`, `modulo`, `etiquetas`) shrink the search space before scoring. A `estado` other than `vigente` is excluded unless explicitly requested.
4. The top k chunks are returned, deduplicated by document (at most 2 chunks from the same document).

In degraded mode (no embeddings) step 1 runs only FTS5, and the response signals it with `"modo": "lexico"`.

## 7. MCP tools

Designed as *progressive disclosure*: orient cheaply → search cheaply → read only what is needed.

### `docs_overview()`

Returns the corpus map: counts by type and module, and one line per document (`[tipo] ruta — resumen (estado)`). Budget: ~10 tokens per document. It is the recommended first step for any agent.

### `search_docs({ query, tipo?, modulo?, etiquetas?, k?, incluir_no_vigentes? })`

Returns the top k fragments (5 by default):

```json
{
  "modo": "hibrido",
  "resultados": [{
    "ruta": "funcional/leadsviewer-validacion-formulario.md",
    "titulo": "Validación del formulario de alta de leads",
    "seccion": "Reglas de negocio > Reglas de duplicidad",
    "extracto": "Un lead se considera duplicado cuando su email normalizado…",
    "estado": "vigente",
    "score": 0.031
  }]
}
```

Excerpts of 2–3 lines. Target budget: full response ≤ 600 tokens.

### `read_doc({ ruta, seccion? })`

Returns the requested section (or the full document if none is given), with its frontmatter. If the path does not exist, it responds with the 3 most similar paths instead of a blunt error — an agent with a broken link must not be left blind.

## 8. Embeddings

- Pluggable interface (`embed(textos: string[]): Promise<Float32Array[]>`), with a single provider in the MVP: **transformers.js** with `Xenova/multilingual-e5-small` (384 dimensions, multilingual, tens of MB, runs on CPU).
- Choice justified by the Spanish corpus: popular English-only models (e.g. the default nomic family) degrade noticeably outside English.
- The model is downloaded on the first run and cached to disk. If the download or load fails: degraded lexical mode, never a crash.
- Phase 2: Ollama provider (bge-m3) for anyone who wants more quality in exchange for an external dependency.

## 9. Configuration (`compendio.config.json`)

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

Everything has a default value: in a repo that follows the convention, `npx compendio-mcp index` must work with no configuration file.

## 10. Evaluation (`compendio eval`) — inside the MVP

A `goldenset.yaml` file with real team questions mapped to the document that should appear:

```yaml
- pregunta: "¿Qué campos son obligatorios al dar de alta un lead?"
  esperado: funcional/leadsviewer-validacion-formulario.md
- pregunta: "¿Por qué elegimos PostgreSQL?"
  esperado: adr/adr-0007-eleccion-base-datos.md
```

`compendio eval` runs each question and reports **recall@5**, **MRR** and the list of failures — in hybrid mode and in lexical-only mode, in the same table. That comparison answers, with data, the question that justifies the project: *how much does semantics add over grep?* It is also the instrument for tuning chunking and k without guessing.

## 11. Client compatibility

Compendio is a standard MCP server over stdio: it is registered the same way in OpenCode (`opencode.json`), Claude Code (`.mcp.json`), VS Code/Copilot (`mcp.json`) or Cursor. The README will include the configuration block for all four. Acceptance criterion: tested in OpenCode and at least one more client.

## 12. Stack

| Piece | Choice |
|---|---|
| Language / runtime | TypeScript, Node ≥ 20 |
| MCP | `@modelcontextprotocol/sdk` (stdio) |
| Database | `better-sqlite3` + `sqlite-vec` extension + FTS5 |
| Frontmatter | `gray-matter` |
| Markdown / chunking | `remark` (heading tree) |
| Embeddings | `@huggingface/transformers` (transformers.js) |
| CLI | `commander` |

## 13. Phases

| Phase | Content |
|---|---|
| **MVP** | Full indexing, hybrid search with filters, 3 MCP tools, CLI (index/search/eval), degraded mode, goldenset with metrics, README with 4-client configuration |
| **Phase 2** | Incremental reindexing by hash, file-watching, `INDEX.md` generator, Ollama provider, lightweight reranking |
| **Phase 3** | Integration with Persona (role-aware retrieval: QA sees QA docs first), multi-repo, synonym table fed by the glossary |

## 14. MVP success criteria

1. `npx compendio-mcp index && npx compendio-mcp eval` works in a repo that follows the convention, with no configuration.
2. Recall@5 ≥ 0.9 over a goldenset of at least 20 real questions.
3. The hybrid vs lexical comparison is measured and documented in the README (whatever the result).
4. Typical `search_docs` response ≤ 600 tokens; `docs_overview` ≤ 10 tokens per document.
5. Zero network in operation; the corpus never leaves the machine.
6. Tested in OpenCode and in a second MCP client.

## 15. Risks and open decisions

- **sqlite-vec** is pre-1.0: stable API but young. Mitigation: the vector search interface is isolated in a module; migrating to another extension would be a local change.
- **Model download** on the first run (tens of MB): document it well and cache it; consider an explicit `compendio setup` command.
- **Chunking of long markdown tables** (frequent in the convention: fields, error messages): decide whether a table always stays whole in one chunk even if it exceeds the maximum. Initial proposal: yes, tables are not split.
- **npm package name**: `compendio-mcp`, verified available (2026-07-19). Publish a minimal 0.0.1 soon to reserve it: on npm, names are first-come, first-served.
