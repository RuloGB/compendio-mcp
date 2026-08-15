# Design: A Fence-Aware `stripHeadingLines`, Without Touching Anything Else

**Phase**: design · **Artifact store**: openspec · **Skill resolution**: paths-injected (`cognitive-doc-design`)

**The whole change is one `else if` inside one loop.** `stripHeadingLines` (`flatten-map.ts:78-105`)
gains a precomputed `balanced` count, an `inFence` toggle, and a delimiter branch that **emits** rather
than skips. No new regex is written anywhere in this change — the two patterns involved already exist
and are already prefix-only. That last sentence is the CRLF constraint in its strongest form: there is
nothing new to CRLF-verify because nothing new exists.

This design is the counterpart of `read-doc-fence-aware-sections`, not its copy. Three things invert:
the delimiter line is kept instead of skipped (Decision 2), the parity hole's consequence is a leak
instead of a loss (Decision 7), and the golden-reference test is a first-class deliverable rather than
a passenger (Decision 4).

## Approach at a glance

```
buildExcerpt(chunk.content)                                   excerpt.ts:56
  ├─ pass 1  flattenWithMap(raw, true)                        excerpt.ts:61
  │     S1 stripHeadingLines(raw)      flatten-map.ts:29  <-- THE ONLY EDIT
  │     S2 /```[^`]*```/g -> " "       flatten-map.ts:32-33     unchanged
  │     S3-S6                                                   unchanged
  ├─ if pass 1 is "" -> pass 2 flattenWithMap(raw, false)     excerpt.ts:68  unchanged
  └─ window / ellipsis                                        excerpt.ts:71-82  unchanged

src/domain/split-text.ts   isFenceDelimiter (:98)   imported as-is, ZERO-LINE DIFF
```

| Question this design owns | Answer | Where |
|---|---|---|
| The loop, to the line | `balanced` before the loop, toggle-then-fall-through | D1 |
| Why a delimiter line must never `continue` | S2's own input depends on it | D2 |
| Why I1-I4 need no new map machinery | The emission path never asked *why* a line was kept | D3 |
| What happens to `referenceFlatten` | Rewritten, predicate shared, loop kept independent, red first | D4 |
| The backtick-injection risk | Measured, recorded, **not fixed** | D5 |
| `isFenceDelimiter`'s third consumer | The sibling's revisit trigger fires — recorded, not acted on | D6 |
| The four uncovered shapes, per shape | Three unfixed, one inverted | D7 |

## Architecture Decisions

### D1 — The loop shape, specified so `sdd-apply` invents nothing

```ts
import { isFenceDelimiter } from "./split-text.js";

/** Anchor-free and prefix-only, deliberately: `split("\n")` leaves a trailing
 * `\r` on every line of a CRLF document, and `.` never matches it. Adding a
 * `$` here would silently stop matching every heading on
 * `docs/documentation-convention.md`. See read-document.ts:120-138. Stateless
 * (no `g` flag), so module scope is safe — unlike trackedReplace's regexes,
 * which are cloned at :117-118 precisely because they carry `lastIndex`. */
const HEADING_LINE_PREFIX = /^\s*#{1,6}\s/;

function stripHeadingLines(markdown: string): FlatText {
  const lines = markdown.split("\n");
  // ... lineStarts loop unchanged (:80-85) ...

  // Chunk-local fence state, trusted only when the delimiter count is even.
  const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;

  const chars: string[] = [];
  const map: number[] = [];
  let emittedAnyLine = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isFenceDelimiter(line)) {
      if (balanced) inFence = !inFence;
      // NO `continue` — a delimiter line is CONTENT here. See D2.
    } else if (!inFence && HEADING_LINE_PREFIX.test(line)) {
      continue;
    }
    // ... emission block unchanged (:93-102) ...
  }
  return { text: chars.join(""), map };
}
```

Four properties, each with its reason:

| Property | Why |
|---|---|
| `balanced` is computed **before** the loop, never maintained during it | A single-pass "fix it up at the end" cannot un-drop lines already dropped. Verbatim from `read-document.ts:169` — the repetition is the point, it is what a reviewer recognises |
| Toggle happens **at** the delimiter, so `inFence` is true for lines strictly *between* opener and closer | Matches `splitIntoBlocksFenceAware`'s toggle-then-test order (`split-text.ts:112`). Agreeing with the chunker is the change's whole argument |
| When `!balanced`, `inFence` stays permanently `false` | Every heading-pattern line is dropped exactly as today. Non-guarantee 1 becomes a property of the code, not an accident |
| `else if`, not two independent `if`s | Observationally identical — `/^\s*(```\|~~~)/` and `/^\s*#{1,6}\s/` require different first non-whitespace characters and are disjoint — but the `else` makes "a delimiter line is never a drop candidate" structural instead of inherited |

**Rejected — the naive toggle with no `balanced` guard.** Same rejection as the sibling, different
damage: on a chunk with a lone closer, `inFence` inverts and every real `## Heading` after it is
*retained*, dumping the document's own heading text into the excerpt body. Milder than `read_doc`'s
version of this bug, but still strictly worse than today for that chunk.

**Rejected — fusing the `balanced` count into the existing `lineStarts` loop.** Saves one pass over
`lines` on inputs that are at most a chunk long. Costs the verbatim grep-match with `read-document.ts:169`.

### D2 — Delimiter lines are emitted with their map entries, and that is load-bearing

`headingsIn` `continue`s on a delimiter (`read-document.ts:174-181`) because it is answering "is this
a heading?" and a delimiter is neither heading nor content. **S1 is answering a different question**:
it produces the string S2 then scans. `flatten-map.ts:33`'s `` /```[^`]*```/g `` needs both backtick
runs *present in S1's output* to find a fence at all.

**Concrete consequence if a `continue` is copied over.** S1 deletes every ```` ``` ```` line → S2
matches nothing → the fence body survives → S3 blanks its backticks → the entire code block leaks into
the `dropFencedBlocks: true` excerpt as prose. The fenced-block drop is silently disabled for the whole
corpus, and no invariant fails: I1-I3 are all still satisfied by a wrong output.

**How it is made impossible to ship, rather than merely warned about.** Gate 2's third bullet is the
detector: for a balanced backtick fence with no interior backtick, the `dropFencedBlocks: true` output
must be **byte-identical** before and after. The copied-`continue` defect changes it from
`"Prose before. Prose after."` to a string containing `python print('hi')`. That is a loud, existing,
already-specified assertion — not a new mechanism, which is why this decision is cheap to enforce.

### D3 — I1-I4 hold with no new map machinery, argued rather than asserted

The exploration inferred this (§3); here is the argument, since Gate 3's falsification clause re-opens
the design if it is wrong.

The emission block (`:93-102`) derives its map entries from `lineStarts[i]` and `j` alone. It never
inspects *why* line `i` reached it. The fence gate changes only the **set** of `i` values that arrive —
and it only ever grows that set.

| Invariant | Why growing the kept set cannot break it |
|---|---|
| **I1** `map.length === text.length` | Every `chars.push` at `:94`/`:99` is paired with a `map.push` at `:95`/`:100`. Structural, unchanged |
| **I2** non-decreasing | `lineStarts` is strictly increasing in `i`; within a line, `lineStart + j` increases; lines are visited in ascending `i`. Holds for **any** subset of `i`, including the full set. The separator space maps to `lineStarts[i]`, which strictly exceeds the previous line's last mapped offset |
| **I3** verbatim copy / synthesized spaces | Every emitted character is `line[j]` = `markdown[lineStart + j]` by construction of `lineStarts` (`:82-85`). The only synthesized character remains the separator space |
| **S2-S6** | `trackedReplace` (`:112-143`) preserves I1-I3 for *any* match set: unmatched characters carry their own map entry through, replacements carry theirs. So even D5's pathological match-set change is invariant-safe — only the text moves |

**The one genuine behaviour change the map exposes, asserted rather than left to be noticed** (Gate 3,
second bullet): a query span landing on a fence-interior heading line is today unlocatable —
`toFlatOffset` (`:57-70`) resolves a destroyed raw offset forward, the span collapses to `end === start`
and `excerpt.ts:98` filters it out. After the fix, `map` carries entries inside that line, so
`end > start`, the span survives, and the lead window can centre on it.

### D4 — `referenceFlatten` moves, and it must stay an independent witness

`referenceFlatten` (`flatten-map.test.ts:10-23`) is a hand-copied fence-blind duplicate of the whole
chain, asserted byte-identical against `flattenWithMap` for all 12 `GENERATED_INPUTS` in both modes
(`:83-92`). None of those fixtures puts a `#`-line inside a fence, so I4 will most likely still pass
after the fix. **That is the trap**: its premise is precisely what this change repeals.

| Option for the reference | Verdict |
|---|---|
| Import `stripHeadingLines` itself | **Rejected.** I4 becomes a tautology and stops detecting drift in the tracked-transform machinery, which is the only thing it ever existed to detect |
| Hard-code a third copy of `` /^\s*(```\|~~~)/ `` | **Rejected.** `split-text.ts:85-97` states one shared definition of "this line is a fence delimiter" as policy; a third copy can drift silently |
| **Import `isFenceDelimiter`, hand-write the balanced-count + toggle in the reference's own `.filter().join(" ")` idiom** | **Chosen.** The predicate is shared *policy* and already has direct unit coverage from the sibling change; the **loop** is the thing under test and stays independently written, as does the heading regex |

```ts
// Golden reference updated 2026-08-15 by `excerpt-fence-aware-flatten`: the
// fence-BLIND filter this used to carry is the defect, not the contract.
// Deliberately still a separate loop from stripHeadingLines' — only the
// delimiter predicate is shared.
const lines = markdown.split("\n");
const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;
let inFence = false;
const withoutHeadings = lines
  .filter((line) => {
    if (isFenceDelimiter(line)) {
      if (balanced) inFence = !inFence;
      return true;                    // kept, unlike headingsIn — D2
    }
    return inFence || !/^\s*#{1,6}\s/.test(line);
  })
  .join(" ");
```

**Required ordering under `strict_tdd: true`, decided here so `sdd-tasks` does not have to guess:**

1. Add the new `GENERATED_INPUTS` fixtures **and** the `referenceFlatten` rewrite. Run `npm test`.
2. **Observe I4 red** — reference is fence-aware, production is not. Record the failure output.
3. Then edit `flatten-map.ts`. I4 goes green.

Note which suite discriminates: the I1-I3 suite (`:72-81`) passes in **both** states, because the
invariants genuinely do not care (D3). Only I4 is red. "The invariants are green" is not evidence here.

New fixtures, all four feeding both suites:

| Fixture | Purpose |
|---|---|
| Backtick fence containing `# a python comment` | The core case (exploration §0 row 4, Gate 2) |
| Fence-interior `#`-line carrying an **odd** number of backticks | D5 / Gate 4's probe |
| Unterminated fence (odd delimiter count) with a `#`-line inside | Pins non-guarantee 1 as unfixed-not-regressed |
| Misaligned-even: stray closer, real `## Heading`, stray opener | Pins non-guarantee 4's known-wrong behaviour visibly rather than latently |

### D5 — The backtick-injection risk: measured, recorded, deliberately not fixed

S1 now *retains* lines it used to drop, and a fence-interior `#`-line can carry a backtick. That
injects a backtick into the string S2 scans and can break `` /```[^`]*```/g `` where it previously
matched — pushing the chunk into out-of-scope S2 gap B.

**Decision: measure it, record the outcome either way, do not fix it.** Fixing it means designing and
CRLF-verifying a second regex, which the proposal scopes out and which would be fixing S2, not S1.
Severity is low and already-accepted in kind: it moves a chunk from "excerpt missing the matched
vocabulary" to "excerpt contains the code it matched on", the same trade `excerpt.ts:62-66` made
deliberately.

**The two measurements, stated exactly:**

| # | Measurement | Where |
|---|---|---|
| **M1** — mechanism | The odd-backtick fixture's `dropFencedBlocks: true` output, recorded **verbatim** before and after, in the verify report. No required outcome; the only failing outcome is not measuring it | `flatten-map.test.ts` fixture + Gate 4 |
| **M2** — live exposure | Over every stored chunk in `.compendio/compendio.db`: count `#`-lines that are **fence-interior** (per `isFenceDelimiter`, balanced chunks only) **and** carry an **odd** number of backticks | The Gate 1 script (D-below) |

M2 was already run once by the exploration (§0b) on this repo's 13 stored chunks of
`docs/documentation-convention.md`: **21 fence-interior `#`-lines will be newly retained, 0 contain a
backtick.** Zero live instances here. **Re-run it, because §0b names the trap**: filtering *all*
`#`-lines carrying a backtick returns 4 hits that sit **outside** the fences, are still dropped after
the fix, and carry an even count anyway. A measurement that does not restrict to fence-interior lines
measures nothing.

### D6 — `isFenceDelimiter` gets a third consumer; the sibling's revisit trigger fires here

`read-doc-fence-aware-sections`'s Decision 1 wrote a revisit trigger and named this exact file as the
candidate: *"Move it to its own domain module when a third consumer appears… the candidate is already
identified: `src/domain/flatten-map.ts:92`."* This change is that third consumer.

**Decision: do not move it now. Record that the trigger fired.**

- The proposal's Affected Areas marks `split-text.ts` **Unchanged — asserted**, and Gate 5 asserts a
  zero-line diff there. A move contradicts a resolved decision.
- The sibling's own argument for deferring was reversibility: the function is stateless, the move is a
  pure refactor with zero behavioural risk, and its tests move with it. That argument is symmetric —
  it is exactly as cheap after this change as during it.
- Bundling a module move into a behaviour fix makes one review diff carry two unrelated stories, in a
  change whose entire production surface is otherwise ~10 lines.

**Recording it is not optional.** This change exists because the last deferred item survived only as
one line in an archive report. The trigger goes into `CLAUDE.md` alongside the S2 `~~~`/interior-backtick
follow-up, in the same greppable sentence.

**Hexagonal check** (`config.yaml` `rules.design`): `flatten-map.ts` and `split-text.ts` are both
`src/domain/`. Domain-to-domain import, no port, no adapter. `flatten-map.ts` currently has **zero**
imports; this adds its first, and it stays free of SQLite, transformers.js and the filesystem.

### D7 — The four uncovered shapes, with their per-shape consequence *for S1*

Do not carry `mcp-contract/spec.md:95`'s wording across; for shape 4 it states the opposite of the truth.

| # | Shape | S1 mechanism | Consequence in the excerpt |
|---|---|---|---|
| 1 | Unterminated fence (odd count) | `balanced` false → `inFence` never leaves `false` | Every heading-pattern line still dropped. **Today's bug, unfixed for that chunk. Not a regression.** Measured context: 0 of 13 chunks of the live document (§0b) |
| 2 | Chunk-crossing fence | Same as 1 when either piece has an odd count | Same: unfixed, not regressed. If both pieces happen to be even, it degenerates into shape 4 |
| 3 | 4-space indented code block | No delimiter line exists to detect | Still dropped. **Unfixable by this mechanism at all**, not merely uncovered |
| 4 | Misaligned even: stray closer, then content, then stray opener | `balanced` true, toggle starts from the wrong phase | **Inverted and milder than `read_doc`'s.** A *real* document heading is misread as fence-interior and **kept**, leaking its text into the excerpt body as prose and competing for the 120/1400-char budget. A genuinely fence-interior line before the stray closer stays dropped. Both halves are cosmetic |

**The safety argument in one line**: shapes 1-3 fail *toward today's behaviour*. Shape 4 is the only one
that changes behaviour in an uncovered case, and where `read_doc`'s version of it removes a real section
from the addressable set — a capability loss — S1's adds a real heading string to a text blob.

## Flow notes

Per `rules.design`. The defect lives entirely in the S1 → S2 → fallback **ordering**, and the fallback
at `excerpt.ts:68` is genuinely reached on real content. Traced on the stored `12. Templates` chunk of
`docs/documentation-convention.md` (1 473 chars, **8** delimiter lines — even, §0b):

```
BEFORE
  pass 1  flattenWithMap(raw, true)
     S1  drops every /^\s*#{1,6}\s/ line, including the 21 fence-interior ones
     S2  matches and drops all four backtick fences
     S3-S6 -> "" ..................................... 0 chars   MEASURED
  flat.text.length === 0  ->  excerpt.ts:68 fallback fires
  pass 2  flattenWithMap(raw, false)
     S1  SAME damage — it runs at :29, BEFORE the :32 branch reads the flag
     S2  skipped
     S3-S6 -> 774 chars of fence bodies ............... MEASURED
  excerpt = 774 chars, containing none of "Business rules" / "Use cases" /
            "Out of scope" / "Context and objective"   MEASURED

AFTER
  pass 1  S1 keeps the 21 fence-interior lines (8 delimiters, even -> gate fires)
          S2 still drops all four fences — the retained lines are INSIDE them
          -> still 0 chars
  fallback STILL fires — the fix does not change WHICH pass produces the excerpt
  pass 2  S1 same retention, S2 skipped
          -> > 774 chars, now carrying the four heading names
```

**The property worth stating explicitly, because Gate 1 asserts it and it looks redundant otherwise**:
pass 1 must *still* be 0 chars after the fix. That is what proves S2 is still matching §12's fences. A
pass 1 that suddenly becomes non-empty would mean S2 stopped matching — i.e. D5's risk fired on the
live corpus, not merely on a fixture.

Span flow, same trace: `search-documents` passes raw-coordinate spans → `mapSpansToFlat`
(`excerpt.ts:91-99`) → today a span inside a stripped fence line collapses to zero width and is
filtered at `:98` → after the fix it maps into the retained line and survives, so `selectMatchCentre`
can centre the lead window on the matched vocabulary instead of falling through to `prefixExcerpt`.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/flatten-map.ts` | Modify | D1: one import, `HEADING_LINE_PREFIX` hoisted with its CRLF comment, `balanced`, `inFence`, delimiter branch. `stripHeadingLines`' doc comment (`:72-77`) updated to state the fence rule and its chunk-locality |
| `src/domain/split-text.ts` | **Unchanged — asserted** | Zero-line diff (Gate 5). D6 records the fired revisit trigger without acting on it |
| `src/domain/excerpt.ts` | **Unchanged — asserted** | Zero-line diff. The fallback keeps firing for §12 |
| `src/application/read-document.ts` | **Unchanged — asserted** | Zero-line diff. Sibling territory |
| `test/domain/flatten-map.test.ts` | Modify — **deliberately** | D4: `referenceFlatten` rewritten with a dated why-comment (**the only permitted existing-assertion change in the whole diff**) + 4 new `GENERATED_INPUTS` fixtures |
| `test/domain/excerpt.test.ts` | Extend — **additions only** | Fallback-path case, the locatable-span case (D3), Gate 4's recorded output. Its existing fenced cases (`:31-43`) carry no interior `#`-line and must pass unmodified |
| `scripts/excerpt-flatten-probe.mjs` | **New** | Gate 1 bullets 1-3 (stored chunk, both passes, token presence) + D5's M2 corpus scan. `section-lookup.mjs` precedent: reads `.compendio/compendio.db` directly, no model download. **One asserted self-check** — exit non-zero when the named chunk's excerpt lacks all four token strings, so it is red today and green after |
| `test/fixtures/excerpt-window/docs/` | **Unchanged — asserted** | Zero fence delimiters (§3) |
| `openspec/specs/mcp-contract/spec.md` | — | **`sdd-spec` owns it.** One new requirement; none of the four neighbours edited |
| `CLAUDE.md` | Modify | One *Non-obvious decisions* bullet: excerpt flattening is fence-aware, chunk-local, balanced-only, shares the chunker's predicate; the four non-guarantees with shape 4's **inverted** consequence; the S2 `~~~`/interior-backtick follow-up; D6's fired revisit trigger. Plus the probe script beside `section-lookup.mjs` |

## Testing Strategy

`strict_tdd: true`. Every case is written first and observed **failing**. A gate that passes unfixed is
not measuring what it claims. No model download for Gates 1-4 (`index --lexical`, `search --lexical`).

| Gate | Layer | Case | Falsifies |
|---|---|---|---|
| 1 | Manual — `excerpt-flatten-probe.mjs` + `node dist/cli.js --root . search --lexical` | Stored §12 chunk: before = pass 1 empty, four tokens absent from both passes; after = tokens present in pass 2 **and** pass 1 **still** 0 chars; tokens present in the real CLI excerpt | The live-occurrence claim. **STOP** if "before" does not reproduce §0b. Uses the real CRLF file, which is what exercises the CRLF path |
| 2 | Unit (`flatten-map.test.ts`) | Backtick fence + `# a python comment`: `false` pass gains `a python comment`; **`true` pass byte-identical before and after** | D2's copied-`continue` defect, immediately |
| 3 | Unit | I1-I3 over all fixtures, both modes (`assertInvariants`, `:94-116`); plus a span landing on a retained fence-interior line producing `end > start` | D3's argument. Any I1-I3 violation re-opens the design |
| **4** | Unit, **measurement-only** | Odd-backtick fence-interior `#`-line: `dropFencedBlocks: true` output recorded verbatim, both directions. Plus M2's corpus scan | Nothing — the only failing outcome is silence (D5) |
| 5 | Suite | `npm test`, `npm run typecheck`, `npm run build`; `compendio eval` unchanged (MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22); zero-line diffs on `split-text.ts` / `excerpt.ts` / `read-document.ts`; `referenceFlatten` the only modified existing assertion | The change drifting outside S1 |
| **I4** | Unit, **ordering-critical** | Red after step 1 of D4's sequence, green only after `flatten-map.ts` changes | The golden reference being "repaired" by reverting fence-awareness — the highest-likelihood risk in the proposal |

## Migration / Rollout

**None.** Excerpts are computed at query time from stored `chunk.content`; nothing about them is
persisted. No reindex in either direction, no schema, no DDL, no `reset()`, no `.compendio/` deletion,
no config key, no port, no response field. A document indexed after the fix is byte-identical to one
indexed before it. Rollback is `git revert` + `npm run build`, and the only residue is behavioural and
immediate.

## Delivery size

| Driver | Estimate |
|---|---|
| `flatten-map.ts` — import, hoisted regex, `balanced`, `inFence`, branch, doc comment | 15-25 |
| `flatten-map.test.ts` — `referenceFlatten` rewrite + 4 fixtures | 45-75 |
| `excerpt.test.ts` — fallback, locatable span, Gate 4 | 40-80 |
| `scripts/excerpt-flatten-probe.mjs` — probe + M2 scan + self-check + header | 90-150 |
| `mcp-contract` delta (`sdd-spec`) | 50-90 |
| `CLAUDE.md` | 12-20 |
| **Total** | **252-440** |

**Decision needed before apply: No · Chained PRs recommended: No · 400-line budget risk: Medium.**
Above the proposal's 176-350 because the probe script was priced as "possibly added" there and this
design makes it required by both Gate 1 and D5's M2. This repository's forecasts have landed 1.3x-4x
low for several cycles (`bounded-chunk-size` 240-420 → 773). **One PR remains the working assumption
and there is no natural cut** — one function, one requirement. An overrun means trimming test breadth,
never the probe script and never the I4 red-first step.

## Open questions

1. **`sdd-spec` runs without seeing D7.** Its new `mcp-contract` requirement must be scoped to
   **chunk-local, balanced, delimiter-detectable** fences, with all four non-guarantees named — and
   shape 4's consequence written *for excerpts* (a real heading is **kept** and leaks as prose), not
   copied from `spec.md:95`, where it says the opposite. An unqualified "a fenced heading line MUST NOT
   be removed from an excerpt" over-promises against the implementation.
2. **Proposal Q1 (should the caller be told the excerpt is quoting code) is unanswered and nothing
   here depends on it.** The assumption in force — no new response field — is what this design
   implements. A "yes" reopens the `mcp-contract` delta.
3. **Proposal Q4 is now moot**: §0b measured the stored chunk at 8 delimiters (even), so the "live on
   this repository" framing holds and needs no retraction. Recorded so the question is not re-asked.
