# Design: Bounded Chunk Size

## Technical Approach

One pure-domain primitive, `splitToBound(text, maxTokens)` in a new `src/domain/split-text.ts`, is
the only thing in the codebase allowed to decide how oversized text is cut. Both chunk producers
route through it: `chunkOutline` (`src/domain/chunking.ts`) applies it to every `Piece` **after**
the pieces are built and **before** `mergeTinyPieces`, and `wholeDocumentChunk`
(`src/application/index-pipeline.ts`) applies it to the whole body of a `NO_CHUNKING` file. There
is no third producer of `Chunk[]`, so "no code path may emit a chunk above `maxTokens`" is
structural, not per-call-site vigilance. No port, no adapter, no new dependency; the splitter takes
a string and a number and returns strings.

Satisfies every scenario in `specs/indexing/spec.md` and `specs/configuration/spec.md`.

## Architecture Decisions

### Decision 1: One splitter, two call sites, signature fixed

**Choice**: `export function splitToBound(text: string, maxTokens: number): string[]` in
`src/domain/split-text.ts` (own module: the cascade is ~120 lines of text policy and deserves its
own unit test file; `chunking.ts` stays about heading policy).

```ts
// src/domain/chunking.ts — inside chunkOutline, replacing the single return statement
const bounded = pieces.flatMap((p) =>
  splitToBound(p.text, opts.maxTokens).map((text) => ({ path: p.path, text })),
);
return mergeTinyPieces(bounded, opts).map((piece, position) => ({ ... }));

// src/application/index-pipeline.ts
function wholeDocumentChunk(title: string, body: string, maxTokens: number): Chunk[] {
  const content = body.trim();
  if (content.length === 0) return [];
  return splitToBound(content, maxTokens).map((text, position) => ({
    heading: title, content: text, position,
  }));
}
```

One `flatMap` covers all three unbounded `chunkOutline` paths (intro `:32`, childless section `:37`,
oversized child `:45`) because it operates on `Piece[]`, not on the branches that produced them.
`splitToBound` returns `[text]` untouched when the text already fits — one `estimateTokens` call, no
allocation, so conforming corpora pay nothing.

