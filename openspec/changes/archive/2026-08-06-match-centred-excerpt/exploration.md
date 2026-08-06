# Exploration — match-centred-excerpt

Status: complete for proposal purposes, with two claims explicitly left unmeasured (§7).

Epistemic status, because this repository has been burned by it before (see the archived
`bounded-chunk-size` and `encoding-aware-reads` explorations). Every claim is tagged:

- **VERIFIED** — read directly in this repository's source, cited `path:line`.
- **VERIFIED (external)** — confirmed against `sqlite.org/fts5.html`, not recollection.
- **REASONED** — a conclusion chained from two or more verified facts, with the chain written out.
- **INFERRED** — could not be executed in the exploration session. Flagged, never presented as
  measured.

The exploration phase had no execution access (no Bash, no test runner). Unlike
`encoding-aware-reads` — where the orchestrator measured the runtime before writing the document —
the two runtime-dependent claims here (§7) remain **unmeasured on purpose** and are scheduled as the
first task of `apply`, before either mechanism is locked in. Nothing below claims otherwise.

Orchestrator verification pass (performed after the exploration returned, against the working tree):
the FTS5 DDL, the single `buildExcerpt` call site, `flatten()`'s exact transformation order, and
`EvaluateSearch`'s non-use of `excerpt` were all re-checked independently and hold. One exploration
claim was **wrong** and is corrected in §6.

---

## 1. Problem statement

`buildExcerpt` returns the first `LEAD_EXCERPT_CHARS` (1400) characters of the rank-1 chunk. It has
no knowledge of which part of that chunk matched the query.

`IMPROVEMENTS.md` §2 measured the consequence on a real corpus, in the **healthy** (UTF-8) index —
that is, with retrieval already working correctly:

| Measurement | Value |
|---|---|
| Chunk length (raw / normalized) | 1811 / 1616 chars |
| Offset of the answer inside the normalized chunk | 1423 |
| Where the lead excerpt ends | 1391 |
| **Shortfall** | **32 chars** |
| Content withheld beyond the cut | 225 chars |

The right chunk ranked #1. The answer fitted comfortably inside the existing 1400-character budget.
Only its *position* ruled it out — and the trailing `…` then told the agent to spend a `read_doc`
call recovering 225 characters it had already paid to retrieve.

The defect is structural: the excerpt is a **prefix** where it should be a **window** centred on the
span that caused the match.

## 2. Current mechanics — VERIFIED

- `LEAD_EXCERPT_CHARS = 1400`, `SUPPORTING_EXCERPT_CHARS = 120` (`src/domain/excerpt.ts:7,14`).
- `excerptBudget(rank)` returns the lead budget for rank 0, the supporting budget otherwise
  (`excerpt.ts:32-34`).
- `buildExcerpt(markdown, maxChars)` has exactly **one** production call site:
  `src/application/search-documents.ts:110` — `buildExcerpt(chunk.content, excerptBudget(results.length))`.
  `chunk.content` is the raw stored chunk, "raw markdown of the section, including its heading line"
  (`src/domain/model.ts:31`). `server.ts` calls neither function; it renders what `SearchDocuments`
  already produced. Grep over `src/`, `test/` and `scripts/` confirms: one production caller, the
  rest are tests.
- Normalization happens **inside** `buildExcerpt`, in `flatten()` (`excerpt.ts:61-74`), in this exact
  order: drop heading lines (`/^\s*#{1,6}\s/`) → join remaining lines with a single space → optionally
  drop fenced blocks (`` /```[^`]*```/g ``) → replace `` ` * _ > | `` with spaces → rewrite
  `[text](url)` to `text` → collapse whitespace → trim. The "raw 1811 / normalized 1616" figures in §1
  name exactly this pre/post pair.
- If the first pass strips the text to nothing (a section that is entirely fenced code), it retries
  with fences kept (`excerpt.ts:42-48`). That fallback is deliberate and documented in place: an empty
  excerpt carries no trailing `…`, so the contract would read it as "complete" and tell the agent not
  to call `read_doc`.
- The budget cut happens **after** flattening (`excerpt.ts:50-53`): `text.slice(0, maxChars)`, snapped
  back to the last space if that space is past the halfway point, then `…` appended. **There is no
  left-edge handling anywhere** — the excerpt always starts at character 0 of the flattened text, and
  no leading `…` exists in the codebase today.
