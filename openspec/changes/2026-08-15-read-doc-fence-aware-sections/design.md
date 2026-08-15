# Design: `read_doc`'s Section Lookup Must Not Treat Fenced Code as Headings

**Phase**: design · **Artifact store**: openspec (Engram MCP tools unavailable this cycle — this file
is the artifact of record) · **Skill resolution**: paths-injected (`cognitive-doc-design`)

**Fork decision: A — `isFenceDelimiter` is exported from `src/domain/split-text.ts` as-is**, imported
by `read-document.ts`, with a written revisit trigger (Decision 1). **But A alone is not the whole
fix**: the naive `inFence` toggle the proposal sketches introduces a *new* failure in the one
direction the proposal declared unacceptable — it can hide a real heading. Decision 3 adds a
balanced-delimiter precondition that makes the change's central invariant provable rather than
probable. That is the load-bearing decision here; the fork is the cheap one.

## Findings that correct the inputs

Recorded first, per this project's practice. Each was checked against the file.

| Claim in the proposal / exploration | Verified state |
|---|---|
| *"`headingsIn` switches to a line-by-line loop that toggles an `inFence` flag"* — the fix, as specified | **Incomplete, and the gap is a regression, not a smaller bug.** A chunk that begins *mid-fence* and contains a lone **closing** delimiter inverts the state: the toggle sets `inFence = true` at the closer, so every line **after** the code block ends is suppressed. Reachable: a prose line immediately followed (no blank line) by a fenced block is **one** block to `splitIntoBlocksFenceAware`; `isFencedCodeBlock` is then false (first line is not a delimiter), so an oversized such block goes through `splitLines`, whose pieces can start mid-fence. If that piece also carries a real `####` after the closer, the fix **hides a section that exists**. See Decision 3 |
| *"Unterminated fences: … A `##` line in such a piece is still reported as a heading after the fix"* (Approach, residual cases) | **True only under Decision 3's guard.** Under the naive toggle it is false for every line following a lone closer. The proposal's own residual description is a statement the implementation has to be designed to honour, not one it inherits |
| *"the fix can only ever remove matches that originate inside a fenced block"* (the invariant Gate 3 rests on) | **Not implied by the naive toggle** — see above. Decision 3 is what makes it a property of the code rather than a hope. Restated gateably: a heading is removed only when a delimiter line precedes it **and** a delimiter line follows it, within the same chunk |
| The toggle's ordering relative to the heading test is a live choice | **It is not — the two patterns are disjoint.** `isFenceDelimiter` is `/^\s*(```\|~~~)/`; the heading test is `/^#{2,6}\s+/`, anchored at column 0 with `#`. No line can satisfy both, so "toggle then test" (the chunker's shape) and "toggle then `continue`" (Decision 3's shape) are observationally identical for heading extraction. Recorded because it is the one place `sdd-apply` could diverge from the chunker and never notice |
| *"Fixture (new, small) — Added"* (Affected Areas) | **No committed fixture directory is needed.** `test/application/read-document.test.ts` already establishes both patterns this change needs, in-file: direct `SqliteIndexStore(":memory:")` + `saveDocument` seeding (`:288-303`) and temp-dir + the real `IndexDocuments` pipeline (`:206-258`). The Templates-shaped document is written inline by the temp-dir case. Gate 1 uses the **real** file, which is stronger than any fixture |
| *"No model download for Gates 1, 2, 4 (chunk count), 5, 6"* (Dependencies) | **Confirmed, and the mechanism is named**: `ReadDocument` reads only the store, and `compendio index` takes `--lexical` (`cli.ts:37`). Gate 1's index run is free |
| Whether Decision 3's guard weakens Gate 1 on the live file | **It does not, and the reason does not depend on a token count.** All four template fences in `docs/documentation-convention.md:166-260` are complete and blank-line separated, so `splitIntoBlocksFenceAware` keeps each whole; whether `chunkOutline` keeps section 12 as one chunk or descends to its four H3 children, and whether `splitToBound` splits further (`splitFence` re-emits both markers on every piece), **every chunk of that section carries an even delimiter count** |

## Technical Approach

One `export` keyword in the domain, one function rewritten in the application layer, and a
precondition that bounds the direction of error. No port change, no new domain type, no new domain
module, no chunker edit.

```
read_doc({ path, section })                                read-document.ts:52
  ├─ resolve(path)                                         unchanged
  ├─ getChunksByDocument(doc.id)                           unchanged
  ├─ MATCH  (:76-80)
  │     normalize(c.heading).includes(wanted)              unchanged — remark-sourced, fence-free
  │     || headingsIn(c.content).some(...)                 <-- the only edited expression's callee
  └─ LIST   (:86-92)   available.add(chunk.heading)        unchanged
              + headingsIn(chunk.content)                  <-- same callee, fixed by construction

headingsIn(markdown)                                       read-document.ts:113  REWRITTEN
  ├─ lines = markdown.split("\n")
  ├─ balanced = count(isFenceDelimiter) % 2 === 0          <-- Decision 3, the over-pruning guard
  └─ for each line:  delimiter -> toggle (only if balanced) and skip
                     inFence   -> skip
                     else      -> HEADING_LINE test        <-- H2-H6, NOT widened to H1

src/domain/split-text.ts                                   isFenceDelimiter: `function` -> `export function`
                                                           body, callers and behaviour UNCHANGED
```

| Question the change owns | Answer | Where |
|---|---|---|
| Which export shape ships | **A**, with a stated revisit trigger | Decision 1 |
| Does the newly public symbol get its own tests | **Yes**, and for a reason narrower than "it is public now" | Decision 2 |
| Exact rewrite of `headingsIn`, toggle semantics included | Balanced-delimiter precondition + toggle-and-skip loop | Decision 3 |
| What an unterminated fence does | Nothing is suppressed in that chunk — a defined contract, not an accident | Decision 4 |
| Do both call sites need separate work | **No**, and the reason is verified rather than assumed | Decision 5 |
| How a gate reaches an MCP-only tool | `scripts/section-lookup.mjs`, the `vector-reach.mjs` precedent, with one asserted self-check | Decision 6 |

## Architecture Decisions

### Decision 1: Fork A — export `isFenceDelimiter` as-is, and write down what would justify moving it

**Choice.** `src/domain/split-text.ts:85` becomes `export function isFenceDelimiter`. Name unchanged,
body unchanged, position unchanged. `read-document.ts` adds one import.

| Option | Cost | Decision |
|---|---|---|
| **A** — export the existing predicate | A private detail of the splitter becomes public domain surface; a module named after *splitting* becomes a dependency of *section lookup* | **Chosen** |
| **B** — a shared fence-aware line iterator consumed by both | Edits `splitIntoBlocksFenceAware`, the highest-consequence function in the repo for a `read_doc` fix | **Rejected** |
| **C** — a new domain module owning fence handling | One file for one predicate, plus a second test file, on speculation | **Rejected, for now** |

**Why A rather than C, stated as the tension it is.** The objection to A is real: `split-text.ts`'s
module comment is a *splitter policy* statement, and nothing in it anticipates a second consumer. The
answer is that the thing being shared is not a regex — it is the sentence **"`read_doc` agrees with
the chunker about what is fenced."** That agreement is the entire argument for reuse (proposal,
*Consistency beats correctness here*), and an import *from the chunker* states it more directly than
an import from a neutral third module: if someone later replaces the splitter's fence detection with
a stricter scanner, under A the exported predicate is left with a single consumer in a module about
splitting — glaring. Under C the shared module keeps its consumer count and the divergence looks like
nothing at all.

