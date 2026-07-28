# Exploration: English Contract Rename

Compendio's public/internal contract moves fully to English — TypeScript identifiers, the MCP
tool contract, SQLite schema, config keys, CLI flags, and default frontmatter field names. The
`ejemplos/` corpus and `goldenset.yaml` are the one deliberate exception and stay Spanish. This is
a decided rename, not a design debate; this document maps the actual blast radius, flags
correctness hazards a mechanical find-replace would miss, and resolves the one open architectural
question (whether `ejemplos/` still works zero-config after the rename).

## 1. Inventory of the Spanish Surface, by Kind

Each kind fails differently if renamed carelessly, so they need different handling — not one
global find/replace.

### 1a. Pure TypeScript identifiers (safe for IDE rename-symbol tooling)

| Layer | Files | What's Spanish |
|---|---|---|
| `domain/model.ts` | 1 | `DocumentMeta`/`Chunk`/`IndexedDocument`/`SearchFilters`/`SearchResultItem`/`SearchResponse` fields: `ruta`, `titulo`, `resumen`, `tipo`, `modulo`, `estado`, `propietario`, `etiquetas`, `actualizado`, `encabezado`, `contenido`, `orden`; `SearchMode = "hibrido" \| "lexico"` |
| `domain/ports.ts` | 1 | `DocumentFile.{ruta,contenido}`, `ReadError.{ruta,error}`, `DiscoverResult.erroresLectura`, `EmbeddingsProvider.embed(textos)`, `ChunkMissingVector.{ruta,encabezado,contenido}`, `IndexFileWriter.write(contenido)`, `IndexWriteResult.{ruta,cambiado}` |
| `domain/convencion.ts` (file itself Spanish) | 1 | `ConvencionConfig`, `ConvencionPolicy`, `crearConvencionPolicy`, `crearPoliticaLibre`/`crearPoliticaEstricta`, `crearComparadorIndice`, `leerCampo`, `inferirModulo`, `humanizarNombreArchivo`, `modo: "libre" \| "estricto"` |
| `domain/frontmatter.ts` | 1 | `FrontmatterInput`/`FrontmatterResult`, `resolveEtiquetas`, `aplicarCamposOpcionales`, error string `"'etiquetas' debe ser una lista de cadenas"` |
| `domain/index-markdown.ts` | 1 | `IndexEntry`, `condenseResumen`, `displayResumen`, `formatDocLine`, `compararAlfabetico`, `TITULO_INDICE`/`AVISO_GENERADO` string constants (rendered into `INDEX.md`) |
| `domain/chunking.ts`, `outline.ts` | 2 | `Piece.{path,texto}`, `sectionFullText`, `DocSection.{titulo,texto,children}`, `DocOutline.{titulo,resumen,intro,secciones}` |
| `application/*.ts` (7 files) | 7 | `SearchQuery.{tipo,modulo,etiquetas,incluirNoVigentes,forzarLexico}`, `SearchDefaults.estadosExcluidos`, `Overview{,Line}`, `SincronizacionInfo`, `toSincronizacionInfo`, `IndexReport`/`SyncReport`/`IndexMdReport` fields (`indexados`,`omitidos`,`eliminados`,`totalChunks`,`duracionMs`,`avisoEmbeddings`), `ReadRequest`/`ReadResult` (`ruta`,`seccion`,`tipo` as a discriminant: `"documento"\|"seccion"\|"ruta-no-encontrada"\|"seccion-no-encontrada"`), `EvalCase.{pregunta,esperado}`, `EvalCaseOutcome.posicion`, `PipelineOptions.sinChunking`, `computeHash`/`transformFile` params (`hash`, `file.contenido`) |
| `infrastructure/*` (7 files) | 7 | `FileDocumentSource.walk(...erroresLectura)`, `DocumentRow`/`ChunkRow` (SQLite row shapes — see 1c), `RemarkMarkdownParser`'s `HeadingEvent.titulo`, `buildOutline`'s `secciones`, `TransformersEmbeddings.embed(textos)` |
| `domain/metrics.ts` | 1 | `EvalCase.{pregunta,esperado}`, `EvalCaseOutcome.posicion`, `EvalSummary.{casos,recallAtK,mrr,fallos}` — not in the original naming map, extended below |
| `server.ts`, `cli.ts` | 2 | see 1d/1e |

