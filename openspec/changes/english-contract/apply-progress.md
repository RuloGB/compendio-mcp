# Apply Progress: English Contract

Branch: `refactor/english-contract`. Mode: **Strict TDD** (behavior-preserving rename; the existing
suite is the specification — RED/GREEN applies to the two genuinely new tests in commit 1 and the
active-proof tasks; all other commits are gated by keep-green-throughout, not new-test-first).

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.1/1.3 new tests | Written first against the still-Spanish tree; both would fail if the mechanism under test were broken (verified: FTS5 probe answers a real open question, deny-list test targets an existing but previously-unobserved fixture behavior) | `npm test` green — all 5 FTS5 assertions (A0-A7 folded into 5 `it` blocks) pass, deny-list assertion passes | N/A — new permanent regression tests, no refactor needed |
| 2.3 (`listChunksMissingVectors` active proof) | N/A — extends existing coverage, not new-test-first (keep-green-throughout mode) | `npm test` green; new assertions explicitly check `missing[0]?.path`/`missing[0]?.heading` are defined before the `toEqual` | N/A |
| 3.3/6.6/10.6 (deny-list re-run) | N/A — reuses 1.3's test unmodified | 3.3 done: `npm test` green with `test/fixtures/estricto/compendio.config.json`'s `tipos/estados/estadosExcluidos`→`types/statuses/excludedStatuses`; 6.6/10.6 pending | pending |

## Commit Status

