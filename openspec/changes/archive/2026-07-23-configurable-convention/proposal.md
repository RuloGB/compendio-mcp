# Proposal: Configurable documentation convention (zero-config on any repo + optional per-project convention)

Compendio today only indexes repositories that already follow one fixed convention: every `.md` file must carry frontmatter with a non-empty `tipo`/`modulo`/`estado`, using values from closed lists (`TIPOS`, `ESTADOS`). Files that don't comply are silently skipped and reported in `omitidos`. This proposal retires that hard requirement so Compendio can index **any project that contains `.md` files with zero configuration** (fields inferred, no frontmatter required), while letting a project opt back into strict validation through an optional `convencion` block in `compendio.config.json`. Spanish stays the product language; there is no backward-compatibility obligation with the old convention (user decision, 2026-07-22).

## Why now

- **Adoption is gated by the convention.** The pitch is "point Compendio at your docs and search them." Today a new user must first restructure their docs and add frontmatter to every file before a single result appears — the opposite of zero-config. The fixed convention is the single biggest barrier between "install" and "first useful search."
- **The inference groundwork already exists.** The markdown parser already extracts `titulo` (first H1) and `resumen` (first paragraph) independently of frontmatter. Only `validateFrontmatter`'s hard requirement for `tipo`/`modulo`/`estado` blocks frontmatter-less files. The gap is a policy gap, not a missing capability.
- **The convention is valuable, not wrong — just mandatory.** Teams that DO maintain a taxonomy still want it enforced (linter-style). The goal is to make convention *optional and progressive*, not to delete it.

## Outcomes (what success looks like)

- Running `compendio index` against any folder of `.md` files (no `compendio.config.json`, no frontmatter) indexes every readable file and returns search results — nothing is skipped for lacking frontmatter.
- `tipo`, `modulo`, and `estado` are inferred or simply absent when there is no signal; search, overview, read, and INDEX.md all behave sensibly with those fields missing.
- A project can declare a `convencion` block to (a) turn on strict validation (`modo: "estricto"`, current behavior), (b) declare its own `tipos`/`estados` taxonomies, (c) map non-standard frontmatter field names, and (d) declare which `estados` are excluded from search.
- The `ejemplos/` corpus demonstrates the zero-config story as the primary example; the full-convention case survives as a secondary synthetic fixture.

## Scope

### In scope

| Area | Change |
|------|--------|
| Domain model | `tipo`, `modulo`, `estado` become **optional open strings** on `DocumentMeta` (`string \| undefined`), not closed unions. `SearchFilters.tipo` and `.estados` follow. |
| Validation gate | `validateFrontmatter` splits into two policies driven by `convencion.modo`: `libre` (default) infers/relaxes and never hard-fails for missing/unknown fields; `estricto` reproduces today's closed-list validation against the project's declared taxonomies (invalid files → `omitidos`). |
| Inference (`libre`) | `titulo` falls back to a humanized filename when no H1. `modulo` inferred from the first path segment under `docsDir`. `tipo`/`estado` left absent when no frontmatter/mapping supplies them. Frontmatter (or a configured field mapping) always wins over inference. |
| Config surface | New optional `convencion` block in `compendio.config.json` (Spanish keys — see below). Empty config or `docsDir`-only must keep working. |
| Persistence | SQLite `tipo`/`modulo`/`estado` columns become nullable. No migration tooling — the index is disposable and rebuilt on every `index` run. |
| Contract | MCP `search_docs.tipo` becomes an open optional string; CLI `--tipo` validation relaxes to warn-not-fail; `docs_overview`, `read_doc`, and INDEX.md handle absent fields. |
| Docs & fixtures | Rewrite `README.md` and `docs/convencion-documentacion.md` to present convention as optional/progressive; rework `ejemplos/` as the zero-config corpus and add a secondary full-convention fixture. |

### Non-goals (explicitly out)

- **Generic key-value metadata bag.** `tipo`/`modulo`/`estado` stay first-class named fields (now optional). We are NOT redesigning `DocumentMeta`/`SearchFilters` into an arbitrary metadata map.
- **Dynamic per-project MCP enums.** MCP tool schemas are registered once per stdio connection and cannot be re-scoped per project's taxonomy. `search_docs.tipo` becomes a plain open string for everyone — we will not attempt per-connection enum injection.
- **DB migrations / schema versioning.** `IndexDocuments.execute()` calls `store.reset()` at the start of every run and `.compendio/` is a gitignored local artifact. Nullable columns take effect on the next `index`; no upgrade path is built.
- **Backward-compatibility shim** for the old fixed convention. Retired outright by user decision; strict behavior is reachable only via `convencion.modo: "estricto"`.
- **Full generic frontmatter remapping of every field.** Field mapping covers the three convention fields (`tipo`/`modulo`/`estado`); it is not a general-purpose frontmatter transformer.

## Approach (recommended)

