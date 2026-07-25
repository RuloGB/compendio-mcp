# Tasks: English Contract — a survivable whole-program rename

Authority on sequencing and rationale: `design.md`. This checklist is executable top to bottom;
it cites design decisions (`Decision A`–`K`, invariants `I1`–`I6`) rather than restating them.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,200–4,000 (design counts ~1,640 identifier occurrences across 56 files; diff additions+deletions roughly double that for pure renames, plus non-mechanical content: commit 1's new test file, commit 9/11 re-authored prose, commit 10's fixture translation) |
| 400-line budget risk | High |
| Chained PRs recommended | No — `design.md` "Delivery" establishes no viable split: after commit 2 every intermediate PR boundary ships a red build (no compatibility shims, whole-program rename). User accepted `size:exception` in advance with this exact figure in view. |
| Suggested split | Single PR, 11 commits (§ Commit Sequence below is the review unit, per `work-unit-commits`) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1–11 | One commit per symbol group / concern, per `design.md` § "The executable sequence" | PR 1 (single, `size:exception`) | Each commit independently green (`typecheck` + `test`) and independently revertible; not chainable across PRs — see risk above |

**Calibration note**: the prior SDD change in this repo (`incremental-reindex`) under-forecast its diff size by 2x. The estimate above deliberately biases high and should not be treated as a ceiling — re-measure with `git diff --stat` after commit 9 (the largest single commit) and flag the orchestrator if the running total materially exceeds this range.

---

## Commit 1 — Safety net (S)

`test(sqlite): pin FTS5 external-content behavior and strict-fixture config effectiveness`

No renames in this commit. Runs against the still-Spanish tree.

- [x] 1.1 Create `test/infrastructure/fts5-external-content.test.ts`: in-memory `better-sqlite3`, no `sqlite-vec`/`SqliteIndexStore` import, implementing assertions A0–A7 from `design.md` Decision D against the target DDL (bare `content` column alongside `content=` option, insert, `MATCH`, column-scoped `MATCH`, the `'delete'` command form, `integrity-check`, no collateral damage).
- [x] 1.2 If any of A0–A7 fails: adopt the fully-specified `body` fallback (Decision D) — physical column `body`, FTS5 `fts5(body, heading, content=chunks, …)`, `Chunk.content` stays `content` (Decision J). Record which assertion failed and the fallback decision in this commit's message. **N/A — all A0–A7 passed, no fallback adopted.**
- [x] 1.3 Append the deny-list subprocess assertion to `test/**/cli-subprocess.test.ts` (Decision C): `search "<query matching plan-pruebas-alertas.md>"` without `--todos` must NOT return it; the same search with `--todos` MUST return it. Uses the existing `estricto` fixture, which already declares `estadosExcluidos: ["borrador", "obsoleto"]` and ships that file in `borrador`.
- [x] 1.4 Gate: `npm run typecheck` then `npm test`, green on `main`'s current behavior.
- [x] 1.5 Done when: A0–A7 settle the FTS5 physical column name as a fact (retires the Decision A "SQL `as`-cast" silent-trap risk before commit 4/8 touch it), and 1.3's deny-list assertion is now the active proof that a dropped fixture config key fails a test — this is the regression net commits 3, 6 and 10 must keep passing.

## Commit 2 — Path-identifying fields (M)

`refactor(domain): rename path-identifying fields to English`

