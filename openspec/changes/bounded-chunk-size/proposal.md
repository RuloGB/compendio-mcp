# Proposal: Bounded Chunk Size

## Intent

`chunk.maxTokens` is a descent hint, not a bound. A document with no H2 becomes one chunk of any
size. Measured on a real 38-document corpus: one 167 KB file produced a single 41 837-token chunk
(52x the limit) that cost 268 s to embed — 88% of a 285 s run — and whose vector is *identical*
(cosine 1.0000) to the embedding of its first ~384 words, its cover page. Everything past that
point is **unreachable by vector search**.

Independently, the model absorbs nothing past ~500 `estimateTokens`, so the 800 default silently
discards the last ~37% of any full-size chunk **for every project on defaults**. Evidence and
method: `exploration.md`.

After this change **no code path in the codebase may emit a chunk above `maxTokens`.**

## Scope

### In Scope

- **Bounding pass** over every `Piece` in `chunkOutline` (`src/domain/chunking.ts`), covering the
  three unbounded paths at once — intro (`:32`), childless section (`:37`), oversized child
  (`:45`). Split preference cascades paragraph/line → sentence → word, so the bound holds even for
  one line that alone exceeds it. A split markdown table repeats its header + separator row on
  each piece, so every piece stays valid markdown.
- **The bound applies to `NO_CHUNKING` files too** (`src/application/index-pipeline.ts:71-73`,
  `wholeDocumentChunk`) — a fourth unbounded path, outside `chunkOutline`. This **redefines the
  option**: `NO_CHUNKING` now means *"do not split this file by headings"*, no longer *"one chunk
  at any cost"*. The size bound is unconditional and has no opt-out.
- **Default `chunk.maxTokens` 800 → 480** (`src/infrastructure/config.ts:53`), the measured ~500
  window with margin, because `estimateTokens` is `chars/4` and under-counts Spanish.
- **Correct the two claims that become false**:
  - "cuts only happen at heading boundaries, so tables are never split mid-row" — `CLAUDE.md` and
    the `chunkOutline` doc comment at `src/domain/chunking.ts:24-26`.
  - "Files indexed as a single chunk (no heading-based chunking)" — `src/infrastructure/config.ts:40-43`,
    plus the matching comments at `index-documents.ts:36-37` and `index-pipeline.ts:9-10`.
    (`CLAUDE.md` and `README.md` make no `NO_CHUNKING` claim — verified, nothing to fix there.)

### Out of Scope

| Item | Why deferred |
|---|---|
| Fixed UTF-8 read (`file-document-source.ts:54`) | Separate change; kept out so it cannot contaminate this change's retrieval revalidation |
| Token-budget batching (~47% padding overhead) | Secondary optimisation |
| Progress bar | Already fixed on `fix/embedding-tick-after-batch` |
| `minTokens: 100` | Explicitly considered, deliberately unchanged: no measurement supports moving it, and this change already moves two variables. Consequence to **observe, not act on**: merge headroom narrows from 700 to 380 tokens, so tiny sections merge less often and chunk count rises slightly beyond Gate 2's estimate. |
| `search_docs` excerpt behaviour | Observed consequence only. `LEAD_EXCERPT_CHARS` is 1400 and a 480-token chunk is ~1920 chars, so the rank-1 excerpt still truncates and the `…` signal still fires — just less often than with 800-token chunks. No action. |
| Migrations, schema markers, compat shims | Beta, no installed users (`config.yaml` proposal rules) |

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `indexing`: `maxTokens` becomes a guaranteed upper bound on **every** emitted chunk, not a
  descent hint; splitting may occur below heading level; `NO_CHUNKING` suppresses heading-based
  splitting only, never the size bound.
- `configuration`: default `chunk.maxTokens` is 480, justified against the measured model window.

### Required spec action (not optional)

`openspec/specs/indexing/spec.md` — *"English Contract Preserves the `ejemplos/` Multilingual
Retrieval Baseline"* states MRR 0.943 / recall@5 1.00 "MUST hold **exactly**", and that any
deviation "is a defect in the rename, not a new baseline to accept". This change moves `ejemplos/`
chunk boundaries, so the requirement can no longer be read as scoped to the frontmatter rename
alone. `sdd-spec` **MUST** emit a delta clarifying its scope. Leaving it implicit means someone
trips over a MUST at verify time.

## Approach