**Config-first `estricto`/`libre` switch, with an open-string (not generic key-value) scope limit** — Approach 2 from the exploration, bounded by Approach 1's scope limit. Endorsed working direction.

- Add `convencion.modo: "estricto" | "libre"`. No config → `libre`.
- `libre`: inference-first. `validateFrontmatter` becomes a resolver that fills fields where it can and never hard-fails for missing/unknown `tipo`/`modulo`/`estado`. Only genuinely unreadable/unparseable files are reported in `omitidos`.
- `estricto`: reproduces today's linter behavior, but validates against the **project's declared** `tipos`/`estados` taxonomies instead of the hardcoded `TIPOS`/`ESTADOS`. Invalid files → `omitidos`.
- `DocumentMeta.tipo?`/`modulo?`/`estado?` become optional open `string`s — bounded blast radius (nullable columns, optional-safe formatting, open MCP string params) rather than a `SearchFilters` redesign.

**Rationale.** This preserves today's behavior as an explicit, testable mode (low regression risk for teams that keep a taxonomy), gives the shortest path to zero-config on any repo, and keeps the type-level ripple to "make three fields optional" instead of "make metadata generic." The single validation choke point (`validateFrontmatter`, called by both `index-documents.ts` and `generate-index-md.ts`) means the strict/libre branch lives in one place.

## Config surface: the `convencion` block

All keys Spanish, consistent with the existing contract. The whole block is optional; every field inside is optional.

```jsonc
{
  "docsDir": "docs",
  "convencion": {
    "modo": "libre",                                  // "libre" (default) | "estricto"
    "tipos": ["funcional", "adr", "api", "qa", "guia"], // allowed tipo values; enforced only in "estricto"
    "estados": ["borrador", "vigente", "obsoleto"],     // allowed estado values; enforced only in "estricto"
    "estadosExcluidos": ["borrador", "obsoleto"],       // estados hidden from search unless incluir_no_vigentes
    "camposFrontmatter": {                              // remap non-standard frontmatter field names
      "tipo": "type",
      "modulo": "module",
      "estado": "status"
    }
  }
}
```

**Minimal-config guarantee.** `{}`, no file at all, or `{ "docsDir": "documentation" }` must index every readable `.md` file. Defaults: `modo: "libre"`, no taxonomies enforced, `estadosExcluidos: []` (nothing excluded — `incluir_no_vigentes` becomes a no-op).

**Reproducing today's behavior** is an explicit opt-in:

```jsonc
{ "convencion": {
    "modo": "estricto",
    "tipos": ["funcional", "adr", "api", "qa", "guia"],
    "estados": ["borrador", "vigente", "obsoleto"],
    "estadosExcluidos": ["borrador", "obsoleto"]
} }
```

**Placement decision (flagged):** `estadosExcluidos` exists today as `search.estadosExcluidos`. This proposal recommends **moving** it into `convencion` so all taxonomy concerns live together. Since there is no backward-compat obligation, the old `search.estadosExcluidos` key is retired rather than dual-supported. Alternative (keep it under `search`) is listed in the question round.

## Contract changes and blast radius

| Surface | Change | Blast radius / visible effect |
|---------|--------|-------------------------------|
| MCP `search_docs.tipo` | `z.enum(TIPOS)` → `z.string().optional()` | **Contract-breaking, forced.** Clients permanently lose enum autocomplete/validation on `tipo`. Response fields keep Spanish names. |
| MCP `incluir_no_vigentes` | Meaning becomes config-driven | With no `estadosExcluidos` declared, the flag is a no-op (everything already included). With a declared list, it behaves exactly as today. |
| CLI `--tipo` (`parseTipo`) | `process.exit(2)` on unknown value → accept any string, warn only | Scripts passing arbitrary `--tipo` no longer hard-fail. |
| `docs_overview` | Must handle a corpus with no `tipo`/`modulo` anywhere | Recommended: omit `porTipo`/`porModulo` buckets entirely when the corpus has no such values (rather than a synthetic "sin tipo" bucket). Flagged for confirmation. |
| `read_doc` `formatFrontmatter` | Render `tipo:`/`modulo:`/`estado:` lines conditionally | Absent fields simply don't appear in the rendered header. |
| INDEX.md `compareEntries` | `TIPOS.indexOf(...)` ordering breaks when `tipo` is open/absent | New default ordering: **alphabetical by `ruta`**. In `estricto` with declared `tipos`, order may follow the declared taxonomy. User-visible formatting change to generated `docs/INDEX.md`. |
| SQLite schema | `tipo`/`modulo`/`estado` columns → nullable; `buildFilterSql` unaffected (works on any string) | No migration; effective on next `index` run (`store.reset()`). |
| Domain types | `Tipo`/`Estado` closed unions retired from `DocumentMeta`/`SearchFilters`/`config.ts`; fields become `string \| undefined` | Compile-time ripple through every consumer listed in the exploration inventory. |

