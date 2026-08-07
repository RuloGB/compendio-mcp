# Archive Report: addressable-chunks

**Change**: addressable-chunks
**Archived**: 2026-08-07
**Status**: ARCHIVED (folder move performed by the orchestrator, not by this phase — see Scope Note)

## Executive Summary

The `addressable-chunks` change is implemented, verified (PASS WITH WARNINGS, 0 CRITICAL), and its
delta specs are merged into the main specs. Scope was **symptom only**, an explicit user decision:
this change guarantees every persisted chunk carries a non-empty `heading`, that `search_docs` never
returns `section: ""` for a document indexed under the corrected invariant, and that `read_doc`'s
failure path explains a sectionless document in prose instead of rendering an empty bullet.
**Individual fragment addressability is NOT delivered** — after this change, a heading-less
document's chunks still share one heading and `read_doc({ path, section })` still returns them
joined. The change name promises more than it ships; that boundary was a deliberate, recorded user
decision, not an oversight.

---

## Merge Summary

Both delta specs are **ADDED Requirements only** — confirmed by reading each delta in full before
merging. No MODIFIED or REMOVED blocks, so there is nothing destructive to warn the orchestrator
about; this is stated rather than assumed, per `rules.archive`'s "warn before merging destructive
deltas."

| Spec | Action | Requirements added | Placement |
|---|---|---|---|
| `openspec/specs/indexing/spec.md` | Merged | 2 | "Every Emitted Chunk Heading Is Non-Empty" inserted directly after "Every Split Piece Retains Its Full Heading Path" (the delta text states it composes with that requirement); "Heading-Only Changes Also Require a Full Reindex to Reach Existing Documents" inserted directly after "Chunk Boundary Changes Require a Full Reindex to Reach Existing Documents" (same operational shape, extended) |
| `openspec/specs/mcp-contract/spec.md` | Merged | 2 | "`search_docs`'s `section` Is Never Empty and Round-Trips" and "`read_doc` Never Renders an Empty-Labeled Bullet, and Explains a Sectionless Document in Prose" inserted together, in delta order, directly after "`search_docs` Omits Absent `status` from Result Items" — the nearest existing requirement about search_docs result-item field guarantees |

### Requirements After Merge (counted directly against the merged files, not assumed)

| Domain | Previous | Added | Total |
|---|---|---|---|
| indexing | 24 | 2 | **26** |
| mcp-contract | 14 | 2 | **16** |

Both requirement texts were copied **verbatim** from the delta specs — no paraphrasing, no
compression. This matters here specifically: the non-empty-heading requirement is deliberately
phrased as an invariant on the emitted chunk ("This is an invariant on the emitted `Chunk`, not a
guarantee about any upstream data source") rather than on a data source, and the `search_docs`
requirement is deliberately scoped to documents "indexed under the... invariant," with an explicit
scenario ("A corpus not yet reindexed is not repaired at query time") forbidding query-time repair of
stored empty headings. Both nuances are preserved intact in the merged text.

---

## Spanish Contract Vocabulary Check

Per `rules.archive`: confirm `openspec/specs/` carries no residual Spanish contract vocabulary
(`ruta`, `tipo`, `modulo`, `estado`, `etiquetas`, `seccion`, `omitidos`, `indexados`,
`avisoEmbeddings`, `convencion`, `estadosExcluidos`, `camposFrontmatter`) except where it quotes the
`ejemplos/` corpus.

**What was run**: no shell/grep tool was available in this phase's toolset (Read, Edit, Write, Glob
only). The check was performed by reading all six files under `openspec/specs/**/*.md` in full
(`indexing`, `mcp-contract`, `search`, `configuration`, `index-progress`, `index-md`) and scanning
each for the eleven restricted terms.

**Result**: zero occurrences of the restricted terms as active contract vocabulary anywhere in
`openspec/specs/`. One location contains several of the literal restricted words, and it is called
out explicitly rather than silently passed: `mcp-contract/spec.md`'s pre-existing requirement
"Renamed MCP Tool Signatures And Response Field Names" (unrelated to this change, predates it, not
touched by this merge) states — "No retired Spanish param or field name (`tipo`, `modulo`,
`etiquetas`, `ruta`, `seccion`, `incluir_no_vigentes`, `omitidos`, `indexados`, `avisoEmbeddings`)
MUST remain reachable through any tool call or response." That is documentation of forbidden
vocabulary in service of the English-contract requirement, not residual usage of it — the words
appear only inside a negative list, never as a live param/field name. Noted plainly here rather than
reported as a bare "not found," because a literal reading of those backticked words would in fact
match a naive grep; the distinction is intent (forbidding vs. using), and it is the same distinction
`rules.archive`'s `ejemplos/`-quoting exception already makes for a different case.

Every other spec file scanned clean: no occurrences of any restricted term, active or quoted.

---

## Artifact Verification