- The `…` is public contract, in prose: `server.ts:110` — an excerpt ending in `…` was cut, and that
  is the signal to call `read_doc`. Introducing a leading `…` changes what that sentence means.

## 3. Where a match span can come from — VERIFIED. This is the crux.

### The lexical query today

`toFtsQuery` (`src/infrastructure/sqlite/sqlite-index-store.ts:429-436`) splits the query on
`/[^\p{L}\p{N}]+/u`, drops empties, and joins the terms as `"t1" OR "t2" OR …` — a bare-term OR, not
a phrase query. `searchLexical` (`sqlite-index-store.ts:334-349`) selects **only `c.id`**, ordered by
`f.rank`. No `snippet()`, `highlight()` or equivalent is used anywhere in the codebase.

### `offsets()` does not exist in FTS5 — VERIFIED (external)

FTS5 ships four built-in auxiliary functions: `bm25()`, `highlight()`, `snippet()`, and the
locale/insttoken helpers. **`offsets()` is FTS3/4 only.** `IMPROVEMENTS.md` §2 names it as an option;
that part of the direction is factually wrong and should not survive into the proposal.

The practical consequence is favourable rather than not: `highlight()` and `snippet()` splice
caller-supplied marker strings **into the text they read from the content column**. Locating the match
therefore becomes a string search for the marker in a returned string, not arithmetic on a returned
integer — which dissolves the byte-offset-versus-character-offset question entirely. There is no
numeric offset to misinterpret.

### The two strings are the same string — VERIFIED