**The revisit trigger, so a future reader does not have to re-derive this.** Move it to its own
domain module **when a third consumer appears.** The candidate is already identified and recorded:
`src/domain/flatten-map.ts:92`'s sibling fence blindness (this change's explicit non-goal). Two
consumers is a shared definition; three, with one of them the accidental owner, is a misplaced home.
The move is a pure refactor with zero behavioural risk — the function is stateless, its tests move
with it, and `split-text.test.ts` must pass unmodified either way. **Reversibility is cheap and
symmetric, which is exactly why paying for C today is speculative.**

**Why B is rejected on a ground stronger than blast radius.** The two toggles look duplicated and are
not the same thing. `splitIntoBlocksFenceAware` toggles *before* testing and **keeps** the delimiter
line in its output; `headingsIn` must **drop** it. That asymmetry is harmless today only because
neither consumer ever asks a question *about* a delimiter line. A shared iterator has to publish one
convention for "is this delimiter line inside or outside", turning an accidental local property into
a contract every future consumer inherits. Three duplicated lines is the cheaper thing to own.

### Decision 2: a dedicated `describe("isFenceDelimiter")` in `test/domain/split-text.test.ts`

**Choice.** Yes — added to the existing file (which already has two top-level `describe`s), additions
only.

**Two reasons, neither of them "it is exported now".**