- [x] **Commit 1 — Safety net (S)** — `74ac6fa`
  - Added `test/infrastructure/fts5-external-content.test.ts` (Decision D, A0-A7 as 5 `it` blocks).
    **Result: all pass.** The `body` fallback is **NOT** needed — commit 8's DDL uses bare `content`
    directly alongside `content=chunks`. This is the single most consequential open question in the
    design, now closed.
  - Added the deny-list subprocess assertion to `test/cli-subprocess.test.ts`: query `"plan de pruebas
    alertas"` (verified unique to `plan-pruebas-alertas.md` within the estricto fixture — checked
    against the other 4 docs' prose) — absent without `--todos`, present with `--todos`.
  - Gate: `npm run typecheck` clean, `npm test` — 24 files / 219 tests green.
- [x] **Commit 2 — Path-identifying fields (M)** — `922f2eb`
  - Redone from a clean tree (the earlier partial attempt was never kept; `wip-commit2-partial` stash
    dropped after this commit landed). `rg -i -n 'ruta|seccion|encabezado' src test` was applied
    file-by-file: whole-identifier bulk rename script for the ~30 files with no touch/no-touch split,
    fully manual edits for `sqlite-index-store.ts` (+ test), `server.ts`, `read-document.ts` (+ test) —
    the files where the SQL row-shape carve-out (Decision G) and the still-Spanish `read_doc` Zod keys
    (commit 9) sit next to identifiers that DO rename now.
  - `listChunksMissingVectors`'s SQL aliases updated in the same commit (`d.ruta AS ruta`→`AS path`,
    `c.encabezado AS encabezado`→`AS heading`); `c.contenido AS contenido` untouched (commit 4). Active
    proof added: `sqlite-index-store.test.ts`'s `listChunksMissingVectors` describe block now asserts
    `missing[0]?.path`/`missing[0]?.heading` are defined, non-undefined, before the existing `toEqual`.
  - Deleted the pre-existing `& { ruta?: string }` widening in `sqlite-index-store.test.ts`'s `meta()`
    helper per the resume note (not translated). Audited `test/` for the same widening shape
    (`& { (ruta|seccion|encabezado|tipo|modulo|estado|etiquetas)\?` ...): none found elsewhere.
  - Beyond the design's explicit symbol table, also renamed local-variable-only leftovers that matched
    the `ruta` root and would otherwise have failed this commit's own done-when sweep:
    `sync-index.ts`'s `hashMatchRutas`/`existingByRuta`/`discoveredRutas`/`protectedRutas`/`failedRutas`/
    `byRuta`, `sync-index.test.ts`'s `ThrowingStore` constructor params, `index-and-search.test.ts`'s
    `rutas`/`porRuta` locals, `generate-index-md.test.ts`'s `rutas` local, `index-markdown.test.ts`'s
    `listedRutas` helper, `evaluate-search.ts`'s `uniqueInOrder(rutas)` param. None of these were listed
    explicitly in design.md's Commit 2 table (which enumerates types/methods, not every local variable);
    they were required to satisfy commit 2's own `rg -i -n 'ruta|seccion|encabezado' src test` gate.
  - Server.ts's tool descriptions (Spanish prose) had the specific words "ruta"/"seccion"/"encabezado"
    swapped in place (not re-authored) where they appeared, since those words are covered by this
    commit's own sweep even though the surrounding sentence stays Spanish until commit 9's full
    re-authoring. This produces intentionally awkward bilingual intermediate text (e.g. "Si la path no
    existe") — expected and bounded by commit 9, not a defect.
  - Post-commit-2 sweep for `ruta|seccion|encabezado` returns only: `sqlite-index-store.ts`'s SQL layer
    (DDL, prepared statements, `DocumentRow.ruta`/`ChunkRow.encabezado`, row-shape casts — all Decision
    G, untouched until commit 8); the `read_doc` MCP wire keys in `server.ts`/`server.test.ts` (commit
    9); the `ReadResult` discriminant string values `"seccion"`/`"ruta-no-encontrada"`/
    `"seccion-no-encontrada"` in `read-document.ts`/`read-document.test.ts`/`index-and-search.test.ts`
    (commit 5); the simulated legacy-schema DDL string in `sqlite-index-store.test.ts`'s reset() test
    (mirrors production DDL, same Decision G carve-out).
  - Gate: `npm run typecheck` clean, `npm test` 24 files / 219 tests green.
- [x] **Commit 3 — Taxonomy fields and their compounds (L)** — `65e06b6`
  - Longest-first: `estadosExcluidos`→`excludedStatuses`, `estados`→`statuses`, `estado`→`status`;
    `tipos`→`types`, `tipo`→`type`; `modulo`→`module`; `etiquetas`→`tags` (`resolveEtiquetas`→
    `resolveTags`, `EtiquetasResult`→`TagsResult`); `propietario`→`owner`; `actualizado`→`updated`;
    `porTipo`/`porModulo`→`byType`/`byModule`; `parseTipo`→`parseType`; `incluirNoVigentes`→
    `includeExcluded`.
  - **Correction to commit 2's own record**: `ReadResult`'s discriminant FIELD name `tipo`→`type` was
    missed in commit 2 (only the port/domain fields were done). Fixed here — the field name renames now,
    its string VALUES (`"documento"`/`"seccion"`/etc.) stay Spanish until commit 5, per the same
    asymmetric-rename pattern as the SQL row shapes.
  - `camposFrontmatter`'s inner shape `{ tipo: string; modulo: string; estado: string }` → `{ type:
    string; module: string; status: string }`: the KEYS are genuine TS property names (whole-program
    scope), the VALUES stay `"tipo"/"modulo"/"estado"` (frozen until commit 7, Decision F). Applied
    consistently in `config.ts`'s `DEFAULT_CONFIG`, `build.ts`, and every test fixture constructing this
    shape.
  - Silent-green trap (Decision A/C): `test/fixtures/estricto/compendio.config.json`'s `tipos/estados/
    estadosExcluidos`→`types/statuses/excludedStatuses`, `config.test.ts`'s inline JSON, `build.ts`'s
    `ESTRICTO_FIXTURE_CONVENCION`. Active proof (3.3): commit 1's deny-list subprocess assertion re-run
    green with the renamed keys.
  - `formatFrontmatter`'s rendered YAML labels (`tipo:`/`modulo:`/`estado:`/`propietario:`/`etiquetas:`/
    `actualizado:`) deliberately kept Spanish — they mirror the frontmatter source-key convention, which
    doesn't flip until commit 7. Only the `meta.X` property reads driving them were renamed.
  - Beyond design.md's symbol table (same class of gap as commit 2, required by this commit's own
    done-when sweep, not by the design's literal per-commit list): local vars/synthetic test paths
    containing a root — `conEtiqueta`→`withTag`, `guias/tipo-invalido.md`→`guias/type-invalido.md`,
    `sin-estado.md`→`sin-status.md`, `sin-tipo.md`→`sin-type.md`, a stray comment in `get-overview.ts`
    ("sin tipo"/"sin modulo" → "no-type/no-module"), and `warnIfLegacyEstadosExcluidos`'s advice string
    (`'convencion.estadosExcluidos'`→`'convencion.excludedStatuses'` — the ADVICE half only; the
    retired-key DETECTION check `"estadosExcluidos" in search` stays literal since it matches a key
    spelling that was never renamed).
  - **False positive discovered in Decision B's root-collision check**: `file-index-writer.ts:25`'s
    comment "the same content modulo EOL" uses the genuine English word "modulo" (mathematics/idiom for
    "except for"), which exactly collides with the Spanish root `modulo`. Design's stated false-positive
    audit ("none of them is a substring of an English word used here") did not catch this because it's
    not a *substring* collision, it's an *exact-word* collision. Left as-is (correct English); flagging
    for the final Sweep A review since it will keep appearing as an unmarked hit that is not a rename
    miss — this is a legitimate Sweep A allow-list candidate, not something `// es-frozen:` fits (it was
    never Spanish).
  - Gate: `npm run typecheck` clean, `npm test` 24 files / 219 tests green, `npm run build` clean,
    `src/domain/` purity verified (no `node:`/`better-sqlite3`/`sqlite-vec`/`@xenova`/`gray-matter`/
    `remark` imports).
