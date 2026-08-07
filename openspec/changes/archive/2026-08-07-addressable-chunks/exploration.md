# Exploration — addressable-chunks

Source: `IMPROVEMENTS.md` §3, "Documents without headings produce unaddressable chunks". Third of the
three defects measured on 2026-08-05. Improvement 1 shipped as `2026-08-06-encoding-aware-reads`;
improvement 2 as `2026-08-06-match-centred-excerpt`.

Status: complete for proposal purposes. **No mechanism is recommended** — the option space is laid out
with tradeoffs and non-viable options are ruled out with evidence. Choosing is `sdd-design`'s job.

## Epistemic legend

This project has had exploration conclusions collapse twice before (memory:
`compendio-exploracion-infiere-no-mide`). Every substantive claim below is labelled:

- **READ-FROM-CODE** — read directly in this repository, cited `path:line`. Includes deterministic
  control-flow tracing of pure functions: tracing what a pure function *will* do for a given input is
  arithmetic on quoted code, not an empirical claim.
- **INFERRED** — could not be verified without executing code. Never presented as settled; listed in §8
  with the exact command that would settle it.

The exploration sub-agent had no Bash access, so **nothing below is labelled MEASURED**. The
89-chunks/1-distinct-heading figures, and everything else already measured in `IMPROVEMENTS.md`, are
cited as given, not re-derived.

## 0. Orchestrator verification record

The exploration sub-agent's claims were independently re-verified by the orchestrator against the
source before this artifact was persisted (the same protocol that caught a false claim in the
`match-centred-excerpt` cycle). Result: **the load-bearing structure is confirmed; one claim is false
and is corrected in place; one gap the exploration missed is added.**

Re-verified and CONFIRMED:

| Claim | Verified at |
|---|---|
| `chunkOutline`'s intro branch pushes `path: [outline.title]`; the `flatMap` copies `p.path` onto every `splitToBound` output; `heading: piece.path.join(" > ")` | `src/domain/chunking.ts:36-62` |
| `chunks` DDL has no hash column (`documents` does; `chunks` does not) | `src/infrastructure/sqlite/sqlite-index-store.ts:59-65` |
| `docs_overview` / `INDEX.md` do **not** consume the chunk-level `heading`/`section` — zero references | `grep` over `src/application/get-overview.ts`, `src/domain/index-markdown.ts`: no matches |
| The reassembly test is real and load-bearing: multiple same-heading chunks, joined by substring match | `test/application/read-document.test.ts:116-166` |
| "Every Split Piece Retains Its Full Heading Path" is a normative MUST | `openspec/specs/indexing/spec.md:441-448` |
| The humanized title never reaches chunking: `chunkOutline(parsed.outline, ...)` receives the raw outline, while `resolution.meta.title` is humanized separately | `src/application/index-pipeline.ts:63-77`, `src/domain/convention.ts:66-68` |
| Whole-document `read_doc({path})` already renders `# ${doc.title}` from the humanized `DocumentMeta` | `src/application/read-document.ts:67` |
| `headingsIn` requires `^#{2,6}`; `availableSections` is a `Set` collapsing to `{""}`; `formatReadResult` emits `- ` | `read-document.ts:100-108`, `:80-92`; `server.ts:208-213` |

**Correction 1 — §2.2's coverage claim is FALSE.** The exploration states "No test in the repository
exercises this case at all" for case B (H1 present, no H2). It does:
`test/domain/chunking.test.ts:170-184` ("covers a heading-less 50 KB intro…") calls
`chunkOutline(outline([], intro), OPTS)`, and the `outline()` helper at
`test/domain/chunking.test.ts:13-15` hardcodes `title: "Test doc"`. Sections are empty, title is
non-empty — that is precisely case B. Corrected in place below.

**Gap 1 — added, and it sharpens the whole change.** That same fact means the test *named* for the
heading-less shape **cannot reproduce the reported defect**. Because the helper's title is hardcoded
non-empty, every chunk it produces carries `heading: "Test doc"`. Confirmed by search:

- `grep -rn 'title: ""' test/` → only `test/domain/convention.test.ts:69,187`, both exercising the
  resolver's humanization, neither constructing a `DocOutline`.
- `grep -rn 'heading).toBe("")|heading: ""' test/` → **zero matches**.

So **case §2.1 — the defect this change exists for — has zero test coverage anywhere in the suite, and
no test anywhere asserts on an empty heading.** The exploration's §6 identified
`chunking.test.ts:170-184` as "the exact gap where a regression test belongs"; that is misleading, since
that test can never reach case A. A regression gate needs a *new* outline fixture with `title: ""`, not
an added assertion on the existing one. §6 is corrected accordingly.

## 1. Problem statement (recap)

`IMPROVEMENTS.md` §3 measured: a heading-less document (167 KB Word-export-style manual, zero H1, zero
H2) produces 89 chunks, all with `heading: ""`. Three consequences: `search_docs` returns
`"section": ""`; `read_doc({ path, section })` cannot match anything; the recovery path renders
`"Available sections:"` followed by one empty bullet.

## 2. Where the empty heading originates (Q1)

Three genuinely different cases exist in `chunkOutline`, plus a fourth code path `IMPROVEMENTS.md` does
not mention (`NO_CHUNKING`), plus a non-obvious mismatch between two different "title" values.

### 2.1 Case A — no H1, no H2 (the reported defect)

`RemarkMarkdownParser.parse` (`src/infrastructure/markdown/remark-markdown-parser.ts:25-58`) only sets
`title` inside the `heading.depth === 1 && !seenH1` branch (line 44-47); with no H1, `title` stays `""`
and `h1End` stays `0` (its initializer, line 32, never reassigned).

`buildOutline` (`remark-markdown-parser.ts:61-100`) then computes:

```
const firstH2 = headings.find((h) => h.depth === 2);          // undefined
const introEnd = firstH2?.start ?? body.length;                // body.length
const intro = body.slice(parsed.h1End, introEnd).trim();       // slice(0, body.length) = whole body
```

With no H2 either, `sections: []`. So `outline = { title: "", summary: ..., intro: <whole body>,
sections: [] }`.

`chunkOutline` (`src/domain/chunking.ts:33-63`):

```ts
if (outline.intro.trim().length > 0) {
  pieces.push({ path: [outline.title], text: outline.intro.trim() });   // path: [""]
}
```

This single `Piece` goes through `splitToBound` at the flatMap (`chunking.ts:54-56`):

```ts
const bounded = pieces.flatMap((p) =>
  splitToBound(p.text, opts.maxTokens).map((text) => ({ path: p.path, text })),
);
```

`p.path` (`[""]`) is copied unchanged onto **every** string `splitToBound` returns. The final map
(`chunking.ts:58-62`) does `heading: piece.path.join(" > ")` — `[""].join(" > ") === ""`. Every
resulting chunk's `heading` is `""` by construction, not by measurement. **READ-FROM-CODE.**

### 2.2 Case B — H1 present, no H2

If an H1 exists but no H2, `seenH1 = true`, `title` = the H1 text, `h1End` = the offset after the H1
line. `firstH2` is still `undefined`, so `intro = body.slice(h1End, body.length)`. `outline.title` is
now **non-empty**, so `piece.path = [outline.title]` is a real string.

Consequence: `section` is non-empty and `read_doc({section: <title>})` matches. The document is **not**
broken the way `IMPROVEMENTS.md` describes — but every one of its chunks shares the **identical**
heading (the H1 title) when the intro needs splitting, which is the general pattern in §2.3.

> **Corrected by orchestrator (see §0, Correction 1).** The exploration originally claimed no test
> exercises this case. `test/domain/chunking.test.ts:170-184` does — `outline([], intro)` with the
> helper's hardcoded `title: "Test doc"` (`chunking.test.ts:13-15`) is exactly case B. What that test
> does *not* do is assert anything about `heading`, and — the point that matters — it cannot reach
> case A at all. See §0, Gap 1.

