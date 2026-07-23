# Exploration: Configurable documentation convention (zero-config + progressive configuration)

Change: `configurable-convention` · Date: 2026-07-22 · Phase: sdd-explore (done)

> Investigation performed by the sdd-explore agent; persisted verbatim by the orchestrator (the explore agent runs without write tooling). Product context: the fixed convention is retired by user decision (2026-07-22), no backward-compatibility obligation; the product's public contract stays Spanish.

## Current State

Compendio's indexing pipeline (`src/application/index-documents.ts`, `generate-index-md.ts`) calls `validateFrontmatter` (`src/domain/frontmatter.ts:26`) as a hard gate: any `.md` file missing a non-empty `tipo`/`modulo`/`estado`, using a `tipo`/`estado` value outside the closed `TIPOS`/`ESTADOS` unions (`src/domain/model.ts:6-10`), or lacking an H1, is skipped and reported in `omitidos` — never indexed, never in `INDEX.md`. This closed vocabulary is a compile-time TypeScript union (`Tipo`, `Estado`) that propagates through `DocumentMeta`, `SearchFilters`, the SQLite schema, the MCP tool schema, and the CLI. Useful finding: the markdown parser (`src/infrastructure/markdown/remark-markdown-parser.ts:44-53`) **already** extracts `titulo` (first H1) and `resumen` (first paragraph after H1) independently of frontmatter — that inference groundwork already exists; only `validateFrontmatter`'s hard requirement for `tipo`/`modulo`/`estado` blocks frontmatter-less files today.

## Affected Areas — full coupling inventory

