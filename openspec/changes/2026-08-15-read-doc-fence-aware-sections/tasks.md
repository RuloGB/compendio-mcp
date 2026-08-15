# Tasks: `read_doc`'s Section Lookup Must Not Treat Fenced Code as Headings

**Phase**: tasks · **Artifact store**: openspec (Engram unavailable this cycle) · **Skill resolution**:
paths-injected (`work-unit-commits`)

**Delivery**: `delivery_strategy: exception-ok` (user decision, 2026-08-15). **One PR**, `size:exception`
recorded against `openspec/config.yaml`'s 400-line review budget. Design forecast: **278–488 changed
lines**. No chained-PR slicing — both call sites share one function, Gate 1 is blocking and needs the
script, and case 2c is the change's own regression guard; none of that has a natural cut point. An
overrun is absorbed by trimming test *breadth* only, never case 2c and never
`scripts/section-lookup.mjs`.

`strict_tdd: true`. Every behavioral task below is **red test first, observed failing, then
implementation**. Test runner: `npm test`. Also gated: `npm run typecheck`, `npm run build`.

`src/domain/flatten-map.ts:92` is an explicit **non-goal** — no task below touches it; its
untouched-ness is a final-verification checklist item (Phase 6), not a task.

---

## Resolution of the parity-hole open decision (must read before Phase 3)

Design's Decision 4 orchestrator note identifies a residual hole in the balanced-delimiter guard:
`count(isFenceDelimiter) % 2 === 0` cannot distinguish **one complete, self-contained fence** from
**one stray closer (continuing a fence opened in an earlier chunk) followed by one stray opener
(starting a fence that continues into a later chunk)**. Both read as "balanced" (2 delimiters); the
guard engages in both; and in the second case it suppresses a heading that a document-wide view would
have kept addressable.

**Resolution: Option (a) — accept, on reachability grounds, with the inconsistency stated plainly
rather than elided.**

**The inconsistency, stated precisely, not smoothed over.** Decision 4's own stated trade is
"under-detection is recoverable, over-detection is a regression" — and that trade is *why* Decision 3
rejected the naive unguarded toggle in the first place. The misaligned-even case inverts that trade for
this one narrow shape: it is over-detection (a real, resolvable-today heading stops resolving) hiding
inside a mechanism whose entire purpose was to rule out over-detection. Accepting it means accepting,
for this one shape, the exact failure direction the rest of this change exists to close. That is not
automatically fine, and the design's own note says so; this decision does not pretend otherwise.

**Why accept it anyway, rather than escalate.** Reachability is narrow, not merely asserted narrow:

1. It requires a document region where two *distinct* fenced blocks and the real heading between them
   carry **no blank line** anywhere across that span — no blank line before the first fence's closer,
   none around the heading, none before the second fence's opener. Markdown authors and generators
   overwhelmingly put blank lines around fences and headings; tightly-packed fence/heading/fence with
   zero separation is an unusual document shape, not a common one.
2. Even given that document shape, `splitIntoBlocksFenceAware` only ever hands such a region to
   `splitLines` (the delimiter-blind line packer) — never to `splitFence`, which always re-emits
   balanced markers by construction — and only because the region also fails `isFencedCodeBlock` (a
   prose line, not a delimiter, must be its first line).
3. Even given both of the above, `splitLines`'s greedy token-budget packing must additionally land a
   piece boundary in the *exact* place that isolates precisely `[stray closer, heading, stray opener]`
   as one self-contained chunk — not `[stray closer, heading]` alone (odd count, correctly
   *not* suppressing) and not a piece carrying more of either fence's real content (which would make the
   fence genuinely self-contained and suppression genuinely correct).

Three independent, individually-unlikely conditions must co-occur. This is at least as narrow as the
"three-delimiter" pathological chunk Decision 3 already accepts as out of scope in its own "Rejected —
pairwise suppression" discussion (`[stray closer … opener]`, which even the *stricter* pairwise
alternative still gets wrong) — this repository has already set the precedent of accepting a
structurally similar narrow residual case on cost/benefit grounds, with a named local upgrade path
rather than a redesign. Escalating this one, materially narrower case to `blocked` while proceeding on
that precedent would be inconsistent in the other direction.