**Naming-map gaps found during the read** (extend the agreed map with these — all mechanical, all
confirmed by reading real usage, none ambiguous):

| Spanish | English | Where |
|---|---|---|
| `pregunta` | `question` | `EvalCase`, goldenset loader in `cli.ts` |
| `esperado` | `expected` | `EvalCase`, goldenset loader |
| `posicion` | `position` | `EvalCaseOutcome` |
| `fallos` | `failures` | `EvalSummary` |
| `casos` | `cases` | `EvalSummary`, `cli.ts` eval printer |
| `errores` / `erroresLectura` | `errors` / `readErrors` | `ports.ts`, `sync-index.ts`, `index-pipeline.ts` |
| `texto` / `textos` | `text` / `texts` | `EmbeddingsProvider.embed`, `index-pipeline.ts`, `sync-index.ts` |
| `documento` (singular) | `document` | many error/skip messages, `formatReadResult`'s discriminant `"documento"` |
| `existente` / `cambiado` / `escrito` | `existing` / `changed` / `written` | `file-index-writer.ts`, `generate-index-md.ts` |
| `eliminados` | `deleted` | `SyncReport` |
| `sincronizacion` | `sync` (as a noun field, e.g. `syncStatus`) | `get-overview.ts`, `server.ts` |
| `crearConvencionPolicy`, `crearPoliticaLibre/Estricta`, `crearComparadorIndice` | `createConventionPolicy`, `createLoosePolicy`/`createStrictPolicy`, `createIndexComparator` | `convencion.ts` |
| `leerCampo`, `inferirModulo`, `humanizarNombreArchivo` | `readField`, `inferModule`, `humanizeFileName` | `convencion.ts` |
| `groupByRuta` | `groupByPath` | `sync-index.ts` |

These are all pure rename-symbol candidates — no behavior change, no ambiguity, safe for IDE
tooling. Listed here so `sdd-tasks` does not have to re-derive them by re-reading every file.

### 1b. String literals that are simultaneously a config key, a SQL column, and/or a frontmatter key

This is the dangerous subset — a rename here is a **behavior** change, not just a label change:

| Literal | Roles | File(s) |
|---|---|---|
| `"tipo"` | TS field name, SQL column (`documents.tipo`), default `camposFrontmatter.tipo` value (frontmatter source key), CLI flag `--tipo`, MCP param `tipo` | `model.ts`, `sqlite-index-store.ts`, `config.ts` DEFAULT_CONFIG, `cli.ts`, `server.ts` |
| `"modulo"` | same triad | same files |
| `"estado"` | same triad, plus the deny-list config key `estadosExcluidos` reads it | same files |
| `"etiquetas"` | TS field, SQL column, **hardcoded** frontmatter source key (see 5, not configurable) | `frontmatter.ts` `resolveEtiquetas` |
| `"propietario"`, `"actualizado"` | TS field, SQL column, **hardcoded** frontmatter source key | `frontmatter.ts` `aplicarCamposOpcionales` |
| `"libre"` / `"estricto"` | `convencion.modo` value, branch discriminant in `crearConvencionPolicy`, also literal string in openspec scenarios | `convencion.ts`, `config.ts`, all 5 specs |
| `"hibrido"` / `"lexico"` | `SearchMode` value, CLI/MCP response `modo` field value, eval report keys (`EvalReport.hibrido`/`.lexico`) | `model.ts`, `search-documents.ts`, `evaluate-search.ts`, `cli.ts` printer |

Every one of these needs its **value**, not just its declaring identifier, changed consistently
across all roles simultaneously (TS field, DB column, config default, wire value), or the system
silently desyncs.

### 1c. SQL schema (`src/infrastructure/sqlite/sqlite-index-store.ts`)

- `SCHEMA_DDL`: `documents(ruta, titulo, resumen, tipo, modulo, estado, propietario, etiquetas, actualizado, hash)`, `chunks(document_id, encabezado, contenido, orden)`, `chunks_fts` FTS5 virtual table over `contenido, encabezado`.
- Every prepared statement referencing these columns by name: `insertDocument`, `insertChunk`, `insertFts`, `deleteFts` (the FTS5 `'delete'` command form, which must match column order/values exactly), `searchLexical`'s `d.tipo =`/`d.modulo =`/`d.estado IS NULL OR d.estado NOT IN` clauses, `buildFilterSql`, `listDocuments`'s `ORDER BY ruta`, `getChunksByDocument`'s `ORDER BY orden`.
- `DocumentRow`/`ChunkRow` TS interfaces mirror the column names 1:1 (`toDocument`/`toChunk` mapping functions).
- **Highest-blast-radius single file for the rename** — every column touches ~5 call sites within the file alone, plus every consumer of `IndexedDocument`/`IndexedChunk` outside it.

