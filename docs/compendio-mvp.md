# Compendio — MVP de servidor MCP de documentación con RAG

Compendio es un servidor MCP que indexa la documentación markdown de un proyecto (escrita según la convención de documentación) y la expone a cualquier agente de IA mediante búsqueda híbrida local, gastando el mínimo de tokens posible. Este documento define el alcance, la arquitectura y los criterios de éxito del MVP.

**Tagline:** *La documentación de tu proyecto, servida a cualquier agente en el mínimo de tokens.*

---

## 1. Problema y objetivo

Los agentes de IA necesitan consultar la documentación del proyecto para responder con fiabilidad, pero leer ficheros enteros dispara el consumo de tokens y la búsqueda por palabras (grep) falla cuando la pregunta no usa la terminología exacta del corpus.

**Objetivo del MVP:** que un agente responda preguntas sobre la documentación leyendo solo los fragmentos relevantes, con recuperación que funcione también cuando la pregunta usa sinónimos o parafrasea (hueco semántico), sin servicios externos y sin que ningún dato salga de la máquina.

**No-objetivos del MVP:** interfaz gráfica, indexado de código fuente, multi-repositorio, sincronización en tiempo real, reranking con LLM.

## 2. Requisitos

### Funcionales

1. Indexar todos los `.md` de `docs/` que sigan la convención (frontmatter con `tipo`, `modulo`, `estado`).
2. Buscar por lenguaje natural combinando búsqueda léxica (BM25) y semántica (embeddings), con filtros por metadatos.
3. Excluir por defecto documentos en estado `borrador` u `obsoleto`.
4. Devolver resultados compactos (ruta, sección, extracto) y permitir leer una sección concreta bajo demanda.
5. Funcionar con cualquier cliente MCP: OpenCode, Claude Code, Copilot (VS Code), Cursor.

### No funcionales

- **Local y privado:** cero llamadas de red en operación (solo la descarga inicial del modelo de embeddings, cacheada).
- **Sin infraestructura:** un único fichero SQLite; nada de Docker, ni Milvus, ni servicios.
- **Rendimiento:** indexar 100 documentos en menos de 30 segundos en un portátil normal; búsqueda en menos de 500 ms.
- **Degradación elegante:** si el modelo de embeddings no está disponible, el servidor sigue funcionando en modo solo-léxico (FTS5) y lo indica en sus respuestas.
- **Idioma:** el modelo de embeddings por defecto debe rendir bien en español.

## 3. Arquitectura

```
┌─────────────────────────────────────────────────┐
│               compendio-mcp (npm)               │
│                                                 │
│  CLI                          Servidor MCP      │
│  compendio index              (stdio)           │
│  compendio search "..."       docs_overview     │
│  compendio eval               search_docs       │
│         │                     read_doc          │
│         │                          │            │
│         └──────────┬───────────────┘            │
│                    ▼                            │
│              núcleo común                       │
│   parser frontmatter · chunking · embeddings    │
│   búsqueda híbrida (RRF)                        │
│                    │                            │
│                    ▼                            │
│         .compendio/compendio.db (SQLite)        │
│         FTS5 (BM25) + sqlite-vec (vectores)     │
└─────────────────────────────────────────────────┘
```

CLI y servidor MCP comparten el mismo núcleo; el CLI existe para indexar, depurar búsquedas sin levantar un agente, y ejecutar las evaluaciones.

**Trade-offs asumidos:** SQLite + sqlite-vec en lugar de una base vectorial dedicada (menos escala, cero operación — correcto para corpus de cientos de documentos, no millones); reindexado completo en lugar de incremental (más simple, y con corpus pequeños cuesta segundos); embeddings locales en lugar de API (algo menos de calidad, pero privacidad total y coste cero).

## 4. Modelo de datos