**Option (b) from the note (require the fragment's first delimiter to be provably an opener) is
correctly unavailable, not merely undesirable**: `isFenceDelimiter` is `/^\s*(```|~~~)/`, which cannot
distinguish an opener from a closer — a bare ` ``` ` is syntactically both, and Decision 1 is explicit
that this predicate is reused *as-is*, not extended. Option (c) is out of scope by Decision 4 (it is the
chunk-crossing problem, needing document-level state). No cheaper in-scope mitigation exists.

**What this resolution requires, concretely** (tasked below, not left as prose):

- **Task 3.5**: a test that **pins the known-wrong behaviour** — a chunk shaped exactly as the
  misaligned-even case, asserting the real heading between the stray closer and stray opener is
  suppressed, with a comment explaining why this is a documented, accepted limitation and not a defect
  to fix in this PR.
- **Task 6.4**: extend the `mcp-contract` spec delta's non-guarantee list from three entries to **four**,
  naming this shape distinctly from the existing "chunk begins mid-fence" non-guarantee — the two have
  opposite consequences (existing: heading stays reachable, safe direction; this one: heading becomes
  unreachable, the regression direction) and must not be folded into one bullet.
- **Task 6.1**: the `CLAUDE.md` bullet names this limitation explicitly, not just the other three.

If, during Phase 3, `sdd-apply` finds the fixture from Task 3.5 does **not** actually reproduce
suppression (i.e., this reasoning is wrong), stop and re-open this decision — do not silently drop the
test or reword the finding.

---

## Phase 0 — Two claims to measure, not inherit

Design flags two claims as reasoned rather than measured. Both are converted into direct measurements
before any implementation work, and both ride on tooling built in Phase 2 rather than one-off scripts —
see the ordering note there.

- **0.1** [depends on 2.1–2.3] Confirm the design's flow-notes claim that the live "12. Templates"
  chunk of `docs/documentation-convention.md` contains exactly **2** fence-delimiter lines (an even,
  balanced count) — measured via `scripts/section-lookup.mjs`'s diagnostic output (Task 2.2), not
  assumed. Record the actual count in the verify report.
- **0.2** [depends on 2.1–2.3] Confirm Gate 1's "before" state directly against the real file: running
  `read_doc({ path: "docs/documentation-convention.md", section: "Business rules" })` against the
  **current, unfixed** tree resolves to `type: "section"` with the "12. Templates" chunk's content.
  **STOP condition** (proposal, Gate 1): if it does not resolve there, the live-occurrence justification
  for this change's priority is wrong — stop for re-analysis rather than proceeding. This is measured
  once, early (immediately after Phase 2's script exists, before Phase 3's fix), and is not repeated.

---

## Phase 1 — Domain: expose `isFenceDelimiter` (Decision 1, 2)