**Alternatives rejected**: bounding inside each of the three branches (three places to forget, and
`wholeDocumentChunk` still uncovered); bounding after `mergeTinyPieces` (merge would then be the
last writer and could re-create an oversized piece — see Decision 4); a `ChunkSplitter` port
(infrastructure seam for pure string work, forbidden by `openspec/config.yaml`'s design rules).

**Consequence, deliberate**: `NO_CHUNKING` gets the size bound without gaining heading-based
splitting, because `splitToBound` never inspects headings. The spec's "split points are NOT derived
from its internal heading structure" holds by construction. A blank line before an `## H2` is a
block boundary like any other blank line — no piece is created *per heading* and no heading path is
derived from one.

### Decision 2: The cascade, and what it does not try to solve

Each level packs units **greedily** (accumulate while the joined candidate still fits, flush when it
does not), then recurses into any single unit that alone exceeds the bound. Greedy packing is what
turns 41 837 tokens into ~88 chunks at 480 rather than ~150 sparse ones — Gate 2's prediction
depends on it.

| # | Unit | Rejoin | Notes |
|---|---|---|---|
| 1 | Blocks (blank-line separated, **fence-aware**) | `\n\n` | A fenced block is one unit; blank lines inside a fence are content, not boundaries |
| 2 | Structural rows (table / fenced code) | `\n` | Preamble re-emitted per piece — see Decision 3 |
| 3 | Lines | `\n` | Tight lists land here, so cuts fall on item boundaries |
| 4 | Sentences | ` ` | Spanish-aware, below |
| 5 | Words (`/\s+/`) | ` ` | |
| 6 | Code points, fixed width `maxTokens * 4` | — | Terminal guarantee; never splits a surrogate pair |

Level 6 is not in the spec's "paragraph → sentence → word" wording and is required by it: a single
5 000-character token with no whitespace (a base64 blob, a Word-export URL) has no word boundary, and
"the bound MUST still hold in the degenerate case" has to be true even then. Word is the last
*boundary-aware* level; code points are the last level, full stop.

**Sentence boundary** (level 4): `[.!?…]`, optionally followed by a closer (`"` `»` `)` `'`), then
whitespace, then an uppercase letter, `¿`, or `¡`. That single rule already handles the three
Spanish cases that matter: `¿?`/`¡!` (the closing mark ends the sentence, the opening mark starts the
next and is in the allowed-follower set), decimals (`3.5` has no whitespace after the dot, so it is
never a boundary), and thousands separators. One extra guard covers abbreviations: no boundary when
the token before the period is a single letter (initials: `J. García`) or is in a short explicit
list — `Sr, Sra, Srta, Dr, Dra, Ud, Uds, art, núm, pág, cap, fig, tab, ej, p, etc, vs`.

**Explicitly NOT solved**: real segmentation. No ICU/`Intl.Segmenter`, no language detection, no
extensible abbreviation dictionary, no ellipsis-versus-period disambiguation, no avoiding cuts inside
inline code spans or link targets. Rationale: a missed boundary costs one awkward chunk edge; it can
never violate the bound and can never lose text, because levels 5 and 6 sit underneath it. Paying for
a segmenter dependency in `src/domain/` to improve an edge case that the corpus evidence says is rare
(4 of 5 oversized chunks are plain prose) is the wrong trade.

### Decision 3: Tables and fences are re-wrapped; lists and heading lines are not

| Structure | Handling | Why |
|---|---|---|
| Markdown table | **Header row + separator row re-emitted on every piece** (spec requirement). Detected as a block whose first line starts with `|` and whose second line is a separator row | A fragment of rows is not a table; columns lose their meaning entirely |
| Fenced code block | **Handled**, though the spec does not require it: never split at a blank line inside a fence (level 1), and if one fence alone exceeds the bound, split at line boundaries re-emitting the opening fence with its info string plus a closing fence | An unterminated fence corrupts every downstream renderer and swallows the rest of the document in `read_doc` output. It is the same "re-emit the structural preamble" machinery the table rule already needs — a handful of lines, not a second mechanism |
| Lists | **Not special-cased.** A tight list is one block, so it falls to level 3 and cuts land on item boundaries anyway; a loose list is already one block per item | Unlike a table fragment, a list fragment is valid markdown and each item is self-describing. The loss is a missing lead-in sentence and, for nested items, parent context — accepted, stated, not silently ignored |
| Markdown heading line | **Not repeated on continuation pieces** | `chunks_fts` indexes `heading` as its own column (`sqlite-index-store.ts:65-66`), so section-title terms still match every piece lexically; and `read_doc` reassembles a document with `chunks.map(c => c.content).join("\n\n")` (`read-document.ts:64`), so a repeated heading line would render two or three times in a full-document read |

**The preamble is charged against the budget, and the bound wins when they conflict.** A table
piece's "joined candidate" at level 2 is `header + "\n" + separator + "\n" + rows.join("\n")` — the
re-emitted header and separator rows are measured by `estimateTokens` along with the rows they carry.
Packing them for free would put every table piece over the bound by exactly the preamble's size,
which is the failure this whole change exists to remove. Where the two rules genuinely cannot both
hold — one data row whose preamble plus row already exceeds `maxTokens`, or a preamble that alone
reaches it, so no row can ever be added — **the bound wins**: the spec makes it unconditional with no
opt-out, whereas "each piece is a valid standalone table" is a quality rule about how the cut is
made. That row is then handed to the cascade as ordinary text, resuming at level 3 (a row is one
line, so in practice it is levels 4-6 that do the work) **without** any preamble, since re-emitting
it is precisely what did not fit. Those pieces are **no longer valid standalone tables** — they are
row fragments, and the design says so rather than pretending otherwise. The same precedence and the
same accounting apply to the fenced-code re-wrap: the opening fence with its info string plus the
closing fence are that level's preamble, charged to the candidate the same way, and when a single
line cannot fit inside them the re-wrap is abandoned for that piece and the cascade continues at
word and code-point level, yielding fragments that are not balanced fenced blocks. In both cases the
degradation is confined to the one unit that could not fit; neighbouring pieces keep their preamble
and stay valid.

**Accepted consequence** of the last row: `IndexDocuments` embeds `passage: ${chunk.content}`
(`index-documents.ts:126`), so a continuation piece's *vector* carries no section title. Embedding
`heading + content` would fix it, moves every vector in every corpus, and needs its own eval — a
follow-up, not this change.

**Load-bearing, verified**: `read_doc({ path, section })` matches `normalize(c.heading)` **first**
(`read-document.ts:75-79`), and every split piece keeps the full heading path. So a split section is
still read back whole and in order (`getChunksByDocument` is `ORDER BY position`). The spec's
heading-path requirement is what makes that true; it is not cosmetic.

### Decision 4: `mergeTinyPieces` can currently exceed the bound by one token — fix the guard

Read, not assumed. The guard is `estimateTokens(previous.text) + tokens <= maxTokens`
(`chunking.ts:70`), but the merge writes `` `${previous.text}\n\n${piece.text}` `` — two extra
characters. Since `estimateTokens` is `ceil(len/4)`, `ceil(la/4) + ceil(lb/4)` is **less** than
`ceil((la + lb + 2)/4)` whenever both lengths are multiples of 4. Concretely at `maxTokens: 100`:
`la = 200`, `lb = 200` → guard sees `50 + 50 = 100`, merges, and emits `ceil(402/4) = 101` tokens.
So merging *can* re-create an over-bound piece after bounding, on exactly the content shape the new
spec makes illegal.

**Choice**: measure the candidate, not the summands.

```ts
const candidate = `${previous.text}\n\n${piece.text}`;
if (previous !== undefined && tokens < opts.minTokens &&
    estimateTokens(candidate) <= opts.maxTokens) previous.text = candidate;
```

**End-to-end invariant**: `splitToBound` guarantees every input piece to `mergeTinyPieces` is within
the bound; the corrected guard guarantees merge never produces one above it; `wholeDocumentChunk` does
not merge at all. Both producers therefore satisfy `estimateTokens(content) <= maxTokens` for every
emitted chunk. An adversarial invariant test asserts it rather than trusting the argument.

`minTokens` stays at 100 (proposal, resolved). Merge headroom narrows from 700 to 380 tokens, so
fewer tiny sections merge and the chunk count rises slightly above Gate 2's estimate. Observed, not
acted on.

### Decision 5: Gate 1b isolates the vector leg with a committed script, not a CLI flag

> **Amended after measurement (Work Unit 1).** The original pass criterion — *"BEFORE: no chunk
> containing `QUETZAL-7731` appears in the vector top-10"* — is **withdrawn**. `containsMarker` is
> text containment, and before the split the marker's chunk *is* the whole document, so it contains
> the marker by construction: that criterion could never have failed. It was also asymmetric with its
> own after-half (rank 1). The criteria table below replaces it; `sdd-verify` must gate on that
> table, not on the withdrawn sentence. The script's mechanism is unchanged and confirmed working —
> `store.searchVector` does isolate the vector leg, FTS5 is never consulted.

`scripts/vector-reach.mjs <root> "<query>"` — plain ESM, imports from `dist/` (built first, per
`CLAUDE.md`'s "run `node dist/cli.js`, not `compendio`" rule), no production code touched:

1. `new SqliteIndexStore(resolve(root, ".compendio/compendio.db"))`
2. `await TransformersEmbeddings.create("Xenova/multilingual-e5-small", {})` — the real provider;
   `test/helpers/fake-embeddings.ts` cannot measure this
3. `const [v] = await emb.embed(["query: " + query])` — the E5 prefix `SearchDocuments` uses
   (`search-documents.ts:144`)
4. `store.searchVector(v, {}, 10)` — **the vector leg alone**. FTS5 is never consulted, so the
   lexical hit that hides the failure in a hybrid `search_docs` call cannot occur
5. Print, per rank: chunk id, document path, heading, `estimateTokens`, `containsMarker`, and that
   chunk's cosine against the query. **The cosine MUST come from the chunk's stored vector, read
   from `chunks_vec`** (`SELECT chunk_id, embedding FROM chunks_vec`, decoding the FLOAT32 blob) —
   **not** from re-embedding `chunk.content`. Provider vectors are normalized, so dot = cosine.
   `containsMarker` **locates** the marker chunk; it is not a criterion.

   *Amended after the baseline run.* The first version re-embedded each chunk to display its cosine,
   which measures a different population from the one `searchVector` ranks: stored vectors are
   written in batches by `IndexDocuments`, and batch padding shifts them by up to ~0.002 against a
   one-at-a-time re-embedding. The symptom was visible in the output — rank 5 printed a **higher**
   cosine (0.8367) than ranks 3 and 4 (0.8360, 0.8350). That ordering is impossible when both come
   from the same vectors: with normalized vectors `‖a−b‖² = 2 − 2·a·b`, so `vec0`'s ascending L2 order
   *is* descending cosine order, exactly. Reading `chunks_vec` makes criteria A and B measure the
   same objects and removes batch drift at the source. It does not widen `IndexStore` — the script
   opens the same database file it already opens, so the rejected-alternatives note below still holds.

   The script MUST assert this invariant and fail loudly if it breaks: the printed cosines must be
   monotonically non-increasing down the ranking. A silent violation is what hid the defect the first
   time.
6. Print the **filler band**: min and max cosine across the non-marker chunks
7. Print the **truncation probe**:
   `dot(embed("passage: " + first 384 words of the marker document), <marker chunk's stored vector>)`
   — the marker side is read from `chunks_vec`, for the same reason as step 5; the first-384-words
   side is a fresh embedding of raw text read from disk, which is what makes the probe survive the
   split (post-split the marker chunk no longer spans the document's opening)
8. Print two diagnostics: the marker sentence's character offset inside its chunk, and that chunk's
   character length — so a null result is traceable to the marker landing at the tail of the model
   window rather than being argued about

**Pass/fail** — all three must hold:

| # | Criterion | BEFORE (measured baseline) | AFTER (required) |
|---|---|---|---|
| A | Rank of the marker chunk in the vector-only ranking | not 1 — measured **rank 4 of 6** | **rank 1** |
| B | Marker chunk cosine vs the filler band | inside the band — measured **0.8357** in **[0.8274, 0.8385]** | **≥ 0.855**, and strictly above that run's own band ceiling |
| C | Truncation probe (validates the fixture, not the change) | **≥ 0.99** (the exploration measured 1.0000) | reported, expected ≤ 0.97; not gated |

**Why the before-state is deterministic, and why B's number is derivable.** The exploration's cosine
table is a truncation signature, not a dilution curve: first-384-words 1.0000, first-2 000-words
1.0000, first-128-words 0.9868. Two different inputs cannot produce an *identical* vector unless the
model consumed identical tokens for both — i.e. e5-small's 512-token window discards everything past
~350 words of this Spanish prose. Pre-split the marker therefore contributes exactly **zero** to the
stored vector, so the marker chunk's cosine must land inside the filler band. It did: 0.8350,
mid-band, while carrying a near-verbatim copy of the query. Post-split the marker sits *inside* the
window and is mean-pooled with its chunk — a different regime, and the one B is derived for.

**The baseline figures above are the stored-vector ones**, captured after step 5 was corrected to read
`chunks_vec`. An earlier run that re-embedded chunk content recorded 0.8350 in [0.8255, 0.8407]; those
numbers describe a vector population the index does not rank on and are superseded. Criterion A was
identical under both (rank 4 of 6), which is what confined the defect to the display path.

**Deriving B.** Model the pooled vector as `p ≈ (1−f)·v_filler + f·v_marker`, with
`f ≈ 250/1920 ≈ 0.13` (the marker sentence's share of a 480-token chunk). With `q·v_filler = 0.835`
(measured), `q·v_marker ≈ 0.93` (a near-verbatim quote; E5 rarely exceeds 0.95) and
`v_filler·v_marker ≈ 0.85`, `cos(q,p) ≈ 0.847 / 0.983 ≈ 0.862`. Expected range **0.855–0.875**; pass
at **≥ 0.855**. A value **≤ 0.8385 fails** — it lands inside the pre-change filler band, meaning the
mechanism did not fire whatever the rank happens to say. A value **≥ 0.90 is a red flag, not a better
pass**: it implies the chunk is almost entirely the marker sentence, i.e. the splitter cut far below
the bound. The threshold deliberately does not promise ~0.93, because the marker is still only ~13%
of its chunk — the physics does not support a bigger jump.

**Why C is in the gate (yes, the exploration's dilution measurement is added).** It is the only
criterion that tests the **fixture** rather than the change, and it needs no distractors, no query
and no ranking. If the oversized document were too small to exceed the model window, the probe would
read well below 0.99 and the whole gate would be void — that makes a null result *diagnosable*
instead of arguable, which is exactly what the withdrawn criterion could not do. Its after-value is
reported but not gated: on a single-word-pool corpus, opening-versus-mid-document similarity is high
by construction (the exploration's analogous "last 2 000 words" comparison read 0.9175), so ≤ 0.97 is
directional evidence, not a threshold worth blocking on.

**Why rank alone is no longer sufficient.** With 5 noise distractors, "not rank 1" holds with
probability ~5/6 under pure noise, so A on its own is a weak gate at this corpus size. A carries the
symmetry with task 9.3; B and C carry the evidence.

**Alternatives rejected**: a `--vector-only` flag on `compendio search` (a permanent public surface
for a one-off verification, on a tool contract this project keeps deliberately narrow); a port method
exposing stored vectors (widens `IndexStore` for a script); a manual `search_docs` procedure (cannot
isolate the leg — the exact trap the proposal names).

### Decision 6: Gate 1b uses a small committed fixture; Gate 2 keeps the generated corpus

| Gate | Corpus | Cost | Committed? |
|---|---|---|---|
| 1b | `test/fixtures/vector-reach/docs/` — one heading-less ~12 000-char Spanish document with `QUETZAL-7731` at ~char 6 000, plus 5 short distractor documents | seconds | **Yes** |
| 2 | `scripts/generate-perf-corpus.mjs <dir>` — 38 documents, 167 KB manual | ~370 s before, ~60 s after | No, regenerated |

The fixture is produced by adding `--profile fixture` to the **same** generator, so there is one
prose vocabulary and one `MARKER` constant, and then its output is committed. Committing the output
(≈30 KB) rather than regenerating on demand is deliberate: a later edit to the generator must not be
able to silently retune a blocking gate.

**Why not run Gate 1b on the generated corpus**, whose 167 KB document already carries the marker: a
pre-change run pays ~270 s to embed one chunk. That is Gate 2's price and Gate 2 pays it once. Gate 1b
must stay cheap enough to re-run on every future chunking change, and the failure it proves is about
the ~384-word absorption limit, not about 167 KB — 12 000 characters is already six times past it.
The generated corpus remains available as an optional at-scale confirmation using the same script.

**Distractor ruling (amended after measurement)**: **keep the same-word-pool distractors, keep the
fixture at 6 documents, change nothing.** The design previously left distractor structure
unspecified, which is the gap that produced a rank-only gate. The ruling is now explicit, for three
reasons. (1) The gate's weight has moved to criteria B and C, which are distractor-independent.
(2) The homogeneous pool is precisely what makes the filler band tight — 0.8255–0.8407, 0.0152 wide —
and a tight band is what turns "the marker chunk is indistinguishable from filler" into a measurement
instead of a hand-wave; a topically varied corpus would widen the band and destroy that reference
line. (3) Same-pool distractors make the **after** state the harder test: rank 1 has to be won by the
marker sentence alone, with no topical drift to ride on. Giving the marker passage a distinct subject
would let the after-run pass on topic rather than on chunk size, which is the one thing this gate
exists to isolate. The apply agent's "add more distractors" recommendation is declined on the same
logic — more same-pool documents add band members, not signal. A secondary but real cost: changing
the fixture now voids the captured before-baseline and would require another before-run on a reverted
build.

**Sequencing, load-bearing**: the fixture, the generator flag, and `vector-reach.mjs` touch no
production code. They must land **before** the splitter so the "before" measurement is captured on a
build that still has the defect. Same pattern as commit `603e7d3`.

## Data Flow

```
transformFile ─┬─ NO_CHUNKING ─→ wholeDocumentChunk(title, body, maxTokens)
               │                        └─→ splitToBound ─→ Chunk[]  (no merge)
               └─ otherwise ───→ chunkOutline(outline, opts)
                                   pieces[] (intro | leaf H2 | H3 child, as today)
                                        └─→ splitToBound per piece, heading path preserved
                                              └─→ mergeTinyPieces (candidate-measured guard)
                                                    └─→ position ─→ Chunk[]

splitToBound(text, max):
  fits? ─→ [text]
  blocks (fence-aware) ─→ pack ─→ oversized block?
     table ─→ rows, header+separator re-emitted     fence ─→ lines, fence re-wrapped
     else  ─→ lines ─→ sentences ─→ words ─→ code points (terminal, bound always holds)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/split-text.ts` | Create | `splitToBound` + the cascade; pure, no imports beyond `tokens.js` |
| `src/domain/chunking.ts` | Modify | `flatMap` through `splitToBound` before merge; candidate-measured merge guard; doc comment `:20-27` corrected (heading-boundary claim is now false) |
| `src/application/index-pipeline.ts` | Modify | `wholeDocumentChunk(title, body, maxTokens)`; `PipelineOptions.noChunking` comment `:9-10` corrected |
| `src/application/index-documents.ts` | Modify | Comment only (`:36-37`, same false claim) |
| `src/infrastructure/config.ts` | Modify | `maxTokens: 800 → 480` (`:53`); `NO_CHUNKING` comment `:40-43` corrected |
| `test/domain/split-text.test.ts` | Create | Cascade unit tests (see Testing Strategy) |
| `test/domain/chunking.test.ts` | Modify | **Delete** `keeps a section with a huge table whole (tables are never split)` (`:73-81`) — it asserts the behavior this change removes — and replace it with the header/separator repetition test; add the bound invariant |
| `test/application/index-pipeline.test.ts` | Create | `transformFile` + `NO_CHUNKING` above the bound; split points not heading-derived |
| `test/helpers/build.ts` | Modify | `:75` hardcodes `{ minTokens: 100, maxTokens: 800 }` under a comment claiming it mirrors production — import `DEFAULT_CONFIG.chunk` and `NO_CHUNKING` so it can never drift again |
| `test/application/index-progress.test.ts` | Modify | `:24`, same hardcoded pair over `ejemplos/`, same fix. (`:134`/`:158` are synthetic corpora sized against their own explicit options — unchanged, as are `index-and-search.test.ts:292/544` and `sync-index.test.ts:34`) |
| `test/fixtures/vector-reach/docs/**` | Create | Committed Gate 1b corpus (generated) |
| `scripts/generate-perf-corpus.mjs` | Modify | `--profile fixture`; the header table's "at maxTokens 800" figures stay — they are the pre-change baseline Gate 2 compares against |
| `scripts/vector-reach.mjs` | Create | Gate 1b measurement (Decision 5) |
| `README.md` | Modify | `:136` config example `800 → 480`; the eval table at `:244-246` only if measured numbers move |
| `CLAUDE.md` | Modify | Correct the "cuts only happen at heading boundaries, so tables are never split mid-row" bullet; add the Gate 1b / Gate 2 manual procedures beside the existing progress smoke test; update the `0.943` figures at `:102` only if they move |

`openspec/changes/archive/2026-07-28-index-progress-reporting/exploration.md:29` also states the old
rule. It is an archived audit trail and **MUST NOT** be edited.

## Testing Strategy

`strict_tdd: true` — tests land before implementation.

| Layer | What | How |
|---|---|---|
| Unit | Every spec scenario of the cascade: multi-paragraph splits at paragraph boundaries with no finer level used; one oversized paragraph falls to sentences; one oversized line falls to words; a whitespace-free 5 000-char run falls to code points | `test/domain/split-text.test.ts` |
| Unit | Spanish sentence rule: `¿…?` / `¡…!`, `3.5`, `art. 12`, `J. García` do not create false boundaries | `test/domain/split-text.test.ts` |
| Unit | Table pieces each begin with header + separator and re-parse as a table; a fenced block never splits at an internal blank line and stays balanced | `test/domain/split-text.test.ts` |
| Unit | **Degenerate table**: one data row whose header + separator + row alone exceeds `maxTokens` — every emitted piece is still `<= maxTokens`, that row's fragments carry no orphan preamble, and the table's other rows keep theirs | `test/domain/split-text.test.ts` |
| Unit | **Invariant**: over an adversarial set (heading-less 50 KB, one 50 KB paragraph, one unbroken line, a 60-row table, a fenced block, a `NO_CHUNKING` body) every emitted chunk is `<= maxTokens` and the concatenation covers the source modulo re-emitted preambles | `chunking.test.ts` + `index-pipeline.test.ts` |
| Unit | Split pieces share the parent's full heading path; merge cannot exceed the bound (regression for the `la=200, lb=200, max=100` off-by-one) | `chunking.test.ts` |
| Integration | `ejemplos/` indexes clean at the new default; `glosario.md` (~290 tokens) is still exactly 1 chunk; `read_doc({ section })` returns a split section whole | existing `index-and-search.test.ts` / `read-document.test.ts` via the updated harness |
| Manual (Gate 1) | `node dist/cli.js --root ejemplos eval` before/after — MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22 | recorded in `verify-report.md` |
| Manual (Gate 1b) | `node dist/cli.js --root test/fixtures/vector-reach index` then `node scripts/vector-reach.mjs test/fixtures/vector-reach "código de verificación interna QUETZAL"` — before and after, gated on criteria **A + B + C** of Decision 5 (rank 1; cosine ≥ 0.855; truncation probe ≥ 0.99 on the before run) | procedure documented in `CLAUDE.md`, numbers in `verify-report.md` |
| Manual (Gate 2) | Generate the perf corpus, `index` before/after: `ba/manual.md` 1 → ~88 chunks, corpus 242 → ~330, 367 s → ~60 s | procedure in `CLAUDE.md`, numbers in `verify-report.md` |

## Migration / Rollout

No schema change, no marker, no shim (beta, `openspec/config.yaml`). The operational step is a
**full `compendio index`**: incremental sync keys on the content hash, so unchanged documents keep
their old boundaries forever otherwise. Stated in the indexing delta spec and repeated in `CLAUDE.md`.

Rollback: revert, `npm run build`, run a full `compendio index` again.

Size crosses the 400-line review budget. Suggested slice, which the gate sequencing requires anyway:
**PR #1** fixture + generator `--profile fixture` + `vector-reach.mjs` (no production code; enables
the "before" capture). **PR #2** splitter, wiring, default, docs, tests.

## Open Questions

- [ ] `README.md:244-246` publishes the **lexical** eval row (recall@5 0.95, MRR 0.857) too, and
  smaller BM25 units may move it. Gate 1 pins hybrid only. Assumed handling: report the measured
  lexical figures and update the README to match; a lexical move is reported, not gated. Confirm
  before verify.
- [ ] Embedding `heading + content` instead of `content` would restore section context to
  continuation pieces (Decision 3). Out of scope here — needs its own eval.