### 1d. MCP tool contract (`src/server.ts`)

- Tool names (`docs_overview`, `search_docs`, `read_doc`) are **already English** — not in scope.
- Zod schema keys: `search_docs`'s `{ query, tipo, modulo, etiquetas, k, incluir_no_vigentes }`; `read_doc`'s `{ ruta, seccion }`.
- Human-readable `title`/`description` strings on every `registerTool` call — currently full Spanish sentences. These need re-authoring, not word-swapping — they are prose, not identifiers.
- Response shape: `formatReadResult`'s discriminant switch on `result.tipo` (`"documento"`/`"seccion"`/`"ruta-no-encontrada"`/`"seccion-no-encontrada"`) and its Spanish output strings.
- `SearchQuery.incluirNoVigentes` (internal, camelCase) vs `incluir_no_vigentes` (wire param, snake_case per MCP convention) vs the target `include_excluded` — keep the snake_case convention on the renamed wire param.

### 1e. CLI (`src/cli.ts`)

- Flags: `--tipo`, `--modulo`, `--etiquetas`, `--todos`, `--lexico`, `--dir`. Command descriptions and all `console.log`/`console.warn`/`console.error` strings are full Spanish sentences.
- `parseTipo` (exported, unit-tested directly) is a pure passthrough — rename mechanical.
- Goldenset loader reads YAML keys `pregunta`/`esperado` **from `ejemplos/goldenset.yaml`, which is frozen** — local variable names can be renamed, but the two string literals `"pregunta"`/`"esperado"` used to index into the parsed YAML (`cli.ts:201-202`) **must stay Spanish**, because they read a frozen file's actual keys.

### 1f. User-facing runtime strings

Scattered across `cli.ts`, `server.ts`, `sqlite-index-store.ts`, `sync-index.ts`/`index-documents.ts`,
`file-document-source.ts`, `config.ts`. All need re-authoring as English prose, not mechanical
substitution — several are template strings interpolating renamed field names.

### 1g. Test fixtures (see section 4)

- `test/fixtures/estricto/` — directory name, `compendio.config.json`, doc filenames and frontmatter.
- `test/helpers/build.ts` — `EJEMPLOS_CONVENCION`, `ESTRICTO_FIXTURE_DOCS`, `ESTRICTO_FIXTURE_CONVENCION`, `TestHarness`, `buildHarness`.
- `test/helpers/fake-embeddings.ts` — class/param names are mechanical, **but `CONCEPT_STEMS`'s string values (`"duplicad"`, `"autenticacion"`, `"cuadro de mando"`, …) are Spanish word stems matched against the frozen corpus's Spanish prose. These must NOT be translated** — they are test data tuned to the corpus vocabulary, not identifiers.

## 2. Collision and Ordering Hazards

Each claimed collision was verified against the actual strings rather than accepted at face value —
one of the three originally assumed was wrong.