1. **It is a deliberate approximation of CommonMark, and approximations that are not written down get
   "fixed".** It toggles on ` ``` ` inside a `~~~` fence, ignores info strings, does not check
   fence-character runs, and accepts arbitrary leading whitespace. The proposal rejects a stricter
   parser *on the record*; a direct test is what converts that rejection from prose into something a
   future PR fails. Enumerate the edges: ` ``` `, `~~~`, four backticks, leading whitespace, an info
   string (` ```markdown `), two backticks (**false**), and a line that merely *contains* backticks
   later (**false**).
2. **"Tested through its effects on one caller" stops covering it the moment there are two.** A
   change that keeps every `splitToBound` assertion green can still break `read_doc` — the two
   consumers ask different questions of the same predicate.

### Decision 3: `headingsIn`'s exact shape — a balanced-delimiter precondition, then the toggle

**Choice.** Specified to the line, so the toggle semantics cannot be got wrong:

```ts
/** H2-H6 only. H1 is the document TITLE, not an addressable section:
 * `execute` re-attaches it at :68 and the parser routes the first H1 to
 * `outline.title`. Widening to `#{1,6}` would offer every document's own
 * title as a "section" — a new defect, not a wider fix. */
const HEADING_LINE = /^#{2,6}\s+(.+)$/;

/**
 * Titles of the H2-H6 heading lines a markdown fragment declares, excluding
 * any that sit inside a fenced code block.
 *
 * Fence state is CHUNK-LOCAL — this receives one chunk's content, never the
 * document — so suppression applies only when the fragment's delimiters are
 * BALANCED. An odd count means the fragment begins or ends mid-fence and its
 * state cannot be reconstructed from the fragment alone; toggling on a guess
 * inverts it after a stray CLOSING delimiter and hides a REAL heading. Not
 * suppressing merely reproduces the pre-fix behaviour for that fragment,
 * which is recoverable. design.md Decision 3/4.
 *
 * `isFenceDelimiter` is the chunker's own predicate (`domain/split-text.ts`)
 * and NOT a stricter CommonMark scanner, on purpose: `read_doc` agreeing with
 * the boundaries the indexer produced matters more than either being
 * individually more correct. design.md Decision 1.
 */
function headingsIn(markdown: string): string[] {
  const lines = markdown.split("\n");
  const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;

  const titles: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (isFenceDelimiter(line)) {
      // A delimiter line is neither content nor a heading: toggle, then skip
      // it. HEADING_LINE and isFenceDelimiter are disjoint patterns, so this
      // ordering is observationally identical to the chunker's toggle-then-
      // test one (design.md, findings table).
      if (balanced) inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING_LINE.exec(line);
    if (match !== null) titles.push(match[1]!.trim());
  }
  return titles;
}
```

**Four properties `sdd-apply` must preserve, each with its reason.**

- **`#{2,6}`, never `#{1,6}`.** The one thing this rewrite must not quietly do.
- **The delimiter line is skipped, not tested.** Free by disjointness, written anyway so the code
  states the rule instead of relying on it.
- **`balanced` is computed before the loop, not maintained during it.** A single-pass "fix it up at
  the end" cannot un-suppress lines already dropped.
- **CRLF behaviour is unchanged.** `split("\n")` leaves a trailing `\r` inside `(.+)`, and `.trim()`
  removes it — exactly what `matchAll(/…/gm)` does today. Do not "fix" this; it would be a behaviour
  change dressed as cleanup.

**Rejected — the naive toggle with no precondition** (the proposal's Approach, taken literally). It
is the fix as everyone will first write it, and it *creates* the failure the proposal ranks as the
only genuine regression: a lone closing delimiter suppresses everything after it. See the findings
table for the reachable shape.

**Rejected — pairwise suppression** (pair delimiter lines 0-1, 2-3, …; ignore a trailing unpaired
one). Strictly more precise: on a three-delimiter chunk it still suppresses the first, genuinely
fenced, span. It is rejected on cost/benefit, not correctness — it needs an index prescan and a
second concept, buys one shape nobody has observed, and both forms fail identically on the
pathological `[stray closer … opener]` chunk. Simplicity is load-bearing here: `sdd-apply` must not
get it wrong and a reviewer must be able to verify the invariant by reading. **If a real corpus ever
produces the three-delimiter shape, this is the upgrade, and it is local to this function.**

**Rejected — document-level fence state** (thread the whole document through, or persist fence state
per chunk at index time). It closes the residual cases properly and it is a schema/pipeline change
for a read-time bug — the proposal's Q3 assumption, upheld.

**The honest cost of the guard, not elided.** On a piece carrying an unterminated *opener* (odd
count), the naive toggle would have suppressed the rest and matched remark; the guard does not, so
phantom headings inside an unclosed fence are still reported. That is a case the fix **fails to
close**, not one it breaks — and it is precisely the trade the proposal mandated: under-detection is
annoying and recoverable, over-detection is a regression.

### Decision 4: an unterminated fence has defined behaviour — no suppression in that chunk

**Choice.** Stated as a contract rather than left as an emergent property: **a chunk whose fence
delimiter lines are odd in number is treated as containing no fence at all.** Every heading line in
it is reported, exactly as before this change.

This is Decision 3's precondition read from the outside, and it is what makes the change's public
claim precise. **The spec requirement must be scoped to chunk-local, balanced, delimiter-detectable
fences** — not to "code". Three named non-guarantees, to be carried into `CLAUDE.md` and the spec
rather than implied away: unterminated fences, chunks that begin mid-fence, and 4-space-indented code
blocks (no delimiter exists to detect).

> **Orchestrator note (gatekeeper pass, 2026-08-15) — a residual hole in the parity guard.**
>
> Decisions 3/4 define "balanced" as `count(isFenceDelimiter) % 2 === 0`. Parity cannot distinguish
> **one complete fence** from **one lone closer plus one lone opener** — both are two delimiters,
> both read as "balanced", and the toggle then runs against a fragment that is misaligned from its
> first line. The result is the exact regression Decision 3 exists to prevent: real headings between
> the stray closer and the stray opener get suppressed.
>
> Reachability is narrow but not zero — it needs one chunk to carry the tail of one straddling fence
> and the head of another, which `splitLines` can produce on a large prose-then-fence block (the same
> mechanism that makes the lone-closer case reachable in the first place). It is strictly rarer than
> the case Decision 3 already closes.
>
> **Not resolved here — this is an input to `sdd-tasks`, not a settled decision.** Three options, in
> rough order of cost: (a) accept it, name it as a fourth non-guarantee alongside the other three,
> and add a test pinning the known-wrong behaviour so it is visible rather than latent; (b) require
> the *first* delimiter in the fragment to be an opener before trusting the toggle, which needs a way
> to tell an opener from a closer — note that `isFenceDelimiter` deliberately cannot, since a bare
> ` ``` ` is both; (c) require the fragment's first line to not be preceded by an open fence, which
> is the chunk-crossing problem again and is out of scope by Decision 4.
>
> Option (a) is the cheap and probably correct answer given Decision 4's stated trade
> (under-detection recoverable, over-detection a regression) — but note it inverts that trade for
> this specific shape, which is the reason it deserves an explicit decision rather than silence.
> Whatever `sdd-tasks` picks, the spec's non-guarantee list may need a fourth entry, so the
> spec delta is in scope for a follow-up edit.

### Decision 5: one edit covers both call sites; nothing else is needed — verified, not assumed

**Choice.** No edit at `:79` (matching) or `:86-92` (listing) beyond what they inherit.

Checked rather than reasoned from "they call one function": the listing path also adds
`chunk.heading`, which comes from `chunkOutline`'s heading path, which comes from remark's AST — where
a `##` inside a fence is a `code` node and never a heading. So the listing path has no second,
independent source of phantoms. Same fact carries Gate 3: `search_docs`'s `section` values are copies
of that stored `heading` and match on the **first** branch of the `||`, which this change does not
touch. The fix prunes candidates from the second branch only.

### Decision 6: Gate 1 ships as `scripts/section-lookup.mjs`, with one asserted self-check

**Choice.** `read_doc` is MCP-only (`cli.ts` registers `index`, `sync`, `index-md`, `search`,
`overview`, `eval`, `serve` — no `read`), so Gate 1 follows the `scripts/vector-reach.mjs` precedent:
a script that imports from `dist/`, drives the use case directly, and is documented in `CLAUDE.md`.

```bash
node dist/cli.js index --lexical                     # this repo's own docs, zero-config loose
node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"
```

It constructs `SqliteIndexStore(<root>/.compendio/compendio.db)` and `ReadDocument` directly — no
embeddings, no model download — and prints the `ReadResult` discriminant plus the payload that
matters: for `section`, the stored `heading` of every matched chunk and the leading content; for
`section-not-found`, the full sorted `availableSections` with a count.

**The one asserted check, mirroring `vector-reach.mjs`'s monotonicity self-check** (a manual gate that
can only be read by eye is a manual gate that gets misread): the script exits **non-zero** when the
result is `type: "section"` and **no** matched chunk's stored `heading` normalizes-contains the
request — i.e. the match came *only* from a content heading, which is the defect's exact shape. It
therefore fails loudly on today's tree and exits 0 after the fix, when the call returns
`section-not-found`. The 17-phantom assertion is read from the printed `availableSections`, recorded
verbatim in the verify report.

**Rejected — exporting `headingsIn` so the script can call it directly.** Widening production surface
to make a gate easier, when `availableSections` already exposes every phantom.

## Flow notes

Per `rules.design`. The live case, one chunk of `docs/documentation-convention.md` section 12:

```
chunk.heading  = "12. Templates > Functional specification"     (remark-sourced, fence-free)
chunk.content  = "### Functional specification (`docs/functional/`)\n\n```markdown\n…\n## Business
                  rules\n…\n```"

BEFORE   headingsIn -> ["Business rules", "Use cases", …]        matchAll, no fence state
         match: normalize("Business rules") in that list -> chunk MATCHES
         result: { type: "section", section: "Business rules", content: <Templates material> }

AFTER    delimiters in chunk = 2 (even) -> balanced
         opener  -> toggle inFence = true, line skipped
         "## Business rules" -> inFence -> skipped
         closer  -> toggle inFence = false, line skipped
         headingsIn -> []          (no H2-H6 outside the fence in this chunk)
         match: neither branch -> no chunk matches
         result: { type: "section-not-found", availableSections: [<the real H2/H3 paths>] }
```

The guard's own case, the shape Decision 3 exists for:

```
chunk.content = "…tail of code…\n```\nSome prose\n#### Real subheading\n\nbody"
delimiters = 1 (odd) -> NOT balanced
  naive toggle:  inFence = true at the closer -> "#### Real subheading" SUPPRESSED   (regression)
  with guard:    no suppression -> "#### Real subheading" reported                   (correct)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/split-text.ts` | Modify — **exposure only** | `isFenceDelimiter` gains `export` and a doc comment naming the second consumer and the deliberate approximation. Body, callers and behaviour unchanged |
| `src/application/read-document.ts` | Modify | `headingsIn` rewritten per Decision 3; `HEADING_LINE` hoisted; one import added |
| `src/domain/flatten-map.ts` | **Unchanged — asserted** | The recorded non-goal (Gate 6) |
| `src/domain/chunking.ts`, `src/domain/similarity.ts`, `src/domain/ports.ts`, `src/server.ts`, `src/cli.ts` | **Unchanged — asserted** | No port change, no response-shape change, no new MCP tool or CLI command |
| `test/domain/split-text.test.ts` | Extend, **additions only** | `describe("isFenceDelimiter")` (Decision 2). Existing cases must pass unmodified |
| `test/application/read-document.test.ts` | Extend, **additions only** | Both call sites, the balanced-guard cases, H4-H6, merged tiny section, round-trip. No committed fixture (findings table) |
| `scripts/section-lookup.mjs` | **New** | Decision 6 |
| `CLAUDE.md` | Modify | One *Non-obvious decisions* bullet: section lookup is fence-aware, chunk-local, balanced-only, and shares the chunker's predicate; plus the manual-gate recipe beside `vector-reach.mjs` |
| `openspec/changes/…/specs/mcp-contract/spec.md` | — | **`sdd-spec` owns it.** One new requirement; neither `:47` nor `:71` edited |

## Testing Strategy

`strict_tdd: true`. Every case is written first and observed **failing** on the current tree. A case
that passes unfixed is not measuring what it claims.

| Gate | Layer | Case | Falsifies |
|---|---|---|---|
| 1 | Manual (`section-lookup.mjs`) | `section: "Business rules"` on the real file: `section` + Templates content before, `section-not-found` after; none of the 17 phantoms in `availableSections`; the real H2/H3 paths still there | The defect, live. **STOP** if the "before" run does not resolve to the Templates chunk |
| 2a | Unit (`:memory:` seed) | A chunk whose content carries a real `#### Deep subheading` outside any fence still resolves | Over-pruning of headings that exist only in chunk content |
| 2b | Integration (temp dir + `IndexDocuments`) | A tiny section merged by `mergeTinyPieces` into a bigger chunk still resolves through the second `\|\|` branch | The branch this change prunes being pruned to nothing |
| **2c** | Unit (`:memory:` seed) | **The Decision 3 guard**: a chunk of `[code, closer, prose, "#### Real"]` (one delimiter) still lists and resolves `Real` | **The naive toggle.** This is the only case that fails against the *fixed-but-unguarded* tree, so it must be written even though it passes today |
| 2d | Unit | Balanced counterpart: `[opener, "## Phantom", closer, "## Real"]` — `Phantom` gone, `Real` kept | Suppression running to end-of-chunk instead of to the closer |
| 3 | Integration (`ejemplos/` + `FakeEmbeddings`) | Every `search_docs` result's `section`, passed verbatim to `read_doc`, returns a `section` result | The round-trip requirement (`mcp-contract/spec.md:47-69`) |
| 4 | Integration + manual | Chunk count and boundaries over `ejemplos/` **identical**; `split-text.test.ts` unmodified; `compendio eval` unchanged (MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22) | The change drifting into the chunker. Under A, identity is the correct assertion — the diff is one keyword |
| 5 | Unit | `describe("isFenceDelimiter")`, edges enumerated in Decision 2 | The approximation being an accident rather than a decision |
| 6 | Suite | `npm test`, `npm run typecheck`, `npm run build`; `read-document.test.ts` additions-only; `flatten-map.ts` untouched | Behaviour moving beyond fenced lines |

**2c is the most load-bearing case in the change.** Every other case fails on today's tree and passes
after any plausible fix; 2c is green today, green after Decision 3, and **red against the fix as the
proposal specifies it**. Without it the regression ships inside a green suite — the shape this
repository has recorded more than once.

## Delivery size

| Driver | Estimate |
|---|---|
| `split-text.ts` — `export` + doc comment | 3–8 |
| `read-document.ts` — `headingsIn` + `HEADING_LINE` + import | 25–40 |
| `read-document.test.ts` — 2a–2d, both call sites, Gate 3 | 90–160 |
| `split-text.test.ts` — direct delimiter coverage | 30–60 |
| `scripts/section-lookup.mjs` — script + header comment | 80–130 |
| `mcp-contract` spec delta (`sdd-spec`) | 40–70 |
| `CLAUDE.md` | 10–20 |

**278–488 changed lines.** `400-line budget risk: Medium` — above the proposal's 175–330 because the
script and case 2c were not priced there, and this repository's forecasts have landed 1.3×–4× low for
several cycles (`bounded-chunk-size` 240–420 → 773). **One PR remains the working assumption and
there is no natural cut**: both call sites share one function, Gate 1 is blocking and needs the
script, and 2c is the change's own regression guard. An overrun means trimming test *breadth*, never
2c and never the script.

## Migration / Rollout

**No migration.** Nothing persisted is touched — `headingsIn` runs at read time over already-stored
chunk content. No schema, no DDL, no `reset()`, no re-index, in either direction; a document indexed
after the fix is byte-identical to one indexed before it (Gate 4). Rollback is `git revert` +
`npm run build`, and the only residue is behavioural and immediate.

**The one consequence to state plainly rather than let someone discover**: 17 section names stop
being offered for `docs/documentation-convention.md`. They never existed.

## Open questions

1. **`sdd-spec` is running in parallel and cannot see Decision 3/4.** The requirement it is writing
   must be scoped to **chunk-local, balanced, delimiter-detectable** fences, with unterminated
   fences, mid-fence chunk starts and indented code blocks named as non-guarantees. If it ships an
   unqualified "a heading inside a code block MUST NOT be addressable", the spec over-promises
   against the implementation. **The orchestrator should reconcile this before `sdd-tasks`.**
2. **Proposal Q1 (should `read_doc` say the name was found inside a fence) is not answered here and
   nothing in this design depends on it.** The assumption in force — plain `section-not-found`, the
   phantom simply absent — is what Decisions 3–5 implement. A "yes" adds a response field, which the
   proposal scopes out, and would reopen the `mcp-contract` delta.
3. **Q2 (the 17 vanishing sections) and Q4 (`flatten-map.ts` scheduling) are answered by the
   assumptions in force.** Q3 (unterminated fences) is answered by Decision 4, which converts it from
   an omission into a written contract.
