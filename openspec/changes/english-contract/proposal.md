# Proposal: English Contract — retire the Spanish surface

Compendio's entire symbol and contract surface moves to English: TypeScript identifiers, the MCP
tool parameters and response fields, CLI flags and help text, user-facing runtime strings, SQLite
column names, config keys, and the default frontmatter field names. The `ejemplos/` corpus and
`goldenset.yaml` stay Spanish by design — they are the retrieval regression suite and the standing
proof that an English codebase indexes Spanish documentation. This is a rename, not a redesign: no
behavior changes, no new capability, and the `eval` metrics must land on exactly the numbers they
produce today.

## Why now

Be honest about the driver: **this is an adoption decision, not a technical-quality one.** Retrieval
works identically in both languages today, and it will work identically after the change. Nothing is
broken. The Spanish contract is not slow, not buggy, and not a maintenance burden in itself.

What it *is* is an audience filter. Every English-speaking developer who opens `search_docs({ query,
tipo, modulo, etiquetas, incluir_no_vigentes })` has to learn a vocabulary before they can use a
tool whose whole promise is zero friction. An MCP server's parameter names are its user interface;
a Spanish interface silently narrows who will adopt it, and `README.md` currently sells that
narrowing as a feature.

The reason to act **now** rather than later is timing, not urgency: compendio is in beta with zero
installed users. Right now this rename costs a branch and an afternoon. After the first real
installs it costs migrations, deprecation aliases, schema markers, and a compatibility window that
would outlive its usefulness. Beta is the last moment breaking the contract is free.

## Intent (success looks like)

- A developer who has never seen the project can read `server.ts`, `cli.ts --help`, and the config
  reference without a translation step.
- `npm run typecheck` and `npm test` are green, and `npm run build` succeeds.
- `node dist/cli.js --root ejemplos eval` reports **the same recall@k and MRR as the pre-change
  baseline** — not "close", identical.
- No Spanish identifier, config key, SQL column, wire field, or user-facing string survives outside
  the declared frozen boundary.
- No migration code, no schema version marker, no deprecation alias exists anywhere in the result.

## Scope (in this change)

| Group | What changes |
|---|---|
| Domain identifiers | `model.ts`, `ports.ts`, `convencion.ts` (file renamed to `convention.ts`), `frontmatter.ts`, `index-markdown.ts`, `chunking.ts`, `outline.ts`, `metrics.ts` — every field, type, and function name |
| Application identifiers | All 7 use cases: query/report/result shapes, discriminant literals, parameter names |
| Infrastructure identifiers | Adapters, row shapes (`DocumentRow`/`ChunkRow`) and their mapping functions |
| SQLite schema | `documents` and `chunks` column names, the `chunks_fts` virtual table columns, and every prepared statement that names them |
| MCP wire contract | Zod schema keys (`snake_case` preserved on wire params), plus re-authored English `title`/`description` prose on all three `registerTool` calls |
| CLI | Flags (`--tipo`/`--modulo`/`--etiquetas`/`--todos`/`--lexico`/`--dir`), command descriptions, and all console output |
| Config surface | `convencion`→`convention`, `modo`→`mode`, `libre`/`estricto`→`loose`/`strict`, `camposFrontmatter`→`frontmatterFields`, `estadosExcluidos`→`excludedStatuses`, and the default frontmatter source keys |
| Test fixtures | `test/fixtures/estricto/` → `test/fixtures/strict/`, fully translated (keys **and** taxonomy values); `test/helpers/build.ts` identifiers |
| `ejemplos/` frontmatter keys | Exactly 3 lines — see resolved decision 1 |
| Specs and docs | `openspec/specs/*.md`, `README.md`, `CLAUDE.md`, `docs/` |

The naming map, including the gaps found during exploration, is already enumerated in
`exploration.md` sections 1a–1f. It is not repeated here; `sdd-tasks` should consume it from there.

## Non-goals (the frozen boundary)

These stay Spanish. Each one is frozen for a *stated reason*, not by inertia — if the reason does
not apply, the thing is in scope.

