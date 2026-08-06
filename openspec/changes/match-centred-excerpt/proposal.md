# Proposal: Match-Centred Lead Excerpt

## Intent

`buildExcerpt` returns the first `LEAD_EXCERPT_CHARS` (1400) characters of the rank-1 chunk
(`src/domain/excerpt.ts:41-54`). It receives `chunk.content` and a number and nothing else
(`src/application/search-documents.ts:110`) — it has no knowledge of *where inside that chunk* the
query matched. The excerpt is a **prefix** where it should be a **window**.

This defect fires precisely when retrieval has already succeeded, which is what makes it easy to
miss. Measured on a real corpus in the healthy (UTF-8) index (`IMPROVEMENTS.md` §2):

| Measurement | Value |
|---|---|
| Chunk length (raw / normalized) | 1811 / 1616 chars |
| Offset of the answer inside the normalized chunk | 1423 |
| Where the lead excerpt ends | 1391 |
| **Shortfall** | **32 chars** |
| Content withheld beyond the cut | 225 chars |

The right chunk ranked #1. The answer fitted comfortably inside the existing 1400-character budget.
Only its *position* ruled it out — and the trailing `…` then told the agent to spend a `read_doc`
call recovering 225 characters it had already paid to retrieve. That round trip is the entire cost
the graduated excerpt budget exists to avoid (`excerpt.ts:18-31`).

After this change the lead excerpt is centred on the span that caused the match, **with the budget
unchanged**. The same 1400 characters, spent on the part of the chunk the caller actually asked
about.

### Two corrections this proposal carries forward

1. **`offsets()` does not exist in FTS5.** `IMPROVEMENTS.md` §2 names it as a source for the match
   span; it is an FTS3/4 function. FTS5's auxiliary functions are `bm25()`, `highlight()`,
   `snippet()` and the locale/insttoken helpers (exploration §3, VERIFIED external). The direction
   survives, that specific mechanism does not, and it must not be re-proposed in design.
2. **The §1 numbers are a historical measurement, not a repeatable check.** They come from a private
   external corpus that is not committable; the largest committed example document is 1–3 KB
   (exploration §6). This change is gated on a **fresh fixture reproducing the defect's shape** —
   correct chunk at rank 1, match past the budget, answer lost — not on reproducing 1423/1391/32.

### Why no retrieval-quality gate is needed

**Structurally, not empirically: this change cannot move MRR, recall@k or top-1.**
`EvaluateSearch` derives ranks from `response.results.map(r => r.path)` and `indexOf`; an
independent grep for `excerpt` across `src/application/evaluate-search.ts` returns **zero hits** —
the metric path never reads the field (exploration §5, re-verified by the orchestrator). The
published numbers (MRR 0.943, top-1 20/22, cited at `excerpt.ts:27-30`) are therefore not at risk.
`compendio eval` still runs as Gate 4 below, but as a **scope falsifier** — if it moves at all, the
change touched retrieval and has exceeded its own boundary — not as a quality re-measurement.

## Scope

### In Scope

- **`buildExcerpt` becomes window-capable.** A new optional parameter carrying the match location;
  absent, it keeps today's prefix behaviour, so the six existing tests in
  `test/domain/excerpt.test.ts:9-62` compile and pass unchanged (and then exercise only the
  no-location path, which is why new tests are mandatory under `strict_tdd`).
- **A raw→flattened offset map**, in `src/domain/`. `flatten()` (`excerpt.ts:61-74`) returns only a
  string; centring needs to know where a raw-space match position lands in flattened space. This is
  the one piece of genuinely new, non-trivial pure-domain logic, and per exploration §11 the
  highest-risk piece in the change.
- **The window ordering is fixed by this proposal**, because getting it wrong is a correctness bug
  rather than a design preference: **locate in raw → flatten the *whole* chunk → map the offset →
  slice the window in flattened space.** Never slice a raw window and flatten the substring.
