# Tasks: Configurable documentation convention (zero-config + optional strict)

Change: `configurable-convention` · Reads: `proposal.md`, `design.md`, `specs/{configuration,indexing,search,mcp-contract,index-md}/spec.md`, `state.yaml`

## Task-breakdown decisions (made in this phase)

- **Slice B ships as a single `size:exception` PR.** Per `design.md`'s Open Questions, making `tipo`/`modulo`/`estado` optional breaks ~9 files at compile time simultaneously; it cannot be split further without a transient red build. Phase B below is one atomic, sequential unit even though it will likely exceed the 400-changed-line review budget. Recommend `review-risk` + `review-reliability` (not the full 4R) on this PR given it's a type-ripple, not new business logic.
- **Slice D splits into D1 (fixtures/corpus) and D2 (docs)** as two independently reviewable PRs, to keep the overall PR budget balanced against the B exception.
- **Reconciliation resolution (Phase 0, recorded below)**: on detailed comparison, `spec.md` and `design.md` do **not** actually diverge on the two flagged points (humanized-filename algorithm, INDEX.md ordering comparator) — both are consistent. `state.yaml`'s reconciliation note predates the spec/design confirmation round; the flag is resolved as "confirmed consistent," not "one side picked over the other." See Phase 0 for the side-by-side.

---

## Phase 0 — Reconciliation (spec ↔ design)

- [x] **0.1** Record the spec↔design reconciliation for the two flagged inference details in `design.md` (append a short "Reconciled with spec" note under Open Questions) so the divergence flag in `state.yaml` is closed with an explicit resolution, not silently dropped.
  - **Humanized filename**: `specs/indexing/spec.md` scenario "Humanized filename, concrete example" (`docs/mi-guia_de-uso.md` → `"Mi guia de uso"`) and `design.md`'s `humanizarNombreArchivo` definition ("basename minus `.md`, `-`/`_`→space, collapse+trim, sentence-case first char") describe the **same algorithm**. Resolution: implement exactly as design's helper signature, verified against spec's worked example as the canonical test case (see task A2).
  - **INDEX.md ordering comparator**: `specs/index-md/spec.md` ("declared-taxonomy ordering... falling back to alphabetical order by `ruta` within each `tipo` group") and `state.yaml`'s `confirmed_assumptions` ("estricto INDEX.md intra-tipo tie-break → alphabetical by ruta") agree; `design.md`'s Architecture Decisions row ("estricto with declared `tipos` supplies a taxonomy-order comparator") is consistent but less detailed — it doesn't restate the tie-break explicitly. Resolution: `crearComparadorIndice` MUST implement declared-order-then-alphabetical-by-ruta-tie-break, per spec + confirmed_assumptions (design's higher-level description is not contradicted, just less precise; spec's wording governs the exact tie-break behavior).
  - Done when: `design.md` has the reconciliation note appended, and both algorithms are referenced identically (by both spec scenario and design signature) in tasks A1/A2/B4/B5 below.

---

## Phase A — Domain convention policy + config surface (Slice A, additive/green)

Depends on: Phase 0. Can start immediately; nothing here is called by existing code yet (additive-only, existing `validateFrontmatter` path stays live until Phase B switches callers over).

- [x] **A1** Create `src/domain/convencion.ts`: `ConvencionConfig`, `ConvencionPolicy` interface, `crearConvencionPolicy(cfg)` factory producing `PoliticaLibre`/`PoliticaEstricta` resolvers, `crearComparadorIndice(cfg)` factory, and pure inference helpers `inferirModulo(ruta, docsDir)` and `humanizarNombreArchivo(ruta)` — per `design.md`'s Interfaces/Contracts block. No imports from `infrastructure/`, `better-sqlite3`, `transformers.js`, or `node:fs` (pure domain). `PoliticaLibre`/`PoliticaEstricta` reuse the shape-only helpers retained on `frontmatter.ts` (etiquetas normalization, date normalization — see B2) rather than duplicating them.
  - Spec: `configuration/spec.md` ("convencion.modo Toggle", "camposFrontmatter Field Mapping" incl. per-key merge and shared-source-key scenarios); `indexing/spec.md` ("libre Mode Never Skips Files for Metadata Reasons", "estricto Mode Validates Declared Taxonomies Per Field, Independently", "estricto Without a Declared Taxonomy Falls Back to Presence-Only Validation, Per Field", "estricto Requires an H1 Title, With No Filename Fallback", "Field Inference in libre Mode" incl. empty-string/null-as-absent).
  - Done when: file compiles standalone; exported symbols match `design.md`'s `src/domain/convencion.ts` contract block exactly.