| Frozen | Why |
|---|---|
| All prose in `ejemplos/docs/**` | It **is** the retrieval corpus. Translating it destroys the multilingual evidence and invalidates the eval baseline. |
| All frontmatter **values** in `ejemplos/` (`borrador`, `obsoleto`, `[lead, importacion, csv, lote]`) | They flow into `INDEX.md` rendering and back live test assertions. Values are corpus data; only keys are plumbing. |
| `ejemplos/goldenset.yaml` | The 22 questions and their expected paths are the regression baseline. Untouched, keys included. |
| The `"pregunta"` / `"esperado"` string literals in the `cli.ts` goldenset loader (`cli.ts:201-202`) | They index into a frozen file's real keys. The surrounding local variables rename; these two literals cannot. |
| `CONCEPT_STEMS` **values** in `test/helpers/fake-embeddings.ts` (`"duplicad"`, `"autenticacion"`, …) | Spanish word stems tuned to the frozen corpus vocabulary. They are test data, not identifiers. Its class and parameter names do rename. |
| MCP tool **names** (`docs_overview`, `search_docs`, `read_doc`) | Already English. Nothing to do. |
| Retrieval behavior: embeddings model, FTS5 tokenizer config, RRF fusion math, chunking rules | Language-orthogonal. Any diff here is a bug in this change. |

Also explicitly out of scope, per `openspec/config.yaml` rules: **no migrations, no compatibility
shims, no schema version markers, no deprecation aliases.** Breaking every existing config file and
`.compendio/` database is the accepted cost of doing this in beta, reaffirmed 2026-07-25.

## Why behavior preservation is structural, not hopeful

The claim "the eval metrics will not move" does not rest on running the eval and seeing green. It
rests on two verified properties of the code:

1. **Frontmatter never reaches the index.** `RemarkMarkdownParser.parse` calls `matter(raw)` and
   destructures `{ data, content }` (`remark-markdown-parser.ts:26`). Only `content` is chunked and
   embedded. A frontmatter *key* is stripped before anything retrievable is produced.
2. **The lexical leg has no stemmer.** `chunks_fts` uses `tokenize='unicode61 remove_diacritics 2'`
   — a Unicode word-boundary tokenizer with no language model. Column *names* are schema metadata;
   they are never tokenized.

Add that `EvaluateSearch.execute` calls `search.execute({ query, k, forzarLexico })` with **no
metadata filters at all** (`evaluate-search.ts:43-47`), and the conclusion is structural: the
renamed surface is disjoint from every input the ranking sees. The eval run is a *check on the
reasoning*, not the reasoning itself — which is exactly why it is worth running.

## Approach: sequence by symbol group, not by layer

The layering is clean (`domain` ← `infrastructure`/`application` ← `composition` ← `cli`/`server`,
verified in `exploration.md` section 3), and it is a correct *blast-radius* map. It is **not** a
viable commit sequence.

The reason is the no-shims constraint. Renaming `DocumentMeta.ruta` breaks domain, infrastructure,
application, and test compilation in the same instant, and the usual escape hatch — keep both names
briefly, migrate consumers layer by layer, drop the old one — is forbidden here. **A domain field
rename is inherently a whole-program edit.** There is no intermediate state with a green build.

So the unit of work is the symbol/concept group, applied project-wide with type-checker-verified
rename-symbol tooling, never with textual find-replace:

1. **Path-identifying fields** — `ruta`→`path`, `seccion`→`section`, `encabezado`→`heading`.
2. **Taxonomy fields** — `tipo`/`modulo`/`estado`/`etiquetas` **together with** their plural and
   deny-list compounds (`tipos`, `estados`, `estadosExcluidos`). Grouped deliberately: these are the
   prefix-collision hazards, and splitting them is what would produce `statuss` or `statusExcluidos`.
3. **Content/structural fields** — `contenido`→`content` (gated by the FTS5 spike),
   `orden`→`position`, `resumen`→`summary`, `titulo`→`title`.
4. **Report/response fields** — `omitidos`→`skipped`, `indexados`→`indexed`, `eliminados`→`deleted`,
   `avisoEmbeddings`→`embeddingsWarning`, and the eval fields.
5. **Config surface** — including deleting `warnIfLegacyEstadosExcluidos`.
6. **Public wire contract, atomically** — MCP Zod keys and tool descriptions, CLI flags and help,
   SQL DDL column names landing in the same commit as the `DocumentRow`/`ChunkRow` mappers.
7. **Specs and docs last** — zero compile dependency, so this is the one part where "layers last"
   holds exactly.

Group boundaries are the commit boundaries. **A group is never split across commits**, because a
half-applied group is a red build with no meaningful review value.

## Binding decisions

