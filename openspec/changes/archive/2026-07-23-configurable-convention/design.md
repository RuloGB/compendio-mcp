# Design: Configurable documentation convention (zero-config + optional strict)

## Technical Approach

Replace the single hard gate `validateFrontmatter` with an injected, pure-domain
**`ConvencionPolicy`** built from config by the composition root. Two implementations —
`PoliticaLibre` (default, inference-first, never hard-fails for metadata) and
`PoliticaEstricta` (linter against the project's *declared* taxonomies) — share the
existing `FrontmatterInput`/`FrontmatterResult` shapes. `DocumentMeta.tipo/modulo/estado`
become **optional open strings**; the closed `Tipo`/`Estado` unions and the hardcoded
`TIPOS`/`ESTADOS` constants are retired from `src/domain/model.ts`. Estado filtering flips
from a closed allow-list to a NULL-aware **deny-list** driven by
`convencion.estadosExcluidos`. This is Approach 2 from the exploration bounded by
Approach 1's "open string, not generic key-value" scope limit. `src/domain/` stays pure:
the policy is a domain object; only `src/infrastructure/config.ts` reads the file and
`src/composition.ts` wires config → policy → use cases.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Convention seam | New pure module `src/domain/convencion.ts` exposing `ConvencionPolicy { resolver(input): FrontmatterResult }` + `crearConvencionPolicy(cfg)` factory + inference helpers. Injected into `IndexDocuments` and `GenerateIndexMd` (they stop importing `validateFrontmatter`). | (a) Keep a branching free function `validateFrontmatter(input, cfg)`; (b) one "god" policy also owning ordering + estadosExcluidos. | The choke point already sits in one function called by both use cases — turning it into an injected policy keeps the mode branch in one place, testable in isolation, without adapter coupling. A god-policy over-couples three unrelated config behaviors into one injected object. |
| Field types | `tipo?/modulo?/estado?: string` on `DocumentMeta`; `SearchFilters.tipo?: string` and `estadosExcluidos?: string[]` (the `estados?` allow-list field is removed/renamed — see the "Estado filtering" row below); `SearchResultItem.estado?: string` (optional, mirrors mcp-contract's "search_docs omits absent estado"); `SearchQuery.tipo?: string`; `SearchDefaults.estadosExcluidos: string[]`; `GetOverview`'s `OverviewLine.tipo?/estado?: string` (per-document-line optionality — a distinct concern from the `porTipo`/`porModulo` bucket-omission behavior already noted in the File Changes table); delete `Tipo`/`Estado` and `TIPOS`/`ESTADOS` from `model.ts`. | Generic key-value metadata bag (Approach 3). | Bounds blast radius to "three fields optional" (nullable columns, optional-safe formatting, open MCP string) instead of redesigning `SearchFilters`. The standard taxonomy moves into the estricto config example + the secondary fixture. |
| Estado filtering | Replace `SearchFilters.estados?` (allow-list) with `estadosExcluidos?: string[]` (deny-list); SQL becomes `(d.estado IS NULL OR d.estado NOT IN (…))`. | Compute allow-list by subtracting from a closed `ESTADOS`. | With open/absent estado there is no closed universe to subtract from; the deny-list is the only semantics that keeps NULL-estado docs always visible and makes `estadosExcluidos: []` a true no-op for `incluir_no_vigentes`. |
| INDEX.md ordering | `renderIndexMd(entries, comparar?)`; default comparator = alphabetical by `ruta`; estricto with declared `tipos` supplies a taxonomy-order comparator. Root-first tier retired. | Keep `TIPOS.indexOf` ordering. | Open/absent `tipo` makes `TIPOS.indexOf` meaningless; alphabetical-by-`ruta` is the confirmed default (state.yaml). |
| Retired `search.estadosExcluidos` | **Warn-and-ignore**: `loadConfig` detects the legacy key and prints a one-line stderr deprecation notice pointing to `convencion.estadosExcluidos`, but does **not** honor its value (no compat shim). | (a) Silent ignore; (b) migrate the value. | Migrating is the forbidden shim. Silent ignore could quietly re-expose `borrador` docs a user meant to hide. A notice costs nothing and `config.ts` is already infrastructure doing IO. |

## Data Flow

Indexing — **libre** (default, no config):
```
discover → parse(data,titulo,resumen) → PoliticaLibre.resolver:
    titulo = H1 || humanizarNombreArchivo(ruta)
    modulo = data[map.modulo] || primerSegmento(ruta) || undefined
    tipo   = data[map.tipo]   || undefined            (never invented)
    estado = data[map.estado] || undefined            (never invented)
    ok unless file unreadable / no indexable content
  → chunk → embed → store.saveDocument (nullable cols)
omitidos ← only unparseable/empty files
```
Indexing — **estricto** (opt-in): resolver requires `map.tipo`/`map.modulo`/`map.estado`
non-empty **and** an H1 — no filename-humanization fallback. Each of `tipo`/`estado` is
checked **independently**: if `cfg.tipos` declared → `tipo` ∈ list, else presence-only;
same independently for `cfg.estados`/`estado` (one being declared does not affect the
other's fallback). `modulo` has no taxonomy at all — always presence-only, regardless of
what's declared for `tipo`/`estado`. No inference of any kind. Invalid → `omitidos`
(today's linter, against declared lists where declared, presence-only otherwise).

Search — estado exclusion:
```
declared ["borrador","obsoleto"] & !incluirNoVigentes
   → filters.estadosExcluidos=[…] → SQL AND (d.estado IS NULL OR d.estado NOT IN (?,?))
not declared (default [])  → no estado clause → incluir_no_vigentes is a no-op
```

## Interfaces / Contracts

```ts
// src/domain/convencion.ts (pure)
export interface ConvencionConfig {
  modo: "libre" | "estricto";
  tipos?: string[];            // enforced only in estricto
  estados?: string[];          // enforced only in estricto
  estadosExcluidos: string[];  // search deny-list; default []
  camposFrontmatter: { tipo: string; modulo: string; estado: string }; // default identity
}
export interface ConvencionPolicy { resolver(input: FrontmatterInput): FrontmatterResult; }
export function crearConvencionPolicy(cfg: ConvencionConfig): ConvencionPolicy;
export function crearComparadorIndice(cfg: ConvencionConfig): (a: IndexEntry, b: IndexEntry) => number;
```
Inference helpers (pure): `inferirModulo(ruta)` = first POSIX segment when `ruta`
contains `/`, else `undefined`; `humanizarNombreArchivo(ruta)` = basename minus `.md`,
`-`/`_`→space, collapse+trim, sentence-case first char.

Config default (`DEFAULT_CONFIG.convencion`): `{ modo:"libre", estadosExcluidos:[],
camposFrontmatter:{tipo:"tipo",modulo:"modulo",estado:"estado"} }`. `search` keeps only
`{ k }`. Reproducing today = declare `modo:"estricto"`, the five `tipos`, three
`estados`, and `estadosExcluidos:["borrador","obsoleto"]`.

`camposFrontmatter` collisions: each of `tipo`/`modulo`/`estado` reads its own declared
source key independently, with no cross-field validation — two fields mapped to the same
source key both read that key's value deterministically. Adding collision-detection
machinery would police an edge case with no real risk (a mapping is a per-project,
author-controlled config choice) for no behavioral benefit.

`camposFrontmatter` merges **per key** against the identity defaults: declaring
`{ "convencion": { "camposFrontmatter": { "tipo": "type" } } }` overrides only `tipo` and
leaves `modulo`/`estado` at their identity defaults (`"modulo"`/`"estado"`) — the object
is never replaced wholesale. This contrasts with today's `exclude` merge
(`config.ts`'s `mergeConfig`: `exclude: override.exclude ?? base.exclude`), which is a
whole-array replace — declaring any `exclude` list drops the default entirely rather than
merging element-wise.

## File Changes (impact map → PR slices)

Slices ordered so each builds + tests green. **PR B carries the atomic TS ripple** (making the fields optional breaks every consumer at compile time — they cannot be split further without transient red).

| Slice | File (exploration ref) | Action | Change shape |
|---|---|---|---|
| **A** additive, green | `src/domain/convencion.ts` | Create | `ConvencionConfig`, `ConvencionPolicy`, factory, inference + comparator helpers |
| A | `src/infrastructure/config.ts` (`:6-36,61-70`) | Modify | Add `convencion` block + defaults; drop `search.estadosExcluidos`; warn-and-ignore legacy key |
| A | `test/domain/convencion.test.ts` | Create | libre/estricto/inference/presence-only unit tests |
| **B** atomic ripple | `src/domain/model.ts` (`:6-10,20-22,51-66`) | Modify | Fields optional strings; delete `Tipo`/`Estado`/`TIPOS`/`ESTADOS`; `SearchFilters.estados?` is removed and replaced by `SearchFilters.tipo?: string` / `estadosExcluidos?: string[]`; `SearchResultItem.estado` becomes optional `string` |
| B | `src/domain/frontmatter.ts` (`:26-86`) | Modify | Keep `FrontmatterInput`/`Result`+helpers; move logic into policies; remove free `validateFrontmatter` |
| B | `src/domain/index-markdown.ts` (`:1,9,55-62`) | Modify | Injectable comparator; `formatDocLine` drops `[tipo]`/`(estado)` when absent |
| B | `src/application/index-documents.ts` (`:3,68-76`) | Modify | Inject `ConvencionPolicy`; call `policy.resolver`; wrap `parser.parse()` in a per-file `try/catch` — a parse failure is pushed to `omitidos` with its error message instead of throwing and aborting the run; fold `source.discover()`'s per-file read failures (see `ports.ts`/`file-document-source.ts` rows below) into `omitidos` the same way |
| B | `src/application/generate-index-md.ts` (`:2,38-50`) | Modify | Inject `ConvencionPolicy`; call `policy.resolver`; pass comparator; same per-file `try/catch` around `parser.parse()` and the same read-failure folding as `index-documents.ts`, so `index-md` has identical skip-and-report behavior |
| B | `src/domain/ports.ts` (`DocumentSource`) | Modify | `discover()` returns per-file read failures alongside successfully read files (e.g. `{ files: DocumentFile[]; erroresLectura: { ruta: string; error: string }[] }`) so one unreadable file no longer aborts the whole walk |
| B | `src/infrastructure/fs/file-document-source.ts` (`:36-46`) | Modify | Per-entry `readFile` wrapped in a per-file `try/catch` inside `walk`; a read failure is collected instead of thrown, so `discover()` keeps walking the rest of the tree |
| B | `src/application/search-documents.ts` (`:13-28,87-97`) | Modify | `SearchQuery.tipo?: string`; `SearchDefaults.estadosExcluidos: string[]`; `buildFilters` → deny-list; conditionally include `estado` in the result-item construction (omit when the document has none), instead of today's unconditional `resultados.push({... estado: doc.estado ...})` |
| B | `src/application/get-overview.ts` (`:4-9,29-32,37-42,47-57`) | Modify | `OverviewLine.tipo?/estado?: string` become optional to carry through absent per-document values; skip absent tipo/modulo in the bucket counters; `formatOverview` conditionally pushes the "Por tipo:"/"Por modulo:" lines only when the corresponding bucket is non-empty (today it pushes both unconditionally via `formatCounts`, which falls back to `"—"` on empty input); `formatCounts` gains a guard so an absent/empty bucket never reaches `Object.entries(undefined)` |
| B | `src/application/read-document.ts` (`:92-104`) | Modify | `formatFrontmatter` renders tipo/modulo/estado conditionally |
| B | `src/infrastructure/sqlite/sqlite-index-store.ts` (`:64-100,287-313,319-333`) | Modify | Columns nullable; deny-list SQL; `toDocument` null→undefined; `migrate()` (constructor path, `:52` — runs on **every** container construction: `search`, `overview`, `eval`, `index-md`, `serve`, not just `index`) stays a non-destructive `CREATE TABLE IF NOT EXISTS`; the schema guarantee moves into `reset()` (index-run-scoped, invoked only at the start of `IndexDocuments.execute()`): `reset()` becomes `DROP TABLE IF EXISTS chunks_vec, chunks_fts, chunks, documents` followed by re-running the current-schema DDL with nullable columns; `listDocuments()`'s `ORDER BY tipo, ruta` changes to `ORDER BY ruta` — with `tipo` now nullable, SQLite sorts `NULL` first, which would render `docs_overview`'s per-document lines in meaningless NULL-first clusters for the zero-config corpus |
| B | `src/composition.ts` (`:43-59`) | Modify | Build policy+comparator from `config.convencion`; inject; `SearchDefaults` is now assembled from `config.search.k` + `config.convencion.estadosExcluidos` — the retired `config.search.estadosExcluidos` no longer feeds it |
| B | affected `test/**` | Modify | optional-field + deny-list scenarios |
| **C** contract | `src/server.ts` (`:6,44`) | Modify | `tipo: z.string().optional()`; drop `TIPOS` import |
| C | `src/cli.ts` (`:10,78,97,171-177`) | Modify | Remove `parseTipo` hard exit; `--tipo` passthrough string; generic help text |
| **D** docs/fixtures | `README.md`, `docs/convencion-documentacion.md`, `ejemplos/**`, `ejemplos/goldenset.yaml`, secondary full-convention fixture + its tests | Modify/Create | Zero-config-first docs; rework corpus; synthetic estricto fixture (goldenset compares `ruta` only → stays valid) |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (domain) | libre inference (H1 fallback, modulo segment, never-invent tipo/estado, field mapping), estricto (declared-list reject, presence-only when undeclared, H1 required), comparator | Pure `test/domain/convencion.test.ts`; no IO |
| Integration | zero-config index+search over reworked `ejemplos/`; deny-list vs no-op; overview omits empty buckets; INDEX.md alphabetical; estricto over synthetic fixture | Vitest `pool:"forks"` (unchanged) + `test/helpers/fake-embeddings.ts` |
| Contract | open-string `tipo` accepted; CLI `--tipo` no longer exits(2) | server/cli tests |

Strict TDD (config.yaml) applies in apply phase; no lint/coverage tooling.

## Migration / Rollout

No data migration tooling, but the schema guarantee is not free: verified against
`sqlite-index-store.ts`, `migrate()` runs inside the `SqliteIndexStore` constructor
(`:52`), which executes on **every** container construction — `search`, `overview`,
`eval`, `index-md`, and `serve`, not only `index`. `migrate()` must therefore stay a
non-destructive `CREATE TABLE IF NOT EXISTS`: recreating the schema there would wipe the
index on every non-index command, which is unacceptable. The schema guarantee instead
moves into `reset()`, which is invoked exactly once, at the start of
`IndexDocuments.execute()` — the only index-run-scoped operation. `reset()` becomes
`DROP TABLE IF EXISTS chunks_vec, chunks_fts, chunks, documents` followed by re-running
the current-schema DDL (nullable columns). Today's `reset()` only `DELETE`s rows and
drops `chunks_vec` — it never touches `documents`/`chunks`/`chunks_fts` — so, left as-is,
a pre-existing `.compendio/compendio.db` created under the old `NOT NULL` schema would
keep those constraints and crash on the first frontmatter-less document. Moving the
drop-and-recreate into `reset()` guarantees the current schema on every `index` run,
with no manual deletion of `.compendio/` required, and without touching the schema on
any command that only constructs the store to read it. The `reset()` DDL (the
`DROP TABLE IF EXISTS` sequence followed by re-creating `documents`/`chunks`/
`chunks_fts`/`chunks_vec`) MUST run inside a single transaction, to shrink — not
eliminate — the window in which the tables briefly don't exist. **Declared non-goal
(spec-level, user-confirmed 2026-07-23)**: concurrent readers during a `compendio index`
run are OUT OF SCOPE / best-effort, not merely a design assumption — this is now codified
in the Indexing spec's "Concurrent Readers During `compendio index` Are Out of Scope"
requirement. A long-lived `compendio serve` (or any other reader) process, if queried by
another terminal concurrently running `compendio index`, may see empty results or a
transient "no such table" failure while the reset transaction is in flight; this is
acceptable because `.compendio/` is disposable, no installed base exists yet, and
re-running the query after the reindex completes returns correct results.
`.compendio/` stays gitignored and disposable; rollback = revert the PR chain, and the
index rebuilds on the old schema on the next `index` run.

## What does NOT change

RRF fusion (`domain/fusion.ts`, k=60), heading-based chunking (`domain/chunking.ts`),
embeddings (normalized L2, BigInt vec0 key, graceful lexical degradation), `read_doc`
fuzzy `ruta` matching (`domain/similarity.ts`), goldenset mechanics (`EvaluateSearch`
compares `ruta` only), FTS5 tokenizer, MCP progressive-disclosure tool set, response field
names (all stay Spanish).

## Open Questions

- [ ] 400-line budget: **PR B is High risk** — the TS ripple across ~9 files may exceed 400 lines and cannot split without transient red. `sdd-tasks` must decide: `size:exception` for B, or split D (docs vs fixtures) to stay balanced. `Decision needed before apply: Yes` for B.

Resolved (user-confirmed 2026-07-23, `state.yaml` `confirmed_assumptions`, now binding —
no longer open):

- `estricto` performs **no** modulo/titulo inference (validation-only): reproduces
  today's linter, requires an H1, no filename-humanization fallback.
- Retired `search.estadosExcluidos` key → warn-and-ignore (see Architecture Decisions
  table above).

Reconciled with spec (task 0.1, resolved during `sdd-tasks`, recorded in
`tasks.md`'s Phase 0 — closes `state.yaml`'s spec↔design reconciliation flag):
on detailed comparison, `spec.md` and this document do **not** actually
diverge on either of the two inference details flagged by that note. Both are
confirmed consistent, not "one side picked over the other":

- **Humanized filename**: `specs/indexing/spec.md`'s "Humanized filename,
  concrete example" scenario (`docs/mi-guia_de-uso.md` → `"Mi guia de uso"`)
  and this document's `humanizarNombreArchivo` definition ("basename minus
  `.md`, `-`/`_` → space, collapse+trim, sentence-case first char") describe
  the same algorithm. Implemented exactly as this document's helper
  signature, verified against the spec's worked example as the canonical
  test case.
- **INDEX.md ordering comparator**: `specs/index-md/spec.md`'s
  declared-taxonomy-ordering-falling-back-to-alphabetical-by-`ruta` wording
  and `state.yaml`'s `confirmed_assumptions` ("estricto INDEX.md intra-tipo
  tie-break → alphabetical by ruta") agree; the Architecture Decisions table
  above ("estricto with declared `tipos` supplies a taxonomy-order
  comparator") is consistent but was less explicit about the tie-break.
  `crearComparadorIndice` implements declared-order-then-alphabetical-by-`ruta`
  tie-break, per spec + `confirmed_assumptions`.
