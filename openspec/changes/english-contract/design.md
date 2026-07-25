# Design: English Contract — a survivable whole-program rename

This change has no architecture to invent. Every binding product decision is already resolved in
`proposal.md`, and the layering is already correct. What the design owes is **survivability**: this is
a behavior-preserving rename with no compatibility shims, so the usual safety net — land it in small
pieces and keep the build green in between — is unavailable at the layer level. Renaming
`DocumentMeta.ruta` breaks domain, application, infrastructure and tests in the same instant.

So the design decides four things, in order of how much they protect:

1. **What the safety net actually is, and precisely where it is absent.** `tsc` covers identifiers.
   It does not cover SQL column strings, `as`-cast row shapes, config JSON keys, frontmatter source
   keys, or CLI flag strings — and two of those classes fail *silently*, not loudly. A third silent
   class has no runtime consequence at all: a leftover Spanish identifier compiles, behaves, and is
   self-consistent, so only a search can find it (Decision B).
2. **A safety-net-first commit** that lands two new regression tests against the still-Spanish tree,
   before any rename: the FTS5 external-content probe, and a strict-fixture config-effectiveness
   assertion that turns the loudest silent-degradation path into a red test.
3. **A corrected 11-commit sequence** — the proposal's seven groups, with one group split, one group
   added, and every group verified to be internally atomic with forward-only dependencies.
4. **A verification design that attributes deviations instead of absorbing them**, anchored on six
   structural invariants that must be diff-verifiable, with the eval run as the falsifier of last
   resort rather than the primary mechanism.

## Quick path

| Step | Action | Gate |
|---|---|---|
| 0 | Commit 1: land the FTS5 regression test + fixture-config assertion on the Spanish tree | `npm test` green **on `main`'s behavior** |
| 1 | Commits 2–6: rename identifiers, one symbol group each, longest-token-first | `npm run typecheck` then `npm test` after each |
| 2 | Commit 7: flip frontmatter source keys + the 3 `ejemplos/` lines together | + `index-md` on `ejemplos/` produces a byte-identical file |
| 3 | Commits 8–9: SQL schema, then the MCP/CLI wire surface | + `npm run build` |
| 4 | Commits 10–11: strict fixture translation, then specs and docs | + the case-insensitive residual sweeps (A and B) are clean |
| 5 | Final | Eval reproduces `eval-baseline.md` cell for cell |

## Goals / Non-Goals

- **Goals**: every group internally atomic and green; no Spanish identifier, config key, SQL column,
  wire field or user-facing string outside the frozen boundary; the eval baseline reproduced exactly;
  `src/domain/` purity preserved; a commit sequence a reviewer can actually read.
- **Non-goals**: any behavior change, any new capability, migrations, schema markers, deprecation
  aliases, retrofitting resilience or fixing the known lexical-mode eval failure. Reworking the
  layering. Translating `ejemplos/` prose, values, or `goldenset.yaml`.

---

## Architecture Decisions

### Decision A: The compiler is the safety net for identifiers — and for nothing else

**Choice**: renames are performed as type-checker-verified symbol renames, never as textual
find-replace, and every group is gated by `npm run typecheck` before `npm test`. But the design does
**not** treat `tsc` as a general safety net, because five classes of Spanish token are invisible to it,
and two of those fail silently:

| Unprotected class | Where | Failure mode if missed |
|---|---|---|
| SQL column names in DDL and statements | `sqlite-index-store.ts` (73 Spanish hits — the heaviest file) | **Loud** — `better-sqlite3` throws `Missing named parameter` / `no such column` |
| `as`-cast row shapes over `SELECT *` | `DocumentRow`, `ChunkRow`, `ChunkMissingVector`, the inline cast in `deleteDocumentRows` | **SILENT** — the cast is an unchecked assertion; the mapper yields `undefined` |
| Config keys read from JSON | `test/fixtures/estricto/compendio.config.json`, inline JSON in `config.test.ts` | **SILENT** — `mergeConfig` is a tolerant whitelist; an unrecognized key falls back to the default |
| Frontmatter source keys | `DEFAULT_CONFIG…frontmatterFields` values, `resolveEtiquetas`, `aplicarCamposOpcionales` | **SILENT** — an unread key just yields absent metadata; `libre` never complains |
| CLI flag strings and console output | `cli.ts`, asserted by `cli-subprocess.test.ts` | **Loud** — commander errors, or an assertion on stdout fails |

The two SILENT rows are the whole reason this design exists. Concrete examples that a green build
would not catch:

- `listChunksMissingVectors` selects `d.ruta AS ruta, c.encabezado AS encabezado, c.contenido AS
  contenido` and casts the result to the **domain port type** `ChunkMissingVector`. Renaming that
  port's fields without editing the SQL aliases compiles cleanly and returns `undefined` for every
  renamed field.
- `test/fixtures/estricto/compendio.config.json` declares `convencion.tipos/estados/estadosExcluidos`.
  Renaming those TS fields without editing the JSON silently drops the declared taxonomy: strict mode
  degrades to presence-only validation, all 5 fixture docs still validate, and
  `cli-subprocess.test.ts`'s existing assertions (`Indexados 5 documentos`, `guia-onboarding.md` found)
  still pass. **A whole config mechanism can stop working with a fully green suite.**

There is a **third silent class with no runtime consequence at all**: a Spanish identifier that is
simply never renamed. It compiles, behaves identically, and is self-consistent at every use site, so
`tsc` and the test suite are silent *by construction*. Nothing but a search can find it — which is
what makes Decision B's residual sweep the only completion criterion this change has, and why its
correctness matters more than any other verification in this document.

**Rationale**: naming the boundary between "the compiler will catch this" and "nothing will catch this"
is the single highest-leverage act of this design. Everything else — the safety-net-first commit, the
residual sweeps, the INDEX.md canary — exists to cover the second half.

**Alternatives considered**: trust `tsc` + `npm test` alone (rejected: demonstrably passes through all
three silent classes above); introduce a typed SQL layer or a schema-to-type generator (rejected: that
is a redesign, explicitly out of scope, and would be a far larger diff than the rename it guards).

### Decision B: The rename mechanism — case-insensitive root search, longest-token-first, `tsc`-gated

**Choice**: for each symbol in a group, in **descending token length**:

1. Enumerate occurrences with a **case-insensitive, substring** search on the Spanish root:
   `rg -i -n '<root>' src test` (plus `docs`, `README.md`, `CLAUDE.md`, `openspec/specs` for the docs
   group).
2. Apply exact-string edits per file. **Never** a repo-wide substitution, and never `sed`.
3. Run `npm run typecheck`. It is cheap enough to run per symbol, and it localizes the break.
4. Only after the whole group is applied, run `npm test`.

#### Why the search must be case-insensitive AND substring-based

Both properties are load-bearing, and **neither is sufficient alone**. Measured on the current tree:

```
$ rg -n 'convencion' src/domain/convencion.ts        →  1 hit
$ rg -i -n 'convencion' src/domain/convencion.ts     →  7 hits
```

That single case-sensitive hit is a doc comment. The file it lives in exports `ConvencionConfig`,
`ConvencionPolicy`, `crearConvencionPolicy`, `crearPoliticaLibre`, `crearPoliticaEstricta`,
`crearComparadorIndice`, `leerCampo`, `inferirModulo` and `humanizarNombreArchivo` — all commit-6
rename targets, none of them matched. The same blindness hides `Sincronizacion*` in `get-overview.ts`,
`EtiquetasResult`/`resolveEtiquetas` in `frontmatter.ts`, and every renamed constant
(`EJEMPLOS_CONVENCION`, `EJEMPLOS_DOCS`, `SIN_CHUNKING`, `TITULO_INDICE`, `AVISO_GENERADO`).

**Adding `-i` is necessary but not sufficient.** `-w` (whole word) cannot match `ConvencionConfig` or
`crearConvencionPolicy` at *any* casing, because `convencion` sits inside a single word bounded on both
sides by word characters. Word-bounded search is structurally incapable of seeing a Spanish root inside
camelCase, PascalCase, or SCREAMING_SNAKE_CASE — which is where most of this codebase's Spanish lives.

**Therefore every verification search in this document is `rg -i` on a Spanish *root*, without `-w`.**
Underscores are word characters too, so `SIN_CHUNKING` lowercases to `sin_chunking` and needs its own
root; that is handled explicitly in the root list below.

#### The longest-first ordering rule

