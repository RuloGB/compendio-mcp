# Proposal: `read_doc`'s Section Lookup Must Not Treat Fenced Code as Headings

`headingsIn` (`src/application/read-document.ts:113-119`) extracts heading titles with
`/^#{2,6}\s+(.+)$/gm` and no fence tracking, so a `## ...` line inside a fenced code block is
indistinguishable from a real section heading. `ReadDocument.execute` calls it in **two** places, and
the first one is the damaging one: `read_doc({ path, section })` can resolve against a chunk that has
nothing to do with the requested section and return it as a successful `section` result.

**This is live in this repository's own indexed corpus today.** `docs/documentation-convention.md`
contains 34 lines matching that regex; **17 of them sit inside fenced `markdown` template blocks**
(enumerated with line numbers in `exploration.md`'s Orchestrator Verification Addendum, measured, not
estimated). Half of the sections `read_doc` advertises for that document do not exist, and each one
can capture a request.

**One of three changes split from the same review pass** (`code-review-src-2026-08-14.md`, findings
1.3/1.4/1.5). Siblings: `filter-input-hygiene` (1.3) and `overview-counter-safety` (1.5), proposed in
parallel. They share an origin document and an exploration artifact
(`openspec/changes/2026-08-15-code-review-findings-1.3-1.5/exploration.md`) and nothing else — no
file, no test, no spec requirement. They are not to be bundled; see that exploration's comparison
table and its recorded user decision.

## Intent

### The review understated this. It is a retrieval-correctness bug, not a cosmetic one

The original finding describes a phantom entry in an error message. That is the *second* call site.
The first is section matching (`read-document.ts:76-80`):

```ts
const matching = chunks.filter(
  (c) =>
    normalize(c.heading).includes(wanted) ||
    headingsIn(c.content).some((h) => normalize(h).includes(wanted)),   // <- fence-blind
);
```

A phantom heading on the right-hand side makes the chunk match. The call returns
`{ type: "section", section: "<what the caller asked for>", content: <the wrong chunk> }` — a
successful result, with the caller's own label on it. Nothing in the response says the match came
from a line inside a code block.

The concrete, currently-reproducible case:

| | |
|---|---|
| Call | `read_doc({ path: "docs/documentation-convention.md", section: "Business rules" })` |
| Today | Resolves to the "12. Templates" chunk — documentation *about* how to write templates |
| Why | Line 181 of that file is `## Business rules`, inside the fenced functional-spec template (fence opened at 166, closed at 185) |
| Correct answer | `section-not-found` — that document has no Business rules section |

The request is not contrived. "Business rules" is a section name the convention itself prescribes for
every functional spec, so it is exactly the section name an agent would ask for. And an agent has two
ordinary routes to asking for it *on this document specifically*: it read the convention doc and saw
the template, or it already got a `section-not-found` whose `availableSections` list offered it.

**The blast radius is asymmetric between the two call sites, and that is worth stating precisely.**
The listing path (line 89) only fires after a miss, so it costs a wrong suggestion. The matching path
(line 79) fires on the first call, with no prior miss, and its output is indistinguishable from a
correct one.

### Every other heading reader in the pipeline is already fence-aware. This one is the outlier

Verified against the code, not assumed:

| Stage | Heading detection | Fence-aware? |
|---|---|---|
| Parse (`RemarkMarkdownParser`) | remark AST `heading` nodes | **Yes, structurally** — a `##` inside a fence is part of a `code` node and never becomes a `HeadingEvent` |
| Chunk boundaries (`chunkOutline`) | consumes that outline | **Yes, inherited** |
| Bounding (`splitToBound`) | `splitIntoBlocksFenceAware` + `isFenceDelimiter` | **Yes, explicitly** |
| `read_doc` section lookup (`headingsIn`) | raw regex | **No** |

So the phantom headings are not merely wrong — they are *inconsistent with the chunk boundaries the
same system produced*. No chunk in that document was ever cut at `## Business rules`, because remark
never saw a heading there. `headingsIn` invents section names the indexer explicitly declined to
create.

That also settles the "is this a design choice?" question. It is not. It is one function that was
written with a regex while the two mechanisms on either side of it were written fence-aware.