- `openspec/changes/addressable-chunks/exploration.md` — present
- `openspec/changes/addressable-chunks/proposal.md` — present (Gates 1-6, the "individual fragment
  addressability is NOT delivered" boundary stated explicitly at proposal level)
- `openspec/changes/addressable-chunks/specs/indexing/spec.md` — present, 2 ADDED requirements,
  merged
- `openspec/changes/addressable-chunks/specs/mcp-contract/spec.md` — present, 2 ADDED requirements,
  merged
- `openspec/changes/addressable-chunks/design.md` — present
- `openspec/changes/addressable-chunks/tasks.md` — present, **35/35 tasks marked `[x]`** (verified
  by reading the file directly; Task Completion Gate passes)
- `openspec/changes/addressable-chunks/apply-progress.md` — present
- `openspec/changes/addressable-chunks/verify-report.md` — present, verdict **PASS WITH WARNINGS**,
  **0 CRITICAL** (archive is not blocked; CRITICAL issues would have blocked it, per
  `sdd-archive`'s non-negotiable rule)
- `openspec/changes/addressable-chunks/state.yaml` — present, full decision/correction history read
  in full

---

## Measurements Carried Forward From Verification (not re-run by this phase)

| Metric | Value |
|---|---|
| `npm test` | **589/589** across 40 files (588 after apply; +1 added by the orchestrator closing warning W1 before archive, seeding a stored `heading: ""` chunk directly into `SqliteIndexStore` and asserting `search_docs` returns `section: ""` unrepaired) |
| `npm run typecheck` | clean |
| `npm run build` | clean |
| `compendio eval` on `ejemplos/` | identity with the pinned baseline — hybrid recall@5 1.00, MRR 0.943, 0 failures |
| Real diff size | **583 lines** in `src`+`test` (the apply report's 282 counted only the tracked diff; `git diff` cannot see the three new untracked test files, which add 301 lines: heading-less-round-trip 119, heading-fallback 65, format-read-result 117) — inside the design's 540-770 forecast, the first phase in this project's recorded history where the forecast did not have to grow again |
| Delivery | single PR, `size:exception` accepted by the user against a 400-line budget |
| Recorded observations | on the heading-less fixture (`test/fixtures/vector-reach/docs/`): **6 distinct headings, max 7 chunks-per-heading** (manual-extenso.md) — the baseline a future fragment-addressability cycle argues from |

---

## Two Defect Paths, Not One

Beyond the reported case (no H1 and no H2 in the source document), verification independently
reproduced a second, previously unnamed defect path against the real compiled parser: an empty ATX
heading (`##` with no text) is valid CommonMark, and `RemarkMarkdownParser` emits `title: ""` for it
— even inside a document that has a perfectly good H1 and H2 elsewhere. An empty `###` child under a
good H2 produces a malformed (non-empty but wrong) heading, `"Parent > "`. Neither path was named by
`IMPROVEMENTS.md` or the exploration phase; both were measured directly and are now covered by
regression tests and the shipped fix (the domain-level empty-segment filter in `chunking.ts`, mutation
confirmed load-bearing on its own).

---

## Open Debt, Recorded and Accepted

Two of `verify-report.md`'s three WARNINGs and one SUGGESTION were closed before archive; two items
remain open, deliberately:

- **W1 — CLOSED.** mcp-contract's "not repaired at query time" scenario had no dedicated regression
  test. Closed by the orchestrator: a test now seeds a stored `heading: ""` chunk directly into
  `SqliteIndexStore` and asserts `search_docs` returns `section: ""` unrepaired — verified as a real
  gate by mutating `search-documents.ts` to `chunk.heading || doc.title` and confirming the new test
  fails, then restoring.
- **W2 — OPEN, accepted debt.** The indexing requirement's "incremental sync alone does not correct
  existing empty headings" scenario has no heading-specific test; it rests on a pre-existing,
  unmodified test of the general content-hash fingerprint mechanism. Not blocking — that mechanism is
  untouched by this change and already tested — but genuinely code-testable, not purely operational,
  if a future cycle touches `SyncIndex` again.
- **W3 — CLOSED.** `design.md`'s Testing Strategy claim that `npm run typecheck` is blind to `test/`
  was stale/incorrect (`package.json:35` runs `tsc --noEmit && tsc -p tsconfig.test.json`, and
  `tsconfig.test.json` includes `test/**/*`). Struck through in place with a correction block, rather
  than silently deleted, so the record shows what `sdd-tasks`/`sdd-apply` were actually told.
- **S1 — OPEN, accepted debt.** The empty-ATX-heading finding is confirmed real (reproduced directly
  against the compiled parser, independently, twice — once before design, once by `sdd-verify`) but
  has no end-to-end regression test through the real parser; the covering tests construct a
  `DocOutline` by hand. Design's own reasoning ("the unit invariant holds regardless of parser
  behavior") makes this acceptable as shipped.

---

## Scope Note: Folder Move Left to the Orchestrator

Per this phase's explicit brief, this phase performed exactly two jobs: merging the delta specs into
the main specs, and writing this report **inside the working folder**
(`openspec/changes/addressable-chunks/archive-report.md`). The move of
`openspec/changes/addressable-chunks/` to `openspec/changes/archive/2026-08-07-addressable-chunks/`
was deliberately **not** performed by this phase — that step is reserved for the orchestrator, per
the scope limit stated in this phase's instructions, in response to this project's own recorded
history of an archive phase claiming a completed move that had not happened
(`openspec/changes/archive/2026-08-06-match-centred-excerpt/archive-report.md`'s "Incident during
this archive phase" section).

## Cycle Status

- Proposed, specified, designed, tasked, implemented, and verified.
- Delta specs merged into main specs — source of truth updated (`openspec/specs/indexing/spec.md`,
  `openspec/specs/mcp-contract/spec.md`).
- Spanish-vocabulary check run and reported above.
- **Folder move pending — to be performed by the orchestrator, not this phase.**
