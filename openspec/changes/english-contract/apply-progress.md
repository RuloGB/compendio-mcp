# Apply Progress: English Contract

Branch: `refactor/english-contract`. Mode: **Strict TDD** (behavior-preserving rename; the existing
suite is the specification — RED/GREEN applies to the two genuinely new tests in commit 1 and the
active-proof tasks; all other commits are gated by keep-green-throughout, not new-test-first).

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.1/1.3 new tests | Written first against the still-Spanish tree; both would fail if the mechanism under test were broken (verified: FTS5 probe answers a real open question, deny-list test targets an existing but previously-unobserved fixture behavior) | `npm test` green — all 5 FTS5 assertions (A0-A7 folded into 5 `it` blocks) pass, deny-list assertion passes | N/A — new permanent regression tests, no refactor needed |
| 2.3 (`listChunksMissingVectors` active proof) | N/A — extends existing coverage, not new-test-first (keep-green-throughout mode) | `npm test` green; new assertions explicitly check `missing[0]?.path`/`missing[0]?.heading` are defined before the `toEqual` | N/A |
| 3.3/6.6/10.6 (deny-list re-run) | N/A — reuses 1.3's test unmodified | pending | pending |

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
- [ ] Commit 3 — Taxonomy fields and their compounds (L) — NOT STARTED
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

Commit 2 landed clean at `922f2eb`. `stash@{0}` ("wip-commit2-partial") has been dropped — no longer
referenced anywhere.

Verified state at `922f2eb`: `npm run typecheck` clean, `npm test` 24 files / 219 tests green,
working tree clean.

**Methodology note for the remaining commits (3–11)**: a bulk whole-identifier (word-boundary,
case-sensitive) rename script was used for the majority of files in commit 2 — safe because `tsc`
adjudicates every occurrence and the script only ever runs against a single commit's ordered,
longest-first rename map. Files with a touch/no-touch split within the SAME file (SQL row-shape
carve-outs per Decision G, MCP wire params staying Spanish until commit 9, discriminant string
LITERALS staying Spanish until commit 5 while the surrounding FIELD names rename now) were edited
fully by hand instead, because a blind regex cannot tell "this `ruta` is a property name" from "this
`ruta` is inside a frozen string value". The same approach — script for uniform files, hand-editing
for files with an internal carve-out — is expected to keep working through the remaining commits, with
the carve-out file set changing per commit (consult each commit's "Explicitly NOT touched" row in
design.md before choosing which files to script vs. hand-edit).

**Also verify per-commit, not just per design table**: after any commit's rename, re-run that commit's
own `rg -i -n '<roots>' src test` done-when check on the FULL tree (not just the files touched by the
rename map) — local variables that merely CONTAIN a renamed root (e.g. `hashMatchRutas`, `porRuta`,
`listedRutas`) are not always enumerated in design.md's per-commit symbol tables (which list
types/interfaces/methods, not every local var) but WILL fail the done-when sweep if left unrenamed.
Commit 2 needed this cleanup pass in `sync-index.ts`, `sync-index.test.ts`, `index-and-search.test.ts`,
`generate-index-md.test.ts`, `index-markdown.test.ts`, and `evaluate-search.ts` beyond the design's
literal symbol list — see the commit-2 entry above for the exact identifiers.

Next: **Commit 3 — Taxonomy fields and their compounds (L)**. Longest-first:
`estadosExcluidos`→`excludedStatuses`, `estados`→`statuses`, `estado`→`status`; `tipos`→`types`,
`tipo`→`type`; `modulo`→`module`; `etiquetas`→`tags` (`resolveEtiquetas`→`resolveTags`,
`EtiquetasResult`→`TagsResult`); `propietario`→`owner`; `actualizado`→`updated`; `porTipo`/`porModulo`→
`byType`/`byModule`; `parseTipo`→`parseType`; `incluirNoVigentes`→`includeExcluded`. Silent-green trap
(Decision A/C): rename the same fields in `test/fixtures/estricto/compendio.config.json`, the inline
JSON in `config.test.ts`, and `build.ts`'s `ESTRICTO_FIXTURE_CONVENCION` field names, in this SAME
commit — then re-run commit 1's deny-list subprocess assertion (task 3.3) to prove the tolerant
`mergeConfig` whitelist didn't silently swallow the rename. Do NOT touch yet: `frontmatterFields`
**values** (still `"tipo"/"modulo"/"estado"` — commit 7); `data["etiquetas"]`/`["propietario"]`/
`["actualizado"]` (commit 7); SQL columns; `--tipo` flag; Zod keys. Reviewer-attention flag: `mode`/
`module` lookalikes begin appearing from this commit on.