```sql
-- Documentos: uno por fichero .md
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  ruta TEXT UNIQUE NOT NULL,        -- relativa a docs/
  titulo TEXT NOT NULL,             -- H1
  resumen TEXT NOT NULL,            -- primer párrafo
  tipo TEXT NOT NULL,               -- funcional | adr | api | qa | guia
  modulo TEXT NOT NULL,
  estado TEXT NOT NULL,             -- borrador | vigente | obsoleto
  propietario TEXT,
  etiquetas TEXT,                   -- JSON array
  actualizado TEXT,
  hash TEXT NOT NULL                -- SHA-256 del contenido (base del incremental futuro)
);

-- Chunks: uno por sección (H2/H3)
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id),
  encabezado TEXT NOT NULL,         -- ruta de encabezados: "Reglas de negocio > Campos"
  contenido TEXT NOT NULL,
  orden INTEGER NOT NULL
);

-- Índice léxico (BM25)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  contenido, encabezado, content=chunks, content_rowid=id,
  tokenize='unicode61 remove_diacritics 2'
);

-- Índice vectorial
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

Nota: `remove_diacritics 2` hace que "validación" y "validacion" coincidan en la búsqueda léxica — imprescindible en un corpus en español.

## 5. Pipeline de indexado (`compendio index`)

1. **Descubrir** los `.md` bajo `docs/` (configurable; `INDEX.md` y `glosario.md` excluidos del chunking, el glosario se indexa como documento normal).
2. **Parsear** frontmatter con gray-matter y **validar** contra la convención: campos obligatorios presentes y con valores permitidos. Los inválidos se reportan y se omiten — el indexador actúa de linter gratuito de la convención.
3. **Trocear por encabezados** (H2, y H3 si la sección supera el máximo). Objetivo: chunks de 100–800 tokens. Secciones diminutas contiguas se fusionan; el encabezado completo ("Reglas de negocio > Duplicidad") acompaña siempre al chunk.
4. **Generar embeddings** por chunk con prefijo `passage: ` (requisito de la familia E5) y guardarlos en `chunks_vec`.
5. **Persistir** todo en `.compendio/compendio.db` (gitignoreado, reconstruible con un comando).

MVP: reindexado completo bajo demanda. Incremental por hash y file-watching quedan para la fase 2.

## 6. Búsqueda híbrida

1. La consulta se lanza en paralelo contra FTS5 (BM25) y contra sqlite-vec (similitud coseno, consulta con prefijo `query: `).
2. Los dos rankings se combinan con **Reciprocal Rank Fusion**: `score = Σ 1/(60 + rango)`. Sin pesos que tunear a ciegas; robusto por defecto.
3. **Filtros previos** por metadatos (`tipo`, `modulo`, `etiquetas`) reducen el espacio de búsqueda antes de puntuar. `estado` distinto de `vigente` se excluye salvo petición explícita.
4. Se devuelven los k mejores chunks, deduplicados por documento (máximo 2 chunks del mismo documento).

En modo degradado (sin embeddings) el paso 1 solo ejecuta FTS5, y la respuesta lo indica con `"modo": "lexico"`.

## 7. Herramientas MCP

Diseñadas como *progressive disclosure*: orientarse barato → buscar barato → leer solo lo necesario.

### `docs_overview()`

Devuelve el mapa del corpus: recuento por tipo y módulo, y una línea por documento (`[tipo] ruta — resumen (estado)`). Presupuesto: ~10 tokens por documento. Es el primer paso recomendado para cualquier agente.

### `search_docs({ query, tipo?, modulo?, etiquetas?, k?, incluir_no_vigentes? })`

Devuelve los k mejores fragmentos (por defecto 5):

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

Extractos de 2–3 líneas. Presupuesto objetivo: respuesta completa ≤ 600 tokens.

### `read_doc({ ruta, seccion? })`

Devuelve la sección pedida (o el documento completo si no se indica), con su frontmatter. Si la ruta no existe, responde con las 3 rutas más parecidas en lugar de un error seco — un agente con un enlace roto no debe quedarse ciego.

## 8. Embeddings

- Interfaz pluggable (`embed(textos: string[]): Promise<Float32Array[]>`), con un único proveedor en el MVP: **transformers.js** con `Xenova/multilingual-e5-small` (384 dimensiones, multilingüe, decenas de MB, corre en CPU).
- Elección justificada por el corpus en español: los modelos populares solo-inglés (p. ej. la familia nomic por defecto) degradan notablemente fuera del inglés.
- El modelo se descarga en el primer arranque y se cachea en disco. Si la descarga o la carga fallan: modo degradado léxico, nunca un crash.
- Fase 2: proveedor Ollama (bge-m3) para quien quiera más calidad a cambio de dependencia externa.

## 9. Configuración (`compendio.config.json`)

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

Todo tiene valor por defecto: en un repo que siga la convención, `npx compendio-mcp index` debe funcionar sin fichero de configuración.

## 10. Evaluación (`compendio eval`) — dentro del MVP

Un fichero `goldenset.yaml` con preguntas reales del equipo mapeadas al documento que debe aparecer:

```yaml
- pregunta: "¿Qué campos son obligatorios al dar de alta un lead?"
  esperado: funcional/leadsviewer-validacion-formulario.md