### Why now

Three reasons, in descending strength:

1. **It is reproducible in this repo, on `main`, today.** Of the three findings in this review pass,
   this is the only one demonstrated live rather than shown reachable.
2. **The primitive already exists**, private, one function away in a module the application layer
   already imports from (`src/domain/split-text.ts:85-87`). The fix is reuse, not invention.
3. **It reaches an existing corpus with no reindex.** `headingsIn` runs at *read* time over stored
   chunk content, so unlike this repo's recent chunking and heading changes
   (`bounded-chunk-size`, `addressable-chunks`), a user gets the corrected behavior from the upgrade
   alone — no `compendio index`, no `reset()`. That is unusual here and it makes the fix cheap to
   deliver value with.

## Scope

### In Scope

- **Fence-aware heading extraction in `headingsIn`**, applied to *both* call sites at once. They call
  one function; there is no version of this change that fixes one and not the other.
- **Making `isFenceDelimiter` reusable from `src/domain/split-text.ts`.** The exploration proposes
  exporting it as-is. That is the recommended approach (rationale below), but **the exact export
  shape is a `sdd-design` decision, not settled here** — see the design fork.
- **Direct unit coverage for whatever `split-text.ts` newly exposes.** `isFenceDelimiter` has zero
  direct tests today; it is covered only through `splitToBound`'s observable behavior. A function that
  becomes public domain surface and acquires a second consumer stops being adequately covered by "its
  effects on one caller."
- **Chunk-local fence state, with its limits written down.** `headingsIn` receives one chunk's
  content, not the document, so fence state is evaluated per chunk. This is correct for every
  terminated fence (see Approach), and it has named residual cases (unterminated fences, indented code
  blocks). The change must record them rather than imply totality.
- **One new `mcp-contract` requirement** (see Capabilities).
- **The behavioral consequence, stated plainly in the change's own notes**: after the fix, those 17
  section names stop being offered for `docs/documentation-convention.md`. That is the correction, not
  a side effect.

### Out of Scope

| Item | Why |
|---|---|
| **Findings 1.3 and 1.5** (`filter-input-hygiene`, `overview-counter-safety`) | Separate changes, proposed in parallel. Disjoint files, disjoint spec requirements, disjoint tests. 1.5 shares only a spec *file* with this change, not a requirement — the same distinction `config-value-validation`/`sync-vector-contract` reasoned through one level coarser |
| **Any change to `read_doc`'s parameters or response shape** | `{ path, section? }` in, the same five `ReadResult` variants out. This is a behavior correction *inside* `section` resolution. A params or response-field change means the scope moved |
| **Chunking and indexing behavior** | `splitIntoBlocksFenceAware`, `splitToBound`, `chunkOutline`, `mergeTinyPieces` keep their exact current behavior. The only edit to `split-text.ts` is exposure of an existing function — asserted, and gated |
| **`flatten-map.ts`'s `stripHeadingLines` (`:92`), the sibling fence-blind heading regex** | Found while verifying this finding; **not** in the review. `/^\s*#{1,6}\s/` drops heading-looking lines when building a search excerpt, so a `# comment` line inside a fenced shell block silently disappears from the excerpt. Same root cause, materially different change: different capability (excerpt rendering), different failure (content loss, not a wrong answer), and it carries a raw→flat offset-map contract that makes any edit riskier than this one. Recorded here so it is a known open item rather than a rediscovery |
| **CommonMark-accurate fence parsing** (info-string matching, fence-character matching, minimum run length, indentation rules) | Deliberately not attempted. See "Consistency beats correctness here" below — a stricter parser would make `read_doc` disagree with the chunker, which is worse than both agreeing on the same approximation |
| **Widening `headingsIn` to H1** | Orthogonal, and analyzed below rather than deferred by default |
| **Migrations, schema markers, compatibility shims, re-index prompts** | Beta, no installed users (`openspec/config.yaml`, `rules.proposal`). Nothing here is persisted; see Rollback |

## Two questions the review left open, answered here

### H1 inside a fence: orthogonal, and the asymmetry is correct as it stands

`headingsIn` matches `#{2,6}`, so the fenced `# <Feature name>` at line 176 of
`documentation-convention.md` is invisible to it today and stays invisible after the fix. There is no
H1 half of this bug.