Longest-first is what keeps the *edits* safe once the search has found everything. The prefix
collisions verified in `exploration.md` section 2 are only dangerous when the short token is renamed
first:

| Order | Result |
|---|---|
| `estado` → `status`, then `estados`/`estadosExcluidos` | corrupted: `statuss`, `statusExcluidos` |
| `estadosExcluidos` → `excludedStatuses`, then `estados` → `statuses`, then `estado` → `status` | correct |
| `seccionesDisponibles` → `availableSections`, then `secciones` → `sections`, then `seccion` → `section` | correct |
| `tipos` → `types`, then `tipo` → `type` | correct (do not rely on the coincidence that the naive order also works here) |

File and directory renames use `git mv` (`convencion.ts` → `convention.ts`,
`test/domain/convencion.test.ts` → `convention.test.ts`, `test/fixtures/estricto/` →
`test/fixtures/strict/`) so history follows the file.

**Alternatives considered**: IDE rename-symbol / `ts-morph` codemod (not rejected — preferred where
available; the procedure above is the executable floor when it is not, and it produces the same result
because `tsc` adjudicates). Repo-wide `sed` with word boundaries (rejected twice over: it cannot
distinguish `ConvencionConfig.modo` from `SearchResponse.modo`, two unrelated concepts that both become
`mode`, it silently rewrites frozen literals inside `ejemplos/`, and — per the measurement above — word
boundaries cannot even *find* the compound identifiers).

**Reviewer-attention flags** (tooling cannot help; call these out in the PR body):

- `mode` (search/index mode) and `module` (document module) become adjacent lookalikes. Verified
  *not* a substring collision — purely a human-attention risk.
- `ConvencionConfig.modo` and `SearchResponse.modo`/`IndexReport.modo` are distinct symbols that both
  target `mode`. They are renamed in different commits (6 and 5 respectively) precisely so the diffs
  stay separable.

### Decision C: Commit 1 installs the safety net before anything moves

**Choice**: the first commit contains **no rename at all**. It lands two new tests against the current
Spanish tree, both green on `main`'s behavior:

1. `test/infrastructure/fts5-external-content.test.ts` — the FTS5 probe (Decision D).
2. A strict-fixture config-effectiveness assertion appended to `cli-subprocess.test.ts`.

The second one is a six-line addition using only existing capability. The fixture declares
`estadosExcluidos: ["borrador", "obsoleto"]` and ships `plan-pruebas-alertas.md` in `borrador`
specifically to exercise the deny-list, but **no subprocess test currently observes that**. Add:

```
search "<query matching plan-pruebas-alertas.md>"          → must NOT contain plan-pruebas-alertas.md
search "<same query>" --todos                              → MUST contain plan-pruebas-alertas.md
```

That converts the silent config-degradation path into a red test for commits 3, 6 **and** 10 — the
three commits that touch `test/fixtures/*/compendio.config.json`.

**Rationale**: a safety net added after the fall is decoration. Both tests are permanent regression
tests with independent value, not scaffolding to delete afterwards, and landing them first means every
subsequent commit is measured against a strictly stronger suite than `main` had.

**Alternatives considered**: run the FTS5 probe as a throwaway script and record the result in the
design (rejected by the task brief and on merit — the question it answers is a property of the shipped
schema, which can regress; a scratch script proves it once). Add the config assertion in commit 3
where the risk first materialises (rejected: it guards three commits, so it belongs before all of
them, and "keep tests with the code" is served by the fact that it tests behavior that already exists).

### Decision D: FTS5 external-content probe — what it creates, inserts, queries, and when to fall back

**The question**: does
`fts5(content, heading, content=chunks, content_rowid=id, tokenize='unicode61 remove_diacritics 2')`
work when a bare column is literally named `content` alongside the `content=` external-content option?
SQLite's grammar distinguishes bare columns from `key=value` options by the `=`, so it is *probably*
fine — but the current DDL is the highest-blast-radius line in the project and "probably" is not a
basis for rewriting it.

**Choice**: `test/infrastructure/fts5-external-content.test.ts`, using `better-sqlite3` directly on
`:memory:` with **no** `sqlite-vec` and **no** `SqliteIndexStore` import, so it can land as commit 1
against the still-Spanish tree.