Pure-domain post-pass. `chunkOutline` builds pieces exactly as today; each piece over `maxTokens`
is then split before `mergeTinyPieces` runs. One pass covers all three sites inside `chunkOutline`,
so no branch can be missed. `wholeDocumentChunk` routes through the same domain function, which is
what makes the bound unconditional rather than per-call-site. Every emitted piece keeps its full
heading path. No port, no adapter, no new dependency in `src/domain/`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/chunking.ts` | Modified | Bounding pass; corrected doc comment |
| `src/application/index-pipeline.ts` | Modified | `wholeDocumentChunk` bounded; comment corrected |
| `src/infrastructure/config.ts` | Modified | Default `maxTokens` 480; `NO_CHUNKING` comment corrected |
| `test/fixtures/` | New | Committed heading-less oversized fixture (Gate 1b) |
| `CLAUDE.md` | Modified | Heading-boundary guarantee corrected |
| `openspec/specs/{indexing,configuration}` | Modified | Delta specs, incl. the required spec action above |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Splitting logic is wrong on oversized content — the case no existing test or corpus exercises | High | Gate 1b, blocking. This is the gate that actually proves the change |
| **Existing indexes keep old boundaries**: incremental sync keys on content hash, so unchanged files are never re-chunked after a config/chunker change | High | Document a required full `compendio index` run (its `reset()` rebuilds everything). No schema marker — forbidden by project rules |
| Table split loses context despite header repetition | Med | Only 1 of 5 oversized chunks is a table; per-piece valid-markdown assertion |
| `NO_CHUNKING` redefinition surprises a project relying on whole-file glossary chunks | Low | Beta, no installed users; behaviour change stated in the spec delta |

## Rollback Plan

1. Revert the change commits (`src/domain/chunking.ts`, `src/application/index-pipeline.ts`,
   `src/infrastructure/config.ts`, docs, fixture) and `npm run build`.
2. Re-run `compendio index` on any project indexed under the new bound. A **full** run is
   required: `reset()` drops and recreates, whereas incremental sync would leave the new
   boundaries in place indefinitely.

No persisted state needs undoing beyond that re-index.

## Dependencies

- `compendio eval` + `ejemplos/goldenset.yaml` (in-repo).
- A committed oversized fixture for Gate 1b (created by this change).
- Real embeddings provider for Gate 1b — vector reachability cannot be measured with
  `test/helpers/fake-embeddings.ts`, so that gate is a manual verification step, documented like
  the existing progress smoke test in `CLAUDE.md`.
- The external 38-document corpus described in `exploration.md` for Gate 2 — private, not
  committable; manual step.

## Success Criteria

### Gate 1 — Collateral-damage guard on `ejemplos/` (BLOCKING, but weak evidence)

`compendio eval` against `goldenset.yaml`, before and after:

- [ ] MRR ≥ 0.943
- [ ] recall@5 = 1.00
- [ ] top-1 ≥ 20/22

Any drop blocks. No tolerance band: the premise of this change is that bounding chunks *improves*
retrieval, so a fall means the design is wrong and must be revisited.

**This gate is not evidence that the splitting logic is correct**, and must not be reported as
such. Measured over `ejemplos/docs` with the real parser and chunker: 28 chunks, 5 459 tokens,
**0 chunks above 800** and **exactly 1 above 480** (639 tokens,
`leadsviewer/validacion-formulario.md :: Reglas de negocio`; the 514-token chunk is `INDEX.md`,
which is excluded from indexing). Under today's default the splitting path is never exercised
here; under 480 it fires once. Gate 1 proves only that already-conforming documents were not
broken.

### Gate 1b — Retrieval reachability on oversized content (BLOCKING, the actual proof)

Add a **committed synthetic fixture** reproducing the failing shape: a heading-less markdown
document well above the bound, carrying a distinctive marker passage placed past its first
~384 words. Then, with the real embeddings provider:

- [ ] **Before**: the marker passage is NOT retrievable via the vector leg (the whole document is
      one chunk whose vector represents its opening)
- [ ] **After**: the marker passage IS retrievable via the vector leg

The measurement **MUST isolate the vector leg**. FTS5 still holds the full text of an oversized
chunk, so a plain hybrid `search_docs` call would find the marker lexically in both runs and hide
the failure entirely. `sdd-design` picks the mechanism (direct cosine against stored chunk vectors,
or a vector-only ranking path).

### Gate 2 — Falsifiable prediction (BLOCKING)

Measured on the external corpus described in `exploration.md`:

- [ ] `MANUAL.md` (the 167 KB heading-less document): 1 chunk → ~88
- [ ] Corpus: 242 → ~330 chunks
- [ ] Full-corpus index: 285 s → roughly 50 s

If measurement contradicts this, **stop**: the analysis is wrong and the design must be revisited
before proceeding.

### Gate 3 — The bound holds unconditionally

- [ ] No emitted chunk exceeds `maxTokens` on any path — heading-less document, single 50 KB
      paragraph, single line longer than the bound, **and a `NO_CHUNKING` file above the bound**
- [ ] Each piece of a split table parses as valid markdown carrying its header row
- [ ] `npm test` and `npm run typecheck` pass

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Does the bound apply to `NO_CHUNKING`? | **Yes.** Option redefined to "no heading-based splitting"; the size bound is unconditional |
| Gate tolerance if retrieval dips? | **None.** Any drop blocks; a fall falsifies the premise |
| Move `minTokens: 100`? | **No.** Unmeasured; narrowed merge headroom is observed, not acted on |
| Track the `search_docs` excerpt effect? | **No.** Consequence only, no action |