Spec link: enables the mechanism the sole new requirement ("A Heading Line Inside a Fenced Code Block Is
Not an Addressable Section") depends on. No behavioral scenario is satisfied by this phase alone.

- **1.1** [RED] Add `describe("isFenceDelimiter")` to `test/domain/split-text.test.ts` (additions only —
  every existing case must stay unmodified). Cover, per Decision 2's enumerated edges: ` ``` `, `~~~`,
  four backticks, arbitrary leading whitespace, an info string (` ```markdown `), two backticks
  (**false**), and a line that merely *contains* backticks later in the line (**false**). The import
  will fail to compile against today's tree (the symbol is not yet exported) — that failure to compile
  **is** this task's red state; record it as such.
- **1.2** [GREEN] In `src/domain/split-text.ts:85`, change `function isFenceDelimiter` to
  `export function isFenceDelimiter`. No other edit to this file: body, callers, and every other
  function's behavior are unchanged. Add a doc comment naming the second consumer
  (`read-document.ts`'s `headingsIn`) and stating plainly that this is a deliberate CommonMark
  approximation, not a stricter parser — the same rationale as design.md's Decision 1/"Consistency beats
  correctness here".
- **1.3** Run `npx vitest run test/domain/split-text.test.ts` — confirm 1.1 is green and every
  pre-existing case in the file passed with **zero assertions modified**. Run `npm run typecheck`.

Task 1.1 and 1.2 are sequential (the red state depends on the export not yet existing); nothing in this
phase can run in parallel with itself, but the whole phase has no dependency on Phase 0.

---

## Phase 2 — Tooling: `scripts/section-lookup.mjs` (Decision 6)

Built early, deliberately: this script is both the deliverable Gate-1 tool **and** the instrument Phase
0's two measurements use, so it is written once rather than once as a throwaway and once as a
deliverable.

- **2.1** Write `scripts/section-lookup.mjs`, following the `scripts/vector-reach.mjs` precedent
  (header doc comment explaining what it measures and why a script rather than a CLI command — there is
  no `read` command). It imports from `dist/`, constructs `SqliteIndexStore(<root>/.compendio/compendio.db)`
  and `ReadDocument` directly (no embeddings, no model download — mirrors Decision 6 and the "no model
  download" dependency claim, itself worth a one-line sanity check that the script never imports
  `TransformersEmbeddings`). Usage:
  `node scripts/section-lookup.mjs <root> "<path>" "<section>"`. Prints the `ReadResult` discriminant
  plus: for `type: "section"`, the stored `heading` of every matched chunk and its leading content; for
  `type: "section-not-found"`, the full sorted `availableSections` with a count.
- **2.2** Add the diagnostic line that satisfies Task 0.1: for `type: "section"`, also print each
  matched chunk's fence-delimiter-line count, computed with the newly exported `isFenceDelimiter`
  (`chunk.content.split("\n").filter(isFenceDelimiter).length`) — a direct measurement, not an assumed
  one. This does not widen `IndexStore` or any production port; it is arithmetic over data the script
  already has in hand.
- **2.3** Add the **asserted self-check** (Decision 6, mirroring `vector-reach.mjs`'s monotonicity
  check): when the result is `type: "section"` and **no** matched chunk's stored `heading`
  (`normalize`d) contains the requested section, exit **non-zero** — this is the defect's exact shape,
  a match that came only from a content heading rather than a real chunk heading. A manual gate that can
  only be read by eye is a manual gate that gets misread; this makes the check mechanical. Print a
  clearly marked failure banner, same style as `vector-reach.mjs`'s monotonicity-violation banner.
- **2.4** [= Task 0.1 + 0.2] `npm run build`, then
  `node dist/cli.js index --lexical` against this repo's own docs (or `node dist/cli.js --root . index --lexical`
  — confirm the correct invocation against `cli.ts` before running), then
  `node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"` against the
  **current, unfixed** tree. Record verbatim in the verify report: the discriminant (`section`), the
  resolved chunk's content excerpt (Templates material), the printed delimiter count (Task 0.1 — expect
  2, confirm rather than assume), and the script's exit code (expect **non-zero**, per 2.3's self-check
  — this non-zero exit on the unfixed tree is itself evidence 2.3 works). This satisfies Gate 1's
  "Before" bullets and both Phase 0 measurements in one run.

Sequential within the phase (2.1 → 2.2 → 2.3 → 2.4). Depends on Phase 1 being merged into the local tree
(the script imports the compiled `isFenceDelimiter`, so `npm run build` must postdate 1.2) but not on
Phase 3.

---

## Phase 3 — Application: `headingsIn` rewrite (Decision 3, 4) — TDD red tests, then implementation

Spec link: every scenario in `specs/mcp-contract/spec.md`'s new requirement. Task-to-scenario mapping is
called out per task below.

All of 3.1–3.5 are written and observed **failing** against the current tree before 3.6 touches
`read-document.ts`. They can be written in any order relative to each other; 3.6 depends on all five.

- **3.1** [RED — Gate 2a] In `test/application/read-document.test.ts`, add a case seeding
  `SqliteIndexStore(":memory:")` directly (pattern at `:268-307`) with a chunk whose content carries a
  real `#### Deep subheading` **outside** any fence — below the chunker's H2/H3 descent, reachable only
  through the second `||` branch. Assert `read_doc({ section: "deep subheading" })` still resolves
  `type: "section"`. Spec scenario: "A genuine section heading outside any fence still resolves." This
  case should already pass on today's tree (today's unfixed `headingsIn` has no fence logic at all to
  break it) — write it anyway, since it is the guard against over-pruning real, unfenced, deep headings.
- **3.2** [RED — Gate 2b] Add an integration case (temp dir + real `IndexDocuments`, pattern at
  `:206-258`): a small section whose heading survives only merged inside a bigger chunk via
  `mergeTinyPieces`, still resolves through the second `||` branch. Also expected to pass on today's
  tree — the regression guard is that the *rewrite* must not stop it passing.