- **Dual-edge behaviour**: word-boundary snapping on both edges (`excerpt.ts:51-53` snaps only the
  trailing one), and a **leading `…`** whenever the window does not start at offset 0.
- **The `…` contract text at `server.ts:110`**, which today says an excerpt ending in `…` was cut.
  With a window that can truncate at both ends, that sentence changes meaning. Nothing in the
  compiler flags it; it ships in this change or it ships wrong.
- **A match-selection policy that is not "first hit".** `toFtsQuery` OR-joins every token, stopwords
  included (`src/infrastructure/sqlite/sqlite-index-store.ts:429-436`), so centring on the first
  occurrence can centre on a `de` near char 0 — reproducing today's prefix while looking like a fix.
  The policy must weigh distinct-term density or term rarity. Its exact form is design's; the
  requirement that it exist is this proposal's.
- **The vector-only path must be defined**, not left to fall through. A chunk surfaced by the vector
  leg alone has no FTS5 match to locate.
- **A committed falsification fixture**, following the `test/fixtures/vector-reach/` precedent —
  small, cheap enough to re-run on every future excerpt change.

### Out of Scope

| Item | Why |
|---|---|
| **Choosing between Approach A (FTS5 `highlight()`), Approach B (pure domain locator), or A+B** | Genuinely open, and `sdd-design`'s decision. The tradeoff is handed over in *Approach* below, unresolved on purpose |
| **Raising `LEAD_EXCERPT_CHARS`** | Ruled out on current evidence, not on principle. `chunk.maxTokens` defaults to 480 (`src/infrastructure/config.ts:58`); at `estimateTokens ≈ chars / 4` (`src/domain/tokens.ts:7`) that bounds a raw chunk at ~1900 chars, within touching distance of §1's 1811-char chunk. A bigger budget degenerates into returning whole chunks — the exact failure the graduated budget exists to prevent |
| **Centring `SUPPORTING_EXCERPT_CHARS` (120) fragments** | Decided out. Full reasoning and the reopening trigger below |
| **`offsets()`** | Does not exist in FTS5 |
| **Re-ranking, BM25 term-weight exposure, cross-encoder or model-based highlighting** | Breaks the local-only, zero-network-at-query-time premise (`CLAUDE.md`, "What this is"), and this change is presentation, not retrieval |
| **`MAX_CHUNKS_PER_DOCUMENT` and the cap's interaction with very large documents** | `IMPROVEMENTS.md` §3 "Related risk". Separate concern |
| **Improvement 1 (encoding)** | Shipped and archived as `2026-08-06-encoding-aware-reads` |
| **Improvement 3 (heading-less chunks are unaddressable)** | Separate cycle. One genuine, **unmeasured** interaction worth recording: a heading-less document yields `heading: ""`, so `section` is a weak signpost and the excerpt carries more of the routing load. Centring softens that symptom; it does not address the defect, and nothing here should be read as partially fixing it |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users; breaking the public contract is an accepted cost (`openspec/config.yaml`, `rules.proposal`) |

### Decision: `SUPPORTING_EXCERPT_CHARS` fragments stay prefixes

The exploration (§10) laid out evidence both ways and deliberately did not decide. **Decision: out of
scope. Supporting fragments remain start-anchored prefixes.** Three reasons, strongest first:

1. **A centred 120-character window is a worse signpost than a prefix.** A supporting fragment's
   documented job is routing — "enough to judge whether the lead is the right one"
   (`excerpt.ts:9-14`, restated to callers at `server.ts:108-109`). A prefix shows a section's
   *opening words*, which the reader can situate against `path` and `section`. An arbitrary
   mid-sentence window shows matched terms the caller already knows are there, stripped of the
   context that makes them interpretable. Visibility of the query's terms is not the deliverable;
   deciding *which result to read next* is.
2. **Largest blast radius on the smallest evidence base.** Centring supporting fragments changes
   `k-1` of `k` fragments in **every** search response. There is no evidence — measured or
   otherwise — that supporting-fragment truncation costs anything today. The measured defect is
   specifically a needless `read_doc` after a *correct* rank-1 hit; a supporting fragment's job
   already assumes `read_doc` may follow, so truncation there costs nothing that was not already
   being paid.