- [x] 2.1 Rename, whole-program: `ruta`→`path`, `seccion`→`section`, `secciones`→`sections`, `seccionesDisponibles`→`availableSections`, `encabezado`→`heading`, `getDocumentByRuta`→`getDocumentByPath`, `groupByRuta`→`groupByPath`, `DocumentFile.ruta`, `ReadError.ruta`, `IndexWriteResult.ruta`, `ChunkMissingVector.{ruta,encabezado}`, `HeadingEvent` path fields. Full list: `design.md` Commit 2 table.
- [x] 2.2 **Silent-green trap (Decision A/G)**: in the same commit, edit `listChunksMissingVectors`'s SQL aliases in `sqlite-index-store.ts` — `d.ruta AS ruta`→`AS path`, `c.encabezado AS encabezado`→`AS heading`. `tsc` will not catch a stale alias.
- [x] 2.3 **Active proof of 2.2** (not implicit via a green suite): confirm/extend `sqlite-index-store.test.ts`'s `listChunksMissingVectors` coverage explicitly asserts defined, non-`undefined` `path`/`heading` values post-rename.
- [x] 2.4 Do NOT touch: `DocumentRow.ruta`, `ChunkRow.encabezado`, `ORDER BY ruta`, `documents.ruta` DDL, `read_doc` Zod keys, `--dir` (Decision G — row shapes track the DDL, not the domain, until commit 8).
- [x] 2.5 Gate: `npm run typecheck` then `npm test`.
- [x] 2.6 Done when: `rg -i -n 'ruta|seccion|encabezado' src test` returns only `sqlite-index-store.ts`'s SQL layer and Sweep A's allow-list.

## Commit 3 — Taxonomy fields and their compounds (L)

`refactor(domain): rename taxonomy fields and their compounds to English`

- [x] 3.1 Rename longest-first (Decision B — prevents `statuss`/`statusExcluidos` corruption): `estadosExcluidos`→`excludedStatuses`, `estados`→`statuses`, `estado`→`status`; `tipos`→`types`, `tipo`→`type`; `modulo`→`module`; `etiquetas`→`tags` (`resolveEtiquetas`→`resolveTags`, `EtiquetasResult`→`TagsResult`); `propietario`→`owner`; `actualizado`→`updated`; `porTipo`/`porModulo`→`byType`/`byModule`; `parseTipo`→`parseType`; `incluirNoVigentes`→`includeExcluded`. Full list: `design.md` Commit 3 table. Also fixed a commit-2 miss: `ReadResult`'s discriminant field name `tipo`→`type`.
- [x] 3.2 **Silent-green trap (Decision A/C)**: rename the same fields in `test/fixtures/estricto/compendio.config.json` (`tipos`/`estados`/`estadosExcluidos`), the inline JSON in `config.test.ts`, and `build.ts`'s `ESTRICTO_FIXTURE_CONVENCION` field names, in this commit.
- [x] 3.3 **Active proof of 3.2**: re-run commit 1's deny-list subprocess assertion (`cli-subprocess.test.ts`) and confirm it still passes with the renamed JSON keys — this is the proof the tolerant-`mergeConfig` whitelist did not silently swallow the rename.
- [x] 3.4 Do NOT touch yet: `frontmatterFields` **values** (still `"tipo"/"modulo"/"estado"` — commit 7); `data["etiquetas"]`/`["propietario"]`/`["actualizado"]` (commit 7); SQL columns; `--tipo` flag; Zod keys.
- [x] 3.5 Reviewer-attention flag (no tooling catches this — Decision B): `mode`/`module` lookalikes begin appearing from this commit on; call it out in the PR body.
- [x] 3.6 Gate: `npm run typecheck` then `npm test`.
- [x] 3.7 Done when: `rg -i -n 'tipo|modulo|estado|etiqueta|propietario|actualizado|vigentes' src test` returns only the SQL layer, the commit-7 source-key literals, and Sweep A's allow-list. (Also: commit-6-scheduled identifiers per design.md's own Commit 6 table, and one false-positive English "modulo" in `file-index-writer.ts:25` — see apply-progress.md.)

## Commit 4 — Content and structural fields (L)

`refactor(domain): rename content and structural fields to English`