- **3.3** [RED — Gate 2d] Add a case: chunk content `[opener, "## Phantom", closer, "## Real"]` (an
  ordinary, self-contained, balanced fence containing one phantom heading, followed by one real heading
  outside it). Assert `headingsIn`'s effect via `read_doc`: `"Phantom"` is **not** resolvable/listed,
  `"Real"` **is**. This is the requirement's core scenario ("A request naming only a fenced heading
  returns section-not-found" / "the live case" in miniature) and **fails on today's unfixed tree** — a
  phantom `## Phantom` currently resolves.
- **3.4** [RED — Gate 2c, THE LOAD-BEARING CASE — never cut, never weaken] Add a case: chunk content
  `[code line, closer, "prose", "#### Real"]` — exactly **one** delimiter line (odd, unbalanced,
  mid-fence chunk start). Assert `"Real"` still resolves and is still listed. **This case is green on
  today's tree AND green after Decision 3's guarded fix, and it is the only case in this change that
  would go red against the naive unguarded toggle the proposal originally specified** (which would set
  `inFence = true` at the lone closer and suppress everything after it in the chunk, including `Real`).
  Write it with a comment stating this explicitly — the case exists to prove the guard is present, not
  to prove the fix works. Do not shrink this case to a smaller or differently-shaped fixture; do not
  substitute an assertion that would also pass under the naive toggle.