The exclusion is deliberate, not an oversight: an H1 is the document title, not an addressable
section. `ReadDocument` handles it separately (`read-document.ts:68` re-attaches the H1 to a
full-document response), and `RemarkMarkdownParser` routes the first H1 to `outline.title` rather than
to the section list. Widening to `#{1,6}` would make every document's *real* H1 an offerable
"section" — a new defect, in exchange for closing a case that does not exist.

**Conclusion: no change, and no residual risk.** The one thing the fix must not do is quietly widen
the range while rewriting the loop.

### Does the fix threaten the `section` round-trip guarantee? No — by construction

`openspec/specs/mcp-contract/spec.md:47-69` requires that a `section` value returned by `search_docs`
resolves through `read_doc({ path, section })` and never yields `section-not-found`. Those values are
copies of the chunk's stored `heading`, which comes from remark and is therefore already fence-free.
They are matched by the **first** branch of the `||` (`normalize(c.heading).includes(wanted)`), which
this change does not touch. The fix prunes candidates from the second branch only.

Stated as an invariant so it can be gated rather than believed: **the fix can only ever remove matches
that originate inside a fenced block; it cannot remove a match on a chunk heading.** Gate 3 asserts it
against the real `ejemplos/` corpus.

## Approach

### Reuse `isFenceDelimiter`, and reuse *only* it

```ts
function isFenceDelimiter(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}
```

Pure, stateless, no dependencies, already in `src/domain/` (so `config.yaml`'s hexagonal rule is
satisfied — no SQLite, transformers.js or fs), and `src/application/read-document.ts` already imports
from `../domain/*`. `headingsIn` switches from `matchAll` to a line-by-line loop that toggles an
`inFence` flag — the same shape `splitIntoBlocksFenceAware` uses one function below it.

Reusing the heavier `splitIntoBlocksFenceAware` instead would be the awkward seam: it splits blocks
for chunking, which has nothing to do with heading extraction. Reusing the one-line delimiter check is
not.

### Consistency beats correctness here, and that is the actual argument for reuse

`isFenceDelimiter` is an approximation of CommonMark. It toggles on ``` inside a `~~~` fence, ignores
info strings, does not check fence-character runs, and accepts arbitrary leading whitespace. A
purpose-built stricter parser in `read-document.ts` would be *more* CommonMark-correct and *worse* for
this system: `read_doc` would then consider a line fenced that the chunker considered ordinary text,
or vice versa, and the two would disagree about the same document. One shared definition of "this line
is a fence delimiter" is the property worth having, and it is the reason to reuse rather than
reimplement.

### The design fork — `sdd-design` decides, this proposal does not

**A. Export `isFenceDelimiter` as-is** from `split-text.ts`. Smallest diff, one new exported symbol,
one new import. Cost: a private implementation detail of the splitter becomes public domain surface,
and the two consumers are now coupled to one regex (which is the point, but it should be a stated
decision rather than a side effect of convenience).

**B. Extract a small shared fence-tracking helper** (e.g. a `forEachLineWithFenceState`-shaped
utility, or a `headingLinesOutsideFences(markdown): string[]` in the domain) consumed by both
`headingsIn` and `splitIntoBlocksFenceAware`. Puts the toggle logic in one place instead of two.
Cost: it edits `splitIntoBlocksFenceAware`, which this change otherwise asserts unchanged, and the
chunker is the highest-consequence code in the repo to touch for a `read_doc` fix.

**C. A new domain module** owning "what markdown headings does this fragment declare". Cleanest
conceptually, largest diff, and it invites the `flatten-map.ts` non-goal back into scope.

**Recommendation: A**, with B acceptable only if design concludes the duplicated 4-line toggle is a
real maintenance hazard. Whichever is chosen, the direct-unit-test obligation (Gate 5) applies to the
newly exported symbol.

### The residual cases, named rather than implied

Fence state is evaluated per chunk, so the fix is exact only when a chunk's fence markers are
balanced. Verified reasoning about when they are:

- **Terminated fences: balanced, always.** A fence that fits within the bound stays a single unit
  (`splitIntoBlocksFenceAware` keeps it whole, `packUnits` packs whole blocks). A fence that exceeds
  the bound goes through `splitFence`, which re-emits the opening and closing markers on **every**
  piece. Either way a chunk never begins in the middle of a terminated fence.
- **Unterminated fences: not covered.** `isFencedCodeBlock` requires both first and last line to be
  delimiters, so an unclosed fence falls through to `splitLines`, whose pieces can begin mid-fence
  with no opener. A `##` line in such a piece is still reported as a heading after the fix. Note the
  system is already inconsistent about this case independently of this change — remark treats an
  unclosed fence as running to EOF, so the chunker already saw no headings there.