**Schema it creates** — the exact target shape, including `position` (Decision 2) and `heading`:

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL,
  heading TEXT NOT NULL,
  content TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content, heading, content=chunks, content_rowid=id,
  tokenize='unicode61 remove_diacritics 2'
);
```

**Assertions, in order** — each one is binding:

| # | What it does | What it proves |
|---|---|---|
| A0 | The two `CREATE` statements execute without throwing | The bare `content` column and the `content=` option coexist. This is *the* question. |
| A1 | Insert two documents' chunks through the production statement shapes: `INSERT INTO chunks (document_id, heading, content, position)` and `INSERT INTO chunks_fts(rowid, content, heading)`. Content uses accented Spanish (`"gestión de duplicados"`). | The external-content insert form still accepts `content` as a column name. |
| A2 | `SELECT c.id FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH '"gestion"' ORDER BY f.rank` returns the chunk | The bare column is indexed, the join-by-rowid shape production uses works, **and** `remove_diacritics 2` survived alongside `content=` (unaccented query matches accented text). |
| A3 | A column-scoped match — `chunks_fts MATCH 'content : gestion'` — returns the same row | `content` is addressable as a column name, i.e. SQLite did not resolve it to the option. This is the sharpest discriminator; production never uses column filters, but a failure here means the grammar is ambiguous and the fallback is cheap insurance. |
| A4 | **The fragile part.** `INSERT INTO chunks_fts(chunks_fts, rowid, content, heading) VALUES ('delete', ?, ?, ?)` with the row's *original* values in declared column order, then `DELETE FROM chunks WHERE id = ?` | The `'delete'` command form accepts a column list containing `content`. This is the form `deleteDocumentRows` depends on, and the one with no fallback if it silently no-ops. |
| A5 | `SELECT count(*) … WHERE chunks_fts MATCH '"gestion"'` is `0` after A4 | No stale lexical hit — the delete actually removed the terms rather than being accepted and ignored. |
| A6 | `INSERT INTO chunks_fts(chunks_fts) VALUES('integrity-check')` does not throw, run after A4 | FTS5's own consistency check between the index and the external content table. The strongest available assertion that the delete left no desync. |
| A7 | The second document's chunk still matches its own term | No collateral damage from the targeted delete. |

**Fallback criterion — deliberately blunt: if *any* assertion A0–A7 fails, adopt the `body` fallback.**
No partial-credit interpretation, no "A3 doesn't matter because production doesn't use column filters".
The fallback costs one mapper line in a mapper that already exists, so the expected value of arguing
about which failure counts is negative.

**The fallback, fully specified** (so no implementation-time choice remains):

- Physical column: `chunks.body TEXT NOT NULL`; FTS5: `fts5(body, heading, content=chunks, …)`.
- TS domain field: **`Chunk.content` regardless** — the domain never bends to a SQLite grammar quirk
  (see Decision J).
- `ChunkRow.body`; `toChunk` maps `content: row.body`; `insertChunk`/`insertFts`/`deleteFts` use `body`;
  `ChunkMissingVector.content` keeps its alias `c.body AS content`.
- The test file is rewritten to assert the `body` shape and keeps a comment recording which assertion
  failed and why the asymmetry exists.

**Anti-drift measure**: at commit 1 the test executes an inline DDL string, because production is still
Spanish. **In commit 8, `SCHEMA_DDL` is exported from `sqlite-index-store.ts` and the test executes the
production constant instead of a copy.** Without that step the test degrades into a copy that can
silently diverge from the schema it claims to guard.

**Alternatives considered**: keep the copy and add a `toContain` assertion against `SCHEMA_DDL`
(rejected: passes on a substring while the surrounding DDL drifts). Exercise the question through
`SqliteIndexStore` end-to-end instead (rejected: the store exposes no db handle, so `integrity-check` —
the most valuable assertion — is unreachable, and the failure mode would be a confusing integration
error rather than a pointed DDL error).

### Decision E: Corrected sequencing — seven groups become nine, plus a safety-net commit and the docs commit

The proposal's seven groups are correct in substance. Auditing them for *internal atomicity* and
*forward-only dependencies* produced three corrections:

| # | Correction | Why |
|---|---|---|
| E1 | **Split proposal group 6** into commit 8 (SQL schema + row shapes) and commit 9 (MCP wire + CLI + user-facing strings) | The two are mutually independent — SQL columns never touch Zod keys — and group 6 was by far the largest unit. The proposal's binding constraint was "SQL DDL column names landing in the same commit as the `DocumentRow`/`ChunkRow` mappers"; commit 8 honors that exactly. Splitting *sharpens* the proposal's own "review group 6 first" instruction: commit 9 becomes the single externally-visible commit, unmixed with schema churn. |
| E2 | **Add a dedicated frontmatter-source-key commit** (commit 7) | The proposal's scope table lists "`ejemplos/` frontmatter keys — exactly 3 lines" without assigning it to a group. It cannot belong to a pure-identifier group: it is the one edit in the whole change that alters **which key is read from disk**, and it must land simultaneously with `frontmatterFields` defaults, `frontmatter.ts`'s hardcoded literals, the `ejemplos/` lines, and every fixture's frontmatter. See Decision F. |
| E3 | **Move the FTS5 probe to commit 1** | Decision 3 makes it a blocking prerequisite for the content group. Scheduling it first trivially satisfies that and is strictly safer. Worth stating plainly: the risk it retires is actually *realised* in commit 8 (the DDL rename), not commit 4 (the TS field rename) — commit 4 renames `Chunk.contenido` → `content` while the physical column is still `contenido`, absorbed by `toChunk`. Running the probe first costs nothing and means the `body` decision is known before any related work is planned. |

**Audit of forward-only dependencies** — every commit depends only on earlier ones:

| Commit | Depends on | Verified |
|---|---|---|
| 2 path | — | ✓ |
| 3 taxonomy | — | ✓ |
| 4 content/structural | 1 (scheduling floor only) | ✓ |
| 5 report/response | — | ✓ |
| 6 config keys | 3 (`estadosExcluidos` is one symbol, renamed there) | ✓ |
| 7 frontmatter source keys | 3, 6 (so `frontmatterFields` already has its final name and keys) | ✓ |
| 8 SQL schema | 2, 3, 4 (mappers become symmetric again) | ✓ |
| 9 MCP + CLI | 2, 3, 4, 5 (the internal fields the boundary maps to) | ✓ |
| 10 strict fixture | 6 (fixture JSON keys), 7 (frontmatter keys), 9 (`--lexico` → `--lexical` in `cli-subprocess.test.ts`) | ✓ |
| 11 specs + docs | everything (zero compile dependency) | ✓ |

**Audit of internal atomicity** — no commit can be half-applied and still compile *or* still test green.
Commits 2–5 are compile-atomic by construction (a domain field rename is a whole-program edit).
Commits 6, 7, 8, 10 are **test-atomic rather than compile-atomic**, which is a weaker but sufficient
property, and is exactly why each one carries the untyped-boundary edits listed in the sequence table
below. Commit 9 is compile-atomic for the Zod↔handler binding and test-atomic for the CLI strings.

### Decision F: Frontmatter source keys are a single atomic unit, separate from the identifiers

**Choice**: the string literals that name frontmatter keys **on disk** move in one commit, together
with every file that declares them:

- `DEFAULT_CONFIG.convention.frontmatterFields` values: `"tipo"/"modulo"/"estado"` → `"type"/"module"/"status"`
- `frontmatter.ts` hardcoded reads: `data["etiquetas"]` → `data["tags"]`, `data["propietario"]` →
  `data["owner"]`, `data["actualizado"]` → `data["updated"]`
- `ejemplos/` — the three lines from binding decision 1, and nothing else
- `test/helpers/build.ts`'s `frontmatterFields` literals in both convention constants
- `test/fixtures/estricto/docs/*.md` frontmatter keys (values untouched here — that is commit 10)
- every inline frontmatter fixture in `index-and-search.test.ts`, `generate-index-md.test.ts`,
  `markdown-parser.test.ts`, `frontmatter.test.ts`, `convention.test.ts`, `sync-index.test.ts`

**Why this specific split is load-bearing.** Commit 3 renames the TS field `tipo` → `type`, which turns
`frontmatterFields` into `{ type: "tipo", module: "modulo", status: "estado" }` — an English key
pointing at a Spanish source key. That is not a hack or a shim; it is **precisely what
`frontmatterFields` exists to express**, and it is a legitimate, fully working state that a Spanish
team would ship deliberately. It lets the identifier rename proceed without dragging the corpus along,
and it leaves commit 7 as a small, self-contained diff whose entire subject is "which key do we read".

**Sequence / flow note — where the source key enters, and why decision 1 is safe by construction:**

```
ejemplos/informes/plan-pruebas.md
  frontmatter:  status: borrador          ← KEY translated (commit 7); VALUE frozen forever
        │
        ▼
RemarkMarkdownParser.parse(raw) → matter(raw) → { data, content }
        │                                         │
        │                                         └─► content ─► chunking ─► embeddings ─► FTS5
        │                                              THE RETRIEVAL BRANCH. Frontmatter never enters it.
        ▼
      data: Record<string, unknown>   (keys exactly as written on disk)
        │
        ├─ readField(data, config.frontmatterFields.status)   ← configurable source key
        ├─ resolveTags(data)                                  ← hardcoded data["tags"]
        └─ applyOptionalFields(meta, data)                    ← hardcoded data["owner"] / data["updated"]
        │
        ▼
   DocumentMeta.status = "borrador"       ← Spanish VALUE preserved end to end
        │
        ├─► formatDocLine  ─► "… (borrador)" in INDEX.md and docs_overview
        └─► documents.status column        ← renamed in commit 8
```

The two branches out of `matter(raw)` never rejoin. That is the whole of decision 1's safety argument,
and it is the reason the commit-7 gate is an `INDEX.md` byte-comparison rather than an eval run.

**Alternatives considered**: fold the source-key flip into commit 3 (rejected: makes a pure-identifier
commit also mutate the corpus and every fixture, which is exactly the kind of mixed commit that
destroys review value on a diff this size). Fold it into commit 10 with the fixture translation
(rejected: the `ejemplos/` edit and the fixture-value translation are protected by different rules and
have different blast radii — mixing them means a reviewer checking decision 1 has to wade through a
fixture rewrite).

### Decision G: SQL row shapes track the DDL, not the domain

**Choice**: `DocumentRow`, `ChunkRow` and the inline row cast in `deleteDocumentRows` are **mirrors of
the physical schema**, not domain types. Through commits 2–7 they keep their Spanish field names while
`toDocument`/`toChunk` become deliberately asymmetric mappers (`path: row.ruta`, `title: row.titulo`,
`content: row.contenido`, `position: row.orden`). They become symmetric again in commit 8, when the
DDL moves.

Corollaries the executor must not violate:

- **Do not** "helpfully" rename `DocumentRow`/`ChunkRow` fields during commits 2–7. Doing so compiles
  (the `as` cast is unchecked) and silently produces `undefined` for every renamed field.
- **`ChunkMissingVector` is the exception, and it is in `ports.ts`.** Its fields are simultaneously a
  domain port shape and SQL aliases in `listChunksMissingVectors`. Every commit that renames one of its
  fields (`ruta` in commit 2, `encabezado` in commit 2, `contenido` in commit 4) **must edit the
  matching `AS` alias in the same commit.** `tsc` will not tell you. This is the single most likely
  place for this change to introduce a silent runtime bug.
- Named-parameter objects (`insertDocument.run({ ruta: meta.path, … })`) keep the SQL-side key until
  commit 8. A mismatch here fails loudly (`better-sqlite3` throws `Missing named parameter`), so it is
  not a silent class — but it is still a per-commit checklist item.

**Alternatives considered**: rename the row shapes together with the domain fields and let the DDL lag
(rejected: that is the silent-`undefined` scenario, with no compiler or test signal until an assertion
happens to touch the field). Introduce a column-name constants object (rejected: new indirection for a
one-time change, and it would outlive its purpose).

### Decision H: `CONCEPT_STEMS` is append-only, and its re-validation is a defined procedure

`CONCEPT_STEMS` is Spanish word stems matched against corpus prose. `FakeEmbeddings` is used against
**both** `ejemplos/` (frozen, stems must stay) **and** `test/fixtures/strict/` (translated in commit
10) — `index-and-search.test.ts:167` builds a strict-fixture harness with `new FakeEmbeddings()`.
Several stems plausibly serve the strict fixture rather than `ejemplos/`: `despliegue`, `pipeline`,
`transaccion`, `sesion`, `persistencia` all appear in the fixture prose.

**Choice**: `CONCEPT_STEMS` is **append-only**. Existing groups are never edited, reordered or removed.
The re-validation runs inside commit 10, as this procedure:

1. Translate the fixture (prose, filenames, frontmatter values) and update the tests' Spanish query
   strings to their English equivalents.
2. Run `npm test`. **If every strict-fixture assertion passes, changing `CONCEPT_STEMS` at all is not
   permitted** — record "no stem change required" in the commit message and stop.
3. If a strict-fixture assertion fails, **append** one new group of English stems at the end of the
   array, derived from the translated fixture vocabulary. Never touch groups 0–8.
4. Re-run the full suite. The `ejemplos/`-backed suites (`evaluate.test.ts`, the `ejemplos/` describes
   in `index-and-search.test.ts`, `read-document.test.ts`) must be **untouched-green** — no assertion
   edited, no expectation loosened.

**Why append-only is provably safe for the frozen corpus**: `vectorize` builds a vector of length
`CONCEPT_STEMS.length + 1` and L2-normalises it. Appending a group that no Spanish text matches inserts
a **zero** component into every `ejemplos/` vector before the constant tail dimension. A zero component
changes neither the L2 norm nor any pairwise dot product, so cosine similarity — and therefore every
ranking over `ejemplos/` — is *identical*, not merely close. Editing or removing an existing group
carries no such guarantee for texts that do match it.

**Also worth stating so nobody conflates the two**: `CONCEPT_STEMS` has **zero** influence on the eval
baseline. `eval-baseline.md` was captured with `npm run dev`, which wires the real transformers.js
provider. `FakeEmbeddings` exists only inside the test suite.

**Residual risk, accepted and monitored**: if the translated fixture matches no stem at all, every
fixture chunk gets the same vector and the vector leg contributes an undifferentiated RRF bonus. With
only 5 fixture documents and `k: 10` the deny-list assertion (`incluirNoVigentes: true` must surface
`plan-pruebas-alertas.md`) could in principle become order-dependent. That is exactly what step 2
detects, and step 3 resolves.

### Decision I: The `INDEX.md` canary is split — entry lines are frozen, header lines are not

The proposal's final gate says "`ejemplos/docs/INDEX.md` is unchanged in `git diff`". Taken literally
that gate is unsatisfiable, because the file's first three lines are rendered from `TITULO_INDICE` and
`AVISO_GENERADO` (`index-markdown.ts:11-12`), which are user-facing strings this change re-authors in
English. The gate needs splitting into what it actually protects:

| Part | Rule | When checked |
|---|---|---|
| **Entry lines** (`- ruta — resumen… (estado)`) | Byte-identical, forever. They are rendered from frozen `ejemplos/` values; a diff means decision 1's frontmatter-key flip broke value resolution. | **Commit 7**, precisely: run `npm run dev -- --root ejemplos index-md` and require `git diff --exit-code -- ejemplos/docs/INDEX.md`. At commit 7 the header constants are still Spanish, so the *whole file* must be byte-identical. This is the sharpest, most localized form of the canary. |
| **Header + notice lines** | Legitimately change with the re-authored constants, exactly like the CLI output strings `eval-baseline.md` already exempts. | **Commit 9**, which renames the constants: regenerate **both** `ejemplos/docs/INDEX.md` and `docs/INDEX.md` and commit them. The diff must contain header/notice lines only — every entry line byte-identical. |

**Rationale**: running the canary at commit 7 rather than at the end converts a vague end-state check
into an exact, attributable one. If it fires, exactly one commit is suspect and it is the commit you
just made.

**Trap to name explicitly**: `SIN_CHUNKING = ["glosario.md"]` (`config.ts:43`) and the identical literal
in `test/helpers/build.ts:69`. The **constant name** renames (`NO_CHUNKING`, `noChunking`,
`isNoChunking`); the **value** is a frozen `ejemplos/` filename and must stay `"glosario.md"`.
Translating it would heading-chunk `glosario.md` instead of indexing it as a single chunk, changing the
corpus chunk count from 27 and moving the eval. Same class as `EJEMPLOS_DOCS`, whose identifier becomes
`EXAMPLES_DOCS` while its path literal `"../../ejemplos/docs"` stays.

### Decision J: Hexagonal integrity — the adapter bends, the domain does not

**Choice**: the rename changes zero structural facts. Verified and preserved:

- `src/domain/` keeps **zero** dependencies on SQLite, transformers.js, `gray-matter`, `remark` or
  `node:fs`. Verification (must return nothing):
  `rg -i -n 'from "(node:|better-sqlite3|sqlite-vec|@xenova|gray-matter|remark)' src/domain/`
- `src/domain/ports.ts` remains the only seam. No port is added, removed, or moved. Renamed ports and
  port types (`DocumentSource`, `MarkdownParser`, `IndexStore`, `EmbeddingsProvider`,
  `IndexFileWriter`, `ChunkMissingVector`, `DocumentFile`, `ReadError`, `DiscoverResult`,
  `IndexWriteResult`) stay in that file.
- `infrastructure/*` continues to import only `domain/*`, never `application/*`.
- `convencion.ts` → `convention.ts` stays in `src/domain/`. It is pure policy; the rename does not
  relocate it.

**The one place this decision has teeth** is the FTS5 fallback. If the probe fails, the physical column
becomes `body` and **`Chunk.content` stays `content`**. The asymmetry is absorbed by `toChunk`, in the
adapter, where adapters belong. The alternative — naming the domain field `body` because SQLite has a
grammar quirk — would let a persistence detail dictate the domain vocabulary, which is the specific
failure hexagonal architecture exists to prevent. `ports.ts` is likewise the *source* of
`ChunkMissingVector`'s field names; `listChunksMissingVectors`'s `AS` aliases adapt to it, never the
reverse.

### Decision K: `EvalCaseOutcome.posicion` → `rank`, not `position`

**Choice**: refine `exploration.md`'s naming-map entry. Binding decision 2 locks `Chunk.orden` →
`position`. Taking exploration's suggested `posicion` → `position` as well would put two unrelated
`position` fields in the same codebase: chunk ordinal within a document, and the rank at which the
expected document appeared in a result list. `rank` is more accurate for the latter (it *is* a
ranking position), reads correctly next to `recallAtK`/`mrr`, and removes a lookalike that decision 2
created.

**Rationale**: exploration's map for `posicion` was a gap-fill, not one of the five binding decisions,
so refining it is in scope for design. The cost is one extra line in the naming map; the benefit is not
adding a second `mode`/`module`-style human-attention hazard on top of the one already accepted.

---

## The executable sequence

One commit per group. Every commit green. `npm run typecheck` **then** `npm test` after each — no
commit lands red, and a group is never split. Every "Done when" search below is `rg -i` on a root,
**without `-w`**, per Decision B.

Weight column uses the Spanish-token occurrence counts per file (`src/` totals 446 across 23 files;
`sqlite-index-store.ts` 73, `convencion.ts` 61, `sync-index.ts` 39, `read-document.ts` 33,
`server.ts` 29, `model.ts` 20).

### Commit 1 — safety net (S)

`test(sqlite): pin FTS5 external-content behavior and strict-fixture config effectiveness`

| | |
|---|---|
| **Adds** | `test/infrastructure/fts5-external-content.test.ts` (Decision D, assertions A0–A7); deny-list assertions in `cli-subprocess.test.ts` (Decision C) |
| **Renames** | none |
| **Gate** | `npm test` green; A0–A7 all pass **or** the `body` fallback is adopted and recorded in this commit's message |
| **Done when** | the FTS5 physical column name is a settled fact, and a dropped fixture-config key would fail a test |

### Commit 2 — path-identifying fields (M)

`refactor(domain): rename path-identifying fields to English`

| | |
|---|---|
| **Symbols** | `ruta`→`path`, `seccion`→`section`, `secciones`→`sections`, `seccionesDisponibles`→`availableSections`, `encabezado`→`heading`, `getDocumentByRuta`→`getDocumentByPath`, `groupByRuta`→`groupByPath`, `DocumentFile.ruta`, `ReadError.ruta`, `IndexWriteResult.ruta`, `ChunkMissingVector.{ruta,encabezado}`, `HeadingEvent` path fields |
| **Untyped edits required in this commit** | `listChunksMissingVectors` SQL aliases: `d.ruta AS ruta`→`AS path`, `c.encabezado AS encabezado`→`AS heading` (**not** tsc-protected — Decision G) |
| **Explicitly NOT touched** | `DocumentRow.ruta`, `ChunkRow.encabezado`, `ORDER BY ruta`, `documents.ruta` DDL, the `read_doc` Zod keys, `--dir` |
| **Gate** | typecheck + test |
| **Done when** | `rg -i -n 'ruta\|seccion\|encabezado' src test` returns only `sqlite-index-store.ts`'s SQL layer and Sweep A's allow-list |

### Commit 3 — taxonomy fields and their compounds (L)

`refactor(domain): rename taxonomy fields and their compounds to English`

| | |
|---|---|
| **Symbols, longest-first** | `estadosExcluidos`→`excludedStatuses`, `estados`→`statuses`, `estado`→`status`; `tipos`→`types`, `tipo`→`type`; `modulo`→`module`; `etiquetas`→`tags` (`resolveEtiquetas`→`resolveTags`, `EtiquetasResult`→`TagsResult`); `propietario`→`owner`; `actualizado`→`updated`; `porTipo`/`porModulo`→`byType`/`byModule`; `parseTipo`→`parseType`; `incluirNoVigentes`→`includeExcluded` |
| **Untyped edits required in this commit** | `test/fixtures/estricto/compendio.config.json` keys `tipos`/`estados`/`estadosExcluidos`; the inline JSON configs in `config.test.ts`; `build.ts`'s `ESTRICTO_FIXTURE_CONVENCION` field names. **Silent class** — guarded by commit 1's deny-list assertion |
| **Explicitly NOT touched** | `frontmatterFields` **values** (still `"tipo"/"modulo"/"estado"` — commit 7); `data["etiquetas"]`/`["propietario"]`/`["actualizado"]` (commit 7); SQL columns; `--tipo` flag; Zod keys |
| **Reviewer flag** | `mode`/`module` lookalikes begin here |
| **Gate** | typecheck + test |
| **Done when** | `rg -i -n 'tipo\|modulo\|estado\|etiqueta\|propietario\|actualizado\|vigentes' src test` returns only the SQL layer, the commit-7 source-key literals, and Sweep A's allow-list |

### Commit 4 — content and structural fields (L)

`refactor(domain): rename content and structural fields to English`

| | |
|---|---|
| **Symbols** | `contenido`→`content`, `orden`→`position` (decision 2), `resumen`→`summary` (`condenseResumen`/`displayResumen`→`condenseSummary`/`displaySummary`), `titulo`→`title`, `texto`/`textos`→`text`/`texts`, `extracto`→`excerpt`, `Piece.texto`, `DocSection.{titulo,texto}`, `DocOutline.{titulo,resumen,secciones}` |
| **Untyped edits required in this commit** | `listChunksMissingVectors`'s `c.contenido AS contenido` → `AS content` |
| **Explicitly NOT touched** | `chunks.contenido`/`chunks.orden` DDL, `ORDER BY orden`, `insertChunk`/`insertFts`/`deleteFts`, `ChunkRow`, the inline cast in `deleteDocumentRows` |
| **Gate** | typecheck + test |
| **Done when** | `rg -i -n 'contenido\|orden\|resumen\|titulo\|texto\|extracto' src test` returns only the SQL layer and Sweep A's allow-list |

### Commit 5 — report and response fields (M)

`refactor(app): rename report and response fields to English`

| | |
|---|---|
| **Symbols** | `omitidos`→`skipped`, `indexados`→`indexed`, `eliminados`→`deleted`, `avisoEmbeddings`→`embeddingsWarning`, `duracionMs`→`durationMs`, `resultados`→`results`, `SearchResponse.modo`/`IndexReport.modo`/`SyncReport.modo`→`mode`, `sincronizacion`→`sync`, `SincronizacionInfo`→`SyncInfo`, `toSincronizacionInfo`→`toSyncInfo`, `errores`→`errors`, `erroresLectura`→`readErrors`, `cambiado`→`changed`, `existente`→`existing`, `escrito`→`written`, `forzarLexico`→`forceLexical` |
| **Value literals** | `SearchMode`: `"hibrido"`/`"lexico"` → `"hybrid"`/`"lexical"` (incl. `EvalReport.hibrido`/`.lexico` keys); `ReadResult` discriminants `"documento"`/`"seccion"`/`"ruta-no-encontrada"`/`"seccion-no-encontrada"` → `"document"`/`"section"`/`"path-not-found"`/`"section-not-found"` |
| **Eval fields** | `pregunta`→`question`, `esperado`→`expected`, `posicion`→`rank` (Decision K), `fallos`→`failures`, `casos`→`cases` |
| **Frozen-boundary work in this commit** | `cli.ts`'s `loadGoldenset` builds `{ question, expected }` from the literals `"pregunta"`/`"esperado"`, which **stay**. Add the `// es-frozen:` markers here (Sweep A), not later. |
| **Gate** | typecheck + test |
| **Done when** | `rg -i -n 'omitid\|indexad\|eliminad\|aviso\|duracion\|resultado\|sincroniz\|errores\|cambiado\|existente\|escrito\|forzar\|hibrido\|lexico\|documento\|pregunta\|esperado\|posicion\|fallos\|caso' src test` returns only marked or allow-listed lines |

### Commit 6 — configuration surface (M)

`refactor(config): rename the configuration surface to English`

| | |
|---|---|
| **Symbols** | `CompendioConfig.convencion`→`convention`, `ConvencionConfig`/`ConvencionPolicy`→`ConventionConfig`/`ConventionPolicy`, `modo`→`mode`, `camposFrontmatter`→`frontmatterFields`, `sinChunking`→`noChunking`, `SIN_CHUNKING`→`NO_CHUNKING`, `isSinChunking`→`isNoChunking`, `crearConvencionPolicy`→`createConventionPolicy`, `crearPoliticaLibre`/`Estricta`→`createLoosePolicy`/`createStrictPolicy`, `crearComparadorIndice`→`createIndexComparator`, `leerCampo`→`readField`, `inferirModulo`→`inferModule`, `humanizarNombreArchivo`→`humanizeFileName`, `aplicarCamposOpcionales`→`applyOptionalFields`, `EJEMPLOS_CONVENCION`→`EXAMPLES_CONVENTION`, `EJEMPLOS_DOCS`→`EXAMPLES_DOCS` |
| **Value literals** | `"libre"`/`"estricto"` → `"loose"`/`"strict"` |
| **File renames** | `git mv src/domain/convencion.ts src/domain/convention.ts`; `git mv test/domain/convencion.test.ts test/domain/convention.test.ts` |
| **Deletion** | `warnIfLegacyEstadosExcluidos` and its `config.test.ts` coverage (decision 5) |
| **Untyped edits required in this commit** | `test/fixtures/estricto/compendio.config.json` (`convencion`→`convention`, `modo`→`mode`, `"estricto"`→`"strict"`); every inline JSON in `config.test.ts`. **Silent class** |
| **Frozen, with markers added here** | `NO_CHUNKING = ["glosario.md"]` — value unchanged; `EXAMPLES_DOCS`'s path literal `"../../ejemplos/docs"` unchanged. Add `// es-frozen:` markers to both |
| **Gate** | typecheck + test |
| **Done when** | `rg -i -n 'convencion\|politica\|comparador\|leercampo\|inferir\|humanizar\|aplicarcampos\|camposfrontmatter\|modo\|libre\|estricto\|sinchunking\|sin_chunking\|ejemplos\|glosario\|indice' src test` returns only marked or allow-listed lines |

### Commit 7 — frontmatter source keys, with the corpus (S, high scrutiny)

`refactor(frontmatter): read English frontmatter keys by default`

| | |
|---|---|
| **Changes** | `frontmatterFields` default **values** → `"type"/"module"/"status"`; `data["etiquetas"]`→`data["tags"]`, `data["propietario"]`→`data["owner"]`, `data["actualizado"]`→`data["updated"]`; the `'etiquetas' debe ser una lista de cadenas` error string re-authored in English |
| **Corpus (decision 1 — exactly 3 lines)** | `ejemplos/docs/informes/plan-pruebas.md` `estado:`→`status:`; `ejemplos/docs/transversal/adr-0001-eleccion-mongodb.md` `estado:`→`status:`; `ejemplos/docs/leadsviewer/importacion-csv.md` `etiquetas:`→`tags:`. **No `compendio.config.json` is added to `ejemplos/`.** |
| **Fixtures** | `test/fixtures/estricto/docs/*.md` frontmatter **keys** only; `build.ts`'s `frontmatterFields` literals; every inline frontmatter fixture across the test suite |
| **Gate** | typecheck + test, **plus** `npm run dev -- --root ejemplos index-md` then `git diff --exit-code -- ejemplos/docs/INDEX.md` (Decision I) |
| **Gate** | `git diff --stat -- ejemplos/` shows exactly 3 changed lines across 3 files, nothing else |
| **Done when** | `(borrador)` and `(obsoleto)` still render, `etiquetas: ["csv"]` filtering still passes, and `ejemplos/docs/INDEX.md` is byte-identical |

### Commit 8 — SQL schema (L)

`refactor(sqlite): rename schema columns to English`

| | |
|---|---|
| **DDL** | `documents(path, title, summary, type, module, status, owner, tags, updated, hash)`; `chunks(document_id, heading, content, position)`; `chunks_fts(content, heading, content=chunks, content_rowid=id, tokenize=…)` — **or the `body` variant** if commit 1 triggered the fallback |
| **Statements** | `insertDocument` named params, `insertChunk`, `insertFts`, `deleteFts` (`'delete'` command form, column order matching the DDL), `buildFilterSql` (`d.type`/`d.module`/`d.status IS NULL OR d.status NOT IN`/`json_each(d.tags)`), `listDocuments`'s `ORDER BY path`, `getChunksByDocument`'s `ORDER BY position`, `getDocumentByPath` |
| **Row shapes** | `DocumentRow`/`ChunkRow` renamed; `toDocument`/`toChunk` become symmetric again (except under the `body` fallback); the inline cast in `deleteDocumentRows`; `listChunksMissingVectors` aliases become identities |
| **Anti-drift** | export `SCHEMA_DDL` and switch `fts5-external-content.test.ts` to execute the production constant (Decision D) |
| **Frozen** | `tokenize='unicode61 remove_diacritics 2'` byte-identical (invariant I2); `position` never `order` (decision 2) |
| **Gate** | typecheck + test + `npm run build` |
| **Done when** | `rg -i -n '<ROOTS>' src/infrastructure/sqlite/` is empty |

### Commit 9 — MCP and CLI surface (L, review this one first)

`refactor(contract): move the MCP and CLI surface to English`

| | |
|---|---|
| **MCP** | `search_docs` Zod keys → `{ query, type, module, tags, k, include_excluded }`; `read_doc` → `{ path, section }`; snake_case preserved on wire params; all three `registerTool` `title`/`description` strings **re-authored as English prose**, not word-swapped; `formatReadResult` output strings; tool names unchanged (already English) |
| **CLI** | `--tipo`→`--type`, `--modulo`→`--module`, `--etiquetas`→`--tags`, `--todos`→`--all`, `--lexico`→`--lexical`, `--dir` unchanged; command descriptions and every `console.log`/`warn`/`error` string re-authored |
| **Constants** | `TITULO_INDICE`→`INDEX_TITLE`, `AVISO_GENERADO`→`GENERATED_NOTICE`, and their **values** re-authored in English |
| **Remaining runtime strings** | `sqlite-index-store.ts`, `file-document-source.ts`, `config.ts`, `sync-index.ts`, `index-documents.ts` |
| **Regenerate and commit** | `docs/INDEX.md` **and** `ejemplos/docs/INDEX.md` — header/notice lines change, **every entry line byte-identical** (Decision I) |
| **Tests** | `cli-subprocess.test.ts` (`--lexico`→`--lexical`, the `/Indexados 5 documentos \(\d+ chunks\)/` regex, `payload.modo`/`resultados`/`ruta` field reads), `server.test.ts` |
| **Gate** | typecheck + test + build; `node dist/cli.js --help` contains no Spanish |

### Commit 10 — strict fixture translation (M)

`test(fixtures): translate the strict fixture to English`

| | |
|---|---|
| **Moves** | `git mv test/fixtures/estricto test/fixtures/strict` (`.compendio/` inside it is gitignored build residue — do not commit it) |
| **Values (decision 4)** | `"funcional"`→`"functional"`, `"guia"`→`"guide"`, `"borrador"`→`"draft"`, `"vigente"`→`"current"`, `"obsoleto"`→`"deprecated"`; `"adr"`/`"api"`/`"qa"` already language-neutral |
| **Files** | the 5 fixture docs (filenames, frontmatter values, prose), `test/fixtures/strict/docs/INDEX.md`, `test/fixtures/strict/compendio.config.json` value arrays, `build.ts`'s `STRICT_FIXTURE_DOCS`/`STRICT_FIXTURE_CONVENTION` |
| **Test coupling — do not miss** | `index-and-search.test.ts`'s Spanish queries (`"decisión arquitectura"`, `"alertas de inventario plan de pruebas"`) and `cli-subprocess.test.ts`'s `"onboarding de un servicio"` + `guia-onboarding.md` expectation both target this fixture and must be translated with it |
| **`CONCEPT_STEMS`** | run Decision H's procedure; record the outcome in the commit message; add `// es-frozen:` markers to `CONCEPT_STEMS` and to any surviving Spanish `ejemplos/`-corpus query string in the test suite |
| **Gate** | typecheck + test; the `ejemplos/`-backed suites untouched-green |
| **Done when** | Sweep A returns only marked or allow-listed lines — this closes the allow-list |

### Commit 11 — specs and documentation (M)

`docs: retire the Spanish contract from specs and documentation`

| | |
|---|---|
| **Files** | `openspec/specs/{mcp-contract,configuration,indexing,search,index-md}/spec.md` (all five), `README.md` (incl. the `README.md:232` pitch that currently sells the Spanish contract — a content rewrite, not a word swap), `CLAUDE.md` (the working-conventions section inverts), `docs/convencion-documentacion.md` → `git mv` to `docs/documentation-convention.md` |
| **If `docs/` filenames change** | regenerate `docs/INDEX.md` again in this commit |
| **Gate** | **Sweeps A and B both clean** (below) — this is the completion criterion for the whole change |
| **Gate** | `openspec/config.yaml`'s archive rule: `openspec/specs/` carries no residual Spanish contract vocabulary except where it quotes the `ejemplos/` corpus |

---

## The frozen boundary, encoded

### What stays Spanish, and the mechanism that enforces it

| Frozen | Enforcement |
|---|---|
| All prose in `ejemplos/docs/**` | `ejemplos/` excluded from both sweeps; `git diff --stat -- ejemplos/` must show exactly 3 changed lines |
| All frontmatter **values** in `ejemplos/` (`borrador`, `obsoleto`, `[lead, importacion, csv, lote]`) | Commit 7's `INDEX.md` byte-identical gate; existing assertions on `"borrador"` and `["csv"]` |
| `ejemplos/goldenset.yaml` | Same `git diff --stat` gate; the eval reproducing 22 cases |
| `"pregunta"` / `"esperado"` in `cli.ts`'s `loadGoldenset` | Sweep A allow-list entry + `// es-frozen:` markers added in commit 5 |
| `CONCEPT_STEMS` **values** | Append-only rule + Decision H; markers added in commit 10. Verified: none of its 38 stems contains any root in the Sweep A list, so it produces zero hits by construction — the markers are documentation for the reader, not sweep suppression |
| `NO_CHUNKING = ["glosario.md"]` **value** | Sweep A allow-list (root `glosario`) + marker in commit 6; invariant I6 |
| `EXAMPLES_DOCS`'s path literal `"../../ejemplos/docs"` | Sweep A allow-list (root `ejemplos`) + marker in commit 6 |
| MCP tool names `docs_overview`/`search_docs`/`read_doc` | Already English — no action |
| Retrieval behavior (model, tokenizer, RRF, chunking) | Invariants I1–I6 below |

### The residual sweeps

**Two sweeps, both case-insensitive, both substring-based on Spanish roots.** Per Decision B, `-w` is
excluded deliberately: it cannot see a root inside `ConvencionConfig`, `resolveEtiquetas`,
`SincronizacionInfo`, or `SIN_CHUNKING`, which is where most of the remaining Spanish would hide. **A
case-sensitive or word-bounded version of either sweep would report clean over an arbitrary number of
un-renamed identifiers, so `-i` and the absence of `-w` are what make these checks mean anything. Do
not "simplify" them back.**

**Root list** (`<ROOTS>` below). Each root is chosen to cover its own compounds — `convencion` catches
`ConvencionConfig` and `crearConvencionPolicy`; `etiqueta` catches `resolveEtiquetas` and
`EtiquetasResult`; `sincroniz` catches `SincronizacionInfo` and `toSincronizacionInfo`; `seccion`
catches `seccionesDisponibles`; `tipo` catches `porTipo` and `parseTipo`; `resumen` catches
`condenseResumen` and `displayResumen`; `titulo` catches `TITULO_INDICE`; `aviso` catches
`avisoEmbeddings` and `AVISO_GENERADO`; `politica`/`comparador`/`inferir`/`humanizar`/`leercampo`/
`aplicarcampos` catch the `crear*`-prefixed factory and helper names. `sin_chunking` is listed
separately from `sinchunking` because `_` is a word character and SCREAMING_SNAKE_CASE lowercases with
it intact.

```
actualizado|aplicarcampos|aviso|cambiado|camposfrontmatter|caso|comparador|contenido|convencion|
documento|duracion|ejemplos|eliminad|encabezado|errores|escrito|esperado|estado|estricto|etiqueta|
existente|extracto|fallos|forzar|glosario|hibrido|humanizar|indexad|indice|inferir|leercampo|lexico|
libre|modo|modulo|omitid|orden|politica|posicion|pregunta|propietario|resumen|resultado|ruta|seccion|
sincroniz|sin_chunking|sinchunking|texto|tipo|titulo|vigentes
```

Every root was checked for English false positives in this codebase's vocabulary: none of them is a
substring of an English word used here (`orden` ⊄ `order`, `modo` ⊄ `mode`, `caso` ⊄ `case`,
`texto` ⊄ `context`, `indice` ⊄ `index`, `libre` ⊄ `library`).

The list is derived from the naming map in this document's commit tables, not from
`exploration.md` alone — `existente` and `escrito` (`file-index-writer.ts:18,20,27`,
`generate-index-md.ts:66,68`) are in commit 5's map and are included here for that reason. If a symbol
appears in a commit table, its root belongs in this list; treat any future addition to a commit table
as also requiring an addition here.

**Sweep A — code** (`src/` and `test/`, excluding markdown):

```
rg -i -n --glob '!**/*.md' '<ROOTS>' src test
```

**Sweep B — contract prose** (`openspec/specs/`, `README.md`, `CLAUDE.md`, `docs/`):

```
rg -i -n --glob '!openspec/changes/**' '<ROOTS>' openspec/specs docs README.md CLAUDE.md
```

`openspec/changes/**` is excluded because SDD artifacts legitimately quote the retired vocabulary;
`ejemplos/**` is excluded because it is frozen wholesale.

#### Acceptance criterion

**Every line either appears in the allow-list table below, or carries an `// es-frozen: <reason>`
marker on the line or the line above. Zero unmarked, un-enumerated hits.** Mechanically:

```
rg -i -n --glob '!**/*.md' '<ROOTS>' src test | rg -v 'es-frozen'
```

must return only the enumerated corpus-filename lines. An unmarked hit blocks delivery until it is
classified as either a rename miss (fix it) or a genuine frozen literal (add the marker **and** a row
to this table). Silently tolerating a hit is not an available outcome.

The marker convention exists because the allow-list cannot be fully enumerated in advance — Spanish
query strings against the frozen corpus may survive in the test suite, and each one is legitimate. The
marker turns "is this hit OK?" from a judgement call at review time into a claim the author had to make
explicitly at edit time.

#### Allow-list (seed — corpus references, measured on the current tree)

| File | Root | Occurrences | Reason |
|---|---|---|---|
| `src/cli.ts` | `pregunta`, `esperado` | 3 lines (`:201`, `:202`, and the goldenset error message at `:196`) | They index into `ejemplos/goldenset.yaml`'s real keys, which are frozen |
| `src/infrastructure/config.ts:43` | `glosario` | 1 | `NO_CHUNKING = ["glosario.md"]` — a frozen `ejemplos/` filename |
| `test/helpers/build.ts:13` | `ejemplos` | 1 | `EXAMPLES_DOCS`'s path literal `"../../ejemplos/docs"` |
| `test/helpers/build.ts:69` | `glosario` | 1 | harness `noChunking: ["glosario.md"]`, mirroring the production default |
| `test/domain/excerpt.test.ts:13` | `glosario` | 1 | asserts an excerpt does not contain the corpus filename |
| `test/application/index-and-search.test.ts:44` | `glosario` | 1 (plus the local variable named after it) | looks up the corpus document by its real path |
| `test/application/read-document.test.ts:30` | `glosario` | 1 | reads the corpus document by its real path |
| `test/helpers/fake-embeddings.ts` | — | 0 | `CONCEPT_STEMS` contains no listed root; marked for the reader only |

**`"glosario.md"` appears 5 times across `src` and `test`, not 2** — measured, not assumed. All five are
legitimate references to the real frozen corpus filename. A **sixth** occurrence, or the disappearance
of any of these five, is a defect: the value must never be translated (invariant I6), while the
identifiers around it (`SIN_CHUNKING`, `sinChunking`, `report.indexados`, `d.ruta`) all rename in
commits 2, 5 and 6 with the literal staying put. Stating the count exactly is the point — a check whose
expected output is wrong cannot distinguish "these are fine" from "one of them is a mistranslation",
which is the ambiguity a positive check exists to eliminate.

---

## Invariants: why behavior preservation is structural

`eval-baseline.md` argues preservation from three verified facts. The design promotes them — plus three
more — to **diff-verifiable invariants**. These, not the eval run, are the primary safety mechanism, so
every file reference below was re-derived from measurement and is cited with `file:line`.

| # | Invariant | Verification (confirmed on the current tree) |
|---|---|---|
| I1 | `RemarkMarkdownParser.parse` still destructures `{ data, content }` from `matter(raw)` and only `content` reaches chunking | `remark-markdown-parser.ts:26` — `git diff main..HEAD` on that file shows identifier changes only |
| I2 | `tokenize='unicode61 remove_diacritics 2'` is byte-identical | `rg -F "unicode61 remove_diacritics 2" src` returns **exactly one** line, `sqlite-index-store.ts:67` |
| I3 | `EvaluateSearch` passes only `{ query, k, forceLexical }` — zero metadata filters | `evaluate-search.ts:40,44-46` — `git diff` shows identifier changes only |
| I4 | RRF constant `60` and the fusion function unchanged | `fusion.ts:6` (`RRF_K = 60`) — `git diff` shows identifier changes only |
| I5 | The embeddings model id, and **the exact string composed and embedded** per chunk and per query, are byte-identical | Model id: `config.ts:52` (`Xenova/multilingual-e5-small`). Provider pooling/normalization: `transformers-embeddings.ts`. **Composition and task prefixes — the part that actually moves the numbers:** `index-documents.ts:88` (`` `${chunk.encabezado}\n${chunk.contenido}` ``) and `:117` (`` `passage: ${p.texto}` ``); `sync-index.ts:130` and `:177` (`` `passage: ${c.encabezado}\n${c.contenido}` ``); `search-documents.ts:107` (`` `query: ${query.query}` ``) |
| I6 | Chunking parameters and the single-chunk exemption unchanged in **value** | Thresholds: `config.ts:53` (`minTokens: 100, maxTokens: 800`). Exemption value: `config.ts:43` (`["glosario.md"]`). **The exemption decision itself:** `index-pipeline.ts:71,82-84` (`isSinChunking`), wired at `composition.ts:67,82`. Chunking logic: `chunking.ts`, `outline.ts` — identifier changes only |

**Two of these were wrong on the first pass and are corrected here.** I5 previously named
`index-pipeline.ts` and `transformers-embeddings.ts` as the sites of the `"passage: "` / `"query: "`
prefixes; **neither file contains either string**, so a reviewer following I5 literally would have
diffed three files, seen identifier-only changes, and signed off while the real composition sites went
unexamined. I6 previously named only `config.ts`/`chunking.ts`/`outline.ts`, omitting
`index-pipeline.ts` — where the decision to bypass chunking for `glosario.md` actually lives. Both
errors are the same class: an invariant pointing at plausible files rather than measured ones. E5 is
sensitive to exact input text and the chunk count feeds every metric, so either gap would have surfaced
as unattributed eval drift — the outcome the attribution ladder exists to prevent.

If all six hold, the eval cannot move. If the eval moves, one of them was violated — which is what
makes the attribution ladder below finite rather than a fishing expedition.

## Final verification and the attribution ladder

**Reproduce the baseline with the exact commands that captured it** — `npm run dev`, not
`node dist/cli.js`, so the comparison is apples to apples with `eval-baseline.md`:

```
rm -rf ejemplos/.compendio
npm run dev -- --root ejemplos index
npm run dev -- --root ejemplos eval
```

Gates, in the order they fail fastest:

| # | Gate | Baseline value |
|---|---|---|
| V0 | The index run reports **hybrid** mode | otherwise the run is *invalid*, not failed — the embeddings path did not execute; re-run |
| V1 | Document and chunk counts | `11 documentos (27 chunks)` |
| V2 | `hybrid` row | recall@5 `1.00`, MRR `0.943`, failures `0` |
| V3 | `lexical` row | recall@5 `0.95`, MRR `0.857`, failures `1` |
| V4 | The single lexical failure is the same case at the same position | `"¿Qué endpoint hay que llamar para crear un lead?"` → `leadsviewer/alta-leads.md` at position 9 |

V1 fails faster and localizes better than V2–V4, which is why it is checked first. Only the wording of
the report lines is exempt (`Indexados …` → its English equivalent).

**Attribution ladder — a deviation is diagnosed, never re-baselined:**

| Symptom | Attribution | Where to look |
|---|---|---|
| Document/chunk counts moved | A document was skipped, or the single-chunk exemption broke | `git diff --stat -- ejemplos/` (must be exactly 3 lines); the `skipped` list in the index output; **I6 — including `index-pipeline.ts`'s `isNoChunking` and the `"glosario.md"` literal** |
| `ejemplos/docs/INDEX.md` entry lines differ | Commit 7 broke frontmatter value resolution | Commit 7's `frontmatterFields` values vs the 3 corpus lines |
| Only the **lexical** row moved | The FTS5 layer | I2 (tokenizer option lost when the DDL was rewritten in commit 8); `toFtsQuery`; the `chunks_fts` column order vs the `'delete'` command form |
| Only the **hybrid** row moved | The vector leg | **I5 — the composed embed input**: `index-documents.ts:88,117`, `sync-index.ts:130,177`, `search-documents.ts:107`. Check for a dropped space after `passage:`/`query:`, or a swapped `heading`/`content` order in the template |
| **Both** rows moved | Chunking or corpus | I6; `NO_CHUNKING`'s value; `minTokens`/`maxTokens`; `exclude` |
| Counts, INDEX.md and both rows all fine but a specific case regressed | Ranking-adjacent code | I4 (RRF), `excerpt.ts`, `similarity.ts` |

**The rule: delivery is blocked until the deviation is attributed to a specific commit and that commit
is corrected.** "Close enough", "the difference is within noise", and "adopt the new numbers as the
baseline" are not available outcomes. The eval is deterministic — same corpus, same model, same k — so
any movement is a code change, not variance.

---

## Delivery

**One PR on `refactor/english-contract`, carrying `size:exception`**, accepted by the user in advance
(~1,640 occurrences across 56 files). Slicing across PRs is unavailable: with no compatibility shims,
every intermediate PR after commit 2 would ship a red build.

Commit structure is therefore the only reviewability lever, and it has to carry real weight
(`work-unit-commits`): each of the 11 commits has one purpose, is green in isolation, includes its own
tests, and is independently revertible without disturbing unrelated work.

**Review order for the PR body:**

1. **Commit 9** — the MCP/CLI surface. The only externally visible contract change. Review first.
2. **Commit 7** — the frontmatter source keys. The only commit that changes *which key is read from
   disk*; everything else is labels. Small diff, highest scrutiny per line.
3. **Commit 8** — the SQL schema. Where the FTS5 and reserved-word hazards land.
4. **Commit 1** — the safety net, to judge whether it is adequate.
5. **Commits 2–6, 10, 11** — mechanical; skim for anything that is not a rename.

**Explicitly out of scope for review comments:** the Spanish content of `ejemplos/`, `goldenset.yaml`,
`CONCEPT_STEMS` values, and the two `cli.ts` goldenset literals. These are frozen by design, with
stated reasons.

Per the proposal, the pre-PR review is the full 4R fan-out (`review-risk`, `review-resilience`,
`review-readability`, `review-reliability`), justified by diff size plus the config/schema surface.

## Rollback

Unchanged from the proposal, and trivial by construction: no durable artifact outlives the code.
Delete the branch or revert the merge; `.compendio/*.db` is a derived cache that `compendio index`
rebuilds via `reset()`'s drop-and-recreate; the three `ejemplos/` lines revert with the same
`git revert`; no user configs exist. No data migration, no manual `.compendio/` deletion, no downgrade
tooling.

## Risks

| # | Severity | Risk | Handling |
|---|---|---|---|
| 1 | **High** | A leftover Spanish identifier compiles, behaves identically, and is self-consistent — invisible to `tsc`, to the test suite, and to any case-sensitive or word-bounded search | Decision B: every verification search is `rg -i` on a root, never `-w`; the measured 1-vs-7 demonstration is kept in the design so nobody reverts it. Sweeps A and B are commit 11's completion criterion |
| 2 | **High** | A renamed `as`-cast row shape silently yields `undefined` — no compiler or test signal | Decision G: row shapes track the DDL, never the domain, through commits 2–7; `ChunkMissingVector`'s SQL aliases named as per-commit checklist items |
| 3 | **High** | A missed config key in a JSON fixture degrades silently through tolerant defaults, with a fully green suite | Decision C: commit 1's deny-list assertion turns it red; the fixture JSON is listed explicitly in commits 3, 6 and 10 |
| 4 | **High** | FTS5 `content` column vs `content=` option | Decision D: commit 1's A0–A7 probe, blunt fallback criterion, fully specified `body` variant |
| 5 | Medium | An invariant points at plausible files rather than the ones holding the logic, so a reviewer signs off on an unexamined regression | Every I1–I6 file reference re-derived from measurement and cited with `file:line`; I5 and I6 were both wrong on the first pass and are corrected |
| 6 | Medium | Naive find-replace corrupts compounds (`statuss`, `statusExcluidos`, `sectiones`) | Decision B: longest-token-first, per-symbol typecheck |
| 7 | Medium | A partially applied group leaves the build red | Group boundary = commit boundary; typecheck + test after each; never split a group |
| 8 | Medium | `mode`/`module` lookalikes; two distinct `modo` symbols both targeting `mode` | Reviewer flag in Decision B; renamed in different commits (5 and 6) so the diffs stay separable |
| 9 | Medium | The translated strict fixture matches no `CONCEPT_STEMS` group, making the deny-list assertion order-dependent | Decision H's procedure, with append-only stems and a proof that appending preserves `ejemplos/` geometry exactly |
| 10 | Low | `NO_CHUNKING`'s value or `EXAMPLES_DOCS`'s path literal gets "translated", changing the corpus chunk count | Sweep A allow-list with the measured count of 5 for `"glosario.md"`; `// es-frozen:` markers; invariant I6 |
| 11 | Low | MCP descriptions, CLI help and `README.md:232` need authoring, not word-swapping | Budgeted as writing time in commits 9 and 11, separate from the mechanical count |
| 12 | Low | `openspec/specs/` retains residual Spanish vocabulary and blocks archival | Commit 11's gate is Sweep B plus the archive rule from `openspec/config.yaml` |

## Open questions

- [ ] Whether the FTS5 probe passes (A0–A7) or the `body` fallback is adopted. **Resolved in commit 1,
      before any rename.** The design is complete under either outcome; nothing downstream branches
      except the physical column name and one `toChunk` line.
- [ ] Whether `CONCEPT_STEMS` needs an appended English group. **Resolved empirically in commit 10** by
      Decision H's procedure — no judgement call remains, only a test result.
- [ ] The Sweep A allow-list is seeded from measurement but cannot be closed in advance: Spanish query
      strings against the frozen corpus may legitimately survive in the test suite. **Closed at commit
      10** by the `// es-frozen:` marker convention, which converts each survivor into an explicit
      author claim rather than a reviewer judgement call.
- [ ] Non-blocking, deferred: `--dir` is already English but inconsistent with `--all`/`--lexical`
      phrasing on the `index-md` command. Out of scope; a rename is not a UX review.