- [x] **Commit 4 — Content and structural fields (L)** — `ffe0a54`
  - `contenido`→`content`, `orden`→`position` (Decision 2), `resumen`→`summary` (`condenseResumen`/
    `displayResumen`→`condenseSummary`/`displaySummary`, `MAX_RESUMEN_CHARS`→`MAX_SUMMARY_CHARS`),
    `titulo`→`title`, `texto`/`textos`→`text`/`texts`, `extracto`→`excerpt`, `Piece.texto`,
    `DocSection.{titulo,texto}`, `DocOutline.{titulo,resumen,secciones}`.
  - **Methodology defect found and fixed mid-commit — read this before commits 5-11.** This commit's
    roots (`contenido`/`texto`/`resumen`/`titulo`) are ordinary Spanish words that also occur as
    arbitrary prose inside test-fixture STRING VALUES (markdown bodies, FTS5 search-query text) all over
    the suite — unlike commits 2/3's more technical roots, which rarely collided with prose. The plain
    word-boundary bulk script used for commits 2-3 (`rename.mjs`) is regex-only and cannot tell an
    identifier from string content; run on commit 4's file set it corrupted Spanish test data (e.g.
    `"contenido comun"` search text became `"content comun"`) in ~8 files. **Caught by diff review before
    committing** (not by the test suite — the corrupted strings still coincidentally contained the
    matched search substrings, so `npm test` stayed green on the corrupted state, proving Decision A's
    point that not every defect surfaces as a red test).
  - **Recovery**: `git restore --source=HEAD -- <32 files>` reverted every uncommitted change back to
    commit 3 (per-file, since a blanket `git checkout -- .`/`git reset --hard` is blocked by the sandbox
    classifier as destructive — `git restore --source=HEAD -- <explicit paths>` is the permitted
    equivalent). Verified back to `65e06b6`'s exact green state before redoing.
  - **New tool**: `rename-safe.mjs`, a small hand-written lexer (not a full parser — good enough for this
    codebase's syntax) that segments each file into `code` and `string` spans, tracking single/double
    quotes and template literals (including `${...}` interpolations, which ARE code, and nested
    templates). Renames apply only to `code` spans — identifiers, comments, and template interpolation
    expressions — never to string/template literal text. Verified on a synthetic test file covering
    comments, object keys vs. string values, template interpolation, nested templates, and single-quoted
    strings before trusting it on real files. **Use `rename-safe.mjs`, not `rename.mjs`, for all
    remaining commits (5-11)** — commits 2/3's roots happened not to collide with prose, but that was
    luck, not a property of those commits; there is no reason later commits (`resultados`, `errores`,
    CLI/MCP prose) would be safer.
  - One known gap in the lexer (documented, not hit in practice this commit): a double-quoted TS
    type-level string literal (`Pick<DocumentMeta, "titulo" | "resumen" | ...>`) is lexically
    indistinguishable from runtime string data, so the tokenizer protects it too — this was **not** a
    silent miss because `tsc` immediately flagged the resulting type mismatch (`index-markdown.ts`'s
    `IndexEntry` `Pick<>`), fixed by hand. Grep for `Pick<|Omit<|keyof ` before trusting the script on a
    file if a future commit's roots might appear in one of those constructs.
  - Also renamed test-title strings that literally quote a renamed function/concept name (same class as
    commits 2/3's `describe("parseTipo"...)`-style misses, since these ARE meant to track the identifier
    despite being string content): `describe("condenseResumen"...)`→`"condenseSummary"`,
    `describe("GetOverview resumen fallback"...)`→`"GetOverview summary fallback"`, and the local var
    `contenidoLf`→`contentLf` in `file-index-writer.test.ts`.
  - Silent-green trap (Decision A/G, same pair as commit 2): `listChunksMissingVectors`'s
    `c.contenido AS contenido`→`AS content` in `sqlite-index-store.ts`. Active proof extended: the
    commit-2 assertion in `sqlite-index-store.test.ts` now also checks `missing[0]?.content` is defined,
    non-undefined, before the `toEqual`.
  - `toDocument`/`toChunk` mappers in `sqlite-index-store.ts` now fully asymmetric on all four renamed
    fields (`title: row.titulo`, `summary: row.resumen`, `content: row.contenido`, `position: row.orden`)
    — matches Decision G's description of the end state through commit 7, symmetric again at commit 8.
  - Verified invariant I1 (`RemarkMarkdownParser.parse` still destructures `{ data, content }` from
    `matter(raw)`) and I5 (embed composition templates `` `passage: ${p.text}` ``/
    `` `passage: ${chunk.heading}\n${chunk.content}` ``/`` `query: ${query.query}` `` byte-identical
    except for the identifier renames — no dropped space, no reordering) directly in the diff.
  - Gate: `npm run typecheck` clean, `npm test` 24 files / 219 tests green, `npm run build` clean,
    `src/domain/` purity verified.
- [ ] Commit 5 — Report and response fields (M) — NOT STARTED
- [ ] Commit 6 — Configuration surface (M) — NOT STARTED
- [ ] Commit 7 — Frontmatter source keys, with the corpus (S, high scrutiny) — NOT STARTED
- [ ] Commit 8 — SQL schema (L) — NOT STARTED (fallback resolved: no `body` variant, use `content`)
- [ ] Commit 9 — MCP and CLI surface (L) — NOT STARTED
- [ ] Commit 10 — Strict fixture translation (M) — NOT STARTED
- [ ] Commit 11 — Specs and documentation (M) — NOT STARTED
- [ ] Final Verification (12.1-12.13) — NOT STARTED

## Decisions recorded during apply

- **FTS5 probe result (blocks Open Question 1 in design.md)**: A0-A7 all pass on the target schema.
  Commit 8 DDL: `chunks_fts USING fts5(content, heading, content=chunks, content_rowid=id,
  tokenize='unicode61 remove_diacritics 2')` — no `body` fallback anywhere in this change.

## Defect in the design's own gating — FIXED in `7b0a34f`

**Resolved. Do not redo this work.** `npm run typecheck` now runs `tsc --noEmit && tsc -p
tsconfig.test.json` and covers `src/` and `test/`. A separate `tsconfig.test.json` was added rather
than widening the base config, so `npm run build` still emits only `src` to `dist`. It uses bundler
module resolution to match vitest's actual resolution of the extensionless relative imports the test
tree already uses — under the inherited `nodenext` setting those produced 68 `TS2835` plus 50
cascading implicit-any errors, none of them real defects. The single genuine violation that remained
(a `noUncheckedIndexedAccess` breach in `test/helpers/fake-embeddings.ts`) was fixed with the non-null
assertion idiom already used a few lines below it.

Measured proof the gate now works: with the half-applied commit 2 in the tree, the old typecheck
reported **0 errors** while 89 tests failed; the new one reports **194 errors** pointing at each stale
fixture field.

Verified state at `7b0a34f`: `npm run typecheck` clean, `npm test` 24 files / 219 tests green,
`npm run build` clean with no test output in `dist/`.

The original diagnosis is kept below for the record.

---

**`npm run typecheck` did not cover `test/`.** Verified in `tsconfig.json`:

```json
"rootDir": "src",
"include": ["src/**/*"]
```

The design's per-commit gate is "`npm run typecheck`, then `npm test`", and the fresh-context review
signed off that each commit boundary leaves a "self-consistent, compilable" state. Both were
reasoning about a compiler that never looks at the ~3,700 LOC of test code this change renames.
TypeScript is **not** a safety net for the test tree; only `npm test` is.

Observed consequence: `test/infrastructure/sqlite-index-store.test.ts:5` declares

```ts
function meta(overrides: Partial<DocumentMeta> & { ruta?: string } = {}): DocumentMeta
```

The `& { ruta?: string }` widening is **pre-existing** — that file's diff is empty, the apply run
never touched it — but with `tsc` blind to `test/`, nothing flags that the helper still emits the
retired key, and the value arrives at the SQL binding as `undefined`.

Same class as the two silent-green traps the design documents, occurring inside the gate meant to
catch them.

**Required amendment:** either extend typecheck to the test tree (a `tsconfig.test.json` with
`include: ["src/**/*", "test/**/*"]`, wired into the `typecheck` script) or strike the claim that a
passing typecheck says anything about `test/`. The first is strongly preferred: it restores compiler
protection over half the renamed surface and would have caught this at edit time instead of test
time. Then audit `test/` for other widening escape hatches like `& { ruta?: string }` — each is a
place the compiler stays silent even after the include is fixed.

## Resume point

Commit 4 landed clean at `ffe0a54`. Tree clean.

Verified state at `ffe0a54`: `npm run typecheck` clean, `npm test` 24 files / 219 tests green,
`npm run build` clean, `src/domain/` purity verified, invariants I1/I5 spot-checked directly in the
diff.

**MANDATORY going forward — read before touching commit 5**: use the lexer-aware rename script
(reconstructed from scratch each apply session under
`.../scratchpad/rename-safe.mjs`; see the commit-4 entry above for its design — segments code vs.
string/template-literal content, renames only in code) for ALL bulk renames in commits 5-11, never the
plain word-boundary version. Commit 4 proved commits 2/3 got lucky: their roots (`ruta`/`tipo`/`estado`/
etc.) rarely collided with ordinary Spanish prose in test fixture strings, so the naive script happened
not to corrupt data — but commit 4's roots (`contenido`/`texto`/`resumen`/`titulo`) are common Spanish
words that appear constantly as arbitrary markdown-body/search-query test content, and the naive
version silently corrupted ~8 files' string literals (caught by diff review, NOT by the test suite,
which stayed green on the corrupted state — the corrupted strings still coincidentally contained the
substrings the tests searched for). Commits 5+ touch `resultados`/`errores`/`sincronizacion`/CLI+MCP
prose strings — assume the same collision risk applies, since "did it collide with prose last time" is
not evidence it won't this time.