- **Indented (4-space) code blocks: not covered.** They have no fence delimiter to detect. remark
  treats them as code; a delimiter-based tracker cannot.
- **Direction of error matters and should be a design constraint.** Failing to detect a fence
  reproduces today's bug for that fragment (a phantom section is offered — annoying, recoverable).
  Spuriously believing we are inside a fence *hides a real section* (a `section-not-found` for a
  section that exists — a regression). `sdd-design` should state which way an ambiguous chunk resolves;
  the recommendation is to bias toward the first.

None of these blocks the change: each is strictly better than the status quo, and each is a fragment
shape the indexer already mishandles in the same direction.

## Capabilities

### New Capabilities

- None. This is a defect inside `read_doc`'s existing section resolution.

### Modified Capabilities

- **`mcp-contract`** — one **new** requirement: a `## ..`-through-`###### ..` line inside a fenced code
  block MUST NOT be treated as an addressable section of the document — neither as a match for
  `read_doc({ path, section })` nor as an entry in a `section-not-found` response's
  `availableSections`.

  **The "new requirement, not a modification" conclusion was re-verified against the spec text, not
  taken from the exploration.** The two neighbours are related and neither covers this:

  | Existing requirement (`mcp-contract/spec.md`) | Why it does not cover this |
  |---|---|
  | *`search_docs`'s `section` Is Never Empty and Round-Trips* (`:47`) | Governs `section` values **produced by `search_docs`** — non-emptiness, and that they resolve back through `read_doc`. Says nothing about section names `read_doc` derives from chunk content on its own, and nothing about fences. This change strengthens it incidentally and violates nothing in it |
  | *`read_doc` Never Renders an Empty-Labeled Bullet...* (`:71`) | Governs the **emptiness** of listed labels and the sectionless-document prose fallback. A phantom heading is non-empty and well-formed; it passes that requirement completely |

  Neither requirement is edited. A delta that modifies either one means the scope moved.

- **`indexing`** — **no delta, asserted.** Chunk boundaries, the chunk-size bound and the non-empty
  heading invariant are untouched. An `indexing` delta appearing in `sdd-spec`'s output is a signal
  that the change drifted into the chunker.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/application/read-document.ts:113-119` | Modified | `headingsIn` becomes a fence-tracking line loop; both call sites (`:79` matching, `:89` listing) inherit it unchanged |
| `src/domain/split-text.ts:85-87` | Modified — **exposure only** | `isFenceDelimiter` exported (fork A) or refactored into a shared helper (fork B). **No behavior change to any splitter function**, gated |
| `src/domain/`, other | **Unchanged — asserted** | No port change, no new domain type, no chunking change. `flatten-map.ts` explicitly untouched (non-goal) |
| `test/application/read-document.test.ts` | Extended | Failing-first cases for both call sites. Templates: `:105-113` (available-sections listing) and the `[RED->GREEN]` empty-heading block at `:288-303` |
| `test/domain/split-text.test.ts` | Extended | Direct `isFenceDelimiter` coverage (Gate 5) plus a regression asserting splitter behavior is byte-identical |
| Fixture (new, small) | Added | A document modeled on `documentation-convention.md`'s Templates shape — a fenced block containing `##` lines. Stronger than a synthetic one-liner, because that is the shape the bug was found in |
| `openspec/specs/mcp-contract/spec.md` | Modified | One new requirement + scenarios. No existing requirement edited |
| `CLAUDE.md` | Modified | The MCP-tools section describes `read_doc({ path, section? })`; one line in *Non-obvious decisions* recording that section lookup is fence-aware, that it is chunk-local, and what that does not cover |

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement
contradicting the reasoning — not on a tolerance band. `strict_tdd: true` applies: every gate is
written first and observed **failing** against the current tree before any fix lands. A gate that
passes on the unfixed tree is not measuring what it claims.