| Hazard | Verified? | Detail |
|---|---|---|
| `tipo` is a prefix of `tipos` | **Confirmed** | A naive `tipo`→`type` replace on `tipos` coincidentally produces `types` (correct) — luck, not a safe method. Do not rely on it. |
| `estado` is a prefix of `estadosExcluidos` and `estados` | **Confirmed** | Naive replace corrupts both: `estadosExcluidos`→`statusExcluidos` and `estados`→`statuss`. A find/replace tool will corrupt these unless it is whole-identifier-aware. |
| `modo` is a substring of `modulo` | **FALSE as originally assumed** | `modulo` = m-o-d-u-l-o; no window matches `modo` = m-o-d-o. The real risk is different: `modo` (search mode) and `modulo` (document module) are unrelated domain concepts whose Spanish names merely look alike. Post-rename, `mode` and `module` sit side by side — a human-attention risk during review, not a tooling risk. |
| `seccion` is a prefix of `secciones`/`seccionesDisponibles` | **New finding, confirmed** | Naive replace produces `sectionesDisponibles` and `sectiones`. Correct targets: `availableSections`, `sections`. |
| `orden` → `order`: **SQL reserved word** | **New, HIGH severity** | `ORDER` is reserved in SQLite's grammar. Current code does `ORDER BY orden` and `INSERT INTO chunks (..., orden)`. An unquoted `ORDER BY order` is invalid. **Do not name the physical SQL column `order`** — use `position`, `chunk_order`, or `sequence`. The TS domain field may still be `order`; the two need not be textually identical. Requires an explicit decision in `sdd-design`. |
| `contenido` → `content`: FTS5 external-content-table naming risk | **New, HIGH severity, unverified** | `chunks_fts` is `fts5(contenido, encabezado, content=chunks, content_rowid=id, …)`. Renaming produces a bare column literally named `content` in the same argument list as the `content=` option. SQLite's grammar distinguishes bare columns from `key=value` options by the `=`, so this is likely fine, but it was not confirmed empirically. **Gate this with an isolated unit test** (create schema, insert, `MATCH` query, exercise the FTS5 `'delete'` command form) before the rename lands, with a documented fallback physical column name (`body`). |
| `module` as a TS/JS identifier | **Checked, safe** | `package.json` has `"type": "module"` (ESM); no runtime `module` global to shadow, and `module` is only a keyword in the `declare module "…"` position. |
| `path` field vs `node:path` import | **Style note** | Files gaining `DocumentMeta.path` already use named imports (`import { join } from "node:path"`). No collision today; avoid `import * as path` in those files later. |
| `content`/`type` vs the MCP SDK response envelope | **Readability note** | The SDK returns `{ content: [{ type: "text", … }] }`. Different scope, no compile error, but `formatReadResult` will read `result.content` near a literal `content: [...]` wrapper. Worth a comment. |
| `warnIfLegacyEstadosExcluidos` | **Design recommendation** | This warns-and-ignores the retired `search.estadosExcluidos` key. Translating it to check an English key that never shipped is meaningless. **Delete it and its `config.test.ts` coverage.** |

## 3. Execution Order for a Behavior-Preserving Rename

The import graph was traced rather than assumed:

- `domain/model.ts` — zero internal imports. Root of everything.
- `domain/ports.ts` — imports only `model.ts` and `outline.ts`.
- `domain/{chunking,convencion,frontmatter,index-markdown}.ts` — import only other `domain/*`. No SQLite/transformers.js/fs anywhere in `src/domain/`. Clean.
- `infrastructure/*` — imports only `domain/*`. Never imports `application/*`. Clean boundary.
- `application/*` — imports only `domain/*` and typed ports; adapters injected via constructor. Clean.
- `composition.ts` — the only file importing both `application/*` and `infrastructure/*`.
- `server.ts`/`cli.ts` — leaf level.

The layering is **correct as a blast-radius ordering**, but it is **NOT a viable commit sequence**.
`DocumentMeta.ruta`, `Chunk.orden` and friends are consumed simultaneously by domain, infrastructure,
application and tests. Renaming a field on `model.ts` breaks every consumer's `tsc` compilation
instantly, and the no-compatibility-shims constraint rules out temporarily keeping both names. A
domain-field rename is inherently a whole-program change; it cannot be landed layer by layer with a
green build in between.

**Recommended sequencing — by symbol/concept group**, using project-wide type-checker-verified
rename-symbol so each group touches every consumer atomically, gated by `npm run typecheck` +
`npm test` after each group:

1. **Path-identifying fields**: `ruta`→`path`, `seccion`→`section`, `encabezado`→`heading`.
2. **Taxonomy fields**: `tipo`→`type`, `modulo`→`module`, `estado`→`status`, `etiquetas`→`tags`, plus plural/deny-list compounds (`tipos`→`types`, `estados`→`statuses`, `estadosExcluidos`→`excludedStatuses`) — grouped together *because* of the prefix-collision hazards in section 2.
3. **Content/structural fields**: `contenido`→`content` (after the FTS5 spike), `orden`→ its resolved SQL-safe name, `resumen`→`summary`, `titulo`→`title`.
4. **Report/response fields**: `omitidos`→`skipped`, `indexados`→`indexed`, `eliminados`→`deleted`, `avisoEmbeddings`→`embeddingsWarning`, eval fields.
5. **Config surface**: `convencion`→`convention`, `modo`→`mode`, `libre`/`estricto`→`loose`/`strict`, `camposFrontmatter`→`frontmatterFields`; plus deleting `warnIfLegacyEstadosExcluidos`.
6. **Public wire contract as one atomic slice**: MCP Zod keys + tool descriptions, CLI flags + help text, SQL DDL column names (must land with the `DocumentRow`/`ChunkRow` mappers).
7. **Specs and docs last** — `openspec/specs/*.md`, `README.md`, `CLAUDE.md`, `docs/`. Zero compile dependency; this is the one part of the original "layers last" framing that holds exactly.

