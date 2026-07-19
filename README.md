# compendio-mcp

*La documentación de tu proyecto, servida a cualquier agente en el mínimo de tokens.*

Compendio es un servidor MCP que indexa la documentación markdown de un proyecto (escrita según la [convención de documentación](docs/convencion-documentacion.md)) y la expone a cualquier agente de IA mediante búsqueda híbrida local: léxica (FTS5/BM25) + semántica (embeddings), combinadas con Reciprocal Rank Fusion. Todo en local: un fichero SQLite, un modelo de embeddings en CPU y cero llamadas de red en operación.

## Requisitos

- Node.js ≥ 20.
- Nada más: ni Docker, ni servicios, ni claves de API.

## Inicio rápido

```bash
npm install
npm run build

# Indexar el corpus de ejemplo y evaluarlo
node dist/cli.js --root ejemplos index
node dist/cli.js --root ejemplos eval

# Buscar desde la terminal
node dist/cli.js --root ejemplos search "¿cuándo se considera duplicado un lead?"
```

En el primer indexado se descarga el modelo de embeddings (`Xenova/multilingual-e5-small`, decenas de MB) y se cachea en disco; a partir de ahí la operación es 100 % offline. Si la descarga o la carga del modelo fallan, Compendio **no se cae**: indexa y busca en modo solo-léxico y lo indica en sus respuestas con `"modo": "lexico"`.

En un repositorio que siga la convención no hace falta configuración: `compendio index` desde la raíz indexa `docs/` en `.compendio/compendio.db` (añade `.compendio/` a tu `.gitignore`).

## CLI

| Comando | Qué hace |
|---|---|
| `compendio index` | Reindexa toda la documentación (`--dir` para otro directorio, `--lexico` para saltarse los embeddings) |
| `compendio search "..."` | Búsqueda híbrida con filtros: `--tipo`, `--modulo`, `--etiquetas`, `-k`, `--todos`, `--lexico` |
| `compendio overview` | Mapa del corpus indexado |
| `compendio eval` | Evalúa el goldenset y compara híbrido vs léxico (`--goldenset`, `-k`) |
| `compendio serve` | Arranca el servidor MCP por stdio |

Opción global `-C, --root <dir>`: raíz del proyecto (donde viven `compendio.config.json` y `.compendio/`).

## Herramientas MCP

Diseñadas como *progressive disclosure*: orientarse barato → buscar barato → leer solo lo necesario.

1. **`docs_overview()`** — mapa del corpus: recuento por tipo y módulo, y una línea por documento (`[tipo] ruta — resumen (estado)`). ~10 tokens por documento.
2. **`search_docs({ query, tipo?, modulo?, etiquetas?, k?, incluir_no_vigentes? })`** — los k mejores fragmentos (5 por defecto, máximo 2 por documento), con ruta, sección, extracto y score. Los documentos `borrador` u `obsoleto` quedan excluidos salvo petición explícita.
3. **`read_doc({ ruta, seccion? })`** — una sección concreta (o el documento completo) con su frontmatter. Si la ruta no existe, responde con las 3 rutas más parecidas en lugar de un error seco.

## Configuración (`compendio.config.json`)

Opcional; todos los campos tienen valor por defecto:

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

## Registro en clientes MCP