| File / symbol | What breaks without frontmatter | What breaks with a custom taxonomy |
|---|---|---|
| `src/domain/model.ts:6-10,13-22,51-57` — `TIPOS`, `ESTADOS`, `DocumentMeta`, `SearchFilters` | `tipo`/`modulo`/`estado` are required (non-optional) fields — a doc with none of them cannot even construct a `DocumentMeta` | `Tipo`/`Estado` are closed unions; any value outside `TIPOS`/`ESTADOS` fails TypeScript, not just runtime validation |
| `src/domain/frontmatter.ts:26-86` `validateFrontmatter` | This is the exact hard gate to relax/replace with inference | Same function does the closed-list check (`TIPOS.includes`, `ESTADOS.includes`) — needs to become "validate against configured taxonomy, if any" |
| `src/infrastructure/sqlite/sqlite-index-store.ts:66-78` (schema), `287-313` (`buildFilterSql`) | `tipo TEXT NOT NULL`, `modulo TEXT NOT NULL`, `estado TEXT NOT NULL` — schema literally can't store an absent field; must become nullable | Filter SQL (`d.tipo = ?`, `d.estado IN (...)`) works with any string values already — not coupled to the closed list itself, only to non-null |
| `src/application/get-overview.ts:29-32` `GetOverview` | Groups every doc into `porTipo`/`porModulo`; assumes every doc has a `tipo` — needs a "sin tipo" bucket or to omit the field entirely when absent corpus-wide | Not coupled to the specific values, just presence |
| `src/application/search-documents.ts:87-97` `buildFilters`, esp. line 95 | `ESTADOS.filter((e) => !excluidos.includes(e))` computes the *included* states by subtracting from the closed list — this specific computation stops making sense once `estado` is open/absent | `SearchQuery.tipo?: Tipo` is typed to the closed union |
| `src/application/read-document.ts:92-104` `formatFrontmatter` | Unconditionally renders `tipo:`/`modulo:`/`estado:` lines — needs conditional rendering | — |
| `src/application/index-documents.ts`, `generate-index-md.ts` | Both call `validateFrontmatter` as their hard skip gate (single choke point — good: only one function to change) | — |
| `src/domain/index-markdown.ts:55-62` `compareEntries` | `TIPOS.indexOf(a.tipo)` drives `INDEX.md` sort order — needs a new default ordering (e.g. alphabetical by `ruta`) when `tipo` is open/absent | Sort order becomes meaningless/arbitrary for custom taxonomies unless the config also declares an order |
| `src/server.ts:44` MCP `search_docs` schema | `tipo: z.enum(TIPOS)` bakes the closed enum into the **MCP tool contract itself** — the biggest single contract-breaking point | MCP tool schemas are registered once per server connection (static); a project-specific enum can't be dynamically injected without redesigning tool registration — effectively forces `tipo` to become an open `z.string()` |
| `src/cli.ts:171-177` `parseTipo` | `process.exit(2)` on any value outside `TIPOS` — needs to become permissive/warn-only | Same |
| `src/infrastructure/config.ts` `CompendioConfig`, `DEFAULT_CONFIG` | Has full location flexibility (`docsDir`, `exclude`, `db`) already, i.e. zero-config-for-location already works; **zero schema for a convention/taxonomy override** — this is the extension point | `search.estadosExcluidos: Estado[]` is typed to the closed union |
| `src/composition.ts` | No direct coupling — wires whichever config/validator is used; unaffected structurally | — |
| `docs/convencion-documentacion.md` (repo's own, only file under `docs/`) + `README.md` | Both document the closed convention as the *only* onboarding path — need rewriting to present convention as optional/progressive | Same |
| `ejemplos/` corpus + `ejemplos/goldenset.yaml` | Corpus follows the old convention fully; `EvaluateSearch`/`evaluate-search.ts` only compares `ruta` strings — **not coupled** to tipo/estado shape at all, low risk | Same — goldenset stays valid regardless |
| Tests: `test/domain/frontmatter.test.ts`, `test/infrastructure/sqlite-index-store.test.ts` (`meta()` helper), `test/application/index-and-search.test.ts`, `generate-index-md.test.ts`, `get-overview.test.ts` (all assert exact per-tipo counts over the 11-doc `ejemplos/` corpus), `test/domain/index-markdown.test.ts` (asserts `TIPOS`-order sorting) | All need rewriting/extension for optional-field scenarios | Taxonomy-specific assertions (closed-list rejection messages) need reframing as "configured taxonomy" tests |

## Inference design space

- **titulo**: already inferred from H1 by the parser regardless of frontmatter. Needs a new fallback to a humanized filename when no H1 exists (new, small).
- **resumen**: already inferred from the first paragraph after H1 (or after doc start if no H1); already has a "fall back to titulo when empty" behavior (`displayResumen`). Needs no new inference work, just needs to stop being gated by the other required fields.
- **modulo**: **not currently inferred at all** — comes only from frontmatter today. Candidate: first path segment under `docsDir`. Product conflict: today the folder segment (`funcional/`, `adr/`, ...) maps to **`tipo`**, not `modulo` — `modulo` is a business concept (`leadsviewer`, `informes`) with no natural folder equivalent in a generic project. This needs an explicit product decision (see Risks).
- **tipo**: today closed-list AND folder-derived by convention. In zero-config mode, becomes optional/absent; `docs_overview` needs a defined behavior for a corpus with no `tipo` anywhere (omit `porTipo` entirely, or bucket as "sin tipo").
- **estado**: no generic signal to infer from arbitrary markdown content — nothing marks a random `.md` file as draft vs current. Default should be "no state = always included," which directly changes the meaning of `incluir_no_vigentes` (see Contract impact).
- **etiquetas**: already safe — `validateFrontmatter` treats an absent `etiquetas` as `[]`, no change needed.

## Config design space

Two extension shapes for `compendio.config.json`, both keeping "nothing" or `docsDir`-only as the minimal config (already true today via `DEFAULT_CONFIG`):

1. **Nested `convencion` block**: `{ convencion: { modo: "estricto"|"libre", tipos?: string[], estados?: string[], camposFrontmatter?: { tipo: "type", ... } } }`. Pros: groups all convention concerns, one flag (`modo`) can fully preserve today's behavior for opted-in projects. Cons: one more level of nesting to document.
2. **Flat top-level keys** alongside `docsDir`/`exclude`/`chunk`/`search`: `tiposPermitidos?`, `estadosPermitidos?`, `mapeoFrontmatter?`. Pros: simpler to write inline. Cons: crowds the top-level schema and has no single toggle for "strict vs lenient" — every consumer has to infer strictness from "are these arrays present."

Recommendation leans toward shape 1 (nested block with an explicit `modo` toggle) — cleaner mental model, and `sdd-propose`/`sdd-spec` can scope it as one additive config surface.

## Contract impact

- `search_docs` `tipo` param (`z.enum(TIPOS)`) must become an open `z.string().optional()` — MCP tool schemas are registered once per stdio connection and can't be dynamically re-scoped per project's configured taxonomy, so this is a forced, not optional, contract change.
- `incluir_no_vigentes` loses universal meaning without a fixed `ESTADOS` taxonomy. Two viable redefinitions: (a) it stays meaningful only when a project's config declares an `estadosExcluidos`-equivalent list (behaves exactly as today, just becomes config-driven rather than hardcoded); when no such config exists, the flag is a no-op and every doc counts as included. (b) generalize to an open "excluir por estado" list. Needs the user's product call before spec.
- CLI `--tipo`/`--todos` flags: `--tipo` validation (`parseTipo`, hard `process.exit(2)`) must relax to accept any string (or warn, not fail) since values aren't statically known project-to-project.
- `DocumentMeta.tipo`/`estado` move from closed TypeScript unions to `string | undefined` — this is a type-level ripple through every listed consumer, not just a runtime behavior change.

## Test/eval impact

- Confirmed **the SQLite DB is fully disposable, no migration needed**: `IndexDocuments.execute()` calls `this.store.reset()` unconditionally at the start of every `compendio index` run (`index-documents.ts:66`), and `.compendio/` is a local, gitignored artifact per the README. Schema changes (making `tipo`/`modulo`/`estado` columns nullable) only require users to re-run `compendio index`.
- EvaluateSearch/goldenset are **not coupled** to the frontmatter shape — safe as-is, low risk, no rewrite needed there.
- Tests needing rewrite/extension: `frontmatter.test.ts` (closed-list rejection assertions need reframing as "configured taxonomy" tests), `sqlite-index-store.test.ts`'s `meta()` helper (needs an optional-friendly variant), `index-and-search.test.ts` / `generate-index-md.test.ts` / `get-overview.test.ts` (all assert exact per-tipo counts against the fully-conventioned 11-doc `ejemplos/` corpus — decide whether `ejemplos/` remains the "fully configured" example and a **new** zero-config fixture corpus is added, or whether `ejemplos/` itself gets a zero-config sibling), `index-markdown.test.ts` (TIPOS-order assertions need a new default ordering path).

## Approaches

1. **Everything optional, inference-first, config-as-overlay** — `tipo`/`modulo`/`estado` become always-optional on `DocumentMeta`; `validateFrontmatter` becomes an inference function that essentially never hard-fails; an optional `convencion` config block re-enables strict validation only when declared.
   - Pros: single code path, matches "zero-config on any project" most directly.
   - Cons: `validateFrontmatter`'s branching logic (strict vs lenient) lives in one function, which can get messy; still requires touching every consumer listed above.
   - Effort: High.

2. **Config-first strict/libre switch** — add `convencion.modo: "estricto" | "libre"`. `estricto` mode preserves 100% of today's behavior (closed lists, hard gate) for projects that opt in via config; `libre` (default, no config) does full inference and never hard-fails.
   - Pros: today's behavior is fully preserved as an explicit, testable mode — lower regression risk for the existing `ejemplos/` corpus/tests; smaller conceptual diff per path.
   - Cons: two branches to maintain and test long-term.
   - Effort: Medium-High.

3. **Field-mapping only, no fixed vocabulary anywhere** — `convencion` lets a project remap arbitrary frontmatter field names/values (`{ tipoField: "type", tipoValues: [...] }`); if unset, `tipo` isn't a first-class concept at all for that project (e.g., `docs_overview` simply omits `porTipo`). `SearchFilters` would need to become a generic key-value filter instead of a typed `tipo`/`modulo` pair.
   - Pros: most flexible, most fully realizes "the user of each project decides how much convention to apply."
   - Cons: biggest lift — effectively redesigns `SearchFilters`/MCP `search_docs` params away from typed fields.
   - Effort: High+.

## Recommendation

**Approach 2** (config-first strict/libre switch), borrowing the "open string, not fully generic key-value" scope limit from Approach 1 for `tipo`/`estado`: keep `DocumentMeta.tipo?`/`estado?` as optional open strings (not a fully dynamic metadata bag), gated by an explicit `convencion.modo` config flag. This bounds the blast radius to relaxations (nullable columns, optional-safe formatting, open MCP string params) rather than a full `SearchFilters` redesign, while still satisfying zero-config-on-any-project and progressive per-project convention. The two biggest **product** decisions to resolve before `sdd-propose`/`sdd-spec` are `modulo` inference source (folder segment collides with today's folder-is-`tipo` convention) and the redefinition of `incluir_no_vigentes`/`estadosExcluidos` semantics without a universal `estado` taxonomy.

## Risks

- `modulo` inference source conflicts with the existing folder-is-`tipo` convention — needs explicit user decision, not an inferred default.
- MCP tool schemas are static per connection: `tipo`/possibly `etiquetas` params must become open strings for every project, permanently losing enum-based client-side autocomplete/validation — worth flagging as an accepted tradeoff, not silently absorbed.
- `INDEX.md` ordering (`compareEntries`, `TIPOS.indexOf`) needs a new default (likely alphabetical-by-`ruta`) once `tipo` is open/absent — a visible, user-facing formatting change.
- `ejemplos/` corpus currently serves as the single example/test fixture; this change likely needs a **second**, zero-config fixture corpus, doubling fixture maintenance — or an explicit decision to keep `ejemplos/` as the "fully-configured" example and only unit-test zero-config paths with synthetic fixtures.
- `docs/convencion-documentacion.md` and `README.md` need substantial rewrites to present the convention as optional/progressive rather than the only path — non-trivial doc-writing effort, not just code.
- Given the explicit no-backward-compatibility mandate and the breadth of coupling (domain model, 2 use-case validation gates, SQLite schema, MCP/CLI contract, config schema, docs, and ~7 test files), this is very likely to exceed the 400-changed-line PR review budget as a single PR — `sdd-tasks` should plan chained/stacked slices (e.g., domain+validation → SQLite schema → MCP/CLI contract → docs/fixtures/tests).

## Ready for Proposal

**Yes** — investigation is complete and no further exploration is needed to start `sdd-propose`. Open questions for the user to confirm during/before spec: (1) `modulo` inference source, (2) redefinition of `incluir_no_vigentes`/state-exclusion semantics, (3) whether `ejemplos/` gets a zero-config sibling fixture or stays single-purpose.