## 4. What `test/fixtures/estricto/` Must Become

Not covered by the `ejemplos/` exception — full translation required:

- Directory: `test/fixtures/estricto/` → `test/fixtures/strict/`.
- `compendio.config.json`: `convencion`→`convention`, `modo: "estricto"`→`mode: "strict"`, `tipos`→`types`, `estados`/`estadosExcluidos`→`statuses`/`excludedStatuses`. Whether the taxonomy **values** (`"funcional"`, `"borrador"`, …) also become English is a separate call — see decision 4.
- The 5 fixture docs and their `INDEX.md` — filenames and frontmatter translated (synthetic fixtures, not the frozen corpus).
- `test/helpers/build.ts`: `ESTRICTO_FIXTURE_DOCS`/`ESTRICTO_FIXTURE_CONVENCION`→`STRICT_FIXTURE_DOCS`/`STRICT_FIXTURE_CONVENTION`.
- `test/helpers/fake-embeddings.ts`: identifiers translate; `CONCEPT_STEMS` values stay Spanish (1g), re-validated once the fixture prose decision is made.

## 5. The `ejemplos/` Boundary — the Highest-Value Question

The working assumption ("`ejemplos/docs/**` frontmatter uses Spanish keys throughout") **overstates
the problem**. Grepping every file in `ejemplos/docs/` for the six mappable keys: only **3 of 12
files** declare any frontmatter at all, and only two distinct keys appear.

| File | Frontmatter |
|---|---|
| `informes/plan-pruebas.md` | `estado: borrador` |
| `transversal/adr-0001-eleccion-mongodb.md` | `estado: obsoleto` |
| `leadsviewer/importacion-csv.md` | `etiquetas: [lead, importacion, csv, lote]` |

`tipo`, `modulo`, `propietario`, `actualizado` are never declared anywhere in `ejemplos/`. The other
9 files rely entirely on `libre` inference (H1 title, folder-derived module), a path with no
frontmatter-key dependency at all.

**What is actually at stake.** `docs_overview`/`INDEX.md` rendering (`formatDocLine`) shows a
`(estado)` segment only when `estado` is present, and `ejemplos/docs/INDEX.md` is checked in with
`(borrador)`/`(obsoleto)` rendered. If the default frontmatter source key changes `estado`→`status`
with no compensation, those two annotations silently vanish from a checked-in file. `etiquetas` does
not appear in `INDEX.md` at all, but it does back two live assertions in
`test/application/index-and-search.test.ts` (`primero.estado === "borrador"`; filter by
`etiquetas: ["csv"]`).

**Confirmed de-risking fact:** `EvaluateSearch.execute` calls `search.execute({ query, k, forzarLexico })`
with no metadata filters (`evaluate-search.ts:43-47`). Goldenset recall@k/MRR are driven purely by
content matching. **No option below can move the eval metrics.**

### Option A — Add a mapping config to `ejemplos/`

`ejemplos/compendio.config.json` with `{ "convention": { "frontmatterFields": { "status": "estado" } } }`.
Uses the existing, already-spec'd mapping mechanism. Keeps `INDEX.md` byte-identical.
**Cost:** adding any config file to `ejemplos/` invalidates the `CLAUDE.md` claim that *"`ejemplos/`
itself ships with none, to prove the zero-config path is real"* — the zero-config demonstration dies.
Also does not solve `etiquetas`, which is hardcoded in `resolveEtiquetas` and not routed through the
mapping at all.

### Option B — Accept the metadata loss

Leave `ejemplos/` untouched; accept that `estado`/`etiquetas` become unreadable, regenerate
`INDEX.md` (losing the two annotations), and rewrite 2-3 test assertions.
**Cost:** mutates the checked-in `INDEX.md`, weakens the demo corpus, and rewrites passing tests to
match a degradation.

### Option C — Translate only the three frontmatter KEYS (RECOMMENDED)