**A delivery constraint that shapes Gates 1 and 2**: there is no `read` CLI command — `read_doc` is
reachable only through MCP or directly through `ReadDocument`. So no gate here can be a
`node dist/cli.js` one-liner. The precedent for this situation already exists in the repo:
`scripts/vector-reach.mjs` drives a use case directly for a manual gate. `sdd-tasks` decides between a
one-off script and an integration test; **the "before" state must be observed against the real file at
least once, either way.**

### Gate 1 — The live case is reproduced, then closed (BLOCKING)

Against `docs/documentation-convention.md`, indexed as this repo indexes it (zero-config `loose`):

- [ ] **Before**: `read_doc({ path: "docs/documentation-convention.md", section: "Business rules" })`
      returns `type: "section"` — the wrong-chunk resolution — and the returned content is the
      Templates material. Recorded verbatim in the verify report, not described.
- [ ] **After**: the same call returns `type: "section-not-found"`.
- [ ] **After**: none of the 17 enumerated phantom names appears in that response's
      `availableSections`.
- [ ] **After**: the real sections of that document are still listed (`12. Templates` and the other
      numbered H2s, plus its H3s).

**STOP condition.** If the "before" call does **not** resolve to the Templates chunk, the live-occurrence
claim — the load-bearing justification for this change's priority — is wrong. That outcome stops the
change for re-analysis rather than being smoothed over. The defect would still be real; its urgency
framing would not be.

### Gate 2 — Real sections reachable only through `headingsIn` still resolve (BLOCKING)

The gate against over-pruning, which is the realistic way this change causes a regression.

- [ ] A document with an **H4-H6** heading (below the chunker's H2/H3 descent, so it exists only inside
      chunk content) still resolves through `read_doc({ section })`.
- [ ] A **small section merged into a bigger chunk** by `mergeTinyPieces` — whose heading line
      survives only inside the merged text, which is precisely why the second `||` branch exists —
      still resolves.

**STOP condition.** Either failing means the fix removed real capability, not phantom capability.

### Gate 3 — The round-trip guarantee is intact (BLOCKING)

- [ ] For every `search_docs` result over `ejemplos/`, its `section` value passed verbatim as
      `read_doc({ path, section })` returns a `section` result, never `section-not-found` — the
      requirement at `mcp-contract/spec.md:47-69`, asserted rather than assumed safe.

### Gate 4 — The chunker did not move

- [ ] Indexing `ejemplos/` produces an **identical** chunk count and identical chunk boundaries before
      and after. Identity is the correct assertion: `split-text.ts` gains an `export` keyword, nothing
      else.
- [ ] `compendio eval` on `ejemplos/` is unchanged: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22.
- [ ] Every existing test in `test/domain/split-text.test.ts` passes **unmodified**.

### Gate 5 — The newly exposed surface is directly tested