3. Two ellipses out of 120 characters is a real but minor tax, and is the weakest of the three
   arguments. Recorded so it is not mistaken for the load-bearing one.

**The rejected side, recorded rather than dropped.** If a supporting fragment's only overlap with
the query sits past char 120, centring is the only way it is ever visible; and one code path is
cheaper than two. That argument is not wrong — it is unevidenced.

**What would reopen it, and who runs it.** The locator built by this change *is* the instrument. In
`sdd-verify`, over `ejemplos/` + its 22-query `goldenset.yaml`, record for each non-lead result the
flattened offset at which its best match span begins, and report the fraction beyond
`SUPPORTING_EXCERPT_CHARS`. This is a **recorded observation in `verify-report.md`, not a gate on
this change**. If more than half of supporting fragments' match spans start past 120, that is
evidence the rejected side was right, and it becomes a separate, narrow follow-up change. Below
that, the decision stands on the record and is not re-litigated.

## Capabilities

### New Capabilities

- None as a new spec domain. The excerpt is an existing part of the `search_docs` response.

### Modified Capabilities

- **`mcp-contract`**: the excerpt-shaping behaviour is currently spec-silent — no requirement in
  `openspec/specs/` covers the graduated budget or the `…` truncation signal (grep for `excerpt`
  across `openspec/specs/` returns a single hit, the field-naming list at
  `mcp-contract/spec.md:116`). This change MUST add explicit requirements rather than rely on that
  silence: the lead fragment is a window centred on the matched span within an unchanged budget; a
  `…` at **either** edge marks truncation; a window starting at offset 0 carries **no** leading `…`;
  the vector-only case has defined behaviour.
- **`search`**: only if design chooses Approach A and a match-location method lands on `IndexStore`
  (`src/domain/ports.ts`). Under Approach B, `ports.ts` is untouched.

## Approach

The mechanism is deliberately **not** chosen here. Both candidates are viable and the tradeoff is a
design judgment, so this proposal fixes the parts that are correctness constraints and hands the
rest over intact.

### Fixed here: the window ordering, and why

**Locate in raw → flatten the whole chunk → map the offset → slice the window in flattened space.**
Not: slice a raw window → flatten the substring. Chained from verified facts (exploration §4):

- `flatten()` already destroys table syntax unconditionally — `|` is stripped by the generic
  character-class replace at `excerpt.ts:70`. By the time any slicing happens the text is flat
  prose; there is no table structure left to corrupt.
- Fences are the one order-sensitive case: `dropFencedBlocks` needs **both** delimiters present in
  the same string for its regex to match (`excerpt.ts:67`). Slice a raw substring first and a
  half-fence leaks raw code into the excerpt.
- Fences are always complete pairs within a stored chunk by construction (`isFencedCodeBlock`,
  `src/domain/split-text.ts:127-131`; `splitIntoBlocksFenceAware`, `split-text.ts:92-111`), so
  flattening a *whole* chunk never sees a partial fence. The guarantee `split-text.ts` already gives
  chunking is exactly the guarantee centring needs, at no cost — **provided `flatten()` keeps
  operating on whole chunks.**

The concrete failure this rules out: a chunk of prose, then a fenced `js` block containing
`const x = 1;`, then more prose, with the match in that trailing prose. A raw window of
`[match−700, match+700]` can open inside the fence body; flattening that substring leaves the code
and the closing delimiter unstripped, and the excerpt opens mid-code.

### Handed to `sdd-design`: where the match span comes from

