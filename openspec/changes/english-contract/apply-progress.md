# Apply Progress: English Contract

Branch: `refactor/english-contract`. Mode: **Strict TDD** (behavior-preserving rename; the existing
suite is the specification — RED/GREEN applies to the two genuinely new tests in commit 1 and the
active-proof tasks; all other commits are gated by keep-green-throughout, not new-test-first).

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.1/1.3 new tests | Written first against the still-Spanish tree; both would fail if the mechanism under test were broken (verified: FTS5 probe answers a real open question, deny-list test targets an existing but previously-unobserved fixture behavior) | `npm test` green — all 5 FTS5 assertions (A0-A7 folded into 5 `it` blocks) pass, deny-list assertion passes | N/A — new permanent regression tests, no refactor needed |
| 2.3 (`listChunksMissingVectors` active proof) | pending | pending | pending |
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
- [ ] Commit 2 — Path-identifying fields (M) — **PARTIALLY APPLIED, UNCOMMITTED, BROKEN**
  - Corrected after the run ended: this entry said "NOT STARTED", but the working tree was measured
    directly and holds partial commit-2 work. The apply run terminated on an external API spend limit
    mid-commit and never updated this file. Trust the measurement below, not the original line.
  - 29 files changed, ~234 insertions / ~229 deletions, none committed.
  - `src/domain/model.ts` renames applied: `ruta`→`path`, `seccion`→`section`, `encabezado`→`heading`.
  - `npm run typecheck` passes — **and that is misleading, see the gating defect below.**
  - `npm test` **FAILS: 89 tests red across 8 files.** Representative:
    `SqliteError: NOT NULL constraint failed: documents.ruta` at
    `src/infrastructure/sqlite/sqlite-index-store.ts:165` (`ruta: meta.path`) — the domain type was
    renamed, the `test/` fixtures constructing it were not.
  - This is the expected mid-group state (the design establishes there is no green intermediate state
    *inside* a symbol group), not evidence the plan is wrong. The group is simply half-finished.
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

The gating defect is fixed. The tree is clean at `7b0a34f` and fully green — start commit 2 from
there, from scratch.

The earlier half-applied commit-2 attempt was **not** kept in the working tree. It is preserved in
`git stash` as `stash@{0}` ("wip-commit2-partial") purely as a reference; it was ~234 lines of
mechanical renaming that is cheaper to redo cleanly than to reason about half-applied. Do not
`git stash pop` it — redo commit 2 from the clean tree. Drop the stash once commit 2 lands.

When redoing commit 2, note two things that attempt got wrong:

- The `test/` fixtures were never updated alongside the domain types. With typecheck now covering
  `test/`, this surfaces immediately instead of as an opaque SQL NOT NULL failure.
- `test/infrastructure/sqlite-index-store.test.ts:5` declares
  `function meta(overrides: Partial<DocumentMeta> & { ruta?: string } = {}): DocumentMeta`. That
  `& { ruta?: string }` widening is pre-existing. **Delete it, do not translate it** — it is a type
  escape hatch that lets a retired key through silently. Audit `test/` for other widenings of the
  same shape.

Next: Commit 2 — path-identifying fields (`ruta`→`path`, `seccion`→`section`, `secciones`→`sections`,
`seccionesDisponibles`→`availableSections`, `encabezado`→`heading`, `getDocumentByRuta`→
`getDocumentByPath`, `groupByRuta`→`groupByPath`, plus the port/type fields listed in design.md's
Commit 2 table). Remember the silent-green trap: edit `listChunksMissingVectors`'s SQL aliases
(`d.ruta AS ruta`→`AS path`, `c.encabezado AS encabezado`→`AS heading`) in the SAME commit, and do NOT
touch `DocumentRow.ruta`/`ChunkRow.encabezado`/DDL/`read_doc` Zod keys/`--dir` yet (Decision G).