- [ ] 4.1 Rename: `contenido`→`content`, `orden`→`position` (Decision 2 in `proposal.md` — `order` is a SQLite reserved word), `resumen`→`summary` (`condenseResumen`/`displayResumen`→`condenseSummary`/`displaySummary`), `titulo`→`title`, `texto`/`textos`→`text`/`texts`, `extracto`→`excerpt`, `Piece.texto`, `DocSection.{titulo,texto}`, `DocOutline.{titulo,resumen,secciones}`.
- [ ] 4.2 **Silent-green trap (Decision A/G), same pair as commit 2**: edit `listChunksMissingVectors`'s `c.contenido AS contenido`→`AS content` in the same commit.
- [ ] 4.3 **Active proof of 4.2**: confirm `sqlite-index-store.test.ts`'s `listChunksMissingVectors` assertions from 2.3 now also cover a defined, non-`undefined` `content` value.
- [ ] 4.4 Do NOT touch: `chunks.contenido`/`chunks.orden` DDL, `ORDER BY orden`, `insertChunk`/`insertFts`/`deleteFts`, `ChunkRow`, the inline cast in `deleteDocumentRows`.
- [ ] 4.5 Gate: `npm run typecheck` then `npm test`.
- [ ] 4.6 Done when: `rg -i -n 'contenido|orden|resumen|titulo|texto|extracto' src test` returns only the SQL layer and Sweep A's allow-list.

## Commit 5 — Report and response fields (M)

`refactor(app): rename report and response fields to English`