- **3.5** [RED, pins KNOWN-WRONG behaviour — the parity-hole resolution, see the section above] Add a
  case: chunk content shaped as the misaligned-even fragment — e.g.
  `` "```\nReal prose leading into a heading\n#### Real subheading between stray delimiters\n\nbody\n```" ``
  (2 delimiters, balanced, and — by construction, chunk-locally indistinguishable from a genuine
  self-contained fence) — asserting `"Real subheading between stray delimiters"` is **suppressed**
  (not resolvable, not listed). Comment block must state: this is a **documented, accepted limitation**
  (design.md Decision 4's orchestrator note, resolved in tasks.md), not a defect this PR closes; it pins
  the behaviour so a future change cannot silently regress it further or "fix" it without a deliberate
  decision. If this fixture does **not** reproduce suppression once 3.6 lands, stop — the reachability
  reasoning above was wrong, and this needs re-opening, not silent deletion.
- **3.6** [GREEN] Rewrite `headingsIn` in `src/application/read-document.ts:113-119` per design.md
  Decision 3's exact specification: hoist `HEADING_LINE = /^#{2,6}\s+(.+)$/` (never `#{1,6}` — H1 stays
  excluded, per the proposal's settled "H1 inside a fence" analysis); import `isFenceDelimiter` from
  `../domain/split-text.js`; compute `balanced` once, before the loop, from the full line count (not
  maintained incrementally); loop with toggle-and-skip-on-delimiter, skip-while-`inFence`, else test
  `HEADING_LINE`. Preserve CRLF behavior exactly (`split("\n")` leaves a trailing `\r` inside the
  captured group; `.trim()` removes it, matching today's `matchAll` behavior — do not "fix" this as
  incidental cleanup). Both call sites (`:79` matching, `:89` listing) require **no edit** beyond what
  they inherit from the rewritten callee — confirm this by diff, per Decision 5's verified (not assumed)
  claim.
- **3.7** Run `npx vitest run test/application/read-document.test.ts` — confirm 3.1–3.5 are green
  (3.5's assertion is "suppressed", i.e. it is a green test *for* the pinned wrong behavior, not a
  failing one) and every pre-existing case in the file passes with **zero assertions modified**.

---

## Phase 4 — Round-trip regression (Gate 3)

> **Orchestrator note (gatekeeper pass, 2026-08-15) — the flagged goldenset unknown is resolved;
> task 4.1 is sound, but two of its references are imprecise enough to stall an executor.**
>
> - The file is **`ejemplos/goldenset.yaml`**, not `goldenset.yaml` at the repo root (there is no
>   root-level copy; the other hits are inside `.claude/worktrees/`).
> - Its schema is **Spanish** — a YAML list of `- pregunta: "…"` / `esperado: "docs/…"` pairs. This
>   is `es-frozen` by the project's language contract: read the `pregunta` field, do **not** rename
>   or translate it.
> - The concern that goldenset "might not fit the assertion" does **not** apply. 4.1 needs a curated
>   *query list*, which `pregunta` is exactly; it does not need section data, which goldenset has
>   none of. The `esperado` field is unused by this gate.
> - `test/application/heading-less-round-trip.test.ts` **exists** — the reference is real.
>   `test/application/goldenset-addresses.test.ts` is the closer prior art for the harness shape:
>   it copies `ejemplos/` to a temp dir (so the git-ignored `ejemplos/.compendio/compendio.db` that
>   `scripts/excerpt-offset-distribution.mjs` reads is never clobbered) and uses `forceLexical: true`
>   to keep the run address-only — no model download, no network, no nondeterminism. **Reuse that
>   pattern.**
> - The cited "Gate 1 / Gate 3 describe block" in `index-and-search.test.ts` is loose: the block
>   named `Gate 3` there (`:329`) is about alias-aware module inference, unrelated to round-trip.
>   Follow `goldenset-addresses.test.ts` instead.

Spec link: does not add a new scenario to this change's requirement — it re-asserts the existing
`section` round-trip requirement (`mcp-contract/spec.md:47-69`, unedited by this change) still holds
after `headingsIn` changes.

- **4.1** [RED, then GREEN by construction] Add (or extend, if a natural home already fits) an
  integration test over the real `ejemplos/` corpus with `FakeEmbeddings`, following the pattern already
  established in `test/application/index-and-search.test.ts`'s "Gate 1 / Gate 3" describe block and
  `test/application/heading-less-round-trip.test.ts`: run `SearchDocuments` against a representative set
  of queries (the corpus's `goldenset.yaml` questions are the natural, already-curated source — do not
  invent a new query list) and, for every returned result, pass its `section` value verbatim into
  `read_doc({ path, section })`, asserting `type: "section"` — never `section-not-found`. This should
  already pass before 3.6 (chunk headings come from remark and match on the untouched first `||`
  branch — Decision 5's invariant), so its role here is confirmation, not a red-first case; still run it
  before and after 3.6 and record both results in the verify report, since Decision 3 is the one edit in
  this change with any chance of breaking it.

---

## Phase 5 — Gate 1 "after" state, and full-suite gates (Gate 4, Gate 6)

- **5.1** [depends on 3.6, 2.4] `npm run build`, re-index this repo's own docs (`--lexical`), then rerun
  `node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"`. Confirm:
  `type: "section-not-found"`; none of the 17 previously-enumerated phantom names in `availableSections`;
  the real numbered H2s and their H3s still listed; script exits **0** (2.3's self-check now passes,
  since the match is gone entirely rather than resolving from a content heading). Record verbatim.
- **5.2** [Gate 4] Index `ejemplos/` before and after 3.6 (or diff against a pre-change baseline run) and
  confirm **identical** chunk count and chunk boundaries — this change only adds an `export` keyword to
  the chunker's own module, so identity, not tolerance, is the correct assertion. Run `compendio eval`
  over `ejemplos/` and confirm it is unchanged against `CLAUDE.md`'s recorded numbers: MRR ≥ 0.943,
  recall@5 = 1.00, top-1 ≥ 20/22.
- **5.3** [Gate 6] `npm test`, `npm run typecheck`, `npm run build` all pass. Confirm by diff:
  `test/application/read-document.test.ts` has only additions (no modified assertion), same for
  `test/domain/split-text.test.ts`, and `src/domain/flatten-map.ts` has a zero-line diff.

---

## Phase 6 — Documentation

- **6.1** `CLAUDE.md`: add one *Non-obvious decisions* bullet stating `read_doc`'s section lookup is
  fence-aware, chunk-local, and shares the chunker's own `isFenceDelimiter` predicate (not a stricter
  parser, deliberately — same argument as the existing sqlite-vec/normalized-vectors bullets' style:
  precise, checked, not aspirational). Name **all four** non-guarantees explicitly: unterminated fences,
  chunks that begin mid-fence, indented (4-space) code blocks, and the misaligned-even parity-hole case
  (Phase-3.5-and-tasks.md-resolved) — the fourth must be distinguished from the second by its opposite
  consequence (heading becomes unreachable, not merely still-reachable-but-unguarded).
- **6.2** `CLAUDE.md`: add the manual-gate recipe beside the existing `vector-reach.mjs` recipe (same
  section style, e.g. immediately following "Manual gate 1b"), showing the exact `node dist/cli.js`
  build/index step and the `node scripts/section-lookup.mjs` invocation from Task 2.4/5.1, and the
  measured before/after outcomes from those two runs (not invented numbers — copy them from the verify
  report once produced).
- **6.3** Confirm the MCP tools section's `read_doc` description in `CLAUDE.md` needs no wording change
  (params/response shape are unchanged by this PR, per proposal Scope) — a no-op check, not an edit,
  unless review finds otherwise.
- **6.4** [the parity-hole resolution's spec obligation] Edit
  `openspec/changes/2026-08-15-read-doc-fence-aware-sections/specs/mcp-contract/spec.md`: extend the
  "Scope is chunk-local..." paragraph's three named non-guarantees (unterminated fences, mid-fence chunk
  starts, indented code blocks) to a **fourth**: a chunk whose fence-delimiter count is even but
  misaligned (a stray closer from an earlier-opened fence, followed by a stray opener continuing into a
  later chunk) can suppress a heading between them — stated as its own bullet, not folded into the
  mid-fence-start non-guarantee, since that one's outcome is "heading stays reachable" (safe direction)
  while this one's is "heading becomes unreachable" (the regression direction the requirement otherwise
  rules out). Do not add a new scenario section for this unless a reviewer specifically asks — the prose
  extension to the existing paragraph is the design's own instruction ("the spec's non-guarantee list may
  need a fourth entry").