**READ-FROM-CODE.**

### 2.3 Case C — has H2 — and a broader pattern IMPROVEMENTS.md does not name

For a document with H2s, `chunkOutline`'s per-section loop (`chunking.ts:40-52`) gives each H2 (and each
H3 child, when the H2 is oversized and has children) a real heading path (`"H2"` or `"H2 > H3"`).

**But the same "many chunks, one heading" mechanism from §2.1 also fires here**, whenever a single piece
exceeds `maxTokens` and `splitToBound` divides it. `chunking.ts:54-56`'s `path: p.path` preserves the
identical heading path across every resulting piece. This is not incidental — it is a **pinned
requirement**:

> `openspec/specs/indexing/spec.md:441-448`, "Every Split Piece Retains Its Full Heading Path": *"When
> bounding splits an oversized piece into multiple chunks, every resulting chunk MUST carry the same
> full heading path… Splitting for size MUST NOT truncate, renumber, or otherwise alter the heading
> path."*

Exercised by tests today:

- `test/domain/chunking.test.ts:74-89` — an oversized H3 child splits; asserts **every** resulting
  chunk's heading is one of `["Business rules", "Business rules > Fields"]`, i.e. explicitly NOT unique.
- `test/domain/chunking.test.ts:91-114` — an oversized table splits; asserts `chunk.heading === "Table"`
  for **every** piece.

More importantly, `ReadDocument` **depends on** this collision to reassemble a split section.
`test/application/read-document.test.ts:116-166` seeds a real 480-token-bounded pipeline with one H2
section large enough to split, confirms `rawChunks.length > 1` (multiple chunks, identical heading
`"Sección extensa"`), then calls `read.execute({ section: "sección extensa" })` and asserts the
**joined** content contains sentence 0 and sentence 119 in order — the substring match at
`read-document.ts:74-79` (`normalize(c.heading).includes(wanted)`) is relied on to match **all**
same-heading chunks and reassemble them via `matching.map(c => c.content).join("\n\n")`
(`read-document.ts:93-98`).

**This is the single most important structural fact for the option space in §4.** Heading collision
across split pieces is not a bug to be silently fixed everywhere — for documents WITH headings it is the
mechanism that makes `read_doc({section})` return a whole split section instead of one arbitrary
fragment. Any option giving every chunk a **unique** `heading`/`section` must either preserve a separate
way to request "the whole section" or explicitly break this test and the spec requirement above.
**READ-FROM-CODE.**

### 2.4 A fourth path: `NO_CHUNKING` documents

`transformFile` (`src/application/index-pipeline.ts:49-84`) branches on `isNoChunking` (line 75-77): for
a file listed in `NO_CHUNKING` (currently only `glosario.md`, `src/infrastructure/config.ts:48`), chunks
come from `wholeDocumentChunk`, not `chunkOutline`:

```ts
function wholeDocumentChunk(title: string, body: string, maxTokens: number): Chunk[] {
  const content = body.trim();
  if (content.length === 0) return [];
  return splitToBound(content, maxTokens).map((text, position) => ({
    heading: title, content: text, position,
  }));
}
```

(`index-pipeline.ts:91-99`) — every split piece gets `heading: title` unconditionally. Same collision
pattern as §2.3. The `title` here is `resolution.meta.title`, which per §2.5 is the **humanized** value,
never empty under `loose` — so this path cannot reproduce the empty-string defect today. Worth naming as
a third generator of the general pattern regardless. **READ-FROM-CODE.**

### 2.5 `outline.title` vs. the document's real title — a mismatch IMPROVEMENTS.md does not surface

Novel finding from tracing the pipeline; not stated anywhere in `IMPROVEMENTS.md`.