## Documentation and fixture impact

- **`README.md`**: lead with the zero-config path ("point at any folder of `.md` files, run `index`, search"); present the `convencion` block as an optional "if you maintain a taxonomy" section. Update the config reference table with the new block and the retired `search.estadosExcluidos`.
- **`docs/convencion-documentacion.md`**: reframe from "the required convention" to "an optional convention you can enforce with `modo: estricto`." Document inference rules (`titulo`/`modulo` sources) and the field-mapping option.
- **`ejemplos/` rework (decision 4)**: restructure from the current `tipo`-based folders into a plausible zero-config corpus (frontmatter-light, folders as modules), and update `ejemplos/goldenset.yaml` `ruta` values to the new paths. `EvaluateSearch` only compares `ruta` strings, so the goldenset stays structurally valid after the path updates.
- **Secondary fixture**: add a small synthetic full-convention corpus (frontmatter + declared taxonomy) to keep `estricto`-mode tests honest, so `ejemplos/` is no longer doing double duty.

## Rollback plan

- **Code**: the change is additive-then-relaxing behind the single `validateFrontmatter` choke point and the `convencion.modo` flag. Reverting the PR (or chained PR set) restores the fixed convention wholesale; no data migration to undo because the SQLite index is disposable and rebuilt on every `index` run.
- **Data/index**: no persistent state changes. Any user who reverts simply re-runs `compendio index`; nullable columns disappear when the schema is recreated.
- **Docs/fixtures**: `README.md`, `docs/convencion-documentacion.md`, `ejemplos/`, and `goldenset.yaml` are versioned — a git revert restores the prior corpus and docs together with the code.
- **Blast-radius containment**: because MCP schema and CLI parsing changes are the only externally observable contract shifts, a rollback is observable to clients as "the `tipo` enum returns," not as broken state.

## Risks and open decisions

- **PR size (carried from exploration).** Domain model + two validation gates + SQLite schema + MCP/CLI contract + config schema + docs + ~7 test files almost certainly exceeds the 400-changed-line review budget as one PR. **Expect `sdd-tasks` to plan chained slices** (e.g. domain+validation → SQLite schema → MCP/CLI contract → docs/fixtures/tests).
- **Permanent loss of MCP `tipo` enum.** Accepted tradeoff, not silently absorbed: static per-connection schemas force an open string; client-side autocomplete/validation on `tipo` is gone for every project.
- **INDEX.md ordering change** is user-visible: existing `docs/INDEX.md` files will re-sort (alphabetical by `ruta`) on the next `index-md` run.
- **`docs_overview` empty-taxonomy behavior** (omit buckets vs "sin tipo" bucket) is a product-facing UX call — see question round.
- **`estricto` with no declared taxonomy** is an edge case: if `modo: "estricto"` but `tipos`/`estados` are omitted, "validate against declared taxonomy" has nothing to validate against. Proposed default: fall back to accepting any non-empty value (presence-only validation) and document it; final rule deferred to spec.
- **Fixture double-maintenance**: two corpora (zero-config `ejemplos/` + synthetic full-convention) increase fixture upkeep — accepted per decision 4.

## Proposal question round

The four major product decisions (strictness toggle, `modulo` inference, `estado` semantics, fixture rework) are already user-confirmed in `state.yaml` and are treated as binding. The following are the **residual** product decisions this proposal made a recommendation on; they improve the PRD by resolving user-facing ambiguity before spec. The user may confirm, correct, skip, or request a second round.

1. **`estadosExcluidos` placement** — Proposal recommends moving it from `search.estadosExcluidos` into the new `convencion` block (co-located with the `estados` taxonomy), retiring the old key. Alternative: keep it under `search` to minimize the config diff. Which do you prefer?
2. **`docs_overview` with no taxonomy** — Proposal recommends **omitting** `porTipo`/`porModulo` entirely when the corpus has no such values, rather than showing a "sin tipo" catch-all bucket. Confirm, or prefer the bucket?
3. **INDEX.md default ordering** — Proposal recommends **alphabetical by `ruta`** in `libre` mode (declared-taxonomy order in `estricto`). Acceptable as the new default, given existing `INDEX.md` files will re-sort?
4. **`estricto` without declared taxonomies** — Proposal recommends presence-only validation (accept any non-empty value) as the fallback. Confirm, or should `estricto` require `tipos`/`estados` to be declared and error/warn otherwise?

Working assumption if unanswered: proceed with the recommended option in each of the four above, and flag them again at spec time.

## Next step

Proceed to `sdd-spec` and `sdd-design` (can run in parallel). Spec should encode inference rules, `libre`/`estricto` behavior, and the contract changes as Given/When/Then scenarios with RFC 2119 keywords; design should cover the config-driven convention resolution flow and keep `src/domain/` free of adapter dependencies.
