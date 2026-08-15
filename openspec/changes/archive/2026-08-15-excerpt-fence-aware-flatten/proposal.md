# Proposal: A `search_docs` Excerpt Must Not Silently Delete the Words the Query Matched On

`stripHeadingLines` (`src/domain/flatten-map.ts:78-105`) drops every line matching `/^\s*#{1,6}\s/`
(line 92) with no fence awareness. A `# comment` in a shell block, a `## Business rules` line inside a
markdown template, a `# key:` line in a YAML sample — all are deleted from the excerpt before the
caller ever sees it. The chunk is still retrieved: FTS5 indexes the raw content and is unaffected. So
`search_docs` can return a result whose `excerpt` contains **none of the vocabulary that caused the
match**.

**This is live on this repository's own corpus.** `docs/documentation-convention.md` §12 "Templates"
(lines 162-261, 1 484 chars) flattens to **the empty string** on the first pass, and `Business rules`,
`Use cases` and `Out of scope` are absent from **both** flatten passes despite being present in the
raw markdown. Measured by executing the production `flattenWithMap` from `dist/`, Node v22.22.0
(`exploration.md` §0).

**This is the second half of a change already shipped.** `read-doc-fence-aware-sections` (archived
2026-08-15) fixed the same root cause in `read_doc`'s `headingsIn` and recorded this half as an
explicit open item (`archive/2026-08-15-read-doc-fence-aware-sections/archive-report.md:229`). Both
trace to finding 1.4 of `code-review-src-2026-08-14.md`. This change closes it with the same
primitive, the same balanced-count gate, and the same discipline of naming what it does **not** cover.

## Evidence discipline

The exploration ran without `Bash`, so most of it is hand-traced static analysis. Section 0 is the
orchestrator's executed measurement. This proposal preserves that split explicitly:

| Label | Meaning |
|---|---|
| **MEASURED** | Executed in `exploration.md` §0 against `dist/domain/flatten-map.js` |
| **DERIVED** | A deduction whose premises are §0's measured numbers, stated with the deduction shown |
| **INFERRED** | Hand-traced from source. Not executed. Design and apply must convert the load-bearing ones into measurements |

No inferred claim is promoted. Where this proposal makes a new claim the exploration did not, it says
so (see "One regression direction the exploration did not find").

## Intent

### The failure, in the terms a caller experiences it

| | |
|---|---|
| Call | `search_docs({ query: "business rules" })` against this repository's own `docs/` |
| Retrieval | The §12 "Templates" chunk is a legitimate hit — FTS5 indexed the raw `## Business rules` line |
| Excerpt returned | Contains no occurrence of "business rules". **MEASURED**: absent from both passes |
| What the caller concludes | The ranking is wrong, or the tool is quoting the wrong part of the document |

The caller has no way to tell the difference between "this chunk does not really contain your words"
and "this chunk contains your words and the excerpt builder deleted them." Nothing in the response
signals the deletion — there is no `…` marking it, because the loss happened before any windowing.