`transformFile` calls `policy.resolver(...)` (`index-pipeline.ts:63-69`) **before** chunking
(line 75-77), and the `loose` resolver (`src/domain/convention.ts:57-87`) does:

```ts
const title = isNonEmptyString(input.title) ? input.title.trim() : humanizeFileName(input.path);
```

(`convention.ts:66-68`). For a heading-less document under the default `loose` mode, `DocumentMeta.title`
is a **humanized filename** — non-empty. But `chunkOutline` is called on `parsed.outline` directly
(`index-pipeline.ts:77`), and `parsed.outline.title` is the **raw, pre-humanization** value — still `""`.
The humanized title is never fed back into `outline.title`. Two independent computations over the same
document; only one gets the `loose`-mode inference.

Consequence, verified by tracing `read-document.ts:63-69`: a whole-document `read_doc({path})` on this
exact document **already** shows a proper `# <humanized title>` line, since `doc.title` comes from
`DocumentMeta`, not from any chunk heading. **The defect is scoped specifically to per-section
addressing** — not to whole-document reads, not to `docs_overview`, not to `INDEX.md`. This narrows the
blast radius considerably and exposes a legitimately smaller Option C in §4 than `IMPROVEMENTS.md`'s
framing suggests. **READ-FROM-CODE.**

## 3. Claim verification (Q3)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| a | `chunks` table has no hash column today | **CONFIRMED** | `sqlite-index-store.ts:59-65` DDL: `id, document_id, heading, content, position`. `ChunkRow` (`:29-35`) and `toChunk` (`:497-505`) mirror exactly these five. `Chunk`/`IndexedChunk` (`src/domain/model.ts:28-44`) carry no hash field. Note `documents` *does* have `hash TEXT NOT NULL` — the absence is specific to `chunks`. |
| b | `headingsIn` requires `^#{2,6}` | **CONFIRMED** | `read-document.ts:103-109`: `markdown.matchAll(/^#{2,6}\s+(.+)$/gm)`. H1 deliberately excluded (stripped from chunk content upstream). |
| c | `availableSections` collapses to `{""}` | **CONFIRMED** | `read-document.ts:80-92`: `available` is a `Set<string>`; for a document where every chunk's `heading === ""` and no chunk content contains an `#{2,6}` line, the set holds exactly one member, `""`. |
| d | `server.ts` renders an empty bullet | **CONFIRMED** | `server.ts:208-213`, `formatReadResult`'s `"section-not-found"` case: `["Available sections:", ...result.availableSections.map(s => \`- ${s}\`)]`. For `[""]` this emits the literal line `- `. **No test exercises this** — `read-document.test.ts:89-97` only checks `availableSections.length > 0` against `ejemplos/` (real headings); `formatReadResult` has no dedicated unit test at all. |
| e | Line ranges cannot be byte-exact | **CONFIRMED**, with sharper grounding than the original claim | See §3.1 — the load-bearing claim, own subsection. |
| f | `section` "is also consumed by `docs_overview` and `INDEX.md`" (asserted in the launch prompt, from `IMPROVEMENTS.md`) | **FALSIFIED** | `Overview`/`OverviewLine` (`src/application/get-overview.ts:6-18`) and `IndexEntry` (`src/domain/index-markdown.ts:9`) carry `path`/`title`/`summary`/`type`/`status` only. `grep` for `heading`/`section` over both files: **zero matches** (re-verified by orchestrator). Both consume the **document-level** `title` via §2.5's humanization path, never the chunk-level `heading`. Today `section` is consumed only by `search-documents.ts:120` (`section: chunk.heading`) and `read-document.ts`'s request/response shape. |

### 3.1 Claim (e) in detail — why line ranges cannot be byte-exact

Four sources of inexactness, **not equally strong**. Precision matters: this claim determines whether
"line range" survives into the proposal at all.