- pregunta: "¿Por qué elegimos PostgreSQL?"
  esperado: adr/adr-0007-eleccion-base-datos.md
```

`compendio eval` ejecuta cada pregunta y reporta **recall@5**, **MRR** y la lista de fallos — en modo híbrido y en modo solo-léxico, en la misma tabla. Esa comparación responde con datos la pregunta que justifica el proyecto: *¿cuánto aporta lo semántico sobre grep?* Es también el instrumento para tunear chunking y k sin ir a ojo.

## 11. Compatibilidad de clientes

Compendio es un servidor MCP estándar por stdio: se registra igual en OpenCode (`opencode.json`), Claude Code (`.mcp.json`), VS Code/Copilot (`mcp.json`) o Cursor. El README incluirá el bloque de configuración de los cuatro. Criterio de aceptación: probado en OpenCode y en al menos un cliente más.

## 12. Stack

| Pieza | Elección |
|---|---|
| Lenguaje / runtime | TypeScript, Node ≥ 20 |
| MCP | `@modelcontextprotocol/sdk` (stdio) |
| Base de datos | `better-sqlite3` + extensión `sqlite-vec` + FTS5 |
| Frontmatter | `gray-matter` |
| Markdown / chunking | `remark` (árbol de encabezados) |
| Embeddings | `@huggingface/transformers` (transformers.js) |
| CLI | `commander` |

## 13. Fases

| Fase | Contenido |
|---|---|
| **MVP** | Indexado completo, búsqueda híbrida con filtros, 3 tools MCP, CLI (index/search/eval), modo degradado, goldenset con métricas, README con configuración de 4 clientes |
| **Fase 2** | Reindexado incremental por hash, file-watching, generador de `INDEX.md`, proveedor Ollama, reranking ligero |
| **Fase 3** | Integración con Persona (retrieval consciente del rol: QA ve primero docs de QA), multi-repo, tabla de sinónimos alimentada por el glosario |

## 14. Criterios de éxito del MVP

1. `npx compendio-mcp index && npx compendio-mcp eval` funciona en un repo que siga la convención, sin configuración.
2. Recall@5 ≥ 0,9 sobre un goldenset de al menos 20 preguntas reales.
3. La comparación híbrido vs. léxico está medida y documentada en el README (sea cual sea el resultado).
4. Respuesta típica de `search_docs` ≤ 600 tokens; `docs_overview` ≤ 10 tokens por documento.
5. Cero red en operación; el corpus nunca sale de la máquina.
6. Probado en OpenCode y en un segundo cliente MCP.

## 15. Riesgos y decisiones abiertas

- **sqlite-vec** es pre-1.0: API estable pero joven. Mitigación: la interfaz de búsqueda vectorial queda aislada en un módulo; migrar a otra extensión sería local.
- **Descarga del modelo** en el primer arranque (decenas de MB): documentar bien y cachear; valorar un comando `compendio setup` explícito.
- **Chunking de tablas markdown** largas (frecuentes en la convención: campos, mensajes de error): decidir si una tabla se mantiene siempre íntegra en un chunk aunque supere el máximo. Propuesta inicial: sí, las tablas no se parten.
- **Nombre del paquete npm**: `compendio-mcp`, verificado libre (2026-07-19). Publicar pronto una 0.0.1 mínima para reservarlo: en npm los nombres son por orden de llegada.