- [ ] Whatever `split-text.ts` exports has direct unit tests, including the approximation's own edges
      (` ``` ` and `~~~`, leading whitespace, an info string, a line that merely *starts* with
      backticks). Testing the approximation is how it stops being an accident and becomes a decision.

### Gate 6 — Nothing else moved

- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] Every existing case in `test/application/read-document.test.ts` passes with **no assertion
      modified**. A modified existing expectation means `read_doc`'s behavior changed beyond fenced
      lines.
- [ ] `src/domain/flatten-map.ts` is untouched (the recorded non-goal).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Only the listing call site is fixed** — the review named it, and it is the one a reader of the review will look for | **High** | Both sites call one function, so a correct fix covers both by construction. Gate 1 asserts the *matching* path first and explicitly, since that is the one the review missed |
| **Over-pruning hides real sections** — the direction of failure that is a genuine regression rather than a smaller version of the current bug | Med | Gate 2, with the two shapes that depend on `headingsIn` alone (H4-H6, merged tiny sections). The Approach section makes bias-toward-under-detection an explicit design constraint |
| **The fix drifts into the chunker** under fork B, and a `read_doc` correction becomes an indexing change | Med | Gate 4 asserts identical chunk boundaries and an unmodified `split-text.test.ts`. Fork A is recommended precisely because it makes this risk structurally impossible |
| **Someone reimplements a stricter CommonMark fence parser** because the shared regex looks sloppy in isolation | Med | Rejected on the record in "Consistency beats correctness here". A `read_doc` that disagrees with the chunker about what is fenced is a worse system than one where both share an approximation |
| **The residual cases are read as covered** — the change ships claiming fence-awareness, and an unterminated fence still produces phantom sections | Med | Named in Approach and required in `CLAUDE.md`. The spec requirement must be scoped to chunk-local, delimiter-detectable fences, not to "all code" |
| **The 17 disappearing sections read as a regression** to whoever notices them | Low | Stated plainly in Scope and required in the change's notes: those sections never existed. They vanish from `availableSections` because they were fabricated |
| **`headingsIn` is widened to H1** while the loop is rewritten, since `#{2,6}` looks arbitrary next to a fresh line loop | Low | Analyzed and rejected above with the reason (H1 is the title, handled at `read-document.ts:68` and by the parser). Gate 6's unmodified-existing-tests item is the tripwire |

## Rollback Plan

Included per `openspec/config.yaml` `rules.proposal`. **Assessment: this is not a risky change, and
inventing ceremony for it would be dishonest.**

1. Revert the change commits and `npm run build`.
2. **Nothing else.**

Why it is genuinely this small, stated as properties rather than reassurance:

- **No persisted state is touched.** `headingsIn` runs at read time over already-stored chunk content.
  No schema, no DDL, no `reset()`, no `.compendio/` deletion, no re-index — in either direction.
- **A document indexed after the fix is byte-identical to one indexed before it.** Gate 4 asserts it.
- **No config key, no port change, no path/ID shape change**, so `ejemplos/goldenset.yaml` and
  `compendio eval` are untouched.
- **No public contract shape change**, so the beta/no-migrations clause never comes into play; there is
  nothing for it to apply to.

The only residue after a revert is behavioral and immediate: `read_doc` goes back to offering the 17
phantom sections and back to resolving `section: "Business rules"` against the wrong chunk. That is
the pre-change state.

## Dependencies

- **Zero new npm dependencies.**
- **No new corpus.** One small fixture (the Templates shape) plus the existing `ejemplos/` corpus and
  the existing `read-document.test.ts` harness.
- **No model download for Gates 1, 2, 4 (chunk count), 5, 6.** Only Gate 4's `eval` run needs
  embeddings, and it is an existing, already-required measurement.

## Delivery size — a decision for the `sdd-tasks` gate

| Driver | Fork A | Fork B |
|---|---|---|
| `read-document.ts` — `headingsIn` rewrite | 15–25 | 15–25 |
| `split-text.ts` — export (A) or shared helper + call-site rewire (B) | 1–3 | 20–40 |
| `read-document.test.ts` — both call sites, H4-H6, merged-section, fixture wiring | 60–120 | 60–120 |
| `split-text.test.ts` — direct delimiter coverage + unchanged-behavior regression | 30–60 | 40–80 |
| Fixture document | 20–40 | 20–40 |
| `mcp-contract` spec delta — one requirement + scenarios | 40–70 | 40–70 |
| `CLAUDE.md` | 8–15 | 8–15 |
| **Total** | **175–330** | **205–390** |

The exploration's floor is ~60-110 changed lines; that number counts production code and does not
count tests, the fixture, or spec prose. **This repository's forecasts have landed 1.3x-4x low for
several cycles running** (`bounded-chunk-size` 240–420 → 773; `match-centred-excerpt` 300–470 → ~1 521;
`incremental-reindex` missed by 2x), and that pattern is recorded here rather than assumed away. The
mitigating difference is real but should not be overweighted: the production surface here is genuinely
one function plus an `export` keyword, so the variance is concentrated in tests and spec prose — the
more predictable half.

**One PR is the working assumption** under fork A, comfortably inside the 400-line review budget. If
it overruns, there is no natural cut: the two call sites share a function and the spec requirement
covers both. An overrun means trimming test breadth, not splitting the change.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Severity framing | **Retrieval correctness**, not cosmetics. The matching call site (`read-document.ts:79`) is the primary defect; the listing site (`:89`) that the review named is secondary |
| Both call sites | **Both, in one change.** They call one function |
| Live occurrence | **Confirmed and measured**: 17 phantom headings of 34 regex matches in `docs/documentation-convention.md`. The motivating scenario is `section: "Business rules"` |
| Mechanism | **Reuse `isFenceDelimiter`** from `src/domain/split-text.ts`. Consistency with the chunker is the argument, not convenience |
| Export shape | **Open — the fork for `sdd-design`.** Fork A recommended |
| CommonMark-accurate fence parsing | **Rejected.** A stricter `read_doc` that disagrees with the chunker is worse than a shared approximation |
| H1 inside a fence | **Orthogonal, no change.** `headingsIn` is H2-H6 because H1 is the title; widening it would create a new defect. No H1 half of this bug exists |
| Round-trip guarantee | **Preserved by construction** — chunk headings come from remark and match on the untouched first branch. Gated anyway (Gate 3) |
| Fence state scope | **Chunk-local**, with unterminated fences and indented code blocks recorded as uncovered |
| The 17 disappearing sections | **Intended.** Stated plainly, not left as a surprise |
| Spec surface | **One new `mcp-contract` requirement.** Verified against the two neighbouring requirements' actual text; neither is edited |
| `flatten-map.ts:92`'s sibling fence-blindness | **Out of scope, recorded as a known open item.** Different capability, different failure mode, riskier (offset-map contract) |
| Siblings 1.3 / 1.5 | **Not bundled.** Separate changes, per `exploration.md`'s recorded user decision |
| Rollback | **Normal revert, nothing else.** No persisted state, no reindex, no migration. Not a risky change |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Artifact store | **openspec** (file-based). Engram MCP tools unavailable this cycle |

## Proposal question round (open — for the user, before `sdd-spec`)

Four product questions this proposal currently answers by assumption. Each names the assumption in
force, so silence is a valid answer and the change proceeds either way. A second round is available if
any answer moves the scope.

1. **When `read_doc` can only find a section inside a code fence, should it say so, or just say
   "not found"?** Assumed: **plain `section-not-found`**, with the phantom simply absent from
   `availableSections`. The alternative fits this project's established reflex of explaining rather
   than staying silent (`noMatchReason`, `filterWarning`, `embeddingsWarning`): the response could add
   "a heading with that name exists inside a code block and is not an addressable section." That is
   genuinely useful for the exact motivating case — an agent that saw the name in a template and asked
   for it — and it costs a response-field addition, which this proposal currently declares out of scope.
   This is the one question whose answer could widen the scope.

2. **Are the 17 sections vanishing from `docs/documentation-convention.md` acceptable with no further
   action?** Assumed: **yes** — they were never real, and the document is still fully readable via
   `read_doc({ path })` and its 17 genuine sections. The alternative reading is that the template
   content is *worth* addressing and the real fix is editorial (the convention document could name its
   templates as real subsections). Not proposed, but if template content is considered first-class
   navigable material, this change makes it less reachable, not more.

3. **How much is an unterminated fence worth?** Assumed: **out of scope, documented.** A document with
   an unclosed ``` still produces phantom sections after the fix. It is rare, already mishandled by the
   indexer in the same direction, and covering it would require document-level rather than chunk-local
   fence state — a materially larger change. If your corpora contain hand-edited or LLM-generated
   markdown where unclosed fences are common, this becomes a first-class case instead of a footnote.

4. **Should the sibling `flatten-map.ts` fence-blindness be scheduled now or just recorded?** Assumed:
   **recorded only**, as a fourth item from this review pass. Its symptom is quieter (a `#`-prefixed
   line inside a fenced block disappears from a search excerpt, so the excerpt silently misrepresents
   the code it is quoting) but it hits `search_docs`, which is the tool agents actually call, whereas
   `read_doc` is the last-resort rung. If excerpt fidelity for code-heavy documentation matters to you,
   its priority is arguably higher than its severity rating suggests.