- [x] **A2** Create `test/domain/convencion.test.ts` (pure, no IO), covering:
  - libre: H1 present → titulo from H1; no H1 → `humanizarNombreArchivo` fallback (assert the exact `docs/mi-guia_de-uso.md` → `"Mi guia de uso"` case from spec, per Phase 0 reconciliation); `modulo` from first path segment under `docsDir`; root-level file → `modulo` absent; frontmatter/mapping wins over inference; empty-string/`null` frontmatter for `tipo`/`modulo`/`estado` treated as absent (tipo/estado stay absent, modulo falls through to folder inference); `tipo`/`estado` never invented when no signal.
  - estricto: declared-taxonomy rejection (value outside `convencion.tipos`); mixed declaration (one taxonomy declared, the other not) validates each field independently; no-declared-taxonomy presence-only fallback per field (accept any non-empty, reject missing/empty); `modulo` always presence-only regardless of `tipo`/`estado` declarations; no H1 → `omitidos`, filename humanization does NOT apply under estricto.
  - `camposFrontmatter`: custom mapping resolves value; partial mapping merges per-key against identity defaults (declaring only `tipo` leaves `modulo`/`estado` at `"modulo"`/`"estado"`); two fields mapped to the same source key both resolve to that key's value, no collision error.
  - `crearComparadorIndice`: default alphabetical-by-`ruta`; estricto with declared `tipos` → declared-order-then-alphabetical-by-`ruta`-tie-break (per Phase 0 resolution); estricto with no declared `tipos` → falls back to alphabetical-by-`ruta`.
  - Done when: `npx vitest run test/domain/convencion.test.ts` passes.

- [~] **A3** (PARTIAL — see apply-progress.md "A3 deviation") Modify `src/infrastructure/config.ts`: add `convencion: ConvencionConfig` to `CompendioConfig` (import the type from `../domain/convencion.js`); `DEFAULT_CONFIG.convencion = { modo: "libre", estadosExcluidos: [], camposFrontmatter: { tipo: "tipo", modulo: "modulo", estado: "estado" } }` (no `tipos`/`estados` by default); ~~remove `search.estadosExcluidos` and the `Estado`/`Tipo` import from `model.ts`~~ **DEFERRED to B20**: `new SearchDocuments(store, embeddings, config.search)` in `composition.ts` requires `config.search` to structurally satisfy `SearchDefaults = { k; estadosExcluidos }`; deleting the field now red-builds `composition.ts` ahead of B20's atomic reassembly from `config.convencion.estadosExcluidos`, which is out of this batch's scope by explicit user instruction. `search.estadosExcluidos` and the `Estado` import in `config.ts` are kept, unchanged, as an interim state. `mergeConfig` needs a **two-level merge** for `convencion`: `modo`/`tipos`/`estados`/`estadosExcluidos` follow the existing whole-value-replace pattern (`override.x ?? base.x`, same as `exclude`), but `camposFrontmatter` merges **per key** (`{ ...base.convencion.camposFrontmatter, ...override.convencion?.camposFrontmatter }`) — declaring `convencion` wholesale must not wipe sibling defaults, and declaring `camposFrontmatter` partially must not wipe its sibling keys. Detect a legacy top-level `search.estadosExcluidos` key in the raw parsed JSON and print one `console.error`/stderr line naming `convencion.estadosExcluidos` (warning implemented; the "value is never read into the returned config" half is deferred with the removal above — the raw value is still structurally present in `config.search.estadosExcluidos`, unread by the new `convencion` surface, but not yet excised from the type).
  - Spec: `configuration/spec.md` ("Optional convencion Configuration Block" incl. "No config file at all" / "docsDir-only config" / "Partial convencion block merges with defaults" scenarios; "estadosExcluidos Lives Under convencion" incl. both legacy-key scenarios).
  - Done when: `loadConfig` on an empty/missing config file returns the documented defaults ✅; a config with only `{ "convencion": { "modo": "estricto" } }` leaves `estadosExcluidos`/`camposFrontmatter` at defaults ✅; a config with only `{ "convencion": { "camposFrontmatter": { "tipo": "type" } } }` leaves `camposFrontmatter.modulo`/`.estado` at identity ✅; a config with `search.estadosExcluidos` present emits the stderr notice ✅ **and the returned config has no such value anywhere ❌ DEFERRED to B20** (see apply-progress.md).

- [x] **A4** Create `test/infrastructure/config.test.ts` (no existing config test file today) covering every scenario in A3's done-condition, one test per Configuration-spec scenario. (Covers the achieved subset of A3's done-when; the deferred "no such value anywhere" assertion is not testable until B20 — see apply-progress.md.)
  - Done when: `npx vitest run test/infrastructure/config.test.ts` passes.

_A1/A2 and A3/A4 can run in parallel with each other **except** that A3 needs `ConvencionConfig`'s type shape from A1 to import — land A1 first, then A2 and A3 in parallel, then A4._

---

## Phase B — Atomic TS ripple (Slice B, single `size:exception` PR, sequential)