| Approach | For | Against |
|---|---|---|
| **A. FTS5 `highlight()`** — an `IndexStore` method running `SELECT highlight(chunks_fts, …) … WHERE chunks_fts MATCH ? AND rowid = ?`, called only for the ≤ k returned results | Uses SQLite's real tokenizer and matcher, so it is faithful to what actually ranked the chunk. "No row returned" doubles as the vector-only signal. Cost bounded by k. `chunks_fts` is **external-content** (`content=chunks`, `sqlite-index-store.ts:65-68`), so `highlight()` reads live text — a contentless table would have returned NULL and killed this outright | Grows the port surface: `ports.ts`, `SqliteIndexStore`, plus a delegating stub in each of the two wrapping test doubles in `test/application/sync-index.test.ts` |
| **B. Pure domain locator** — reuse `toFtsQuery`'s tokenizer (`sqlite-index-store.ts:431`, a plain regex with no SQLite dependency) plus an NFD diacritic fold | `ports.ts` untouched; one code path for lexical, vector and both; unit-testable with no SQLite and no embeddings | Reproduces `unicode61 remove_diacritics 2` only *approximately* — **INFERRED, unmeasured** (exploration §7). Reflects term presence, not BM25's ranking decision |
| **A + B composed** | A where the lexical leg matched (most cases), B as the vector-only fallback | Two mechanisms to maintain and to keep consistent with each other |

Both approaches still need the raw→flattened offset map, and both still need a multi-match selection
policy. Neither is avoided by the choice.