1. **Frontmatter stripping** (`remark-markdown-parser.ts:26`, `matter(raw)`) shifts every downstream
   offset relative to the *post-strip* body, not the raw file bytes. Recoverable in principle, but a real
   unresolved ambiguity: "line range" relative to which file?

2. **Offsets are structurally discarded before chunking ever runs — the strongest, most fundamental
   reason, not previously stated this precisely.** `HeadingEvent.start`/`.end`
   (`remark-markdown-parser.ts:8-15`) exist only inside `parse`; they `.slice()` text and are then
   discarded. `DocSection`/`DocOutline` (`src/domain/outline.ts:8-23`) carry `title`/`text`/`children`
   only — no offset field. `ParsedMarkdown` (`src/domain/ports.ts:52-58`) returns `{ data, outline, body }`;
   nothing tells a consumer where a given `Chunk` sits inside `body`. **There is no plumbing from raw byte
   offset to stored chunk at any layer** — a prerequisite cost for *any* provenance-range option,
   independent of the exactness questions below.

3. **`.trim()` on every outline slice** (`remark-markdown-parser.ts:68,87,94`) and the `\n\n` joins in
   `sectionFullText` (`chunking.ts:16-19`) and `mergeTinyPieces` (`chunking.ts:78-93`). Tracing precisely:
   these joins operate on slices `buildOutline` constructs to be physically **contiguous** in the source
   (each section's `sectionEnd`/`nextBoundary` is exactly the next section's start,
   `remark-markdown-parser.ts:75,84,111-118`). So this source is real but **weaker** than "two disjoint
   regions glued together": it is whitespace normalization at an already-adjacent join point (the original
   blank-line count is lost, replaced by a fixed `\n\n`), not a discontinuity. A *provenance* range
   spanning "roughly this contiguous span" survives this; a byte-exact range does not.

4. **`splitTable`/`splitFence` re-emission is the one airtight proof of impossibility.** `splitTable`
   (`split-text.ts:153-192`) re-emits the header+separator preamble on **every** piece (`flush()` at
   :164-169); `splitFence` (`split-text.ts:200-244`) does the same with fence markers. For any piece
   beyond the first, its stored `content` is a **concatenation of two disjoint source regions** — the
   preamble, physically located *before* that piece's rows, plus the rows. The chunk's content is **not a
   substring of the source file at all**. `chunking.test.ts:91-114` and the coverage invariants
   (`:169-277`) confirm this shape is exercised, not hypothetical.

