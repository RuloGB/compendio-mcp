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
- [ ] Commit 4 — Content and structural fields (L) — NOT STARTED
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

Commit 3 landed clean at `65e06b6`. Tree clean, `stash@{0}` reference fully retired (dropped after
commit 2).

Verified state at `65e06b6`: `npm run typecheck` clean, `npm test` 24 files / 219 tests green,
`npm run build` clean, `src/domain/` purity verified.

**Methodology note for the remaining commits (4–11)**, confirmed working across commits 2 and 3: a
bulk whole-identifier (word-boundary, case-sensitive) rename script for the majority of files per
commit — safe because `tsc` adjudicates every occurrence. Files with a touch/no-touch split within the
SAME file (SQL row-shape carve-outs per Decision G, MCP wire params staying Spanish until commit 9,
discriminant string LITERALS staying Spanish until commit 5 while the surrounding FIELD names rename
now, `camposFrontmatter`'s KEYS-rename-but-VALUES-frozen shape per Decision F) are edited fully by
hand, because a blind regex cannot tell "this token is a property name" from "this token is inside a
frozen string value or a frozen object value". Continue this approach for commits 4–11.

**Also verify per-commit, not just per design table**: after any commit's rename, re-run that commit's
own `rg -i -n '<roots>' src test` done-when check on the FULL tree (not just the files touched by the
rename map) — local variables/synthetic test-fixture identifiers that merely CONTAIN a renamed root
(e.g. commit 2's `hashMatchRutas`/`porRuta`; commit 3's `conEtiqueta`, `sin-estado.md`, `tipo-invalido.md`)
are not always enumerated in design.md's per-commit symbol tables (which list types/interfaces/methods,
not every local var or fixture filename) but WILL fail the done-when sweep if left unrenamed. Also
watch for identifiers explicitly scheduled for a LATER commit in design.md's own tables (e.g. commit 3
deliberately left `inferirModulo`, `crearComparadorIndice`, `ConvencionConfig`, `modo` untouched even
though they contain/relate to this commit's roots, because design.md's Commit 6 table owns their
rename) — these are legitimate deferrals, not misses; cross-check design.md's LATER commit tables before
"fixing" a hit that's actually scheduled ahead.

**Discovered in commit 3, applies going forward**: `file-index-writer.ts:25`'s English idiom "modulo"
(mathematics/"except for") is an exact-word collision with the Spanish root `modulo` that Decision B's
stated false-positive audit did not anticipate (it only checked substring collisions, not exact-word
ones). It will keep surfacing in every `modulo`-root sweep from here through Sweep A/B — it is correct
English, not a rename miss, and does not fit `// es-frozen:` (never Spanish). Recommend documenting it
in design.md's Sweep A allow-list at commit 11 rather than re-diagnosing it each commit.

Next: **Commit 4 — Content and structural fields (L)**. Symbols: `contenido`→`content`, `orden`→
`position` (Decision 2 — `order` is a SQLite reserved word), `resumen`→`summary` (`condenseResumen`/
`displayResumen`→`condenseSummary`/`displaySummary`), `titulo`→`title`, `texto`/`textos`→`text`/`texts`,
`extracto`→`excerpt`, `Piece.texto`, `DocSection.{titulo,texto}`, `DocOutline.{titulo,resumen,secciones}`.
Silent-green trap (Decision A/G, same pair as commit 2): edit `listChunksMissingVectors`'s
`c.contenido AS contenido`→`AS content` in `sqlite-index-store.ts`, in the SAME commit — extend the
commit-2 active-proof assertion in `sqlite-index-store.test.ts` to also cover a defined, non-`undefined`
`content` value. Do NOT touch: `chunks.contenido`/`chunks.orden` DDL, `ORDER BY orden`,
`insertChunk`/`insertFts`/`deleteFts`, `ChunkRow`, the inline cast in `deleteDocumentRows` (all Decision
G, commit 8). Expect the same "beyond the literal symbol table" cleanup pass this commit's own
`rg -i -n 'contenido|orden|resumen|titulo|texto|extracto' src test` done-when check will require.