Compendio es un servidor MCP estándar por stdio y se registra igual en los cuatro clientes. Mientras el paquete no esté publicado en npm, sustituye `npx compendio-mcp` por `node <ruta-a-compendio>/dist/cli.js` (los ejemplos siguientes usan esa forma); tras publicarlo bastará `"command": "npx", "args": ["compendio-mcp", "serve"]`.

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "compendio": {
      "type": "local",
      "command": ["node", "C:/ruta/a/compendio-mcp/dist/cli.js", "serve"],
      "enabled": true
    }
  }
}
```

**Claude Code** (`.mcp.json` en la raíz del repo):

```json
{
  "mcpServers": {
    "compendio": {
      "command": "node",
      "args": ["C:/ruta/a/compendio-mcp/dist/cli.js", "serve"]
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
      "command": "node",
      "args": ["C:/ruta/a/compendio-mcp/dist/cli.js", "serve"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "compendio": {
      "command": "node",
      "args": ["C:/ruta/a/compendio-mcp/dist/cli.js", "serve"]
    }
  }
}
```

El servidor **no** reindexa por sí solo: ejecuta `compendio index` antes de arrancar el cliente (o tras cambiar la documentación). El reindexado incremental y el file-watching son fase 2.

Este repositorio incluye un `.mcp.json` que sirve el corpus de `ejemplos/` para probar las tools desde Claude Code sin configurar nada.

## ¿Cuánto aporta lo semántico sobre grep?

Medido con `compendio eval` sobre el corpus de ejemplo (`ejemplos/`: 11 documentos, 27 chunks) y su goldenset de 22 preguntas reales, ejecutado el 2026-07-19 en un portátil sin GPU:

| modo | recall@5 | MRR | fallos |
|---|---|---|---|
| híbrido | **1.00** | **0.920** | 0 |
| léxico | 0.95 | 0.885 | 1 |

- El modo léxico ya es fuerte cuando la pregunta usa la terminología del corpus (la convención de documentación empuja justo en esa dirección).
- El hueco semántico aparece con paráfrasis y sinónimos: «¿Qué endpoint hay que llamar para crear un lead?» cae a la posición 7 en léxico y lo recupera el híbrido; «fichas repetidas de clientes potenciales» (cero solape léxico con «duplicado») solo la resuelve la pata semántica.
- Indexado completo del corpus de ejemplo: ~6,5 s incluida la descarga/carga del modelo. Con el modelo caliente, la búsqueda híbrida responde en 5–20 ms y la léxica en <5 ms (requisito del MVP: <500 ms).

`compendio eval` reproduce esta tabla en cualquier momento; es también el instrumento para tunear chunking y `k` sin ir a ojo.

## Arquitectura

Hexagonal: el núcleo no conoce SQLite, ni transformers.js, ni el filesystem.

```
src/
├── domain/            # puro, sin dependencias: modelo, chunking, RRF, métricas, validación
│   └── ports.ts       # DocumentSource, MarkdownParser, IndexStore, EmbeddingsProvider
├── application/       # casos de uso: IndexDocuments, SearchDocuments, GetOverview,
│                      # ReadDocument, EvaluateSearch
├── infrastructure/    # adaptadores: SQLite (FTS5 + sqlite-vec), remark + gray-matter,
│                      # filesystem, transformers.js, configuración
├── composition.ts     # raíz de composición (wiring)
├── cli.ts             # adaptador de entrada: commander
└── server.ts          # adaptador de entrada: servidor MCP (stdio)
```

Decisiones clave (ver [docs/compendio-mvp.md](docs/compendio-mvp.md)):

- **SQLite + sqlite-vec** en vez de base vectorial dedicada: cero operación, correcto para corpus de cientos de documentos. La pata vectorial está aislada en el adaptador; migrar sería un cambio local.
- **Chunking por encabezados** (H2, y H3 si la sección excede el máximo), con fusión de secciones diminutas. Solo se corta en fronteras de encabezado, así que **las tablas nunca se parten**.
- **RRF** (`score = Σ 1/(60 + rango)`) para fusionar rankings: sin pesos que tunear a ciegas.
- **FTS5 con `remove_diacritics 2`**: «validación» y «validacion» coinciden — imprescindible en un corpus en español.
- **Degradación elegante**: cualquier fallo del runtime de embeddings deja el sistema en modo léxico, nunca lo tira.

## Desarrollo

```bash
npm run build       # compila a dist/
npm test            # 56 tests (vitest): dominio, adaptadores e integración
npm run dev -- ...  # CLI sin compilar (tsx)
```

Los tests de integración usan un proveedor de embeddings determinista (sin descargas) y el corpus real de `ejemplos/`.

## Fases

- **MVP (esto)**: indexado completo, búsqueda híbrida con filtros, 3 tools MCP, CLI (index/search/overview/eval), modo degradado, goldenset con métricas.
- **Fase 2**: reindexado incremental por hash, file-watching, generador de `INDEX.md`, proveedor Ollama (bge-m3), reranking ligero.
- **Fase 3**: retrieval consciente del rol, multi-repo, tabla de sinónimos alimentada por el glosario.