**Recovery pattern if a bulk rename needs reverting**: `git checkout -- .` / `git reset --hard` are
blocked by the sandbox's destructive-command classifier. `git restore --source=HEAD -- <explicit file
list>` is the permitted equivalent for restoring specific files to the last commit — use it, not a
blanket revert.

**Also verify per-commit, not just per design table**: after any commit's rename, re-run that commit's
own `rg -i -n '<roots>' src test` done-when check on the FULL tree (not just the files touched by the
rename map) — local variables/synthetic test-fixture identifiers/describe-title strings that literally
quote a renamed function name (e.g. commit 4's `describe("condenseResumen"...)`, `contenidoLf`) are not
always enumerated in design.md's per-commit symbol tables but WILL fail the done-when sweep if left
unrenamed. Also watch for identifiers explicitly scheduled for a LATER commit in design.md's own tables
(e.g. commit 3 deliberately left `inferirModulo`/`ConvencionConfig`/`modo` untouched — commit 6's table
owns their rename) — legitimate deferrals, not misses; cross-check design.md's LATER commit tables
before "fixing" a hit that's actually scheduled ahead.

**Discovered in commit 3, still applies**: `file-index-writer.ts:25`'s English idiom "modulo"
(mathematics/"except for") is an exact-word collision with the Spanish root `modulo`, not a rename miss.
Document it in design.md's Sweep A allow-list at commit 11 rather than re-diagnosing it each commit.

**One lexer gap found in commit 4 (documented, not a recurring risk unless roots hit `Pick<>`/`Omit<>`/
`keyof`)**: TS type-level string literals (`Pick<DocumentMeta, "titulo" | ...>`) are lexically
indistinguishable from string data, so the lexer protects them too — `tsc` catches the resulting type
mismatch immediately (not silent), fix by hand. `rg -n 'Pick<|Omit<|keyof '` before trusting the script
on a commit whose roots might appear in one.

Next: **Commit 5 — Report and response fields (M)**. Symbols: `omitidos`→`skipped`, `indexados`→
`indexed`, `eliminados`→`deleted`, `avisoEmbeddings`→`embeddingsWarning`, `duracionMs`→`durationMs`,
`resultados`→`results`, `SearchResponse.modo`/`IndexReport.modo`/`SyncReport.modo`→`mode`,
`sincronizacion`→`sync`, `SincronizacionInfo`→`SyncInfo`, `toSincronizacionInfo`→`toSyncInfo`,
`errores`→`errors`, `erroresLectura`→`readErrors`, `cambiado`→`changed`, `existente`→`existing`,
`escrito`→`written`, `forzarLexico`→`forceLexical`. Value literals: `SearchMode` `"hibrido"`/`"lexico"`→
`"hybrid"`/`"lexical"` (incl. `EvalReport.hibrido`/`.lexico` keys); `ReadResult` discriminants
`"documento"`/`"seccion"`/`"ruta-no-encontrada"`/`"seccion-no-encontrada"`→`"document"`/`"section"`/
`"path-not-found"`/`"section-not-found"`. Eval fields: `pregunta`→`question`, `esperado`→`expected`,
`posicion`→`rank` (Decision K — NOT `position`, that's commit 4's `Chunk.position`), `fallos`→
`failures`, `casos`→`cases`. **Frozen boundary, assigned to THIS commit**: `cli.ts`'s `loadGoldenset`
literals `"pregunta"`/`"esperado"` stay Spanish forever (index into `ejemplos/goldenset.yaml`'s real
keys) — add `// es-frozen:` markers to both in this commit, not later (task 5.5). This is the first
commit with a Decision-B-flagged reviewer-attention risk already live from commit 3 (`mode`/`module`
lookalikes) plus a NEW one of its own: two distinct `modo` symbols (`SearchResponse.modo` etc. here,
`ConvencionConfig.modo` in commit 6) both target `mode` — expected to stay separable since they land in
different commits, per design.md's Decision B.