**Net verdict: CONFIRMED — byte-exact line ranges are impossible, for two reasons of different strength.**
(2) means nobody has built the plumbing (a real but surmountable cost). (4) means that even with perfect
plumbing, some chunks' content is provably not a contiguous slice of the source — so byte-exact ranges are
**categorically**, not just practically, ruled out for those chunks. A *provenance* range ("assembled from
approximately region A, and for a split table/fence piece also region B") is a different, weaker, honestly
named contract — exactly what `IMPROVEMENTS.md` concludes. This tracing confirms it.

## 4. Option space for individual chunk addressability (Q2)

**No option is recommended.** Each is evaluated against the constraint from §2.3: whatever ships must not
silently break the load-bearing multi-chunk reassembly for documents that already have headings, unless
that behaviour is deliberately changed — which also requires amending
`openspec/specs/indexing/spec.md:441-448`.

| Option | Description | Pros | Cons | Scope reach |
|---|---|---|---|---|
| **A. Opaque stable per-chunk identifier** | A new field persisted alongside `heading`, not replacing it, uniquely identifying one `chunks` row | Solves §2.1/2.3/2.4 uniformly with one mechanism; does not touch `heading`'s substring-match/reassembly semantics — additive; cheap schema-wise (no hash column exists yet, §3(a)) | Grows the public MCP contract with a field whose consumer-facing meaning (what does an agent DO with it?) must be designed; touches `ports.ts`'s `IndexStore`/`Chunk` shape and the test doubles in `test/application/sync-index.test.ts` | Documents with headings AND heading-less alike — orthogonal to the heading mechanism |
| **B. Synthesized heading** (leading line, or ordinal) | Replace the empty heading with a derived human-readable string | No new field, no schema change; `section`'s shape and consumers unchanged; a caller that saw `""` now sees something actionable | If synthesis is per-DOCUMENT it does not make chunks distinguishable, only removes the symptom (that is Option C). If per-CHUNK (leading-line text, ordinal suffix) it **directly conflicts** with §2.3's reassembly test and the pinned spec requirement, unless substring matching is redesigned to still find "the whole section" across chunks that no longer share a heading string | Heading-less documents only, unless deliberately extended to §2.3 (bigger, spec-touching) |
| **C. Minimal backfill** | When `outline.title === ""` (case §2.1 only), feed the already-computed non-empty `resolution.meta.title` (§2.5) into the intro piece's heading | Smallest possible diff: one assignment in `chunkOutline`'s intro branch; no schema change, no new field; converts the *pathological* all-empty case into the *ordinary*, already-tolerated shared-heading case (§2.3) — consistent behaviour, not a special case | Does not solve individual addressability at all; only removes the worst symptom (unmatchable `""`, the empty bullet). All 89 chunks would still share one heading and `read_doc({section})` would still return all 89 joined. Requires routing a value across the `index-pipeline` seam that §2.5 shows is currently separate | Case §2.1 only, by construction |
| **D. Provenance line range** (named as such) | Answers "roughly where did this come from" | Per §3.1, requires offset plumbing that does not exist today (item 2) before even reaching exactness; for split table/fence pieces the honest answer is "region A + region B", a more complex contract than a scalar range; likely a complement to A, not a substitute | Any chunk, weakest for split table/fence pieces |
| **E. Do nothing** | — | Zero cost | Leaves all three §1 consequences unfixed for Word-export-shaped corpora, stated as a normal real-world input rather than an edge case | — |

**Options are not mutually exclusive.** A+C is a coherent incremental combination: C ships the smallest
improvement to the reported symptom (removing the empty string and empty bullet), A ships true individual
addressability as an additive field, and neither touches B's territory. B, in its per-chunk-unique form,
is the option that collides with §2.3's pinned test and would need an explicit decision to either preserve
a parallel "get the whole section" mechanism or accept the spec change. **This tension — not a preference
between A and B — is the one thing this exploration is confident enough to flag as a genuine design
constraint rather than a mere tradeoff.**

## 5. Blast radius on the public MCP contract (Q4)

Recheck of the launch prompt's framing: "every added response field competes with the excerpt budget that
`match-centred-excerpt` protects" is **not literally true at the code level**. `excerpt`
(`buildExcerpt(chunk.content, ...)`, `search-documents.ts:121`) and `section` (`chunk.heading`,
`search-documents.ts:120`) are independent fields from independent inputs; nothing in
`excerpt.ts`/`flatten-map.ts`/`match-location.ts` reads `heading`. The real cost of a new field is response
payload size (`JSON.stringify(response, null, 1)`, `server.ts:158`) and cognitive load on the calling
agent — not a shared character budget.

| Surface | Option A (new id) | Option B (unique heading) | Option C (backfill) | Option D (provenance) |
|---|---|---|---|---|
| `search_docs` (`SearchResultItem`) | New field on every item (JSON bytes, not excerpt budget) | `section`'s **value** changes for previously-empty and (if extended to §2.3) previously-shared headings; no new field | `section` non-empty for case §2.1; shape unchanged | New field, likely `{from, to}`-shaped; same payload concern as A |
| `read_doc` request (`section`) | Param unchanged; a new param needed if the id is directly requestable, or `section` matching extended to equality-match the id | Matching semantics unchanged (substring against `heading`), but the matched strings change — risks breaking §2.3's reassembly | Semantics and param unchanged; more chunks enter the matched set | No natural touch point unless design adds one |
| `docs_overview` | **No touch point** (§3(f)) | No touch point | No touch point | No touch point |
| `INDEX.md` | **No touch point** (§3(f)) | No touch point | No touch point | No touch point |

## 6. What breaks in existing behaviour — tests and specs (Q5)

Documents that already have headings must not regress. Potential change sites, by option:

- `test/domain/chunking.test.ts:74-89`, `:91-114` — assert non-unique headings across split pieces are the
  *expected* output. Any option making headings chunk-unique for the general case must update these.
- `openspec/specs/indexing/spec.md:441-448`, "Every Split Piece Retains Its Full Heading Path" — a
  normative MUST. Chunk-unique headings for the general case require an explicit spec delta, not just a
  test update. An `openspec` process consequence, not only a code one.
- `test/application/read-document.test.ts:116-166` — the reassembly test (§2.3). Directly at risk under a
  chunk-unique version of Option B; unaffected by A, C, D.
- `test/application/read-document.test.ts:89-97` — only asserts `availableSections.length > 0` against
  `ejemplos/` (real headings); does not exercise the `{""}` collapse.
- `server.ts:194-215` / `formatReadResult` — no dedicated unit test exists (§3(d)). A new test is required
  under any option changing what a collapsed `availableSections` renders as.
- `test/infrastructure/fts5-external-content.test.ts:55,69,88,107` — raw
  `INSERT INTO chunks (id, document_id, heading, content, position)` against the production `SCHEMA_DDL`
  (orchestrator-verified: four such inserts, plus `chunks_fts` inserts). Option A's new column would need
  these updated, or rely on a nullable default — a design decision, not decided here.
- `src/domain/ports.ts:106-144` (`IndexStore`) and `test/application/sync-index.test.ts` — Option A's new
  field on `Chunk`/`IndexedChunk` (`src/domain/model.ts:28-44`) ripples into every `IndexStore` implementer;
  `SqliteIndexStore` is the only production one, but the test fakes need the new shape too.

> **Corrected by orchestrator (§0, Gap 1).** The exploration named
> `test/domain/chunking.test.ts:170-184` as "the exact gap where a regression test for this change
> belongs". That is misleading. The `outline()` helper hardcodes `title: "Test doc"`
> (`chunking.test.ts:13-15`), so that test exercises case B (§2.2), not case A, and **cannot** reproduce
> the reported defect no matter what assertion is added. Verified by search: no test anywhere constructs a
> `DocOutline` with `title: ""`, and no test anywhere asserts an empty `heading`. **Case §2.1 has zero
> coverage in the entire suite.** A regression gate needs a *new* fixture with an empty outline title —
> the cheapest being a `chunkOutline({ title: "", summary: "", intro, sections: [] }, OPTS)` unit case
> asserting the current `heading === ""` before the fix and the chosen behaviour after.

## 7. `MAX_CHUNKS_PER_DOCUMENT = 2` interaction (Q6) — scoped OUT

Per `IMPROVEMENTS.md`'s own framing ("deserves a measurement before anything is changed" — not itself a
defect), this stays **out of scope**. No change to the constant is proposed.