DDL (`sqlite-index-store.ts:65-68`):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content, heading, content=chunks, content_rowid=id,
  tokenize='unicode61 remove_diacritics 2'
);
```

This is an **external-content** table (`content=chunks`), not a contentless one. `chunks_fts` stores
no text of its own; `highlight()`/`snippet()` read live text from `chunks.content` / `chunks.heading`
through `content_rowid`. (A *contentless* table returns NULL for every column but rowid — VERIFIED
external — which would have killed this approach outright. It is not contentless.)

`insertDocumentAndChunks` (`sqlite-index-store.ts:145-189`) writes the identical `chunk.content` value
into `chunks.content` (line 179) and into `chunks_fts` (line 182). So a marker position located via
`highlight()` refers to exactly the string `buildExcerpt` receives as `markdown` — the **raw** chunk,
before `flatten()`. That seam, raw-versus-flattened, is the real problem to solve (§4), not any FTS5
unit mismatch.

### Per-leg provenance is already available at the call site — VERIFIED

`FusedResult` (`src/domain/fusion.ts:1-4`) carries only `{ id, score }`, and
`reciprocalRankFusion` discards which input list contributed. **But `fusion.ts` does not need to
change**: `SearchDocuments.runSearch` still holds `lexicalIds` and `vectorIds` as separate arrays when
it builds each result item (`search-documents.ts:82-86`, items built at 96-115). Provenance for a chunk
id is a local array lookup at the call site. No domain change required.

### The vector-only case

A chunk surfaced by the vector leg alone has no FTS5 match to highlight. Options:

1. Keep today's prefix behaviour for those chunks — zero cost, defect persists for that subset.
2. A pure domain-side term locator (below) — works identically for lexical hits, vector hits, and
   both, so it is less a "fallback" than a uniform mechanism.
3. Nothing else is reachable without breaking the project's local-only, zero-network-at-query-time
   premise (`CLAUDE.md`, "What this is"). No cross-encoder, no highlighting model.

### The pure domain-side alternative — REASONED

`toFtsQuery`'s tokenizer is a plain regex with no SQLite dependency (`sqlite-index-store.ts:431`). A
`src/domain/` helper could reuse the identical split, case-fold, and diacritic-fold
(`normalize("NFD").replace(/[̀-ͯ]/g, "")`) on both query and chunk, then locate the term
occurrences directly.

- Keeps `IndexStore` (`src/domain/ports.ts`) **completely unchanged** — no new port method, no
  test-double churn.
- Reproduces `unicode61 remove_diacritics 2` **approximately, not exactly** — **INFERRED**, see §7.
  NFD + combining-mark strip folds the Spanish cases correctly (`ó→o`, and `ñ→n` via its `n + ◌̃`
  decomposition), but SQLite's table is broader. For this corpus that is very likely sufficient;
  "very likely" is not "measured".
- Does **not** reproduce BM25 ranking or term weighting. It can locate *a* term, not necessarily the
  term that made the chunk rank.

### A trap the naive implementation walks into — REASONED

`toFtsQuery` OR-joins **every** token, stopwords included: `"código" OR "de" OR "verificación" OR
"interna"`. Centring on the *first* match therefore risks centring on a `de` near the start of the
chunk — reproducing precisely the prefix behaviour this change exists to eliminate, while looking like
it works. Match selection must weigh distinct-term density or term rarity, not position.

## 4. The window contract — REASONED

The concern that a centred window could start mid-table-row or mid-fence and emit content that no
longer parses is real, **but only under one of the two possible orderings**.

**Recommended ordering: locate in raw → flatten the whole chunk → map the offset → slice the window in
flattened space.** Not: slice a raw window → flatten the substring.

Why that is safe, chained from verified facts:

- `flatten()` already destroys table syntax unconditionally: `|` is stripped by the generic
  `.replace(/[`*_>|]/g, " ")` (`excerpt.ts:70`). By the time any slicing happens the text is flat
  prose. There is no table structure left to corrupt.
- Fences are the one order-sensitive case: `dropFencedBlocks` needs **both** delimiters in the same
  string to match `` /```[^`]*```/g `` (`excerpt.ts:67`). Slice a raw substring first and a half-fence
  leaks raw code into the excerpt.
- Fences are always complete pairs within a stored chunk by construction: `isFencedCodeBlock` requires
  a block's first and last line to both be delimiters (`src/domain/split-text.ts:127-131`), and
  `splitIntoBlocksFenceAware`'s toggling scan keeps an opened fence's content in one block
  (`split-text.ts:92-111`). An unterminated fence in the source degrades to plain lines
  (`split-text.ts:116-119`), and a stray delimiter is still destroyed character-by-character by the
  backtick strip at `excerpt.ts:70`.

So flattening a **whole** chunk never sees a partial fence. The guarantee `split-text.ts` already
gives chunking is exactly the guarantee excerpt-centring needs, at no cost — provided `flatten()` keeps
operating on whole chunks.

The concrete failure this rules out: a chunk of `` prose\n\n```js\nconst x = 1;\n```\n\nmore prose ``
with the match in "more prose". A raw window of `[match-700, match+700]` can open inside the fence
body; flattening that substring leaves the closing delimiter and the code unstripped, and the excerpt
opens mid-code.

What centring genuinely adds, orthogonal to all of the above:

1. **A leading `…`** whenever the window does not start at 0 — today it always does.
2. **Word-boundary snapping on both edges**, where `excerpt.ts:51-53` snaps only the trailing one.
3. **A raw→flattened offset map.** `flatten()` returns only a string. Centring needs to know where a
   raw-space match position lands in flattened space. This is the one piece of genuinely new,
   non-trivial pure domain logic in the change — build a parallel kept-source-index array while
   flattening, then look up. It is also, per §8, the highest-risk piece.

## 5. Blast radius — VERIFIED

| Surface | Impact |
|---|---|
| `buildExcerpt` signature | Needs a new parameter carrying the match location. **Non-breaking internally** if optional and defaulting to today's prefix behaviour. |
| `search-documents.ts:110` | The only production call site; must pass the location. |
| `test/domain/excerpt.test.ts:9-62` | Six tests, all calling `buildExcerpt` with 1–2 positional args on short synthetic strings with no query context. All keep passing unchanged with an optional parameter — but they then exercise **only** the no-location path. New tests are required (`strict_tdd: true`, `openspec/config.yaml:18`). |
| `test/application/index-and-search.test.ts:123,124,135,182,184,189` | Assert `excerpt.length <= LEAD_EXCERPT_CHARS + 1` / `<= SUPPORTING_EXCERPT_CHARS + 1`, where `+1` is the single trailing `…`. **With a leading `…` these bounds become `+2` when both edges truncate.** Mechanical but not optional. |
| `server.ts:110` | Prose contract describing `…` as a trailing cut signal. Must be updated in the same change. Nothing in the compiler will flag it. |
| `src/application/evaluate-search.ts` | **Zero impact — VERIFIED structurally.** `runMode` derives ranks from `response.results.map(r => r.path)` and `indexOf`. Independent grep for `excerpt` across the file returns **no hits at all**: the metric path never reads the field. |

That last row settles the question the task posed. **Centring the excerpt cannot move MRR, recall@k
or top-1.** The published quality numbers (MRR 0.943, top-1 20/22, cited at `excerpt.ts:29-30`) need
no re-measurement gate, because the guarantee is structural rather than empirical. Running
`compendio eval` once anyway is a cheap confirmatory no-op and is recommended for the record, not
because there is doubt.

## 6. A falsification gate

`scripts/rank-probe.mjs` and `scripts/vector-reach.mjs` were read in full. Neither is reusable:
`rank-probe.mjs` measures which retrieval **stage** a chunk survives to and has no concept of excerpt
content; `vector-reach.mjs` measures cosine-versus-rank on a vector-only marker fixture. What they do
establish is the pattern worth copying: import from `dist/`, plant a distinctive literal marker, assert
a numeric before/after criterion that is capable of failing.

**Reproducibility of the §1 measurement — checked, and it is NOT reproducible from what is committed.**
The 1811/1616/1423 case comes from the private external corpus (the 167 KB Word-export manual named in
`bounded-chunk-size`'s archived exploration, explicitly not committable). Nothing in `ejemplos/docs/`
is remotely large enough — the largest committed example documents are 1–3 KB. The cited numbers are a
**documented historical measurement, not a repeatable regression check**. A fresh fixture is required.

> **Correction to the exploration as returned.** The exploration claimed `goldenset.yaml` "exists only
> under `.claude/worktrees/*`, not at the repo root". That is wrong: it is at **`ejemplos/goldenset.yaml`**,
> exactly where `CLAUDE.md` says it is (the worktree copies are checkouts of the same file). The
> conclusion above survives the correction — it rests on the size of `ejemplos/docs/`, not on the
> golden set's location — but the claim itself was false and is recorded here rather than quietly
> dropped.

Proposed gate, following the `test/fixtures/vector-reach/` precedent (small, committed, cheap enough
to re-run on every future excerpt change):

- A fixture document whose single chunk flattens to roughly `LEAD_EXCERPT_CHARS + 200` characters —
  comfortably inside the default `chunk.maxTokens: 480` (`src/infrastructure/config.ts:58`) so it stays
  one chunk — with a unique marker placed so its **flattened** offset lands past `LEAD_EXCERPT_CHARS`
  (target ≈ 1420, mirroring §1).
- Index it, run the real query through `SearchDocuments`, and assert:
  - **Baseline, current code:** the marker is **absent** from the excerpt and the excerpt ends in `…`.
    If the marker is already visible today, the fixture is void and must be rebuilt with a larger
    offset. This is the check that makes the gate capable of failing.
  - **After the change:** the marker is present verbatim.
  - **Falsification:** if the marker is still absent after the change (offset-map error, wrong flatten
    ordering, off-by-one), or the excerpt exceeds its budget plus the two ellipses, the gate fails and
    blocks the change — the `bounded-chunk-size` Gate 2 discipline, where a wrong analysis stops the
    change instead of shipping.

## 7. The two claims this exploration did NOT measure

Both are scheduled for the first task of `apply`, before design's mechanism choice is locked in:

1. **NFD diacritic-fold fidelity versus `unicode61 remove_diacritics 2`.** A short `node -e` probe
   against a real FTS5 table settles it. Load-bearing only for Approach B.
2. **`WHERE chunks_fts MATCH ? AND rowid = ?` behaviour** with `highlight()` on this external-content
   table. Load-bearing only for Approach A.

Neither is exotic; both are a few minutes of execution. They are listed because this project's recorded
failure mode is exactly this — an exploration conclusion that was confidently reasoned and wrong (see
the memory `compendio-exploracion-infiere-no-mide`).

## 8. Approaches compared

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. FTS5 `highlight()`** — new `IndexStore` method (e.g. `locateLexicalMatch(chunkId, query)`) running `SELECT highlight(chunks_fts, 0, …) … WHERE chunks_fts MATCH ? AND rowid = ?`, called only for the ≤ k returned results, not the full candidate set | Uses SQLite's real tokenizer and matcher, so it is faithful to what actually ranked the chunk; "no row returned" doubles as the vector-only signal; cost bounded by k | Grows the port surface: `ports.ts`, `SqliteIndexStore`, plus a one-line delegating stub in each of the two test doubles in `test/application/sync-index.test.ts` (they wrap `inner`); still needs the raw→flattened map; still needs a multi-match selection policy (§3) | Medium |
| **B. Pure domain locator** — reuse `toFtsQuery`'s tokenization plus an NFD fold in a new `src/domain/` helper | `ports.ts` untouched; one code path for lexical, vector and both; trivially unit-testable with no SQLite or embeddings | Diacritic equivalence is INFERRED (§7); reflects term presence, not BM25's ranking decision; same stopword-centring risk, with no `bm25()` weighting available to break ties | Low–Medium |
| **C. Raise `LEAD_EXCERPT_CHARS`** | Trivial | Ruled out — see below | — |
| **D. Do nothing** | Zero cost | Leaves the measured defect: correct retrieval, lost answer, an unnecessary `read_doc` round trip | — |

**On Approach C, which `IMPROVEMENTS.md` rules out and this exploration was invited to challenge: the
reasoning holds, and there is new evidence strengthening it.** `chunk.maxTokens` now defaults to 480
(`src/infrastructure/config.ts:58`, set by the shipped `bounded-chunk-size` change). At
`estimateTokens ≈ chars / 4` (`src/domain/tokens.ts:7`) that bounds a raw chunk at roughly 1900
characters — within touching distance of the 1811-char chunk in §1. Raising the lead budget much past
1400 would routinely return *most of a whole chunk*, which is exactly the degeneration the graduated
budget exists to prevent. Ruled out on the current default, not merely on principle.

## 9. Recommendation

**Approach A for lexically-matched chunks, with Approach B as the vector-only fallback**, using §4's
ordering (locate in raw → flatten the whole chunk → map the offset → window in flattened space). These
compose rather than compete: A is faithful where the lexical leg actually matched, which is most cases;
B is the only option for a chunk only the vector leg surfaced.

Whether the composed A+B pair is worth two mechanisms, or B alone should carry the whole change for
simplicity, is a genuine design decision and is deliberately **left open** for `sdd-design`.

Design must also resolve:

1. The multi-match selection policy — distinct-term density or rarity, explicitly not "first hit" (§3).
2. The raw→flattened offset map's shape (§4).
3. Whether `SUPPORTING_EXCERPT_CHARS` fragments are centred too (§10) — left open per instruction.
4. If Approach A survives: the exact `IndexStore` method signature and its two test-double stubs.

## 10. `SUPPORTING_EXCERPT_CHARS` (120) — deliberately not decided

**For centring them too:** one code path rather than two; and if a supporting fragment's only overlap
with the query sits past char 120, centring is the only way it is ever visible.

**Against:** their documented job is routing, not answering (`excerpt.ts:10-14`, `server.ts:109`). At
120 characters a centred window pays for *two* ellipses out of a tiny budget, plausibly making it a
worse signpost than a start-anchored prefix showing the section's actual opening words. And there is no
evidence — measured or otherwise — that supporting-fragment truncation costs anything today; the
measured defect is specifically about the lead excerpt forcing a needless `read_doc`, whereas a
supporting fragment's job already assumes `read_doc` may follow.

A small measurement would settle it better than intuition: do supporting fragments' matched terms tend
to sit near the start of their chunk, or scattered as in the lead case?

## 11. Risks

- **The raw→flattened offset map is the highest-risk new logic.** A silent off-by-N centres on the
  wrong text with no test failing, unless the fixture deliberately targets a boundary — a match
  straddling a stripped heading line, or a collapsed whitespace run.
- **Stopword-driven mis-centring** if match selection is implemented as "first hit" (§3). This failure
  mode looks like success.
- **`server.ts:110`'s prose contract** must change with the code. The compiler will not catch it.
- **Test churn** is real but fully enumerated (§5): one optional parameter, `+1` → `+2` length bounds,
  two trivial port stubs if A is chosen.
- **The §1 numbers will not recur exactly** on a fresh fixture (§6). What is being falsified is the
  *shape* of the defect — correct chunk, match past the budget — not the specific 32-char shortfall.

## 12. Non-goals

- Improvement 1 (encoding) shipped and is archived as `2026-08-06-encoding-aware-reads`. Improvement 3
  (heading-less chunks produce unaddressable sections) is a separate cycle; it is not touched here.
- `MAX_CHUNKS_PER_DOCUMENT` and the cap's interaction with very large documents
  (`IMPROVEMENTS.md` §3, "Related risk") stays out of scope.
- No migration, schema marker or compatibility shim: the project is in beta with no installed users
  and breaking the public contract is an accepted cost (`openspec/config.yaml`, proposal rules).
