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

## Defect in the design's own gating — fix before resuming

**`npm run typecheck` does not cover `test/`.** Verified in `tsconfig.json`:

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

0. **Fix the gating defect above first.** Resuming without it repeats the same blind spot ten more times.
1. **Finish commit 2**: update every `DocumentMeta`/`Chunk` fixture and assertion under `test/` to the
   renamed fields, and delete the `& { ruta?: string }` widening rather than translating it. Gate on
   `npm test` green plus commit 2's "Done when" search.
2. Then continue as originally recorded:

Next: Commit 2 — path-identifying fields (`ruta`→`path`, `seccion`→`section`, `secciones`→`sections`,
`seccionesDisponibles`→`availableSections`, `encabezado`→`heading`, `getDocumentByRuta`→
`getDocumentByPath`, `groupByRuta`→`groupByPath`, plus the port/type fields listed in design.md's
Commit 2 table). Remember the silent-green trap: edit `listChunksMissingVectors`'s SQL aliases
(`d.ruta AS ruta`→`AS path`, `c.encabezado AS encabezado`→`AS heading`) in the SAME commit, and do NOT
touch `DocumentRow.ruta`/`ChunkRow.encabezado`/DDL/`read_doc` Zod keys/`--dir` yet (Decision G).