Worth recording precisely: `capPerDocument` (`src/domain/fusion.ts:36-51`) caps *after* fusion, preserving
fused order (called from `search-documents.ts:91-95` with `MAX_CHUNKS_PER_DOCUMENT = 2`, declared at
`search-documents.ts:32`). Combined with §2.1, the two consequences compound: even after any option in §4
ships, at most 2 chunks of a large heading-less document are ever visible in one `search_docs` response.
Option A at least lets a caller distinguish *which* 2 survived; B and C do not add that power on their own.

**Measurement that would settle whether this deserves its own cycle**, using the instrument
`IMPROVEMENTS.md` already established: run `scripts/rank-probe.mjs` against the generated corpus with a
needle inside the large heading-less document and read the `after cap` row specifically — the row
`IMPROVEMENTS.md` names as the one that "removes results *after* they rank". No new script required.
Future work, not part of this change.

## 8. Claims requiring measurement before design locks

| # | Claim | Why unmeasured | Command that would settle it |
|---|---|---|---|
| 1 | The 89-chunk / 1-distinct-heading figure reproduces on a committable fixture (the 167 KB manual is external — same gap the `bounded-chunk-size` and `match-centred-excerpt` cycles hit) | No Bash access; the private corpus figures are historical, not repeatable | `node scripts/generate-perf-corpus.mjs <scratch-dir>`, then `node dist/cli.js --root <scratch-dir> index`, then `SELECT DISTINCT heading FROM chunks WHERE document_id = (SELECT id FROM documents WHERE path LIKE '%<manual>%')` against `<scratch-dir>/.compendio/` |
| 2 | Case §2.2 ("H1, no H2") produces a non-empty shared heading across multiple chunks, as traced | Pure code trace, never executed | `npx vitest run test/domain/chunking.test.ts` already covers this shape at `:170-184`; adding a `heading` assertion there settles it without new fixtures |
| 3 | `formatReadResult`'s literal rendered bytes for `availableSections === [""]` | Traced from source, not run | A unit test calling `formatReadResult` (needs exporting, or testing through the `read_doc` handler) with a `section-not-found` result whose `availableSections` is `[""]`, asserting the exact string |
| 4 | Whether Option A's new `chunks` column, added nullable, requires updating the raw `INSERT`s in `test/infrastructure/fts5-external-content.test.ts` | Requires running `npm test` against a real schema change | Add the column on a scratch branch, then `npx vitest run test/infrastructure/fts5-external-content.test.ts` |
| 5 | §7's `MAX_CHUNKS_PER_DOCUMENT` compounding, quantified | Out of scope; no execution performed | `node scripts/rank-probe.mjs <root> "<query>" "<needle>"`, reading the `after cap` row |