- [ ] 5.1 Rename: `omitidos`→`skipped`, `indexados`→`indexed`, `eliminados`→`deleted`, `avisoEmbeddings`→`embeddingsWarning`, `duracionMs`→`durationMs`, `resultados`→`results`, `SearchResponse.modo`/`IndexReport.modo`/`SyncReport.modo`→`mode`, `sincronizacion`→`sync`, `SincronizacionInfo`→`SyncInfo`, `toSincronizacionInfo`→`toSyncInfo`, `errores`→`errors`, `erroresLectura`→`readErrors`, `cambiado`→`changed`, `existente`→`existing`, `escrito`→`written`, `forzarLexico`→`forceLexical`.
- [ ] 5.2 Rename value literals: `SearchMode` `"hibrido"`/`"lexico"`→`"hybrid"`/`"lexical"` (incl. `EvalReport.hibrido`/`.lexico` keys); `ReadResult` discriminants `"documento"`/`"seccion"`/`"ruta-no-encontrada"`/`"seccion-no-encontrada"`→`"document"`/`"section"`/`"path-not-found"`/`"section-not-found"`.
- [ ] 5.3 Rename eval fields: `pregunta`→`question`, `esperado`→`expected`, `posicion`→`rank` (Decision K — deliberately not `position`, to avoid colliding with commit 4's `Chunk.position`), `fallos`→`failures`, `casos`→`cases`.
- [ ] 5.4 **Frozen boundary (do NOT rename)**: `cli.ts`'s `loadGoldenset` reads the literals `"pregunta"`/`"esperado"` from `ejemplos/goldenset.yaml` — these index into a frozen file's real keys and stay Spanish forever.
- [ ] 5.5 Add `// es-frozen: <reason>` markers to those two literals in `cli.ts` (Sweep A) — assigned to this commit specifically, not deferred.
- [ ] 5.6 Gate: `npm run typecheck` then `npm test`.
- [ ] 5.7 Done when: `rg -i -n 'omitid|indexad|eliminad|aviso|duracion|resultado|sincroniz|errores|cambiado|existente|escrito|forzar|hibrido|lexico|documento|pregunta|esperado|posicion|fallos|caso' src test` returns only marked or allow-listed lines.

## Commit 6 — Configuration surface (M)

`refactor(config): rename the configuration surface to English`

- [ ] 6.1 Rename: `CompendioConfig.convencion`→`convention`, `ConvencionConfig`/`ConvencionPolicy`→`ConventionConfig`/`ConventionPolicy`, `modo`→`mode`, `camposFrontmatter`→`frontmatterFields`, `sinChunking`→`noChunking`, `SIN_CHUNKING`→`NO_CHUNKING`, `isSinChunking`→`isNoChunking`, `crearConvencionPolicy`→`createConventionPolicy`, `crearPoliticaLibre`/`Estricta`→`createLoosePolicy`/`createStrictPolicy`, `crearComparadorIndice`→`createIndexComparator`, `leerCampo`→`readField`, `inferirModulo`→`inferModule`, `humanizarNombreArchivo`→`humanizeFileName`, `aplicarCamposOpcionales`→`applyOptionalFields`, `EJEMPLOS_CONVENCION`→`EXAMPLES_CONVENTION`, `EJEMPLOS_DOCS`→`EXAMPLES_DOCS`.
- [ ] 6.2 Rename value literals: `"libre"`/`"estricto"`→`"loose"`/`"strict"`.
- [ ] 6.3 `git mv src/domain/convencion.ts src/domain/convention.ts`; `git mv test/domain/convencion.test.ts test/domain/convention.test.ts` (history follows the file).
- [ ] 6.4 Delete `warnIfLegacyEstadosExcluidos` and its `config.test.ts` coverage (proposal.md decision 5 — dead code guarding a state that can no longer exist under no-shims).
- [ ] 6.5 **Silent-green trap (Decision A/C), same class as commit 3**: rename `convencion`→`convention`, `modo`→`mode`, `"estricto"`→`"strict"` in `test/fixtures/estricto/compendio.config.json` and every inline JSON in `config.test.ts`, in this commit.
- [ ] 6.6 **Active proof of 6.5**: re-run commit 1's deny-list subprocess assertion and confirm it still passes with `convention`/`mode`/`"strict"` renamed.
- [ ] 6.7 Frozen values, mark in this commit: `NO_CHUNKING = ["glosario.md"]` (value unchanged — corpus filename); `EXAMPLES_DOCS`'s path literal `"../../ejemplos/docs"` (unchanged). Add `// es-frozen: <reason>` markers to both (invariant I6 depends on this value never moving).
- [ ] 6.8 Gate: `npm run typecheck` then `npm test`.
- [ ] 6.9 Done when: `rg -i -n 'convencion|politica|comparador|leercampo|inferir|humanizar|aplicarcampos|camposfrontmatter|modo|libre|estricto|sinchunking|sin_chunking|ejemplos|glosario|indice' src test` returns only marked or allow-listed lines.

## Commit 7 — Frontmatter source keys, with the corpus (S, high scrutiny)

`refactor(frontmatter): read English frontmatter keys by default`

- [ ] 7.1 Change `frontmatterFields` default **values** to `"type"/"module"/"status"`; `frontmatter.ts` hardcoded reads `data["etiquetas"]`→`data["tags"]`, `data["propietario"]`→`data["owner"]`, `data["actualizado"]`→`data["updated"]`; re-author the `'etiquetas' debe ser una lista de cadenas` error string in English.
- [ ] 7.2 **Corpus — exactly 3 lines, nothing else** (proposal.md binding decision 1): `ejemplos/docs/informes/plan-pruebas.md` `estado:`→`status:`; `ejemplos/docs/transversal/adr-0001-eleccion-mongodb.md` `estado:`→`status:`; `ejemplos/docs/leadsviewer/importacion-csv.md` `etiquetas:`→`tags:`. Do NOT add `compendio.config.json` to `ejemplos/`.
- [ ] 7.3 Update `test/fixtures/estricto/docs/*.md` frontmatter **keys** only (values are commit 10); `build.ts`'s `frontmatterFields` literals; every inline frontmatter fixture in `index-and-search.test.ts`, `generate-index-md.test.ts`, `markdown-parser.test.ts`, `frontmatter.test.ts`, `convention.test.ts`, `sync-index.test.ts`.
- [ ] 7.4 Gate: `npm run typecheck` then `npm test`.
- [ ] 7.5 Gate (Decision I — the sharpest, most localized canary in this change): `npm run dev -- --root ejemplos index-md` then `git diff --exit-code -- ejemplos/docs/INDEX.md`. At this commit the header constants are still Spanish, so the **whole file** must be byte-identical — any diff means this commit broke frontmatter value resolution (see Decision F's flow diagram).
- [ ] 7.6 Gate: `git diff --stat -- ejemplos/` shows exactly 3 changed lines across 3 files, nothing else.
- [ ] 7.7 Done when: `(borrador)` and `(obsoleto)` still render, `etiquetas: ["csv"]`-style filtering still passes, and `ejemplos/docs/INDEX.md` is byte-identical.

## Commit 8 — SQL schema (L)

`refactor(sqlite): rename schema columns to English`

- [ ] 8.1 Rewrite DDL: `documents(path, title, summary, type, module, status, owner, tags, updated, hash)`; `chunks(document_id, heading, content, position)`; `chunks_fts(content, heading, content=chunks, content_rowid=id, tokenize=…)` — or the `body` variant if commit 1 triggered the fallback.
- [ ] 8.2 Rename statement column references: `insertDocument` named params, `insertChunk`, `insertFts`, `deleteFts` (`'delete'` command form, column order matching the DDL), `buildFilterSql` (`d.type`/`d.module`/`d.status IS NULL OR d.status NOT IN`/`json_each(d.tags)`), `listDocuments`'s `ORDER BY path`, `getChunksByDocument`'s `ORDER BY position`, `getDocumentByPath`.
- [ ] 8.3 Rename `DocumentRow`/`ChunkRow`; `toDocument`/`toChunk` become symmetric again (Decision G — except under the `body` fallback); the inline cast in `deleteDocumentRows`; `listChunksMissingVectors`'s `AS` aliases become identities (the commit-2/4 trap is now closed by construction).
- [ ] 8.4 Anti-drift (Decision D): export `SCHEMA_DDL` from `sqlite-index-store.ts`; switch `fts5-external-content.test.ts` to execute the production constant instead of its commit-1 inline copy.
- [ ] 8.5 Verify frozen and unchanged: `tokenize='unicode61 remove_diacritics 2'` byte-identical (invariant I2); `position` column name, never `order` (SQLite reserved word).
- [ ] 8.6 Gate: `npm run typecheck` then `npm test` then `npm run build`.
- [ ] 8.7 Done when: `rg -i -n '<ROOTS>' src/infrastructure/sqlite/` is empty (see § Final Verification for the root list).

## Commit 9 — MCP and CLI surface (L, review this one first)

`refactor(contract): move the MCP and CLI surface to English`

- [ ] 9.1 `search_docs` Zod keys → `{ query, type, module, tags, k, include_excluded }`; `read_doc` → `{ path, section }`; snake_case preserved on wire params; tool names unchanged (already English).
- [ ] 9.2 Re-author (not word-swap) all three `registerTool` `title`/`description` strings as English prose; `formatReadResult` output strings.
- [ ] 9.3 Rename CLI flags: `--tipo`→`--type`, `--modulo`→`--module`, `--etiquetas`→`--tags`, `--todos`→`--all`, `--lexico`→`--lexical`; `--dir` unchanged. Re-author command descriptions and every `console.log`/`warn`/`error` string in English.
- [ ] 9.4 Rename constants and re-author their **values** in English: `TITULO_INDICE`→`INDEX_TITLE`, `AVISO_GENERADO`→`GENERATED_NOTICE`.
- [ ] 9.5 Re-author remaining runtime strings in `sqlite-index-store.ts`, `file-document-source.ts`, `config.ts`, `sync-index.ts`, `index-documents.ts`.
- [ ] 9.6 Regenerate and commit `docs/INDEX.md` **and** `ejemplos/docs/INDEX.md` (Decision I, second half of the split canary): header/notice lines legitimately change; **every entry line must stay byte-identical** to commit 7's output.
- [ ] 9.7 Update tests: `cli-subprocess.test.ts` (`--lexico`→`--lexical`, the `/Indexados 5 documentos \(\d+ chunks\)/` regex and its English replacement, `payload.modo`/`resultados`/`ruta` field reads), `server.test.ts`.
- [ ] 9.8 Gate: `npm run typecheck` then `npm test` then `npm run build`; `node dist/cli.js --help` contains no Spanish.
- [ ] 9.9 Note for PR body (design.md § Delivery): this is the only externally-visible contract change — flag it as the first commit for reviewers to read.

## Commit 10 — Strict fixture translation (M)

`test(fixtures): translate the strict fixture to English`

- [ ] 10.1 `git mv test/fixtures/estricto test/fixtures/strict` (the `.compendio/` directory inside it is gitignored build residue — do not commit it).
- [ ] 10.2 Translate taxonomy values (proposal.md decision 4): `"funcional"`→`"functional"`, `"guia"`→`"guide"`, `"borrador"`→`"draft"`, `"vigente"`→`"current"`, `"obsoleto"`→`"deprecated"`; `"adr"`/`"api"`/`"qa"` already language-neutral.
- [ ] 10.3 Translate the 5 fixture docs (filenames, frontmatter values, prose), `test/fixtures/strict/docs/INDEX.md`, `test/fixtures/strict/compendio.config.json` value arrays, `build.ts`'s `STRICT_FIXTURE_DOCS`/`STRICT_FIXTURE_CONVENTION`.
- [ ] 10.4 Translate the coupled test strings — do not miss these: `index-and-search.test.ts`'s Spanish queries (`"decisión arquitectura"`, `"alertas de inventario plan de pruebas"`) and `cli-subprocess.test.ts`'s `"onboarding de un servicio"` + `guia-onboarding.md` expectation, both targeting this fixture.
- [ ] 10.5 **Silent-green trap (Decision A/C), same class as commits 3 and 6, closing case**: this commit is the third and last to touch `test/fixtures/*/compendio.config.json`.
- [ ] 10.6 **Active proof of 10.5**: re-run commit 1's deny-list subprocess assertion (now fully translated) and confirm it still passes.
- [ ] 10.7 Run Decision H's `CONCEPT_STEMS` re-validation procedure: (a) after 10.1–10.6, run `npm test`; (b) if every strict-fixture assertion passes, do NOT touch `CONCEPT_STEMS` — record "no stem change required" in the commit message and stop; (c) if a strict-fixture assertion fails, **append** one new group of English stems derived from the translated fixture vocabulary — never edit/reorder/remove groups 0–8; (d) re-run the full suite and confirm the `ejemplos/`-backed suites (`evaluate.test.ts`, `index-and-search.test.ts`'s `ejemplos/` describes, `read-document.test.ts`) are untouched-green.
- [ ] 10.8 Add `// es-frozen: <reason>` markers to `CONCEPT_STEMS` and to any surviving Spanish `ejemplos/`-corpus query string in the test suite.
- [ ] 10.9 Gate: `npm run typecheck` then `npm test`; the `ejemplos/`-backed suites must be untouched-green (no assertion edited, no expectation loosened).
- [ ] 10.10 Done when: Sweep A (§ Final Verification) returns only marked or allow-listed lines — this closes the allow-list for good.

## Commit 11 — Specs and documentation (M)

`docs: retire the Spanish contract from specs and documentation`

- [ ] 11.1 Rewrite `README.md`'s pitch (currently sells the Spanish MCP contract as a differentiator, `README.md:232`). This is a content rewrite, not a word-swap: the new pitch is that the contract is English while `ejemplos/` proves Spanish documentation indexes and retrieves identically.
- [ ] 11.2 Rewrite `CLAUDE.md`'s "Working conventions" section — it currently states prose is English while identifiers/MCP contract/config keys/`ejemplos/` stay Spanish; that statement inverts: identifiers, the MCP contract, config keys, and frontmatter keys are now English, only `ejemplos/` and `goldenset.yaml` remain Spanish (mirror the language contract already recorded in `openspec/config.yaml`).
- [ ] 11.3 `git mv docs/convencion-documentacion.md docs/documentation-convention.md`, re-authored in English.
- [ ] 11.4 Update all five `openspec/specs/{mcp-contract,configuration,indexing,search,index-md}/spec.md` — vocabulary only, zero requirement change.
- [ ] 11.5 If any `docs/` filename changed, regenerate `docs/INDEX.md` again in this commit.
- [ ] 11.6 Gate: Sweep A and Sweep B both clean (§ Final Verification) — this is the completion criterion for the whole change.
- [ ] 11.7 Gate: `openspec/config.yaml`'s archive rule — `openspec/specs/` carries no residual Spanish contract vocabulary except where it quotes the `ejemplos/` corpus.

---

## Final Verification

- [ ] 12.1 **Sweep A (code)**: `rg -i -n --glob '!**/*.md' '<ROOTS>' src test` where `<ROOTS>` is the exact root list below (Decision B — case-insensitive, substring, no `-w`; do not simplify).
  ```
  actualizado|aplicarcampos|aviso|cambiado|camposfrontmatter|caso|comparador|contenido|convencion|
  documento|duracion|ejemplos|eliminad|encabezado|errores|escrito|esperado|estado|estricto|etiqueta|
  existente|extracto|fallos|forzar|glosario|hibrido|humanizar|indexad|indice|inferir|leercampo|lexico|
  libre|modo|modulo|omitid|orden|politica|posicion|pregunta|propietario|resumen|resultado|ruta|seccion|
  sincroniz|sin_chunking|sinchunking|texto|tipo|titulo|vigentes
  ```
  Acceptance: `rg -i -n --glob '!**/*.md' '<ROOTS>' src test | rg -v 'es-frozen'` returns only the enumerated corpus-filename allow-list rows in `design.md` § Sweep A (5 `"glosario.md"` references, `cli.ts`'s `pregunta`/`esperado`, `build.ts`'s `ejemplos`). Any other hit is a rename miss — fix it, do not add a marker to excuse it.
- [ ] 12.2 **Sweep B (contract prose)**: `rg -i -n --glob '!openspec/changes/**' '<ROOTS>' openspec/specs docs README.md CLAUDE.md`, same root list, same zero-unmarked-hit rule.
- [ ] 12.3 Verify invariant I1: `RemarkMarkdownParser.parse` still destructures `{ data, content }` from `matter(raw)` — `git diff main..HEAD -- src/infrastructure/markdown/remark-markdown-parser.ts` shows identifier changes only.
- [ ] 12.4 Verify invariant I2: `rg -F "unicode61 remove_diacritics 2" src` returns exactly one line (`sqlite-index-store.ts`).
- [ ] 12.5 Verify invariant I3: `EvaluateSearch.execute` passes only `{ query, k, forceLexical }` — `git diff` on `evaluate-search.ts` shows identifier changes only.
- [ ] 12.6 Verify invariant I4: `fusion.ts`'s `RRF_K = 60` and the fusion function are unchanged.
- [ ] 12.7 Verify invariant I5 (the composed embed input — the part that actually moves the numbers): `index-documents.ts` chunk/passage template, `sync-index.ts`'s equivalents, `search-documents.ts`'s `query:` prefix — byte-identical composition, no dropped space, no swapped `heading`/`content` order.
- [ ] 12.8 Verify invariant I6: chunking thresholds (`minTokens: 100, maxTokens: 800`), the `NO_CHUNKING` exemption value `["glosario.md"]`, and `index-pipeline.ts`'s `isNoChunking` decision logic — identifier changes only, no value or logic change.
- [ ] 12.9 Run `npm run build`; confirm it succeeds.
- [ ] 12.10 Reproduce the eval baseline with the exact commands that captured it: `rm -rf ejemplos/.compendio && npm run dev -- --root ejemplos index && npm run dev -- --root ejemplos eval`.
- [ ] 12.11 Check gates in order (fail-fastest): V0 index run reports **hybrid** mode (otherwise the run is invalid, re-run); V1 `11 documentos (27 chunks)`; V2 hybrid row recall@5 `1.00`, MRR `0.943`, failures `0`; V3 lexical row recall@5 `0.95`, MRR `0.857`, failures `1`; V4 the single lexical failure is the same case at the same position (`"¿Qué endpoint hay que llamar para crear un lead?"` → `leadsviewer/alta-leads.md`, position 9). Only report-line wording is exempt from byte-identity.
- [ ] 12.12 If any of V1–V4 deviates: diagnose via the attribution ladder in `design.md` § "Final verification and the attribution ladder" (counts moved → I6/skip list; only INDEX.md entries differ → commit 7; only lexical moved → I2/FTS5; only hybrid moved → I5/embed composition; both moved → I6/chunking; a specific case regressed with everything else clean → I4/ranking code). **A deviation is diagnosed and the responsible commit corrected — never re-baselined, never accepted as "close enough".**
- [ ] 12.13 Confirm hexagonal integrity (Decision J): `rg -i -n 'from "(node:|better-sqlite3|sqlite-vec|@xenova|gray-matter|remark)' src/domain/` returns nothing; `src/domain/ports.ts` still the only seam, no port added/removed/moved.