**Two claims were deliberately left unmeasured by the exploration and must be settled as the first
task of `apply`, before the mechanism is locked in** (exploration §7): NFD fold fidelity versus
`unicode61 remove_diacritics 2` (load-bearing for B only), and `highlight()` behaviour under
`WHERE chunks_fts MATCH ? AND rowid = ?` on this external-content table (load-bearing for A only).
Both are minutes of execution. They are called out because this project's recorded failure mode is
exactly this — a confidently reasoned exploration conclusion that turned out wrong.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/excerpt.ts` | Modified | Optional match-location parameter; window slicing; dual-edge word snapping; leading `…` |
| `src/domain/` (new file) | New | Raw→flattened offset map; match-selection policy; under B, the term locator |
| `src/application/search-documents.ts:110` | Modified | The only production call site. Per-leg provenance is already local — `lexicalIds`/`vectorIds` are still in scope at `search-documents.ts:82-86`, so `src/domain/fusion.ts` needs no change |
| `src/domain/ports.ts`, `src/infrastructure/sqlite/sqlite-index-store.ts` | Modified **only under Approach A** | New match-location method |
| `test/application/sync-index.test.ts` | Modified **only under Approach A** | Two wrapping test doubles need a delegating stub each |
| `src/server.ts:110` | Modified | The `…` prose contract. Silent if forgotten — the compiler flags nothing |
| `test/domain/excerpt.test.ts` | Extended | Six existing tests keep passing via the optional parameter; new tests required (`strict_tdd`) |
| `test/application/index-and-search.test.ts:124,135,182,184` | Modified | `LEAD_EXCERPT_CHARS + 1` → `+ 2`, `SUPPORTING_EXCERPT_CHARS + 1` unchanged (supporting stays a prefix). Mechanical, silent if forgotten |
| `test/fixtures/` (new) | New | The centring fixture and the stopword-trap fixture |
| `openspec/specs/mcp-contract/spec.md` | Modified | New requirements — the behaviour is spec-silent today |
| `CLAUDE.md` | Modified | Two claims in the MCP-tools section become false: "the rank-1 fragment gets `LEAD_EXCERPT_CHARS` (1400)" as a prefix, and "**A trailing `…`** is the documented truncation signal" |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Silent off-by-N in the raw→flattened offset map** — centres on the wrong text, no test fails | **High** | Fixtures must deliberately target boundaries: a match straddling a stripped heading line, and one after a collapsed whitespace run. Gate 1 asserts the marker verbatim, which an off-by-N fails |
| **Stopword-driven mis-centring** — "first hit" centres on a `de` near char 0, reproducing today's prefix while looking like a fix | **High** | Gate 3 is a dedicated fixture for exactly this failure mode. In-scope requirement: selection weighs distinct-term density or rarity, never position |
| `server.ts:110`'s prose contract not updated with the code | Med | Listed in Affected Areas and gated: Gate 5 requires the contract text to describe both edges |
| Approach B's NFD fold diverges from `unicode61 remove_diacritics 2` on a real corpus | Med | Unmeasured (exploration §7). Settled by probe as the first `apply` task, **before** design's choice is locked |
| A window that starts at 0 emits a spurious leading `…`, telling the caller content was cut when it was not | Med | Gate 2 asserts its absence explicitly. This inverts the defect: the contract would then lie in the other direction |
| Excerpt exceeds budget once two ellipses are possible | Low | Gate 2 asserts `≤ budget + 2` |
| Two mechanisms (A+B) drift apart in behaviour | Low–Med | Design's call; if it chooses A+B, both must satisfy the same gates through the same public surface |

## Rollback Plan

1. Revert the change commits and `npm run build`.
2. **No re-index is required, in either direction, and no data is at risk.** The excerpt is computed
   at query time from `chunk.content` inside `runSearch` (`src/application/search-documents.ts:110`)
   and is never persisted. Nothing in the SQLite schema changes — the `chunks_fts` DDL
   (`sqlite-index-store.ts:65-68`) is untouched even under Approach A, which only *reads* through
   `highlight()`.
3. A running `compendio serve` picks up the revert on restart. No `compendio index` pass, no cache
   invalidation, no fingerprint churn.

This is the cheapest rollback profile of the three recent changes: `bounded-chunk-size` required a
mandatory full reindex (bytes identical, only config moved), and `encoding-aware-reads` relied on
hash-driven self-healing. Here the blast radius stops at the process boundary. That materially
lowers the cost of being wrong, and it is a reason to prefer measuring in production use over
over-designing up front.

## Dependencies

- **Zero new npm dependencies.** Both approaches use what is already present: SQLite FTS5's built-in
  auxiliary functions, or pure JavaScript string handling.
- **New committed fixtures**, created by this change. Existing ones do not fit: `ejemplos/docs/`
  documents are 1–3 KB, far below the ~1600 flattened characters the defect needs, and
  `test/fixtures/vector-reach/` targets cosine-versus-rank, not excerpt content.
- **Existing instruments, reused for the record only**: `compendio eval` + `ejemplos/goldenset.yaml`.
  `scripts/rank-probe.mjs` and `scripts/vector-reach.mjs` were read in full and are **not** reusable
  (exploration §6) — the first measures which retrieval stage a chunk survives to, the second
  measures cosine-versus-rank; neither has any concept of excerpt content. What they contribute is
  the pattern: import from `dist/`, plant a distinctive literal marker, assert a numeric
  before/after criterion capable of failing.

## Success Criteria

Each gate can **fail and stop the change**. A gate that cannot fail is not a gate — this project's
`bounded-chunk-size` Gate 2 discipline, where a wrong analysis stops the change rather than shipping.

### Gate 1 — The window reaches the answer (BLOCKING)

Fixture: a committed document whose single chunk flattens to roughly `LEAD_EXCERPT_CHARS + 200`
characters — comfortably inside `chunk.maxTokens: 480` so it stays **one** chunk — carrying a unique
literal marker whose **flattened** offset lands past `LEAD_EXCERPT_CHARS` (target ≈ 1420, mirroring
the §1 case). Indexed, then queried through `SearchDocuments`.

- [ ] **Baseline, on current code, run and recorded first**: the marker is **absent** from the rank-1
      excerpt and the excerpt ends in `…`. **If the marker is already visible today, the fixture is
      void and MUST be rebuilt with a larger offset.** This step is what makes the gate capable of
      failing; skipping it produces a gate that passes for free.
- [ ] **After the change**: the marker is present **verbatim** in the rank-1 excerpt.

**STOP condition.** If the marker is still absent after the change — offset-map error, wrong flatten
ordering, off-by-one — the change is falsified as implemented and does not ship.

### Gate 2 — The truncation contract is honest at both edges (BLOCKING)

- [ ] Excerpt length ≤ its budget **+ 2** (at most one ellipsis per truncated edge)
- [ ] A window that starts at flattened offset 0 carries **no** leading `…`
- [ ] A window that reaches the end of the flattened text carries **no** trailing `…`

A spurious ellipsis is not cosmetic: it is the signal that sends the agent to `read_doc`, so
emitting one falsely reproduces the cost this change exists to remove.

### Gate 3 — The stopword trap (BLOCKING)

Fixture: a query whose high-frequency token (e.g. `de`, `the`) occurs before flattened offset 100
while its distinctive terms cluster past 1400 — the shape `toFtsQuery`'s bare-term OR
(`sqlite-index-store.ts:429-436`) makes routine.

- [ ] The rank-1 excerpt contains the distinctive marker, not the early stopword's neighbourhood

**STOP condition.** Failing this means match selection is position-based. That implementation passes
casual inspection and reproduces the defect; shipping it is worse than shipping nothing, because the
defect would then be recorded as fixed.

### Gate 4 — Scope falsifier: retrieval did not move (BLOCKING)

- [ ] `compendio eval` on `ejemplos/`: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22 — these must not
      move **at all**
- [ ] `npm test`, `npm run typecheck`, `npm run build` pass

Identity is the right assertion, not a tolerance band. `evaluate-search.ts` never reads `excerpt`
(zero grep hits), so any movement means the change reached retrieval and has breached its own scope.

### Gate 5 — The vector-only path and the contract text

- [ ] A chunk with no lexical match still produces a well-formed excerpt: within budget,
      contract-consistent ellipses, no crash. The harness is design's choice; the behaviour is not
      optional
- [ ] `server.ts:110`'s description and `CLAUDE.md`'s excerpt bullet both describe truncation at
      **either** edge

### Recorded observation (not a gate)

- [ ] The `SUPPORTING_EXCERPT_CHARS` distribution described under *Decision* above, written into
      `verify-report.md`

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Source of the match span | **Open — `sdd-design`'s call** between A, B and A+B. Fixed here only: it must be faithful enough to survive Gate 3, and `offsets()` is not an option |
| Window ordering | **Locate in raw → flatten the whole chunk → map → slice in flattened space.** Correctness, not preference: the reverse order leaks half-fences |
| Match selection among several occurrences | **Never "first hit."** Distinct-term density or rarity. Exact form is design's |
| Leading `…` | **Yes, when the window does not start at 0** — and never otherwise. `server.ts:110` and `CLAUDE.md` change with it |
| `LEAD_EXCERPT_CHARS` | **Unchanged at 1400.** Raising it is ruled out on the current `chunk.maxTokens: 480` default |
| `SUPPORTING_EXCERPT_CHARS` fragments | **Stay prefixes.** Reopenable only by the named measurement above |
| Reproducing §1's 1811/1616/1423/1391 | **Not attempted.** Private corpus. The gate falsifies the defect's *shape*, not its numbers |
| Retrieval-quality re-measurement | **Not required** — structural, not empirical. `eval` runs as a scope falsifier |
| Migrations / schema markers / shims | **None.** Beta, no installed users |

## Delivery size — a decision for the `sdd-tasks` gate

No exploration estimate exists for this change. Driver-based, and explicitly a **proposal-phase**
figure: excerpt window logic and the offset map (~120–180 lines), call site (~10), tests including
two fixtures (~100–150), spec delta (~40), contract and docs text (~30). Approach A adds the port
method, the adapter query and two test-double stubs (~60).

That lands roughly **300–470 changed lines** against a 400-line PR budget, with the A+B composition
sitting at the upper end.

This project has a recorded pattern — the size forecast grows at every phase (`bounded-chunk-size`:
240–420 at explore, 555–695 at tasks, 773 actual). Treat the range as a lower bound, and resolve the
delivery shape at the review-workload gate rather than at apply time. The natural cut line, if one
is needed: the offset map plus window slicing in `src/domain/` first (pure, independently testable,
independently valuable), the call-site wiring and mechanism second.