## 9. Risks

- **The reassembly-test tension (§2.3) is the highest risk if under-specified going into design.** A design
  saying "make headings unique" without addressing how `read_doc` recovers a whole split section will
  silently regress `test/application/read-document.test.ts:116-166` and violate
  `openspec/specs/indexing/spec.md:441-448` — a defect that *looks like success* (the individual chunk
  becomes addressable; the whole-section case quietly breaks) unless the test is run, not just read.
- **Case A has zero test coverage** (§0, Gap 1). Nothing currently fails when the defect is present, so
  "tests are green" carries no information about this change. A red-first fixture is mandatory under strict
  TDD.
- **Offset plumbing does not exist today** (§3.1 item 2) — any line-range/provenance option starts from
  zero, not from an approximation that merely needs widening.
- **No committed fixture reproduces the reported failure shape.** Every existing measurement lives in a
  private, non-committable corpus — the same gap `match-centred-excerpt` and `bounded-chunk-size` solved by
  building small committed generator-based fixtures.
- **`MAX_CHUNKS_PER_DOCUMENT` compounding (§7) is easy to scope-creep into.** Explicitly out of scope; a
  design or apply phase that "also raises it while in the area" violates this change's stated boundary.
- **The falsified `docs_overview`/`INDEX.md` claim (§3(f)) could mislead scoping.** Designing for a consumer
  that does not exist would over-build.

## 10. Non-goals (restated for the record)

- No backward compatibility, schema version markers, or migrations — breaking the SQLite schema and the MCP
  contract is an accepted cost in beta (`openspec/config.yaml`).
- No replacement of `section` substring matching with GitHub-style slug anchors — already ruled a downgrade
  in `IMPROVEMENTS.md`, treated as settled.
- No citation registry / stale-citation tracking — explicitly rejected in `IMPROVEMENTS.md`.
- No change to `MAX_CHUNKS_PER_DOCUMENT` (§7) — measurement recipe given instead.
- No mechanism chosen for chunk addressability (§4) — left for `sdd-design`.