Change `estado:`→`status:` (2 files) and `etiquetas:`→`tags:` (1 file). **Three lines total.** Every
value stays Spanish (`borrador`, `obsoleto`, `[lead, importacion, csv, lote]`), every word of prose
stays Spanish, `goldenset.yaml` is untouched.

**Why this is safe, verified:** `RemarkMarkdownParser` calls `matter(raw)` and destructures
`{ data, content }` (`remark-markdown-parser.ts:26`) — chunking and embedding consume only `content`.
**Frontmatter keys never reach the index.** Changing a key therefore cannot affect retrieval, ranking,
or eval metrics by construction, not merely by measurement.

**What it preserves that A and B do not:**
- Zero-config promise intact — no config file added to `ejemplos/`; the `CLAUDE.md` invariant survives.
- `INDEX.md` renders byte-identically — the values feeding `formatDocLine` are unchanged.
- Zero test rewrites — assertions target values (`"borrador"`, `["csv"]`) and TS field names, not frontmatter keys.
- The multilingual proof is fully intact: 100% of retrievable Spanish content and all 22 goldenset questions untouched.
- Solves `etiquetas` too, which Option A cannot without new scope.

**The reframing that justifies it:** the purpose of freezing `ejemplos/` is preserving the Spanish
*retrieval corpus* and its evaluation baseline. Frontmatter keys are metadata plumbing that is
stripped before indexing — they are not retrievable content, so they fall outside what the freeze is
protecting. A Spanish team that prefers Spanish frontmatter keys is exactly the case
`frontmatterFields` exists to serve, and that mechanism remains available and documented.

## 6. Risks, Ranked

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | High | `contenido`→`content` FTS5 external-content-table column-name collision with the `content=` option — unverified | Isolated unit test (schema, insert, MATCH, FTS5 `'delete'` form) before the SQL rename group lands; fallback physical name `body` |
| 2 | High | `orden`→`order` is a SQLite reserved keyword; `ORDER BY order` is invalid unquoted | Pick a different physical column name (`position`/`chunk_order`); decide in `sdd-design`, not at implementation time |
| 3 | Medium | Naive find-replace corrupting compound identifiers (`estadosExcluidos`, `estados`, `secciones`, `seccionesDisponibles`) | Type-checker-verified rename-symbol per identifier; group singular+plural in one pass |
| 4 | Medium | The whole-program nature of domain-field renames (section 3) makes a partially-applied rename leave the build red | Sequence by symbol group, `typecheck` + `test` gate after each group; never split a group across commits |
| 5 | Medium | `modo`/`modulo` → `mode`/`module` semantic confusion during review | Flag for reviewer attention on the taxonomy group |
| 6 | Low | MCP tool descriptions and CLI help need re-authoring as English prose, not translation | Budget writing time in `sdd-tasks` |
| 7 | Low | `README.md:232` currently sells the Spanish contract as a differentiator; that pitch inverts | Content rewrite task, not part of the mechanical occurrence count |
| 8 | Low | `warnIfLegacyEstadosExcluidos` becomes dead weight if translated | Delete it and its coverage in the config group |

## 7. Confirmed Out of Scope

- `EvaluateSearch`/goldenset recall@k/MRR — unaffected by any option in section 5.
- `libre`/`estricto` inference logic (`humanizarNombreArchivo`, `inferirModulo`) — only identifiers change.
- Embeddings model, FTS5 tokenizer config, RRF fusion math — language-orthogonal, untouched.

## Decisions to Surface for `sdd-propose`

1. **`ejemplos/` frontmatter handling** — Option C recommended (translate 3 frontmatter keys only; preserves the zero-config demo, `INDEX.md`, and all tests). Options A and B documented above with their costs.
2. **`orden`'s physical SQL column name** — cannot be `order` unquoted. Lock a replacement in `sdd-design`.
3. **`contenido`→`content` FTS5 verification spike** — required before the SQL rename group is trusted.
4. **Taxonomy value translation scope for `test/fixtures/strict/`** — are declared values (`"funcional"`, `"borrador"`, …) translated, or only the keys?
5. **`warnIfLegacyEstadosExcluidos`** — delete rather than translate, per the no-shims policy.

## Ready for Proposal

Yes. Scope, blast radius and sequencing are understood. Decision 1 is resolved with a recommendation
(Option C) that no longer requires trading away the zero-config demonstration.
