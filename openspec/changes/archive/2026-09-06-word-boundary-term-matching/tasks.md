# Tasks: Match Query Terms on Word Boundaries, Not Substrings

Strict TDD is active. Every production edit is preceded by a task that writes/updates a failing
test and observes it fail. `npm test` is the runner throughout.

Ordering principle: the probe (`scripts/word-boundary-probe.mjs`) must exist in the tree **before**
`src/domain/match-location.ts` is touched, so Gate C's RED verifications (revert-only) are real
reverts, not fresh-checkout illusions. Unit-test RED comes first because it is cheaper (vitest runs
from `src/`, no build needed) — Decision 4.

## Phase 1 — Unit-level RED (cheapest falsification first)

### [x] 1.1 Invert the existing canary and observe it fail
- Spec/Design ref: proposal Scope ("Invert one existing canary"); design Decision 4; Gate D
  ("inverted canary demonstrated failing against the pre-change build")
- Edit `test/domain/match-location.test.ts:96-107` ("finds overlapping terms from different query
  terms"): replace with two assertions —
  `locateSpans("theta value", ["the", "theta"])` → exactly `[{start: 0, end: 5, term: "theta"}]`,
  and `locateSpans("theta value", ["the"])` → `[]`. Rewrite the comment to state the new semantics;
  never delete it into silence.
- Run `npx vitest run test/domain/match-location.test.ts` and capture the failure diff (received
  still contains `{start: 0, end: 3, term: "the"}`). This transcript is Gate D evidence — keep it.
- Sequential. Blocks 1.2 and 1.3 (same file, avoid clobbering the diff).

### [x] 1.2 Add new unit tests for the boundary classes (RED)
- Spec ref: `specs/mcp-contract/spec.md` "Located Spans Are Whole-Token Matches" scenarios; design
  Testing Strategy row 1
- In `test/domain/match-location.test.ts`, add cases for: exact whole-token match (kept), prefix of
  a longer word (rejected, e.g. `"for"` in `"before"`), interior fragment (rejected, e.g. `"time"`
  in `"timestamp"`), suffix of a longer word (rejected), a `_`-delimited boundary (kept, e.g.
  `"time"` in `"time_stamp"`), digit-adjacency (rejected, e.g. `"v"` in `"v2"` — per design Decision
  3's table).
- Run the suite, observe these new assertions fail against the unmodified `locateSpans`.
- Sequential, after 1.1.

### [x] 1.3 Add the NFD fixture test (BINDING — design addendum)
- Design ref: orchestrator addendum, binding requirement; closes the gate gap on Decision 2 since no
  committed corpus is naturally NFD
- Add a test using a decomposed-accent input, e.g. raw text built as `"a" + "́" + "the value"`
  (NFD form of `áthe value`) against term `"the"`. First assert the fixture's own precondition —
  `input.normalize("NFC") !== input` (i.e. the literal string is genuinely NFD, not silently
  reverted by an editor) — per `test/application/excerpt-window.test.ts`'s self-asserted-precondition
  pattern. Then assert `locateSpans` rejects the occurrence (folded coordinates reject it), and add
  the NFC counterpart of the same text asserting the same rejection — proving both forms agree
  (spec.md scenario "The boundary test is evaluated in folded, not raw, coordinates").
- If a fixture file is used instead of an inline string, note `.gitattributes` governs line endings
  only, not normalization form — prefer an inline literal with an explicit code-point construction
  (as above) to avoid depending on file-save behavior at all.
- Run the suite, observe this test fail (current code has no boundary predicate at all, so the
  NFD/NFC inputs both currently produce a span).
- Sequential, after 1.2.

### [x] 1.4 Confirm the fold-interaction pinned tests are still present and green
- Design ref: proposal Scope ("must survive"); `match-location.test.ts:109-121`
- No new test — verify `"DUPLICADO" ← "duplicado"` and `"dirección" ← "direccion"` tests are
  untouched and currently pass. Record this as a checkpoint, not a code change (protects against
  accidentally touching them while editing 1.1-1.3).
- Sequential, after 1.3, before 1.5.

### [x] 1.5 Implement the boundary predicate (GREEN)
- Design ref: Decision 3 (predicate + placement), Decision 2 (folded coordinates), Technical
  Approach flow/trap, Decision 4 doc-comment move
- In `src/domain/match-location.ts`: add a module-private `const WORD_CHAR = /[\p{L}\p{N}]/u` (not
  exported — Decision 3's non-tautology guard for W2), and a boundary check inside the `while`
  loop's occurrence-accept step: accept only when `foldedRaw[idx - 1]` is undefined or fails
  `WORD_CHAR`, and `foldedRaw[idx + foldedTerm.length]` is undefined or fails `WORD_CHAR`. A
  rejected occurrence must `continue` the scan (via the existing `searchFrom = idx + 1`), never
  `break` — the `"charged charge"` trap named in the design's Flow section.
- Update the doc comment at `match-location.ts:57-65` to state whole-token semantics, matching
  AGENTS.md's house rule that a doc comment moves with the semantics it documents.
- Run `npm test` (or targeted `npx vitest run test/domain/match-location.test.ts`) — all of 1.1,
  1.2, 1.3 turn green; 1.4's pinned fold tests stay green.
- Sequential, after 1.4. This is the only production-code edit in the entire task list.

### [x] 1.6 Full suite + typecheck + build
- Gate ref: Gate D ("`npm test` green; `npm run typecheck` and `npm run build` pass")
- Run `npm test`, `npm run typecheck`, `npm run build`.
- Diff-check: confirm `git diff --name-only` shows exactly one changed test file
  (`test/domain/match-location.test.ts`) plus the one production file
  (`src/domain/match-location.ts`) at this point (probe/docs not yet added). If any second test
  file changed, STOP — this falsifies the blast-radius claim (Gate D) and the change needs
  re-analysis before continuing.
- Sequential, after 1.5.

## Phase 2 — The gate probe (must exist in both tree states)

### [x] 2.1 Author `scripts/word-boundary-probe.mjs`
- Spec/Design ref: proposal "Success Criteria" counters W0-W5; design Decision 1 (recompute spans
  from `dist/`'s real `locateSpans`, never proxy on excerpt text, never widen `SearchResultItem`)
- Derive from `strict-cost.mjs` (kept as prior art in this folder), hardened per design Decision 1:
  - Import from `dist/` only (`createContainer`, `locateSpans`, `tokenizeQuery`), never `src/`.
  - Drive the real pipeline: `createContainer`, hybrid index (no `--lexical`), no explicit `k`.
  - W0: `(path, section)` resolves to exactly one stored chunk — else excluded + counted, message
    `CANNOT IDENTIFY THE MEASURED CHUNK`.
  - W1: anti-vacuity denominator — spans emitted by the pipeline (BEFORE run) whose start or end
    abuts a `[\p{L}\p{N}]` character (i.e. NOT already a whole-token match) — must be `> 0`. Message
    `GATE IS VACUOUS`.
  - W2: of AFTER-run emitted spans, count of those that are NOT exact word matches — must be `0`.
    Message `THE FIX DID NOT LAND`. Classifier for W1/W2 is written independently, in RAW
    coordinates (never importing the private `WORD_CHAR` predicate — it is not exported, by design).
  - W3: fragments with ≥1 span BEFORE that have 0 spans AFTER — must be `0`. Message
    `MATCH CENTRING WAS LOST`.
  - W4: ordered digest of `(query, rank, path, section)` + a per-fragment excerpt hash; a
    `--compare-digest <file>` flag requiring tuple-for-tuple identity of the first component.
    Message `POPULATION DRIFTED BETWEEN RUNS`.
  - W5: reported only — span retention %, class breakdown (exact/prefix/interior/suffix), count of
    fragments whose excerpt text changed, and a sub-count of fragments whose selected centre moved
    (design Decision 5), with two verbatim before/after excerpt pairs printed for eyeballing.
  - Five distinct, never-conflated failure messages/exit codes — one job each, per counter.
  - Query set: default to `ejemplos/goldenset.yaml` (as `strict-cost.mjs` does), with `--query`
    override support for the RED verifications in Phase 3.
- No test framework — this is a standalone script, verified by running it, not by `npm test`.
- Sequential. Must land before 3.x (the RED verifications need the probe present pre-change) and
  before 1.5's production edit is trusted as final — but since 1.5 already happened in Phase 1 to
  keep unit-test TDD cheap, 2.1 is written against the ALREADY-fixed `dist/` build. This is fine
  per design Decision 4's asymmetry: the unit-test RED (Phase 1) and the probe RED (Phase 3, revert-
  only) are two independently satisfied requirements, not one sequence.

### [x] 2.2 Build and smoke-run the probe once (sanity, not a gate)
- Run `npm run build`, then `node scripts/word-boundary-probe.mjs ejemplos`. Confirm it runs to
  completion, all messages are distinct strings, and W0/W1/W2/W3 print sane numbers. This is not
  Gate A/B yet — just confirming the instrument itself works before it is used to gate anything.
- Sequential, after 2.1.

## Phase 3 — Gates A, B, C (measurement, not code)

### [x] 3.1 Gate A — the fix lands, measured on `ejemplos/`
- Gate ref: Success Criteria, Gate A
- Run the probe BEFORE (see 3.4 for how BEFORE is obtained without losing the probe) against
  `ejemplos/` hybrid: confirm **W1 > 0**. If W1 is 0, widen the query set (add terms with known
  prefix/interior collisions, e.g. from the goldenset's own vocabulary) before proceeding — do not
  proceed on a vacuous W1.
- Run AFTER (current, fixed tree): confirm **W2 === 0**.
- Confirm the W4 digest between the BEFORE and AFTER runs matches tuple-for-tuple (population did
  not drift — same queries, same ranks, same `(path, section)` per rank).
- Record W5's real numbers in `verify-report.md`, for `ejemplos/` and for `DocuTests2` if the
  machine running apply has that corpus (non-blocking there).
- Sequential, after 2.2.

### [x] 3.2 Gate B — the functional cost, re-measured HERE
- Gate ref: Success Criteria, Gate B; orchestrator addendum ("Gate B must still re-measure")
- From the same BEFORE/AFTER pair as 3.1, confirm **W3 === 0** on `ejemplos/`'s 22 goldenset
  queries. This supersedes exploration §4.6.4's `0/110` (raw-mode, prior evidence only) — do not
  cite that number in place of this measurement.
- If the machine has `DocuTests2`, report its W3 too, explicitly labeled non-blocking (not
  committed, not reviewer-reproducible).
- If W3 > 0 anywhere on `ejemplos/`: STOP. Per the gate's own text, a fragment losing match-centring
  has no argument in this design and needs re-analysis, not a passing-anyway continuation.
- Sequential, after 3.1.

### [x] 3.3 Gate C — W2 RED (revert-only)
- Gate ref: Success Criteria, Gate C, first bullet; design Decision 1's non-tautology framing
- With the probe (2.1) already committed/present in the working tree, revert **only**
  `src/domain/match-location.ts` to its pre-1.5 state (e.g. `git stash` scoped to that one file, or
  a manual revert — never a full branch checkout that would also remove the probe).
- `npm run build`, then re-run the probe against `ejemplos/`.
- Capture the transcript showing the literal message `THE FIX DID NOT LAND` — not merely a non-zero
  exit code. This is the exact fake `retrieval-open-work.md:218-222` warns against; the transcript
  is the evidence it did not happen here.
- Restore `src/domain/match-location.ts` to its post-1.5 state, `npm run build` again, confirm the
  restored build reproduces 3.1/3.2's numbers (nothing was lost in the revert/restore round-trip).
- Sequential, after 3.2. Must not be skipped or asserted from memory.

### [x] 3.4 Gate C — W1 RED, both tree states
- Gate ref: Success Criteria, Gate C, second bullet
- Construct a query set whose terms produce only exact whole-token matches, or match nothing at all
  (e.g. `--query "qwertzuiop plughxyzzy frobnicate"`, following the `excerpt-fence-drop-probe.mjs` /
  `supporting-anchor-probe.mjs` nonsense-query precedent already in this repo).
- Run the probe with this query set against the CURRENT (post-1.5) build: confirm `GATE IS VACUOUS`,
  exit non-zero.
- Run the probe with the same query set against the reverted (pre-1.5) build (repeat the scoped
  revert from 3.3, or keep a saved copy of the pre-1.5 file to avoid re-doing the stash/restore
  twice): confirm `GATE IS VACUOUS` fires there too — the vacuity guard must not depend on which
  side of the fix it runs on.
- Restore the post-1.5 build, `npm run build`.
- Sequential, after 3.3.

### [x] 3.5 Gate C — W3 RED, deliberately over-strict patch
- Gate ref: Success Criteria, Gate C, third bullet
- Temporarily patch `src/domain/match-location.ts` with an intentionally over-strict rule on top of
  the boundary predicate — e.g. also reject any term shorter than 4 characters (zeroing out short-
  term fragments the goldenset is known to rely on).
- `npm run build`, run the probe against `ejemplos/`: confirm `MATCH CENTRING WAS LOST` fires (W3 >
  0), proving the counter can detect the loss it names — it is not a counter that always reads 0.
- Revert the temporary over-strict patch back to the real 1.5 predicate, `npm run build`, confirm
  3.1/3.2's numbers reproduce again (W3 === 0 restored).
- Sequential, after 3.4. This is the last tree-mutating verification step — after this task the
  working tree must be back at the real, final `match-location.ts`.

## Phase 4 — Documentation and spec closure

### [x] 4.1 Confirm the `mcp-contract` spec delta is final
- The spec delta (`openspec/changes/word-boundary-term-matching/specs/mcp-contract/spec.md`) was
  already authored in `sdd-spec`. This task is a verification pass, not new authoring: confirm its
  scenarios match what 1.5 actually implemented (folded coordinates, whole-token boundary, five
  named non-guarantees) and that it states explicitly which excerpt requirements are unchanged
  (Graduated Excerpt Budget, Truncation Marking, Vector-Only Results, Match Selection Is Not
  Positional). Fix wording only if 1.5's real behavior drifted from what was speced (it should not
  have — the predicate was specified before being written).
- Can run in parallel with 4.2/4.3 (read-only cross-check against already-implemented code).

### [x] 4.2 Add the `AGENTS.md` non-obvious-decision bullet
- Gate ref: Gate E, first bullet
- Add a new bullet in `AGENTS.md`'s "Non-obvious decisions" section, house style (measured numbers,
  named non-guarantees, greppable): state the substring→whole-token change, the 71.9%/0-loss
  measurements from the proposal, the folded-vs-raw coordinate choice and why (Decision 2, the
  NFC/NFD asymmetry table from the orchestrator addendum), and the five residual divergences from
  the spec delta / proposal's "Residual divergences" section. Explicitly state this does NOT fix
  `docs/retrieval-open-work.md` Open problem 3 (Gate E's last bullet).
- Sequential after 3.5 (documents the final, real behavior — not the reverted or over-strict
  intermediate states).

### [x] 4.3 Add the new manual-gate section to `AGENTS.md`
- Gate ref: Gate E, second bullet
- Add a manual-gate section matching the shape of the five existing ones (`bounded-chunk-size`
  Gate 1b/2, `read-doc-fence-aware-sections`, `excerpt-fence-drop-generalization`,
  `supporting-excerpt-anchoring`): the two `node dist/cli.js ... index` + probe invocation lines,
  a before/after counters table (W0-W5, using 3.1/3.2's real measured numbers — not placeholders),
  and the three RED verifications (3.3, 3.4, 3.5) each with their exact failure message and
  exit-code row, written the way the existing sections report theirs (a small markdown table).
- Sequential, after 4.2 (numbers must be final).

### [x] 4.4 Final Gate D re-check and Gate E close-out
- Run `npm test`, `npm run typecheck`, `npm run build` one more time on the fully-documented tree.
- Run `compendio eval` on `ejemplos/` (or the equivalent `EvaluateSearch` invocation) and confirm
  hybrid recall@5 = 1.00, MRR = 0.943 — identity, not a tolerance band (Gate D's scope-falsifier
  bullet). Any movement means the change breached its declared scope and must be investigated
  before closing.
- Re-confirm the blast-radius diff-check from 1.6 still holds now that docs were added: exactly one
  test file changed (`test/domain/match-location.test.ts`), one production file changed
  (`src/domain/match-location.ts`), plus the expected non-code files (`scripts/word-boundary-
  probe.mjs` new, `AGENTS.md`, `specs/mcp-contract/spec.md`). No other `src/`/`test/` file may
  appear in the diff.
- Sequential, last task.

## Review Workload Forecast

| Driver | Production | Tests | Probe/script | Docs |
|---|---|---|---|---|
| `match-location.ts` predicate + doc comment (1.5) | ~20-30 | — | — | — |
| Canary inversion (1.1) | — | ~15-20 | — | — |
| New boundary-class unit tests (1.2) | — | ~40-60 | — | — |
| NFD fixture test + precondition assertion (1.3) | — | ~25-35 | — | — |
| `scripts/word-boundary-probe.mjs` (2.1) | — | — | ~200-260 | — |
| `mcp-contract/spec.md` delta | — | — | — | already ~130 (existing file) |
| `AGENTS.md` bullet + manual-gate section (4.2, 4.3) | — | — | — | ~55-75 |
| `verify-report.md` (measurement transcripts, W0-W5 tables, 3 RED transcripts) | — | — | — | ~90-140 |

**Estimated total changed/added lines: ~445-620**, driven almost entirely by the probe
(200-260 lines, consistent with the proposal's own 180-220 estimate plus the five-message/digest/
vacuity-guard hardening this task list adds explicitly) and by the verify-report transcripts, which
the proposal's own delivery-size table does not itemize at all (it stops at the spec/AGENTS.md
diff and never counts `verify-report.md`, even though Gate C alone requires three separate
transcript captures plus a W5 before/after excerpt-pair dump).

This is **higher than the proposal's own 385-425 estimate**, and consistent with this project's
documented pattern of the forecast growing at each phase (`bounded-chunk-size`: 240-420 at explore →
555-695 at tasks → 773 actual). Do not treat 385-425 as a ceiling.

**Budget risk: Medium-to-High**, leaning High if `verify-report.md`'s transcripts are counted
against the 400-line PR budget (they usually are not counted the same as code by reviewers, but the
proposal itself does not exclude them, and `openspec/config.yaml`'s size-exception convention is
already anticipated by the proposal's own Delivery size section).

**Chain strategy recommendation**: single PR, with an accepted `size:exception`, per the proposal's
own stated preference — splitting the probe (the falsifying gate) into a second PR would ship the
predicate change without its own RED-verified gate, which is the exact anti-pattern
`retrieval-open-work.md:218-222` names. If the orchestrator's `delivery_strategy: ask-on-risk`
triggers a stop here, the question to ask is specifically: **accept `size:exception` on a single
PR, or split with the explicit, named risk of a temporarily ungated production change on the first
PR?** — not a menu, one binary choice, matching the proposal's own framing.