Depends on: Phase A complete (needs `crearConvencionPolicy`/`crearComparadorIndice`/`ConvencionConfig` and `config.ts`'s `convencion` defaults). **Do not attempt to land these as separate PRs** — intermediate states will not compile (`design.md` Open Questions: "cannot split further without transient red"). Internal ordering below is for review/authoring clarity within the one changeset.

- [x] **B1** Modify `src/domain/model.ts`: `DocumentMeta.tipo?/modulo?/estado?: string` (optional open strings, not closed unions); delete `Tipo`, `Estado`, `TIPOS`, `ESTADOS`; `SearchFilters.estados?` removed and replaced by `SearchFilters.tipo?: string` + `SearchFilters.estadosExcluidos?: string[]`; `SearchResultItem.estado?: string` becomes optional.
  - Spec: `search/spec.md` ("Open tipo Filtering"); `indexing/spec.md` ("Optional Persisted Metadata").
  - Done when: no closed unions for tipo/estado remain in `model.ts`; file compiles standalone (consumers will be red until B9-B20 land, expected within this one PR).

- [x] **B2** Modify `src/domain/frontmatter.ts`: keep `FrontmatterInput`/`FrontmatterResult` types and the reusable shape-only helpers currently inlined in `validateFrontmatter` — `isNonEmptyString`, etiquetas normalization/rejection, `actualizado` date normalization (`Date` → `YYYY-MM-DD` / trimmed string), `propietario` pass-through — exported so `convencion.ts`'s two policies can call them instead of duplicating logic. Delete the free `validateFrontmatter` function and its `TIPOS`/`ESTADOS`/`Tipo`/`Estado` import.
  - Done when: `frontmatter.ts` exports no closed-list logic; `PoliticaLibre`/`PoliticaEstricta` in `convencion.ts` (from A1) are updated to call these retained helpers instead of any duplicated inline logic.

- [x] **B3** Rewrite `test/domain/frontmatter.test.ts`: remove every assertion against the deleted `validateFrontmatter` (closed-list rejection, missing-tipo/modulo/estado rejection, no-H1 rejection — those scenarios are now covered by `convencion.test.ts`'s estricto cases from A2). Keep/move tests for the retained pure helpers only (etiquetas list validation and normalization, `actualizado` date normalization, `propietario` trimming) exercised directly against their exported names from B2.
  - Done when: file contains no reference to `validateFrontmatter`/`TIPOS`/`ESTADOS`; `npx vitest run test/domain/frontmatter.test.ts` passes.

- [x] **B4** Modify `src/domain/index-markdown.ts`: `renderIndexMd(entries, comparar?)` accepts an injectable comparator (default = alphabetical by `ruta`, per Phase 0); `formatDocLine` omits the `[tipo]` bracket segment when `tipo` is absent and the `(estado)` parenthesized segment when `estado` is absent — no `[undefined]`/empty-bracket rendering; retire the `TIPOS.indexOf` root-first-tier ordering entirely (no compatibility path).
  - Spec: `index-md/spec.md` ("Default Alphabetical Ordering in libre Mode", "Declared-Taxonomy Ordering in estricto Mode", "Per-Document Line Omits Absent tipo/estado Segments", "No Compatibility Ordering Path").
  - Done when: calling `renderIndexMd` with no comparator sorts alphabetically by `ruta`; passing the estricto comparator from `crearComparadorIndice` (A1) sorts declared-tipos-order-then-alphabetical-tie-break; line rendering never emits `undefined`/empty brackets.

- [x] **B5** Rewrite `test/domain/index-markdown.test.ts`: replace `TIPOS`-order sort assertions with default-alphabetical-by-`ruta` and estricto declared-taxonomy-order-with-tie-break scenarios; add omitted-`[tipo]`/`(estado)`-segment rendering scenarios (neither present, tipo-only, estado-only).
  - Done when: `npx vitest run test/domain/index-markdown.test.ts` passes.

- [x] **B6** Modify `src/domain/ports.ts`: `DocumentSource.discover()` return type gains `erroresLectura: { ruta: string; error: string }[]` alongside the existing successfully-read files, so a single unreadable file no longer has to abort the whole walk via a thrown exception.
  - Done when: type compiles; `file-document-source.ts` (B7) and both use cases (B9/B10) are updated to the new shape within this same PR.

- [x] **B7** Modify `src/infrastructure/fs/file-document-source.ts`: wrap the per-entry `readFile` inside `walk` in a per-file `try/catch`; a read failure is pushed to `erroresLectura` instead of thrown, so `discover()` keeps walking the rest of the tree.
  - Done when: a corpus containing one unreadable file still returns every other readable file from `discover()`, plus one `erroresLectura` entry for the failed one.

- [x] **B8** Create `test/infrastructure/file-document-source.test.ts` (no existing test file for this adapter today): normal discovery unaffected by the change; one unreadable file (e.g. permission-denied or a path that errors on read) is collected into `erroresLectura` and does not stop discovery of the rest.
  - Done when: `npx vitest run test/infrastructure/file-document-source.test.ts` passes.

- [x] **B9** Modify `src/application/index-documents.ts`: constructor takes an injected `ConvencionPolicy` (stop importing `validateFrontmatter`); call `policy.resolver(...)` per file; wrap `parser.parse()` in a per-file `try/catch` — a parse failure is pushed to `omitidos` with its error message instead of throwing and aborting the run; fold `source.discover()`'s `erroresLectura` (B6/B7) into `omitidos` the same way; a file that parses successfully but yields zero indexable chunks after chunking is reported in `omitidos` with "el documento no tiene contenido indexable".
  - Spec: `indexing/spec.md` ("Resilience Skip Reasons Apply in Both Modes" — all three scenarios: unreadable, malformed-frontmatter-parse-failure, no-indexable-content — identical under `libre` and `estricto`; "libre Mode Never Skips Files for Metadata Reasons").
  - Done when: an unreadable file, a malformed-frontmatter file, and an empty-body file are each reported in `omitidos` with a message, under both `libre` and `estricto` configs, and indexing continues with the remaining files in every case.

- [x] **B10** Modify `src/application/generate-index-md.ts`: constructor takes injected `ConvencionPolicy` + comparator; call `policy.resolver(...)`; pass the comparator into `renderIndexMd` (B4); apply the identical per-file `try/catch` around `parser.parse()` and the identical `erroresLectura` folding as `index-documents.ts` (B9), so `index-md` has the same skip-and-report behavior.
  - Spec: `index-md/spec.md` ("Skip-and-Report Resilience Matches Indexing" — both estricto scenarios).
  - Done when: same resilience guarantees as B9, verified for `compendio index-md` specifically.

- [x] **B11** Rewrite `test/application/index-and-search.test.ts` and `test/application/generate-index-md.test.ts` (indexing halves): replace assertions hardcoded to the old tipo-based `ejemplos/` corpus (exact per-tipo counts) with optional-field scenarios (libre: no-frontmatter file indexed with absent fields; estricto: declared-taxonomy reject/accept) plus the new resilience scenarios (unreadable file, malformed frontmatter, empty-body file) under both modes. Use small inline/temp fixtures for this task rather than depending on the full `ejemplos/` migration (D1) — final re-verification against the migrated `ejemplos/` corpus and the new synthetic estricto fixture happens in D4.
  - Done when: these test files pass using local/inline fixtures, with no remaining assertion tied to the retired tipo-based folder layout.

- [x] **B12** Modify `src/application/search-documents.ts`: `SearchQuery.tipo?: string` (open string); `SearchDefaults.estadosExcluidos: string[]`; `buildFilters` builds the NULL-aware deny-list predicate (`estadosExcluidos` list, not a subtracted allow-list — remove the `ESTADOS.filter(...)` computation entirely); empty/whitespace-only `tipo` treated as absent (no filtering applied); result-item construction conditionally includes `estado` (omit the key entirely when the document has none) instead of the current unconditional `estado: doc.estado` push.
  - Spec: `search/spec.md` ("Open tipo Filtering" incl. empty/whitespace-as-absent; "Config-Driven estadosExcluidos" incl. NULL-estado-always-eligible; "incluir_no_vigentes Is a No-Op Without Declared Exclusions"); `mcp-contract/spec.md` ("search_docs Omits Absent estado from Result Items").
  - Done when: filtering by an arbitrary project-specific `tipo` works; empty-string `tipo` is a no-op filter; a document with no `estado` is never excluded by a declared deny-list; `estadosExcluidos: []` (default) makes `incluir_no_vigentes` a true no-op; result items for estado-less documents omit the `estado` key.

- [x] **B13** Extend the search half of `test/application/index-and-search.test.ts` (or split into a dedicated search test file if that's cleaner within this PR): open-`tipo` filter on a project-specific value; empty/whitespace `tipo` treated as absent; `estadosExcluidos` declared vs not declared; `incluir_no_vigentes` no-op scenario; NULL-estado document remains eligible under a declared deny-list; result item omits `estado` when absent.
  - Done when: all listed scenarios pass.

- [x] **B14** Modify `src/application/get-overview.ts`: `OverviewLine.tipo?/estado?: string` become optional; bucket counters (`porTipo`/`porModulo`) skip documents with an absent value rather than counting them into any bucket; `formatOverview` pushes the "Por tipo:"/"Por modulo:" lines only when the corresponding bucket is non-empty (today's unconditional `formatCounts` call falls back to `"—"` on empty input — remove that fallback path for this case); `formatCounts` gets a guard so an absent/empty bucket never reaches `Object.entries(undefined)`.
  - Spec: `mcp-contract/spec.md` ("docs_overview Per-Document Line Omits Absent tipo/estado Segments" incl. alphabetical-by-`ruta` ordering; "docs_overview Omits Empty Taxonomy Buckets" incl. partial-coverage counts-only-defined-values, no "undefined" literal, no synthetic "sin tipo" bucket).
  - Done when: a corpus with no `tipo` anywhere renders no "Por tipo:" line at all; a corpus with partial `tipo` coverage counts only documents that define `tipo`; per-document lines are ordered alphabetically by `ruta` (relies on B18's `listDocuments()` ordering); no rendered line ever contains the literal text "undefined".

- [x] **B15** Rewrite `test/application/get-overview.test.ts`: empty-taxonomy omission (no tipo anywhere → no "Por tipo:" line), partial-coverage counts-only-defined-values, alphabetical-by-`ruta` per-document-line ordering, omitted `[tipo]`/`(estado)` segment rendering (reuses the shared line formatter from B4).
  - Done when: `npx vitest run test/application/get-overview.test.ts` passes.

- [x] **B16** Modify `src/application/read-document.ts`: `formatFrontmatter` renders `tipo:`/`modulo:`/`estado:` lines conditionally, omitting each entirely when absent (never empty/placeholder).
  - Spec: `mcp-contract/spec.md` ("Conditional Frontmatter Rendering in read_doc").
  - Done when: a document missing `modulo` renders `tipo:`/`estado:` only; a document with none of the three renders none of those lines.

- [x] **B17** Extend `test/application/read-document.test.ts`: partial-metadata rendering (one/two/three fields absent, in various combinations).
  - Done when: scenarios pass.

- [x] **B18** Modify `src/infrastructure/sqlite/sqlite-index-store.ts`:
  - `tipo`/`modulo`/`estado` columns become nullable in the schema DDL.
  - `migrate()` (constructor path — runs on **every** container construction: `search`, `overview`, `eval`, `index-md`, `serve`, and `index`) stays a **non-destructive** `CREATE TABLE IF NOT EXISTS` — do not move the schema-guarantee drop-and-recreate here, or every non-index command would wipe the index.
  - `reset()` (invoked once, at the start of `IndexDocuments.execute()`) becomes `DROP TABLE IF EXISTS chunks_vec, chunks_fts, chunks, documents` followed by re-running the current-schema DDL with nullable columns, wrapped in a **single transaction** (shrinks, does not eliminate, the concurrent-reader window per the declared non-goal below).
  - `buildFilterSql`'s estado predicate becomes `(d.estado IS NULL OR d.estado NOT IN (?, ?, …))` (NULL-aware deny-list, not the old allow-list `IN`).
  - `toDocument` maps SQL `NULL` → `undefined` for `tipo`/`modulo`/`estado`.
  - `listDocuments()`'s `ORDER BY tipo, ruta` changes to `ORDER BY ruta` only (nullable `tipo` would otherwise NULL-cluster first, defeating the zero-config alphabetical ordering both `docs_overview` and `INDEX.md` rely on).
  - Spec: `indexing/spec.md` ("Optional Persisted Metadata" incl. pre-existing-NOT-NULL-DB-upgraded-in-place; "Concurrent Readers During compendio index Are Out of Scope" incl. single-transaction requirement).
  - Done when: a document with no `tipo` persists as SQL `NULL` and round-trips to `undefined`; a `.compendio/compendio.db` seeded with the old `NOT NULL` schema is dropped/recreated by the next `compendio index` run with no manual `.compendio/` deletion required; `listDocuments()` returns rows ordered alphabetically by `ruta` regardless of `tipo` nullability; the `reset()` DDL runs inside one transaction.

- [x] **B19** Extend `test/infrastructure/sqlite-index-store.test.ts`: nullable-column round-trip (insert with undefined tipo/modulo/estado → NULL → `toDocument` returns undefined); pre-existing-NOT-NULL-schema-upgraded-in-place (seed the old schema directly via SQL, construct the store, run `reset()`, assert nullable insert succeeds); deny-list SQL scenarios (NULL-estado doc always eligible; declared exclusion filters correctly); `listDocuments()` alphabetical-by-`ruta` ordering with a mix of NULL and non-NULL `tipo`. Keep `pool: "forks"` (do not switch to threads — `better-sqlite3` is a native addon).
  - Done when: `npx vitest run test/infrastructure/sqlite-index-store.test.ts` passes.

- [x] **B20** Modify `src/composition.ts`: build the `ConvencionPolicy` and comparator from `config.convencion` via `crearConvencionPolicy`/`crearComparadorIndice` (A1); inject the policy into `IndexDocuments` and `GenerateIndexMd` constructors (B9/B10) and the comparator into `GenerateIndexMd` (B10); assemble `SearchDefaults` from `config.search.k` + `config.convencion.estadosExcluidos`.
  - **Carries A3's deferred debt** — A3 could NOT remove `search.estadosExcluidos` (deleting it breaks this file's compile, since `composition.ts` passes `config.search` wholesale as `SearchDefaults`). B20 must therefore also: (a) drop `estadosExcluidos` from `CompendioConfig["search"]` and from `DEFAULT_CONFIG.search` in `src/infrastructure/config.ts`, (b) delete the interim NOTE on `CompendioConfig["search"]`, and (c) tighten `warnIfLegacyEstadosExcluidos`'s stderr text — until B20 lands the key is deprecated but still live, and the message says so on purpose.
  - Done when: `src/composition.ts` compiles against every constructor signature changed in B9/B10/B12; no reference to the retired `config.search.estadosExcluidos` remains anywhere in `src/`; the deprecation warning states plainly that the key has no effect, and `test/infrastructure/config.test.ts` asserts a user-declared `search.estadosExcluidos` no longer changes search results.
  - **Closed in full**: `estadosExcluidos` removed from `CompendioConfig["search"]`/`DEFAULT_CONFIG.search` (now `{ k: number }` only); interim NOTE deleted; `mergeConfig`'s `search` merge changed from a spread (which would silently pass a raw-JSON legacy key through at runtime despite the narrower type) to an explicit `{ k: override.search?.k ?? base.search.k }` whitelist; `warnIfLegacyEstadosExcluidos` message tightened to state the key "ya no tiene ningun efecto"; new behavioral test added in `config.test.ts` proving a declared `search.estadosExcluidos` no longer changes `SearchDocuments` results.

- [x] **B21** Full-suite gate for Phase B: run `npm run typecheck` and `npm test` with B1–B20 landed together as one changeset; grep for any remaining reference to `Tipo`/`Estado`/`TIPOS`/`ESTADOS` outside doc comments/CHANGELOG.
  - Done when: both commands exit 0 from a clean tree, and the closed-union/const names are gone from `src/`.
  - **Closed in Batch 3** (see apply-progress.md "Batch 3"): the residual failure was exclusively `src/server.ts`/`src/cli.ts` still importing `TIPOS`/`Tipo`, which B1 necessarily broke by deleting those names from `model.ts`. Batch 2 correctly deferred fixing this because it fell inside Phase C's own scope ("Do NOT start Phase C"). Batch 3 implemented C1/C2/C3, which closes this gate as a direct consequence: `npm run typecheck` exit 0, `npm run build` exit 0, `npm test` 155/155 passing, and `grep -rn "TIPOS\|ESTADOS\|\bTipo\b\|\bEstado\b" src/` returns zero matches.

---

## Phase C — Contract (server.ts, cli.ts)

Depends on: Phase B (needs `SearchFilters.tipo?: string`, open persisted fields).

- [x] **C1** Modify `src/server.ts`: `search_docs` tool's `tipo` param `z.enum(TIPOS)` → `z.string().optional()`; drop the `TIPOS` import.
  - Spec: `mcp-contract/spec.md` ("Open tipo Across MCP Tool and CLI" — MCP scenario).
  - Done when: `search_docs` accepts `tipo: "playbook"` (or any arbitrary string) without schema rejection.

- [x] **C2** Modify `src/cli.ts`: remove `parseTipo`'s hard `process.exit(2)` on an unrecognized value; `--tipo` becomes a plain string passthrough (MAY print a warning, MUST NOT exit non-zero for an unknown value); update `--tipo`/`--todos` help text to describe the open-string/config-driven behavior instead of the retired closed list.
  - Spec: `mcp-contract/spec.md` ("Open tipo Across MCP Tool and CLI" — CLI scenario: "does not call process.exit(2)").
  - Done when: `compendio search --tipo notarealtype ...` runs to completion (no non-zero exit for that reason alone).

- [x] **C3** Create minimal contract tests: `test/server.test.ts` (MCP schema accepts an arbitrary `tipo` string) and extend/create CLI coverage for `--tipo` no longer calling `process.exit(2)` on an unknown value. No existing test file covers `server.ts`/`cli.ts` today — keep these smoke-level, matching the design's Testing Strategy row ("server/cli tests"), not a full CLI test harness buildout.
  - Done when: both scenarios pass under `vitest`.

---

## Phase D1 — Fixtures / corpus migration

Depends on: nothing code-wise for authoring (content-only); D4's final assertions depend on Phase B. Can be authored in parallel with Phases A–C.

- [x] **D1.1** Restructure `ejemplos/docs/` from the current `tipo`-based folders (`funcional/`, `adr/`, `api/`, `qa/`, `guias/`) into a plausible zero-config, folder-as-module layout (product decision 4, confirmed in `state.yaml`): keep real, meaningful content for search evaluation; make frontmatter light/absent on most files to demonstrate `libre` inference (H1-derived `titulo`, folder-derived `modulo`); remove the `.compendio/compendio.db*` build artifacts from the working tree if present (already gitignored — confirm untracked).
  - Done when: `node dist/cli.js --root ejemplos index` (after `npm run build`) indexes every file with zero `omitidos` for metadata reasons under the default (no-config / `libre`) path.
  - **Done** — see apply-progress.md "Batch 4" for the folder-as-module layout (`leadsviewer/`, `informes/`, `transversal/`, `glosario.md` at root) and the frontmatter-stripping rationale. `node dist/cli.js --root ejemplos index` -> "Indexados 11 documentos (27 chunks)", zero `omitidos`.

- [x] **D1.2** Update `ejemplos/goldenset.yaml`: rewrite every `ruta` value to match the migrated paths from D1.1 (`EvaluateSearch` compares `ruta` strings only, so entries stay structurally valid once paths line up — no query/expected-doc semantics need to change unless a file's content moved meaningfully).
  - Done when: `node dist/cli.js --root ejemplos eval` runs against the new corpus with every goldenset entry resolving to an existing indexed `ruta`.
  - **Done** — all 22 `esperado` paths rewritten to the new layout; no `pregunta` text touched. `eval` runs clean; see apply-progress.md for the before/after recall/MRR table.

- [x] **D1.3** Create a secondary synthetic full-convention fixture (e.g. `test/fixtures/estricto/` — exact path decided during apply) with frontmatter + a declared taxonomy matching today's retired `TIPOS`/`ESTADOS` values, so `estricto`-mode behavior stays covered by a fixture now that `ejemplos/` is zero-config-only (per proposal's "Secondary fixture" note — `ejemplos/` no longer does double duty).
  - Done when: the fixture indexes cleanly under a `convencion.modo: "estricto"` config declaring the matching `tipos`/`estados`, with zero `omitidos`.
  - **Done** — `test/fixtures/estricto/` created (5 docs, one per retired `tipo`, plus `compendio.config.json` declaring the matching `tipos`/`estados`/`estadosExcluidos`). Verified both via `vitest` (new describe block in `index-and-search.test.ts`) and via the real CLI (`node dist/cli.js --root test/fixtures/estricto index` -> 5/5 indexed, zero `omitidos`).

- [x] **D1.4** Update `ejemplos/compendio.config.json` to reflect the zero-config default (`docsDir`-only or empty) consistent with D1.1, since `ejemplos/` is now the product's zero-config pitch example, not the strict-convention example.
  - Done when: config file contains no `convencion` block (or an empty one), and `compendio index --root ejemplos` behaves identically with the file present or absent.
  - **Done** — `search.estadosExcluidos` removed (no `convencion` block declared at all, falls through to `DEFAULT_CONFIG.convencion`). Verified `compendio index --root ejemplos` emits zero stderr output (no legacy-key deprecation warning).

- [x] **D1.5** (depends on Phase B) Re-point the final assertions in `test/application/index-and-search.test.ts`, `generate-index-md.test.ts`, and `get-overview.test.ts` (interim-fixtured in B11/B15) to run against both the migrated zero-config `ejemplos/` corpus (`libre`) and the D1.3 synthetic fixture (`estricto`), replacing any remaining assumption tied to the retired tipo-based `ejemplos/` layout.
  - Done when: full suite green against the final fixture set; no test still hardcodes the old folder-based tipo assumption.
  - **Done** — `test/helpers/build.ts`'s `EJEMPLOS_CONVENCION` switched from the interim `estricto` reproduction to real zero-config `libre` (matching `ejemplos/compendio.config.json`); every ejemplos-path assertion in `index-and-search.test.ts`/`evaluate.test.ts`/`read-document.test.ts` re-pointed to the new paths; tipo-filtering coverage moved to a new estricto-fixture describe block (D1.3) since zero-config `ejemplos/` no longer declares `tipo` anywhere. `generate-index-md.test.ts`/`get-overview.test.ts` needed NO changes — confirmed by grep that both were already fully inline-fixture-based since B11/B15 with zero dependency on the real `ejemplos/` folder layout (see apply-progress.md for the grep evidence). Full suite: 159/159 green.

## Phase D2 — Documentation

Depends on: nothing code-wise for authoring (specs are final); final review waits on Phase B (no stale claims about mandatory frontmatter). Can be authored in parallel with Phases A–C, verified after B.

- [x] **D2.1** Rewrite `README.md`: lead with the zero-config path ("point Compendio at any folder of `.md` files, run `index`, search"); present the `convencion` block as an optional "if you maintain a taxonomy" section (using the `estricto` reproduce-today's-behavior example from `proposal.md`); update the config reference table with the new `convencion` block fields and note the retirement of `search.estadosExcluidos`.
  - Done when: README contains no claim that frontmatter/`tipo`/`modulo`/`estado` are required to index a project.
  - **Done** (Batch 5) — see apply-progress.md. Zero-config quick start; new "Documentation convention (optional)" section with the `estricto` reproduce-today JSON example (pointing at `test/fixtures/estricto/compendio.config.json`, since `ejemplos/compendio.config.json` was deleted in Batch 4); config table updated (`search: { k }` only, full `convencion` defaults shown, `search.estadosExcluidos` retirement called out); eval table refreshed with freshly re-measured numbers (hibrido 1.00/0.943, lexico 0.95/0.857, zero-config, no config file present); `ejemplos/` paths updated to the D1 folder-as-module layout.

- [x] **D2.2** Rewrite `docs/convencion-documentacion.md`: reframe from "the required convention" to "an optional convention you can enforce with `modo: estricto`"; document the inference rules (`titulo`/`modulo` sources, empty-string/null-as-absent) and the `camposFrontmatter` mapping option, including the shared-source-key behavior.
  - Done when: doc's described behavior matches `configuration/spec.md` and `indexing/spec.md` exactly (no stale mandatory-frontmatter language).
  - **Done** (Batch 5) — new "§4 Compendio's convention modes: `libre` vs `estricto`" section added (inference table matching indexing spec exactly, `estricto` per-field-independent validation, `camposFrontmatter` mapping incl. shared-source-key example); §5 "Frontmatter" (renamed from "Required frontmatter") reframed as this project's own team choice, not a tool requirement; §8 Lifecycle updated to state `estadosExcluidos` default `[]` explicitly, using this very document's own `estado: borrador` frontmatter (left untouched) as the live example the orchestrator flagged; §9 INDEX.md ordering/example updated to alphabetical-by-`ruta` default. Frontmatter of the doc itself intentionally NOT modified (it is the live example).

- [x] **D2.3** Update `CLAUDE.md` (repo root, "Non-obvious decisions" and "Working conventions" sections): `TIPOS`/`ESTADOS` closed lists retired; `tipo`/`modulo`/`estado` optional; `convencion.modo` `libre`/`estricto`; SQLite columns nullable; schema guarantee moved to `reset()` (vs `migrate()`'s non-destructive `CREATE TABLE IF NOT EXISTS`); `INDEX.md` default alphabetical-by-`ruta` ordering; concurrent-readers-during-`index` declared non-goal.
  - Done when: `CLAUDE.md`'s documented architecture/decisions match the shipped implementation (this file is checked-in guidance read by future agents working in this repo).
  - **Done** (Batch 5) — all bullets rewritten against the actual shipped `src/` (verified by reading `convencion.ts`, `config.ts`, `sqlite-index-store.ts`, `index-markdown.ts`, `get-overview.ts` directly, not copied forward from the old doc); stale `TIPOS = [...]` closed-list bullet removed; "Working conventions" bullet 3 rewritten (no more "matched against TIPOS").

- [x] **D2.4** (depends on D2.1–D2.3 and Phase B) Regenerate `docs/INDEX.md` via `compendio index-md` (this repo's own `docs/` follows the convention per `CLAUDE.md`, and ordering has changed).
  - Done when: `docs/INDEX.md` is re-sorted alphabetically by `ruta`, with no stale `TIPOS`-order artifacts.
  - **Done** — `node dist/cli.js --root . index-md` run after D2.1–D2.3; reported "sin cambios" (frontmatter/first-paragraph of the one doc were untouched by the rewrite, so the regenerated content is byte-identical to the smoke-test version already in the tree) but confirmed freshly generated through the real `libre`/alphabetical-default code path (no config file at the repo root).

---

## Phase E — Final verification

Depends on: all prior phases.

- [x] **E1** Run `npm run build && npm test && npm run typecheck` from a clean tree.
  - Done when: all three exit 0.
  - **Done** (Batch 6) — from a genuinely clean tree (`dist/` and `.tsbuildinfo` removed before building): `npm run build` exit 0, `npm test` 159/159 passing, `npm run typecheck` exit 0. See apply-progress.md "Batch 6" for full output.

- [x] **E2** Manual smoke test per `CLAUDE.md`'s documented commands: `node dist/cli.js --root ejemplos index`, `node dist/cli.js --root ejemplos eval`, `node dist/cli.js --root ejemplos search "<query>"` against the migrated corpus; `compendio index-md` against `docs/`; an `estricto`-mode run against the D1.3 synthetic fixture.
  - Done when: every command succeeds and output matches the zero-config/`estricto` behaviors described in the specs (no unexpected `omitidos`, correct ordering, correct filtering).
  - **Done** (Batch 6) — all commands run against the compiled `dist/`, all succeed. Central acceptance test (round-trip of `product_decisions.estado_semantics`) verified explicitly with real command output: `estricto` fixture excludes `borrador` by default and includes it with `--todos`; zero-config `ejemplos/` shows byte-identical output with/without `--todos` despite genuinely containing `borrador`/`obsoleto` documents (confirmed both are returned by unfiltered search). `docs_overview`/`index-md` ordering confirmed alphabetical-by-`ruta` in `ejemplos/` and declared-taxonomy-order (`funcional, adr, api, qa, guia`) in the `estricto` fixture. Zero `omitidos` in both corpora (11/11 and 5/5 indexed, no `AVISO`/`Omitidos` lines). `read_doc` on a no-frontmatter document (`glosario.md`) renders an empty `---\n---` block, no placeholder `tipo:`/`modulo:`/`estado:` lines; a partial-metadata document renders only its present fields. `search_docs`'s tool description confirmed free of the unconditional-exclusion claim. Eval baseline reproduced exactly (hibrido 1.00/0.943, lexico 0.95/0.857). Two known issues confirmed still present and NOT fixed (out of scope): `SERVER_VERSION` hardcoded `"0.1.0"` vs `package.json`'s `"0.1.2"` (`compendio --version` prints `0.1.0`); no subprocess-level CLI test exists. See apply-progress.md "Batch 6" for full command output and the CLI-subprocess-test recommendation.

---

## Dependency summary

```
Phase 0 (reconciliation)
  └─> Phase A (A1 → {A2, A3} → A4)
        └─> Phase B (B1..B21, one atomic PR, sequential)
              ├─> Phase C (C1, C2, C3)
              └─> D1.5 / D2.4 (final re-verification against Phase B)
Phase D1.1–D1.4, Phase D2.1–D2.3 — content authoring, parallel with A/B/C
Phase E — depends on everything above
```

## Parallelization notes

- **A1** must land before **A2**/**A3** (both need `ConvencionConfig`/policy shapes); **A2** and **A3** can proceed in parallel; **A4** follows A3.
- **Phase B is one changeset** — do not parallelize its internal tasks across separate PRs; the ordering above is for reviewer/author sequencing within the single diff, not independent delivery.
- **Phase C** is strictly after Phase B (needs the open-string types).
- **D1.1–D1.4** (fixture authoring) and **D2.1–D2.3** (doc drafting) have no code dependency and can run fully in parallel with Phases A/B/C — only their final verification steps (**D1.5**, **D2.4**) wait on Phase B.
- **Phase E** is the sole hard gate before calling the change done.