This matters more than the sibling change it follows. `read_doc` is the last-resort rung of
progressive disclosure; `search_docs` is the entry point agents actually call, and its rank-1 excerpt
carries a 1 400-character budget precisely so it can *answer outright* without a follow-up call
(`excerpt.ts:10`, `CLAUDE.md`'s excerpt-budget bullet). An excerpt stripped of the matched vocabulary
spends that budget and answers nothing.

### The `dropFencedBlocks: false` fallback does not rescue it, and that is the load-bearing mechanism

`buildExcerpt` (`excerpt.ts:61,68`) runs the flatten twice: first with fenced blocks dropped, and —
only if that yields the empty string — again with them kept. The second pass exists exactly for a
templates-or-examples section, and its comment says so.

It cannot help here, because **S1 runs once, unconditionally, before the `dropFencedBlocks` branch**
(`flatten-map.ts:29` vs. the `if` at `:32`). Both passes call the same `stripHeadingLines` on the same
raw string. The flag governs S2 only; it restores nothing S1 already destroyed.

**MEASURED** on the real §12 section: first pass 0 chars (fallback triggered), second pass 774 chars,
and the three heading names absent from both. The fallback fires, does its job, and still hands back
an excerpt with the matched words missing.

**DERIVED, from those two numbers**: §12's fences are backtick-delimited and S2's regex *does* match
them today. If S2 had failed to match, the fence body (`type: functional` and the rest) would have
survived S2, survived S3 — which blanks only `` `*_>| `` — and survived S5/S6, so pass 1 would have
equalled pass 2 at 774 chars rather than 0. It measured 0. Therefore S2 matched. This deduction is
what predicts that the fallback **stays** live for §12 after the fix, and Gate 1 asserts it rather
than assuming it.

### Why now

1. **It is reproducible on `main` today, on this repo's own documentation** — MEASURED, not shown
   reachable in the abstract.
2. **The primitive already exists and is already exported.** `isFenceDelimiter`
   (`src/domain/split-text.ts:98`) was made public by the sibling change. The balanced-count gate was
   designed, implemented, CRLF-debugged and shipped in `headingsIn`
   (`src/application/read-document.ts:167-187`). This change is reuse of a proven mechanism, not
   invention.
3. **It reaches an existing corpus with no reindex.** Excerpts are computed at query time from
   `chunk.content` (`search-documents.ts:128` → `buildExcerpt`). Nothing about them is persisted. The
   fix lands on the very next `search_docs` call — the opposite of the chunk-boundary caveat in
   `CLAUDE.md`.
4. **It was nearly lost once.** It survived as one line in an archive report. Recording it a second
   time is not a plan.

## Scope

### In Scope

- **Fence-aware `stripHeadingLines`.** Gate the existing `continue` at `flatten-map.ts:92` on fence
  state, computed with `isFenceDelimiter` and the same balanced-delimiter-count gate `headingsIn`
  uses. No new domain surface, no new port, no new module.
- **The offset map stays correct.** I1-I3 (`flatten-map.ts:12-21`) are preserved by construction: the
  map-emission path for a *kept* line is already generic and unconditional, so a fix that only makes
  the drop conditional adds no map machinery (**INFERRED**, `exploration.md` §3 — to be asserted by
  the existing invariant tests, not argued).
- **A deliberate update to the I4 golden reference.** See "The test that must change on purpose".
- **One new `mcp-contract` requirement** (see Capabilities).
- **The residual cases written down**, in the same shape as the sibling change's four non-guarantees,
  including the two whose consequence here is *not* symmetric with `read_doc`'s.

### Out of Scope — and these are named so they are not lost the way this item nearly was

| Item | Why it is out, and what is left behind |
|---|---|
| **S2 gap A — `~~~` fences are invisible to S2.** `flatten-map.ts:33`'s ` /```[^`]*```/g ` is backtick-only, so tilde-fenced code is **never** dropped, in either pass. **MEASURED** (§0, row 3: 52 chars, fence never dropped, identical in both passes) | Opposite failure direction from this change's: content **leaks in**, rather than being lost. Fixing it means a second regex to design and CRLF-verify, and it goes beyond the open item and the code-review finding. **Recorded here as a named follow-up**, with its measurement, so it has the same paper trail this change inherited |
| **S2 gap B — a backtick fence containing an interior backtick silently matches nothing.** `[^`]*` cannot cross it, so the fence survives S2 and S3 blanks its backticks into spaces, leaking code into the excerpt as prose. **MEASURED** (§0, row 2: 50 chars, code leaks, zero replacements made) | Same reasoning. Same follow-up. **Confirmed live by measurement, not theoretical** — the stakes on the follow-up are higher than "someday" |
| **S3's unconditional `` [`*_>|] `` blanking** | A pre-existing, deliberate design choice about markdown-syntax removal, not fence blindness. Out of scope even for a broader fence fix |
| **`read_doc` / `headingsIn`** | Already fixed and archived. `read-document.ts` must be untouched by this change; a diff there means the scope moved |
| **`search_docs` params, response shape, budgets, windowing, ellipsis contract** | Only the *text* an excerpt contains changes. `LEAD_EXCERPT_CHARS`, `SUPPORTING_EXCERPT_CHARS`, `selectMatchCentre`, `computeWindow` and the `…` rules are untouched |
| **Chunking** | `split-text.ts` gains no behavior change. `isFenceDelimiter` is imported as-is; it is already exported |
| **CommonMark-accurate fence parsing** | Rejected on the same record as the sibling change: one shared, imperfect definition of "this line is a fence delimiter" keeps every consumer agreeing with the chunker, which matters more than any one of them being independently more correct (`split-text.ts:85-97`) |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`). Nothing here is persisted; see Rollback |

**The follow-up, stated once, plainly, so it is greppable**: `flatten-map.ts:33`'s S2 regex does not
recognize `~~~` and fails silently on interior backticks. Both measured. Neither is touched here.

## Approach

### Reuse `isFenceDelimiter` plus the balanced gate — the mechanism, verbatim from `headingsIn`

`headingsIn`'s shape (`read-document.ts:167-187`), which this mirrors:

```ts
const lines = markdown.split("\n");
const balanced = lines.filter(isFenceDelimiter).length % 2 === 0;
let inFence = false;
for (const line of lines) {
  if (isFenceDelimiter(line)) { if (balanced) inFence = !inFence; continue; }
  if (inFence) continue;
  // ... heading test ...
}
```

`stripHeadingLines` already computes `lines = markdown.split("\n")` and already iterates it by index.
The change is a `balanced` precomputation, an `inFence` toggle, and turning line 92's
`if (/^\s*#{1,6}\s/.test(line)) continue;` into a test that also requires `!inFence`.

**One difference from `headingsIn` that design must handle, not copy blindly**: `headingsIn` `continue`s
on a delimiter line because a delimiter is neither content nor a heading. `stripHeadingLines` **must
keep emitting the delimiter line and its map entries** — it is content as far as the flatten chain is
concerned, and S2 needs those backticks present to find its own fence pair. A `continue` copied over
from `headingsIn` would silently delete every fence marker and break S2. Naming it here so it is a
design decision rather than a copy-paste defect.

Hexagonal boundary: `flatten-map.ts` and `split-text.ts` are both `src/domain/`. Domain-to-domain
import, no port. Compliant with `config.yaml`'s `design` rule.

### CRLF: a non-issue by construction, and it must stay that way

Line 92's `/^\s*#{1,6}\s/` has **no `$` anchor at all** — a pure prefix test, so a trailing `\r` left
by `split("\n")` cannot affect whether it matches. **Verified by reading the exact pattern.**
`isFenceDelimiter`'s `/^\s*(```|~~~)/` is anchor-free in the same way.

**This is a hard constraint on the implementation, not an observation.** The sibling change's worst
regression came from exactly here: a `$`-anchored per-line pattern that had worked under `matchAll`
with `/m` stopped matching every heading on CRLF input, and it was found live on this repository's own
CRLF-encoded `docs/documentation-convention.md` (`read-document.ts:130-138`). Any regex this change
introduces or edits **must be anchor-free and prefix-only**. `docs/documentation-convention.md` is
CRLF-encoded and is the live probe, which means Gate 1 exercises the CRLF path for free — but only if
it runs against the real file rather than a hand-written LF fixture.

### The fix is partial by construction, and here is exactly where — stated up front

The balanced-count gate is chunk-local. Four shapes it does not cover, checked one by one against the
sibling change's four documented non-guarantees:

| # | Shape | Consequence here | vs. `read_doc` |
|---|---|---|---|
| 1 | **Unterminated fence** (odd delimiter count) | `balanced` is false, `inFence` never toggles, the heading line is dropped as today. **The original bug is simply not fixed for that chunk — not a new regression** | Same direction, benign both ways |
| 2 | **Chunk-crossing fence** | Same as 1: unfixed, not regressed | Same. Whether the parser can even produce such a boundary is **UNVERIFIED, LOWER CONFIDENCE** (`exploration.md` §5) |
| 3 | **4-space indented code block** | No delimiter exists to detect. Heading-pattern lines inside one are still dropped | Identical, carried over unchanged |
| 4 | **Misaligned-even parity hole** — one stray closer, then a real heading, then a stray opener, all within one chunk | **Inverted and milder.** A real document heading is misread as fence-interior and therefore **kept**, leaking a heading name into the excerpt body as prose. Cosmetically odd, not a correctness break | In `read_doc` this hole makes a real heading **unreachable** — the regression direction. Here it does the opposite. **Do not assume symmetry with the archived change's risk framing** |

Shapes 1-3 share one property worth stating as the change's safety argument: **every uncovered shape
fails toward today's behavior, not toward something new.** Shape 4 is the only one that changes
behavior in an uncovered case, and it changes it in the harmless direction.

### One regression direction the exploration did not find

**INFERRED by this proposal, hand-traced, NOT measured. Design and apply must measure it.**

`exploration.md` §2(d) asked whether S1's line *removal* could disturb S2's delimiter pairing and
correctly answered no: a heading line starts with `#`, never a backtick, so removing it deletes zero
backticks. **The inverse was not asked, and this change is precisely the inverse.** S1 will now
*retain* lines it used to drop, and a `#`-prefixed line inside a fence can absolutely contain a
backtick — a shell comment quoting a command, a markdown template's own inline code. Retaining it
injects a backtick into the string S2 scans, which can break the ` /```[^`]*```/g ` pairing that
previously matched.

Traced consequence: a chunk where S2 used to match and drop a fence, whose fenced `#` line carries an
odd backtick, would after the fix fall into S2 gap B — the fence survives, S3 blanks its backticks,
and code leaks into the `dropFencedBlocks: true` excerpt where it previously did not.

Assessment, so this is neither dismissed nor inflated:

- **Severity: low.** It moves a chunk from "excerpt is missing the matched vocabulary" to "excerpt
  contains the code it matched on, as prose" — the same tradeoff `excerpt.ts:62-66` already made
  deliberately when it chose leaking fences over an empty string.
- **Reachability: narrow.** Requires a heading-pattern line, inside a balanced backtick fence, in a
  chunk S2 currently matches, carrying an odd number of backticks.
- **Not a reason to widen scope.** It is a *symptom* of out-of-scope S2 gap B, reached by a new route.
  Fixing S2 to close it is the follow-up already named.
- **It must be gated.** Gate 4 exists for this and nothing else.

### Is keeping these lines even the right answer? Yes, and the reasoning is short

S1 strips heading lines because the matched chunk's own heading is already surfaced separately as
`SearchResultItem.section` (`search-documents.ts:127`) — repeating it in the excerpt wastes budget.
That rationale has **no application** to fence-interior content, which is illustrative material the
corpus author wrote on purpose and which the caller's query may well have matched on.

One unmeasured quality tradeoff, recorded rather than hidden: a fence packed with several short
heading-like lines — exactly the §12 Templates shape — may, once kept, read as a terse fragment list
inside the 120-char supporting budget rather than as prose. That is strictly better than the status
quo, where the same budget is spent on YAML noise carrying zero matched vocabulary.

### The test that must change on purpose

`test/domain/flatten-map.test.ts:10-23` defines `referenceFlatten`, a hand-copied, deliberately
fence-blind reimplementation of today's whole flatten chain — including
`.filter((line) => !/^\s*#{1,6}\s/.test(line))` — and the I4 suite asserts `flattenWithMap` is
**byte-identical** to it for every fixture, in both `dropFencedBlocks` modes.

**Verified by reading the file**: none of the 12 `GENERATED_INPUTS` fixtures places a `#`-line inside a
fence (the fenced fixture is `const x = 1; console.log(x);`; the all-fenced fixture is
`type: functional`), so I4 will most likely still pass on today's inputs after the fix. **That is the
trap, not the reassurance.** Its premise — that fence-blind stripping is the contract — is exactly
what this change repeals, and the first new fixture exercising the fix will break it.

Required, intentional handling, decided here so `sdd-tasks` does not have to guess:

- `referenceFlatten` **must be updated** to model the fence-aware rule, and the update must be a
  visible, reviewed diff with a comment recording why the golden reference moved.
- The new fence-interior fixture must be added and **observed failing** against the unfixed tree
  (`strict_tdd: true`), so I4's change-detector role is exercised rather than bypassed.
- **If this is missed, one of two bad outcomes follows**: the fix cannot ship, or someone "repairs" the
  test by reverting the fence-awareness. Both have happened in this repo's history to change-detector
  tests; this is why it is a proposal-level item and not a task detail.

## Capabilities

### New Capabilities

- None. This is a defect inside `search_docs`'s existing excerpt construction.

### Modified Capabilities

- **`mcp-contract`** — one **new** requirement: a heading-pattern line that sits inside a fenced code
  block within a chunk's content MUST NOT be removed from that chunk's `search_docs` excerpt on the
  grounds that it looks like a markdown heading.

  **Verified against the existing requirement text, not assumed new.** Three neighbours are related and
  none covers it:

  | Existing requirement (`openspec/specs/mcp-contract/spec.md`) | Why it does not cover this |
  |---|---|
  | *A Heading Line Inside a Fenced Code Block Is Not an Addressable Section* (`:87`) | The sibling change's requirement. Governs **`read_doc`'s** derivation of addressable section names. Its own text scopes it: "This requirement governs `read_doc`'s own derivation of section names from chunk content" (`:97`). It says nothing about excerpt text. **Not edited** |
  | *Graduated Excerpt Budget by Result Rank* (`:348`), *Lead Excerpt Is a Window Centred on the Matched Span* (`:362`), *Supporting Excerpts Remain Start-Anchored Prefixes* (`:375`) | Govern **how much** excerpt and **where** the window sits. None governs **what the flatten chain deletes** before windowing. An excerpt missing its matched vocabulary satisfies all three |
  | *Truncation Is Marked at Either Edge, Within Budget* (`:391`) | Governs `…` placement. The loss here happens before windowing and produces no ellipsis, so this requirement is satisfied while the content is gone — which is precisely the gap |

  A delta that **edits** any of these four is a signal the scope moved. The new requirement must carry
  the same non-guarantee scoping the `:87` requirement carries (chunk-local; unterminated,
  chunk-crossing and indented blocks uncovered; the parity hole named **with its inverted consequence
  here**, since copying `:95`'s wording verbatim would state the opposite of the truth for excerpts).

- **`indexing`** — **no delta, asserted.** Nothing about chunk boundaries, chunk size or stored
  headings changes. An `indexing` delta in `sdd-spec`'s output means the change drifted.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/flatten-map.ts:78-105` | Modified | `stripHeadingLines` gains `balanced` + `inFence`; line 92's drop becomes conditional. Delimiter lines keep being emitted with their map entries |
| `src/domain/split-text.ts` | **Unchanged — asserted** | `isFenceDelimiter` is imported as-is; it is already exported (`:98`) |
| `src/domain/excerpt.ts` | **Unchanged — asserted** | The two-pass fallback, budgets, windowing and ellipsis logic are untouched. The fallback keeps firing for §12 (Gate 1) |
| `src/application/read-document.ts` | **Unchanged — asserted** | The sibling change's territory. A diff here means the scope moved |
| `test/domain/flatten-map.test.ts:10-23` | **Modified — deliberately** | `referenceFlatten` updated to the fence-aware rule, plus new fence-interior fixtures in `GENERATED_INPUTS` (which feed both the I1-I3 and I4 suites) |
| `test/domain/excerpt.test.ts` | Extended | Its two existing fenced cases (`:31-43`) use fence bodies with **no** `#`-line inside and are unaffected (**INFERRED**, exploration §3). New cases cover the fallback path |
| `test/fixtures/excerpt-window/docs/` | **Unchanged — asserted** | Grepped for fence delimiters: **zero matches** (exploration §3). Structurally unaffected |
| `scripts/` | Possibly added | A direct-drive probe in the `vector-reach.mjs` / `section-lookup.mjs` shape, if `sdd-tasks` chooses a script over a CLI gate. `scripts/excerpt-offset-distribution.mjs` has no hard-coded pass/fail and is a measurement to re-run, not a test that can break |
| `openspec/specs/mcp-contract/spec.md` | Modified | One new requirement + scenarios. No existing requirement edited |
| `CLAUDE.md` | Modified | One line in *Non-obvious decisions* recording that excerpt flattening is fence-aware, that it is chunk-local, what it does not cover, and that the S2 `~~~`/interior-backtick gaps remain open |

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement
contradicting the reasoning — not on a tolerance band (`CLAUDE.md`, Gate 2 of `bounded-chunk-size`).
`strict_tdd: true` applies: every gate is written first and observed **failing** on the current tree.
A gate that passes unfixed is not measuring what it claims.

**No model download is required for any gate.** `index --lexical` and `search --lexical` both exist
(`src/cli.ts:37,187`), so the live path is reachable end to end without embeddings — a cheaper
starting point than the sibling change had.

### Gate 1 — The live case on this repository's own CRLF file (BLOCKING)

Against `docs/documentation-convention.md` §12 "Templates", indexed as this repo indexes it
(zero-config `loose`):

- [ ] **Before**, recorded verbatim: the first flatten pass over that section yields **0 chars**, the
      `excerpt.ts:68` fallback is taken, and `Business rules`, `Use cases`, `Out of scope` are absent
      from **both** passes. This reproduces `exploration.md` §0 row 1 as a first-party observation.
- [ ] **After**: all three token strings are **present** in the excerpt text.
- [ ] **After**: the first pass still yields 0 chars, so the fallback is still what produces the
      excerpt. This asserts the DERIVED claim above (S2 matches §12's fences) rather than assuming it.
- [ ] **After**: the same three tokens are present in the excerpt an actual
      `node dist/cli.js --root . search --lexical "..."` call returns for that chunk — the end-to-end
      path, not just the domain function.

**FALSIFICATION — what stops the change**:
- If the "before" run does **not** reproduce the empty first pass and the three absent tokens, §0's
  measurement does not hold on the current tree and the live-occurrence claim — this change's whole
  priority argument — is wrong. Stop and re-analyze.
- If the "after" run leaves the three tokens absent, the balanced-count gate does not reach this
  section. **The most likely cause is worth predicting now**: §0 measured a *hand-extracted* 100-line
  section, while `search_docs` operates on the **stored chunk**, whose boundaries may differ and whose
  fence-delimiter count may be **odd**. That would put §12 into non-guarantee 1 or 2 and mean the fix
  is correct but does not reach its own motivating case. That outcome does not falsify the mechanism —
  it falsifies "live on this repo", which is a load-bearing claim in its own right and must be
  corrected in the artifacts rather than smoothed over. **Gate 1 must therefore measure the stored
  chunk, not a re-extraction of the source file.**

### Gate 2 — The isolated case, in both passes (BLOCKING)

Using `exploration.md` §0 row 4's input (a backtick fence containing a `# a python comment` line):

- [ ] **Before**, `dropFencedBlocks: false` → `"Prose before. python print('hi') Prose after."` — the
      fence's code survives while the `#` line is gone. Nothing but S1 removed it.
- [ ] **After**, `dropFencedBlocks: false` → the same string **with `a python comment` restored**.
- [ ] **After**, `dropFencedBlocks: true` → `"Prose before. Prose after."`, **unchanged**. S1 now keeps
      the line, but S2 still drops the whole fence. Asserting this is the point: for a balanced
      backtick fence with no interior backtick, the drop-fences pass **must be byte-identical** before
      and after. A change here means the fix disturbed S2.

**FALSIFICATION**: if the `dropFencedBlocks: true` output changes for this input, S1's retention is
interfering with S2's pairing on the *simple* case, not merely the odd-backtick one Gate 4 targets.
Stop — the interaction is broader than analyzed.

### Gate 3 — The offset map is still sound (BLOCKING)

- [ ] I1-I3 (`flatten-map.ts:12-21`) hold for every fixture including the new fence-interior ones, in
      both modes: `map.length === text.length`, `map` non-decreasing, every non-space emitted character
      copied verbatim from raw at its mapped offset.
- [ ] A query match landing on a fence-interior heading line — today silently un-locatable, because
      `toFlatOffset` resolves a destroyed raw offset forward and the span collapses to
      `end === start` and is filtered at `excerpt.ts:98` — now produces a **locatable** span and can
      centre the lead window on it. This is a behavior change, in the improving direction, and it is
      asserted rather than left to be noticed.

**FALSIFICATION**: any I1-I3 violation means the map machinery was not as generic as `exploration.md`
§3 inferred. That inference is load-bearing for the "no new map logic" scoping and its failure
re-opens the design.

### Gate 4 — The retention-breaks-S2 direction (BLOCKING)

Exists solely for the regression direction named in "One regression direction the exploration did not
find", which no prior artifact analyzed.

- [ ] A fixture: a heading-pattern line **carrying an odd number of backticks**, inside a balanced
      backtick fence, in a chunk where S2 currently matches and drops the fence.
- [ ] **Before**: `dropFencedBlocks: true` drops the fence; no code in the output.
- [ ] **After**: measured and **recorded either way**, with the observed output in the verify report.

**This gate does not have a required outcome — it has a required measurement.** If code now leaks, that
is the predicted consequence of out-of-scope S2 gap B reached by a new route, and it is accepted and
documented (severity assessed above), not fixed here. If it does not leak, the hand-traced prediction
was wrong and that is recorded too. **Silently not measuring it is the only failing outcome.**

### Gate 5 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] `compendio eval` on `ejemplos/` unchanged: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22.
      `ejemplos/` documents are prose with no fenced `#` lines, so identity is the expected result.
- [ ] Every existing case in `test/domain/excerpt.test.ts` passes with **no assertion modified**. A
      modified existing expectation means excerpt behavior changed beyond fence-interior heading lines.
- [ ] `src/domain/split-text.ts`, `src/domain/excerpt.ts` and `src/application/read-document.ts` carry
      **zero-line diffs**.
- [ ] The only modified existing test assertion in the whole change is `referenceFlatten` — and it is
      accompanied by a comment recording why.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The I4 golden reference is "fixed" by reverting the fence-awareness**, because it looks like the fix broke a passing test | **High** | Called out at proposal level with the required handling spelled out. Gate 5's last item makes `referenceFlatten` the *only* permitted existing-assertion change, so any other one is a tripwire |
| **§12's stored chunk has an odd fence-delimiter count**, so the fix is correct but does not reach its own motivating case | Med | Gate 1's falsification clause predicts it in advance, requires the gate to run against the **stored chunk**, and requires the "live on this repo" claim to be corrected rather than quietly dropped |
| **S1's new retention breaks S2's pairing** on chunks carrying an odd backtick inside a fenced `#` line | Med | Gate 4, which mandates the measurement without mandating an outcome. Severity assessed as low and consistent with `excerpt.ts:62-66`'s existing leak-over-silence tradeoff |
| **A `continue` is copied from `headingsIn` onto delimiter lines**, deleting every fence marker and breaking S2 outright | Med | Named explicitly in Approach as the one place the mirror must not be verbatim. Gate 2's unchanged-`true`-pass assertion catches it immediately |
| **A new `$`-anchored regex reintroduces the sibling change's CRLF regression** | Med | Stated as a hard implementation constraint. Gate 1 runs against the CRLF-encoded real file, so the CRLF path is exercised by the primary gate — provided the gate uses the real file and not an LF fixture |
| **The partial fix is read as total**, and someone later reports an unterminated-fence case as a regression | Med | The four shapes are tabled here with their *per-shape* consequence, the spec requirement must carry the same scoping, and `CLAUDE.md` records it. Non-guarantee 4's inverted consequence is flagged so `:95`'s wording is not copied verbatim |
| **The S2 follow-up is lost again** | Med | Both gaps are named, measured, and stated once plainly in Scope as a greppable sentence. This change exists because the last such item survived only as one line in an archive report |
| **Excerpt quality degrades** for template-heavy sections, which now read as terse fragment lists in a 120-char budget | Low | Assessed in Approach as strictly better than spending the budget on zero matched vocabulary. Unmeasured, and stated as unmeasured |
| **The offset map drifts silently**, centring the excerpt on the wrong text with no test failing — the failure mode `flatten-map.ts:6-9` was written to guard | Low | Gate 3. The invariants are already mechanical and the change adds no map machinery |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`. **Assessment: this is not a risky change, and
inventing ceremony for it would be dishonest.**

1. Revert the change commits.
2. `npm run build`.
3. **Nothing else.**

Why it is genuinely this small, as properties rather than reassurance — **verified by tracing the call
path** (`exploration.md` §8), not assumed:

- **Excerpts are computed at query time.** `SearchDocuments.execute` (`search-documents.ts:128`) calls
  `buildExcerpt(chunk.content, …)` on content read live from SQLite on every search. **Nothing about
  excerpt computation is persisted.**
- **Therefore: no reindex, in either direction.** The fix takes effect on the next `search_docs` call,
  and a revert un-takes effect on the one after that. This is the **opposite** of `CLAUDE.md`'s
  chunk-boundary caveat, where a config change needs a full `compendio index` with its `reset()` to
  reach existing documents. No `.compendio/` deletion, no DDL, no `reset()`.
- **A document indexed after the fix is byte-identical to one indexed before it** — nothing in the
  index pipeline is touched. Gate 5's zero-line-diff assertions cover it.
- **No config key, no port, no response-field, no path/ID shape change**, so `ejemplos/goldenset.yaml`
  and `compendio eval` are structurally unaffected.
- **No public contract shape change**, so the beta/no-migrations clause has nothing to apply to.

The only residue after a revert is behavioral and immediate: `search_docs` goes back to returning
excerpts with the matched vocabulary deleted. That is the pre-change state.

## Dependencies

- **Zero new npm dependencies.**
- **Zero new exported symbols.** `isFenceDelimiter` is already public (`split-text.ts:98`) — the
  sibling change paid that cost and gave it direct unit coverage.
- **No new corpus.** This repo's own `docs/` for Gate 1, small in-file fixtures for Gates 2-4, the
  existing `ejemplos/` for Gate 5.
- **No model download for any gate.** `index --lexical` / `search --lexical` cover Gate 1 end to end;
  only Gate 5's `eval` needs embeddings, and it is an existing, already-required measurement.

## Delivery size

| Driver | Estimate (changed lines) |
|---|---|
| `flatten-map.ts` — `balanced` + `inFence` + conditional drop | 8-15 |
| `flatten-map.test.ts` — `referenceFlatten` update + new fixtures | 30-60 |
| `excerpt.test.ts` — fallback-path and Gate 4 cases | 40-80 |
| Gate 1 harness (script or integration test) | 40-90 |
| `mcp-contract` spec delta — one requirement + scenarios | 50-90 |
| `CLAUDE.md` | 8-15 |
| **Total** | **176-350** |

**This repository's forecasts have landed 1.3x-4x low for several cycles running** — `bounded-chunk-size`
240-420 → 773; `match-centred-excerpt` 300-470 → ~1 521; `incremental-reindex` missed by 2x. That
pattern is recorded here rather than assumed away, and the sibling change recorded the same caution.
The mitigating difference is real but must not be overweighted: the production surface is genuinely one
function's loop, so variance sits in tests and spec prose — the more predictable half.

**One PR is the working assumption**, comfortably inside the 400-line review budget. There is no
natural cut if it overruns: one function, one requirement. An overrun means trimming test breadth, not
splitting the change.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Scope | **Approach 1 — minimal, S1 only.** User decision, not open for revision by later phases |
| Mechanism | **Reuse `isFenceDelimiter` + the balanced-count gate**, mirroring `headingsIn`. Consistency with the chunker is the argument, not convenience |
| Delimiter lines | **Kept and emitted with map entries**, unlike `headingsIn`, which skips them. S2 needs them |
| S2's `~~~` gap and interior-backtick gap | **Out of scope. Named follow-up, with their measurements**, so they carry a paper trail rather than one archive-report line |
| S3's `` [`*_>|] `` blanking | **Out of scope.** Pre-existing deliberate design choice, not fence blindness |
| CommonMark-accurate fence parsing | **Rejected**, on the sibling change's record. Agreeing with the chunker beats being independently more correct |
| Fence state scope | **Chunk-local**, with all four uncovered shapes tabled and their *per-shape* consequence stated |
| Non-guarantee 4 (parity hole) | **Inverted here**: a real heading is kept and leaks into body text, rather than becoming unreachable. Must not be documented by copying `mcp-contract/spec.md:95`'s wording |
| Direction of failure for uncovered shapes | **Toward today's behavior** for shapes 1-3 — unfixed, not regressed |
| I4 golden reference | **Must be updated deliberately**, with a recorded reason and a fixture observed failing first. The only permitted existing-assertion change in the whole diff |
| Retention-breaks-S2 risk | **Newly identified here, INFERRED, must be measured** (Gate 4). Accepted and documented if confirmed; not fixed here |
| CRLF | **Non-issue by construction**, and a hard constraint: anchor-free, prefix-only regexes only |
| Spec surface | **One new `mcp-contract` requirement.** Verified against the four neighbouring requirements' actual text; none is edited |
| Reindex | **None needed, in either direction.** Query-time computation, verified by call-path trace |
| Rollback | **Normal revert + build, nothing else.** Not a risky change |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Artifact store | **openspec** (file-based) |

## Proposal question round (open — for the user, before `sdd-spec`)

Four product questions this proposal currently answers by assumption. Each names the assumption in
force, so silence is a valid answer and the change proceeds either way. A second round is available if
any answer moves the scope.

1. **When an excerpt is quoting code, should the caller be told?** Assumed: **no** — the excerpt simply
   contains the fenced text like any other content. The alternative fits this project's established
   reflex of explaining rather than staying silent (`noMatchReason`, `filterWarning`,
   `embeddingsWarning`, the `…` truncation signal): a caller receiving 1 400 characters of YAML template
   cannot currently tell it is looking at illustrative code rather than prose the document asserts. That
   would cost a response-field addition, which this proposal declares out of scope.

2. **Is "the excerpt now contains code" an acceptable answer for template-heavy sections?** Assumed:
   **yes** — it is strictly better than an excerpt with the matched words deleted, and it matches the
   tradeoff `excerpt.ts:62-66` already made deliberately. The alternative reading is that for a section
   that is *entirely* fenced, the most useful excerpt is neither the code nor silence but a pointer
   ("this section is a template; call `read_doc`"). That is a different, larger change and is not
   proposed.

3. **How much is the S2 follow-up worth, now that both its gaps are measured rather than theoretical?**
   Assumed: **recorded, not scheduled.** But the measurements raise its standing: tilde-fenced code is
   *never* dropped from any excerpt, in either pass, on any corpus. If your documentation uses `~~~`
   fences at all — or backtick fences quoting backticks, which is common in documentation *about*
   markdown — that is a live excerpt-quality defect today, independent of this change.

4. **If Gate 1 shows §12's stored chunk is not covered by the fix** (odd delimiter count), does the
   change still ship? Assumed: **yes** — the defect and the mechanism are both real regardless, and the
   isolated case in Gate 2 still demonstrates the fix. But the "live on this repository" framing would
   have to be retracted from the artifacts, and if that framing is what makes this worth doing now
   rather than later, you may prefer to stop and re-scope toward document-level fence state instead.