Resolved before this proposal. These are inputs, not open questions.

| # | Decision | Rationale |
|---|---|---|
| 1 | **`ejemplos/` frontmatter: translate the 3 KEYS only.** `estado:`→`status:` in `informes/plan-pruebas.md` and `transversal/adr-0001-eleccion-mongodb.md`; `etiquetas:`→`tags:` in `leadsviewer/importacion-csv.md`. Three lines. All values, all prose and `goldenset.yaml` untouched; **no `compendio.config.json` added to `ejemplos/`.** | Frontmatter keys are stripped before indexing (see above), so this cannot move retrieval *by construction*. The freeze protects the Spanish retrieval corpus and its baseline — metadata plumbing discarded before the index is outside what it protects. Preserves what the alternatives would cost: the zero-config demonstration survives (the `CLAUDE.md` invariant that `ejemplos/` ships with no config file), `ejemplos/docs/INDEX.md` stays byte-identical because `formatDocLine` reads unchanged values, and zero test assertions need rewriting because they target values and TS fields, not frontmatter keys. It also fixes `etiquetas`, which a `frontmatterFields` mapping could not — `resolveEtiquetas` hardcodes that key. |
| 2 | **`orden` → `position`**, in both the TS domain field and the physical SQLite column. | `order` is a SQLite reserved word: `ORDER BY order` is invalid unquoted, and the code does exactly that in `getChunksByDocument`. `position` is unreserved, and it already matches the field's own JSDoc — *"Position of the chunk within the document"* (`model.ts:33`). Keeping the TS field and the column textually identical avoids a second mapping asymmetry in `toChunk`. |
| 3 | **The `contenido`→`content` FTS5 spike is a blocking prerequisite** for group 3. An isolated unit test must create `fts5(content, heading, content=chunks, content_rowid=id, tokenize=…)`, insert, run a `MATCH` query, and exercise the FTS5 `'delete'` command form before the rename lands. | The rename puts a bare column literally named `content` in the same argument list as the `content=` option. SQLite's grammar distinguishes them by the `=`, so it is *probably* fine — but "probably" is not a basis for renaming the highest-blast-radius file in the project. **Documented fallback:** if the spike fails, name the physical column `body` and keep the TS field `content`; the `toChunk` mapper already exists to absorb that asymmetry. |
| 4 | **`test/fixtures/estricto/` → `test/fixtures/strict/`, keys AND taxonomy values translated** (`"funcional"`→`"functional"`, `"guia"`→`"guide"`, `"borrador"`→`"draft"`, `"vigente"`→`"current"`, `"obsoleto"`→`"deprecated"`). Fixture filenames, frontmatter and prose all become English. | This is a synthetic fixture whose only job is exercising the declared-taxonomy mechanism under `strict` mode. It is not a corpus, has no eval baseline, and proves nothing about multilingual retrieval — the `ejemplos/` exception does not extend to it. Leaving Spanish values in an English fixture would only invite a reader to mistake them for a contract. **Dependency:** `CONCEPT_STEMS` must be re-validated against the translated fixture, since its Spanish stems stay only where they match the frozen `ejemplos/` corpus. |
| 5 | **Delete `warnIfLegacyEstadosExcluidos` and its `config.test.ts` coverage.** | It warns-and-ignores the retired `search.estadosExcluidos` key. Translating it would produce a warning about an English key that never shipped under any version — dead code guarding a state that cannot exist. Under the no-shims policy the honest move is deletion, not translation. |

## Impact / blast radius

| Spec domain | Touched? | Why |
|---|---|---|
| `mcp-contract` | **Yes** | Every tool param and response field is renamed; tool descriptions are re-authored. Behavior identical. |
| `configuration` | **Yes** | Every config key renamed; default frontmatter source keys change; the retired-key warning is deleted. |
| `indexing` | **Yes** | SQLite column names and report field names. Indexing *semantics* unchanged. |
| `search` | **Yes** | Filter param names, `SearchMode` values (`hibrido`/`lexico`), response field names. Ranking math untouched. |
| `index-md` | **Yes** | `INDEX.md` header/notice string constants and entry-rendering identifiers. Ordering rules unchanged. |

All five spec files are touched. Every delta is vocabulary; none is a requirement change. Per the
archive rule in `openspec/config.yaml`, `openspec/specs/` must carry no residual Spanish contract
vocabulary afterwards, except where it quotes the `ejemplos/` corpus.