---

## Phase 7 — Commit plan (per `work-unit-commits`)

Medium risk per the skill's SDD relationship table (forecast 278–488 vs. 400-line budget, but
`exception-ok` is already the recorded decision) — commit by work unit, monitor changed lines, no
chained-PR slicing.

Suggested work units, each a candidate standalone commit (all land in the one PR):

1. `feat(domain): export isFenceDelimiter for read_doc's section lookup` — Phase 1 (1.1, 1.2). Tests
   with the code, per the skill.
2. `test(application): add red cases for headingsIn's fence-aware rewrite` — Phase 3's 3.1–3.5 committed
   together, still red, immediately before the implementation commit — makes the red state visible in
   history rather than squashed away, which is itself evidence for reviewers.
3. `fix(application): make headingsIn fence-aware, chunk-local and balanced-guarded` — Phase 3's 3.6,
   turning the previous commit's red suite green. Phase 4's round-trip test can ride with this commit or
   its own — reviewer's call, same logical unit either way.
4. `chore(scripts): add section-lookup.mjs, the read_doc manual gate` — Phase 2, with the before/after
   measurement outputs referenced in the commit body (not the script itself — those are prose, recorded
   in the verify report and Task 6.2).
5. `docs: record fence-aware section lookup and its four non-guarantees` — Phase 6 (CLAUDE.md + the
   spec's fourth non-guarantee entry).

Each commit leaves the repo in a state where `npm test` passes except commit 2 (intentionally red,
documented as such in its message) — acceptable per the skill's "repo still makes sense after applying
only this commit" checklist item, since a red-but-intentional TDD commit inside one PR (never pushed to
`main` alone) is the documented exception, not a violation.

---

## Task-to-requirement traceability

| Task(s) | Spec scenario |
|---|---|
| 3.3 | "A request naming only a fenced heading returns section-not-found" |
| 0.2, 2.4, 5.1 | "The live case — `docs/documentation-convention.md`, 'Business rules'" |
| 3.3, 5.1 | "A fenced heading is absent from the available-sections listing" |
| 3.3 (extend to both fence styles — see note below) | "Both fence marker styles suppress the phantom heading" |
| 3.1, 3.2 | "A genuine section heading outside any fence still resolves" |
| 3.4 | "A fence left open across chunk boundaries is a documented non-guarantee" (the mid-fence-start shape) |
| 3.5, 6.4 | The **fourth**, not-yet-in-spec non-guarantee (misaligned-even parity hole) — spec text updated by 6.4 |

**Note for 3.3**: as written above it covers only ` ``` `-style fences; extend it (or add a sibling case)
with a `~~~`-delimited fence carrying the same phantom-heading shape, to directly cover the "Both fence
marker styles suppress the phantom heading" scenario rather than leaving it implied by 1.1's
delimiter-level coverage alone.