## Verification strategy

**Capture the baseline BEFORE the first rename commit.** Run `node dist/cli.js --root ejemplos eval`
on the current `main` build and record recall@k and MRR for both `hibrido` and `lexico` modes. There
is no way to reconstruct this number after the fact from a renamed tree.

| When | Gate |
|---|---|
| Before group 3 | The FTS5 spike test passes (decision 3), or the `body` fallback is adopted |
| After **every** symbol group | `npm run typecheck` **and** `npm test` green — no group lands red |
| Before delivery | `npm run build` succeeds |
| Final | `node dist/cli.js --root ejemplos eval` recall@k and MRR **match the captured baseline exactly** |
| Final | `ejemplos/docs/INDEX.md` is unchanged in `git diff` — a diff here means decision 1 broke something |
| Final | Repo-wide grep finds no `ruta`/`tipo`/`modulo`/`estado`/`etiquetas`/`seccion`/`omitidos`/`indexados`/`avisoEmbeddings`/`convencion`/`estadosExcluidos`/`camposFrontmatter` outside the frozen boundary |

A moved eval metric is not a tolerance to negotiate — it is a defect signal meaning something
retrieval-relevant was renamed, and it blocks delivery.

## Delivery

**One PR, `size:exception` accepted by the user in advance.** Slicing this across PRs is not
available: the no-shims constraint means every intermediate PR after group 1 would ship a red build.

What makes it reviewable instead is commit structure — **one commit per symbol group**, each one
green and each one telling a single story ("rename the taxonomy fields"). Reviewers read commits,
not the squashed diff. Group 6 (the wire contract) is the commit to review first; it is the only one
with externally visible consequences.

Given the diff size and the config/schema surface, the pre-PR review should be the full 4R fan-out
(`review-risk`, `review-resilience`, `review-readability`, `review-reliability`).

## Risks and mitigations

Carried forward from `exploration.md` section 6, unchanged in severity.

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | **High** | `contenido`→`content` collides with the FTS5 `content=` external-content option — unverified | Blocking spike before group 3 (decision 3); documented `body` fallback |
| 2 | **High** | `orden`→`order` is a SQLite reserved keyword | Resolved: `position` (decision 2). No implementation-time choice remains |
| 3 | Medium | Naive find-replace corrupts compound identifiers (`estadosExcluidos`→`statusExcluidos`, `estados`→`statuss`, `secciones`→`sectiones`, `seccionesDisponibles`) | Type-checker-verified rename-symbol only; singular and plural renamed in the same group |
| 4 | Medium | A partially applied group leaves the build red (whole-program rename, no shims) | Group boundary = commit boundary; `typecheck` + `test` gate after each; never split a group |
| 5 | Medium | `modo`→`mode` and `modulo`→`module` become adjacent lookalikes for unrelated concepts | Human-attention risk, not a tooling one (the substring collision was checked and is false). Flag explicitly for the reviewer on group 2 |
| 6 | Low | MCP tool descriptions and CLI help need re-authoring as English prose, not word-swapping | Budget writing time in `sdd-tasks`; these are not mechanical lines |
| 7 | Low | `README.md:232` sells the Spanish contract as a differentiator; that pitch inverts | Content rewrite task in group 7, separate from the mechanical count |
| 8 | Low | `warnIfLegacyEstadosExcluidos` becomes dead weight | Resolved: deleted with its coverage (decision 5) |

## Rollback plan

Rollback is trivial by construction, because this change produces **no durable artifact that
outlives the code**.

1. **Code** — `refactor/english-contract` is a disposable branch. Delete it, or revert the merge
   commit. There is no partial-adoption state to unwind: no feature flag, no dual-name period.
2. **Databases** — `.compendio/*.db` is a derived cache, regenerated wholesale by `compendio index`
   (whose `reset()` is a single-transaction drop-and-recreate). A database written by the renamed
   schema is simply discarded by re-running `index` on the reverted code. Nothing persists across
   the change.
3. **`ejemplos/`** — three frontmatter key lines, reverted by the same `git revert`. Values, prose,
   `goldenset.yaml` and `INDEX.md` were never touched, so there is nothing else to restore.
4. **User configs** — none exist. Beta, zero installed users; that is the premise the whole change
   is built on.

No data migration, no manual `.compendio/` deletion, no downgrade tooling. Revert the code and run
`compendio index` once.
