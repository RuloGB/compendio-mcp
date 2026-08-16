# Design: One Regex Literal, and the Corpus That Makes It Falsifiable

**Phase**: design · **Artifact store**: openspec (file-based) · **Skill resolution**: paths-injected
(`sdd-design`, `_shared/sdd-phase-common`)

**The production change is one line.** `flatten-map.ts:35`'s
`` /```[^`]*```/g `` becomes `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, still handed to the same
`trackedReplace(flat, regex, (m) => singleSpaceAt(flat, m.index))` call. Nothing else in `src/` moves.
The proposal already resolved that; this document owns everything around it.

**Everything expensive here is verification, and that is deliberate.** M2 measured **zero** real `~~~`
fences anywhere in this repository, so the corpus half of Gate 1 has nothing to falsify against.
A gate that cannot fail is this repo's recorded failure mode (`memory: agentes que reportan verde en
falso`), not a formality. So the design's centre of mass is D5 (what the fixture corpus contains, down
to its line endings) and D6 (a probe whose anti-vacuity guard is itself verified against a
known-empty corpus).

This is the third cycle in the `read-doc-fence-aware-sections` → `excerpt-fence-aware-flatten` →
**this** lineage. Two things invert relative to the sibling: the fence's *interior* is now dropped
rather than retained (D3's reason the two changes are not copies of each other), and the golden
reference is a passenger here rather than the first-class deliverable it was there (D3).

## Approach at a glance

```
buildExcerpt(chunk.content)                                  excerpt.ts:56   unchanged
  ├─ pass 1  flattenWithMap(raw, true)                       excerpt.ts:61   unchanged
  │     S1 stripHeadingLines(raw)             flatten-map.ts:31   unchanged, ZERO-LINE
  │     S2 /```[^`]*```/g -> " "              flatten-map.ts:35   <-- THE ONLY PRODUCTION EDIT
  │     S3-S6                                                     unchanged
  ├─ if pass 1 is ""  -> pass 2 flattenWithMap(raw, false)   excerpt.ts:68   unchanged
  └─ window / ellipsis                                       excerpt.ts:71-82 unchanged

src/domain/split-text.ts  isFenceDelimiter (:98)   NOT imported by S2. ZERO-LINE DIFF, asserted
src/application/read-document.ts                   ZERO-LINE DIFF, asserted
```

| Question this design owns | Answer | Where |
|---|---|---|
| Why alternation and not a backreference | Traced here, rejected — it invents a *third* fence rule | D1 |
| What `*?` does to adjacent and nested fences | Correct; one new named non-guarantee for interleaved | D2 |
| The `referenceFlatten` mirror | One line, textually duplicated, argument inherited | D3 |
| The assertion that pins today's defect | Inverted, with a three-state comment chain | D4 |
| The fixture corpus, file by file, EOL by EOL | Five documents, two of them CRLF, `.gitattributes` required | D5 |
| The probe, and how the probe itself is verified | Anti-vacuity guard run against a known-empty corpus | D6 |
| The balanced-parity divergence | Accepted; exact `CLAUDE.md` wording given | D7 |
| `isFenceDelimiter`'s relocation, third occurrence | Deferred, re-recorded; exact wording given | D8 |
| Size | **465-720, over budget** — a real cut exists, contrary to the proposal | D9 |

## Architecture Decisions

### D1 — The backreference form: traced, then rejected, on a non-behavioural ground

The exploration left `` /(```+|~~~+)[\s\S]*?\1/g `` **UNEVALUATED**, and the proposal forbade adopting
it without CRLF and mixed-fence tracing. Evaluated here rather than left open. **Evidence label:
INFERRED** — this design phase had no `Bash` tool, so the traces below are hand-executed against the
regex grammar, not run. That labelling is itself part of the decision (point 3).

| Input (post-S1, single line) | Alternation | Backreference | Same? |
|---|---|---|---|
| `` ```js x ``` `` (LF) | drops whole fence | drops whole fence | yes |
| `` ```js\r x\r ```\r `` (CRLF) | drops; `[\s\S]` eats `\r`, no anchor anywhere | identical, `\1` is a literal backtick run | **yes** |
| `~~~json { } ~~~` | branch 2 matches at pos 0 | branch 2 captures `~~~`, finds its twin | yes |
| **Backtick fence inside a tilde fence** `` ~~~md ```js x ``` ~~~ `` | at pos 0 branch 1 fails, branch 2 matches to the final `~~~` — whole outer fence dropped | identical | **yes** |
| **Tilde fence inside a backtick fence** `` ```md ~~~js x ~~~ ``` `` | branch 1 matches to the closing backtick run — whole outer fence dropped | identical | **yes** |
| Interior backtick `` ```js # odd ` tick ``` `` | drops (the fix) | drops | yes |
| **4-backtick fence** ` ````js x ```` ` | matches opener's first 3 through closer's first 3; **one stray backtick each side survives**, blanked to a space by S3 | matches the runs exactly, no residue | **no** |

The only divergence in seven traced shapes is the last row, and it is where the backreference looks
*better*. It is rejected anyway, for three reasons in increasing weight:

1. **Cosmetic gain only.** S3 (`` /[`*_>|]/g `` → space, `flatten-map.ts:39`) blanks the alternation
   form's residue on the very next step. The user-visible excerpt is identical.
2. **It invents a third fence rule.** `\1` demands the closer run be **exactly** as long as the opener.
   `isFenceDelimiter` checks run length **not at all** (`split-text.ts:88-96`, verbatim: *"does not
   check fence-character run length… one shared, imperfect definition… keeps every consumer agreeing
   with the chunker"*). CommonMark demands closer **≥** opener. Exact-equality is neither. Adopting it
   would make S2 disagree with both the chunker and the spec — strictly worse than the proposal's
   Out-of-Scope row, which only declined to be *more* correct.
3. **It has zero executed evidence.** `exploration.md` §8/M1 executed the **alternation** form on seven
   inputs. Swapping literals in design demotes the change's central claim from MEASURED to INFERRED —
   this document's own traces — for a residue S3 already erases. That trade is not available under this
   project's evidence discipline.

**Recorded, not silently dropped**: the backreference is now EVALUATED-and-REJECTED, with the trace
above and the exact-length reason. It is no longer an open item for a fourth cycle.

### D2 — `*?` on adjacent and nested fences: three correct, one new non-guarantee

**`*?` is load-bearing, not stylistic.** A greedy `[\s\S]*` would match from a chunk's *first*
delimiter to its *last*, merging every fence and deleting all the prose between them — a silent
content-loss defect that no invariant catches (I1-I3 hold happily on a wrong string) and that I4
**cannot** catch either, because `referenceFlatten` carries the same literal (D3). It therefore needs
one explicit content assertion outside the golden-reference suite; that assertion is named in Testing
Strategy, Gate 3b.

| Shape | Trace | Verdict |
|---|---|---|
| **Two adjacent same-kind fences**, prose between: `` ```a``` p ```b``` `` | exec 1 stops at the *nearest* closer (fence A). `lastIndex` advances past it; exec 2 matches fence B. `p` survives | **Correct.** This is M1's measured row 3 |
| **Backtick fence nested in a tilde fence** (legal CommonMark) | outer `~~~` pair matched whole; the inner fence is consumed as content of the outer | **Correct** — a nested fence *is* the outer fence's content |
| **Tilde fence nested in a backtick fence** | mirror image, same reasoning | **Correct** |
| **Interleaved, improperly nested**: `~~~ a ``` b ~~~ c ``` ` | at pos 0 branch 2 matches `~~~ a ``` b ~~~`; the trailing `` c ``` `` is left as text, its backticks blanked by S3 | **Acceptable-but-imperfect. NEW named non-guarantee.** The input is malformed markdown; nothing that should survive is deleted |
| **Odd delimiter count** (three `` ``` `` in one chunk) | nearest pair dropped, the third left as text, blanked by S3 | This is D7's balanced-parity divergence, not a separate item |

The interleaved shape is the change's **only** new non-guarantee. It joins — it does not replace — the
four shapes already documented for S1 and `read_doc`.

### D3 — The `referenceFlatten` mirror stays a textual duplicate

The exact edit, `test/domain/flatten-map.test.ts:32`:

```ts
  const body = dropFencedBlocks
-   ? withoutHeadings.replace(/```[^`]*```/g, " ")
+   ? withoutHeadings.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    : withoutHeadings;
```

Byte-identical literal to production's, **including branch order** — alternation is leftmost-first at
each position, so a reference that tried `~~~` first could diverge from production on D2's interleaved
shape and turn I4 red for a reason that has nothing to do with the map machinery.

**The sibling's D4 argument is inherited, not overturned**, and the distinction it drew is exactly why:

| Thing | Sibling's ruling | Applies here? |
|---|---|---|
| `isFenceDelimiter` — shared **policy**, three consumers, own unit tests | import it, don't re-copy | unchanged; S2 still never imports it |
| `stripHeadingLines` — the **loop under test** | never import: I4 would become a tautology | unchanged |
| S2's regex — a **local literal of one step**, no other consumer | already duplicated at `:32` today | **keep duplicating** |

Exporting the literal from `flatten-map.ts` to share it would add this change's first new exported
symbol, contradicting the proposal's *"zero new exported symbols"*, and would make I4 blind to an
asymmetric typo — which is the one class of error duplication actually detects. What duplication
cannot detect is a *symmetric* mistake (both literals made greedy); Gate 3b covers that instead.

**Ordering under `strict_tdd: true`, decided here so `sdd-tasks` does not guess**: unlike the sibling,
I4 is **not** the red-first discriminator. Editing `referenceFlatten` alone turns I4 red only for the
odd-backtick fixture; editing production alone turns it red for the same one. Either order is one
commit's worth of red. The red-first artefacts that matter here are **Gate 1's probe** (D6) and
**Gate 2's inverted assertion** (D4), both of which must be observed failing on the unmodified tree.

### D4 — The pinned defect assertion, inverted with a why that resists repair

`test/domain/excerpt.test.ts:259-269` currently asserts the defect as accepted behaviour:

```ts
expect(withFencesExcluded).toBe(flattenWithMap(markdown, false).text);
```

Traced post-fix on that exact input (`:260-261`): S1 keeps every line (2 delimiters, balanced),
producing `` Before text.  ```js # a comment with an odd ` backtick const x = 1; ```  After text. ``;
S2's `[\s\S]*?` now crosses the lone interior backtick and stops at the closer, so the whole fence
collapses to one space. **Required new body** (the `it` title changes with it — the test is no longer
measurement-only):

```ts
it("the interior-backtick fence is dropped from the excluded pass (was: the pinned defect)", () => {
  const markdown =
    "Before text.\n\n```js\n# a comment with an odd ` backtick\nconst x = 1;\n```\n\nAfter text.";

  const withFencesExcluded = flattenWithMap(markdown, true).text;
  const withFencesIncluded = flattenWithMap(markdown, false).text;

  expect(withFencesExcluded).toBe("Before text. After text.");
  // The two passes must now DIVERGE. Asserted separately from the toBe above
  // because equality was the defect's signature, and this is the line a
  // future reader is most likely to try to "repair".
  expect(withFencesExcluded).not.toBe(withFencesIncluded);
  for (const leaked of ["js", "# a comment with an odd", "const x = 1;"]) {
    expect(withFencesExcluded).not.toContain(leaked);
  }
});
```

**Comment requirement, mandatory and specified rather than left to taste.** The 15-line verbatim block
at `:235-258` is **extended to a third recorded state, not deleted** — the before/after chain is the
artefact:

```
//   BEFORE `excerpt-fence-aware-flatten` (fence-blind S1) ...........  [keep verbatim]
//   AFTER  `excerpt-fence-aware-flatten` (fence-aware S1, S2 unpaired)  [keep verbatim]
//   AFTER  `excerpt-fence-drop-generalization` (S2 crosses the interior
//   backtick and pairs on the nearest real closer):
//     dropFencedBlocks: true  -> "Before text. After text."
//     dropFencedBlocks: false -> "Before text. js # a comment with an odd backtick const x = 1; After text."
//
// DO NOT "REPAIR" THIS BY REVERTING flatten-map.ts:35. The equality this
// test used to assert WAS the defect (S2 made zero replacements). Its
// divergence is the fix working. See excerpt-fence-drop-generalization.
```

**The two — and only two — permitted existing-assertion changes in the whole diff, as designed here**,
enumerated so Gate 4's tripwire is checkable mechanically:

1. `test/domain/flatten-map.test.ts:32` — `referenceFlatten`'s S2 literal (D3).
2. `test/domain/excerpt.test.ts:268` — this assertion, with its `it` title and its `:235-258` comment
   block.

**Amended during `sdd-apply` (2026-08-16): this design missed a third.** Applying D1's chosen regex
broke `test/domain/excerpt.test.ts:198-218` — the sibling `excerpt-fence-aware-flatten` cycle's own
"D3" test, which isolated S1's map-locatability claim from S2's fence-drop behaviour by using a `~~~`
fence specifically because S2's old regex was backtick-only. That isolation trick depends entirely on
some fence style staying invisible to S2; once S2 recognizes every style, no such fence exists (traced
and confirmed at apply time: an unterminated fence flips `balanced` false and strips the line from the
other direction, an indented block has no delimiter to retain it under — there is no third shape).
`sdd-apply` stopped and reported this per its HARD REQUIREMENT #4 rather than patching silently; the
orchestrator independently verified the trace and the user decided to rewrite the test to observe its
claim via `flattenWithMap`/`toFlatOffset` directly and record the consequence (the sibling's D3
guarantee is now pass-scoped to the fenced-blocks-included fallback pass only — see the shipped
`mcp-contract/spec.md` MODIFIED requirement and `CLAUDE.md`'s S2 bullet). **The permitted set is now
three**: the two above, plus `test/domain/excerpt.test.ts:198-218`. A fourth still means stop and
report — this amendment does not relax that discipline, it corrects an incomplete enumeration.

Everything else is an addition. In particular `excerpt.test.ts:220-233` (the sibling's Gate 2,
`toBe("Prose before. Prose after.")`) **must pass unmodified** — traced: its python fence carries no
interior backtick, so old and new literals match the same span. If it moves, `[\s\S]*?` is matching
across a boundary the old class respected, which is Gate 3's falsification.

### D5 — The fixture corpus, and why two of its files must be CRLF on disk

**Decision made by the user, not re-opened**: a dedicated `test/fixtures/excerpt-fence-drop/docs/`,
following `test/fixtures/excerpt-window/docs/`'s precedent (5 documents, no config file, zero-config
`loose` mode, so every indexed path is prefixed `docs/`).

Two constraints bind every file: each must be a **mixed** chunk (prose, fence, prose) — an all-fenced
document strips to empty, `excerpt.ts:68`'s fallback fires and the fixture measures nothing (proposal,
"one nuance that bounds the win") — and each must stay **one chunk** (well under `maxTokens: 480`), so
"chunk-local" reasoning is exact rather than approximate.

| File | EOL | What it proves | Before the fix |
|---|---|---|---|
| `tilde-fence.md` | LF | Symptom 1. `~~~json` config example between two prose paragraphs | `~~~json` + body visible in the `true` pass |
| `tilde-fence-crlf.md` | **CRLF** | Symptom 1 **under CRLF** — the half that is otherwise assumed, never tested | same, plus `\r` survives indexing |
| `interior-backtick-fence.md` | LF | Symptom 2 on a document, not a string literal: a `sh` fence whose body carries one stray backtick in a comment | whole fence leaks; `true` output byte-identical to `false` |
| `interior-backtick-fence-crlf.md` | **CRLF** | Symptom 2 under CRLF | same |
| `control-backtick-fence.md` | LF | The common case: a plain fence, no interior backtick, no tilde. **Must be byte-identical before and after** | already dropped correctly |

**`.gitattributes` is REQUIRED, checked rather than assumed.** The repo's `.gitattributes` today
carries exactly one rule — `test/fixtures/vector-reach/** text eol=lf` — with a comment stating why
(*"a Windows checkout under core.autocrlf=true would rewrite every newline to CRLF and silently shift
them"*). There is no `* text=auto`, so **line endings are governed per path or not at all**, and the
CRLF half of this gate would survive or die on each contributor's `core.autocrlf`. `input` (common on
CI images) would normalise the two CRLF fixtures to LF on the way in and the gate would degrade to
LF-only **silently**. Append, last-match-wins:

```
# excerpt-fence-drop's gate corpus encodes line endings AS EVIDENCE. The two
# *-crlf.md documents exist to prove the S2 regex is anchor-free under CRLF;
# an autocrlf=input checkout would normalise them to LF and the CRLF half of
# Gate 1 would pass without ever having run. The rest are pinned to LF so
# "byte-identical before and after" means the same thing on every machine.
test/fixtures/excerpt-fence-drop/** text eol=lf
test/fixtures/excerpt-fence-drop/docs/*-crlf.md text eol=crlf
```

**Belt and braces, because an attribute file is a claim and not a measurement**: the probe (D6) asserts
that the two `*-crlf.md` documents' **stored chunk content** contains `\r\n`. That is stronger than
checking the file on disk — it proves CRLF survived `decode-text.ts`, the parser and chunking, which is
precisely where the `HEADING_LINE` trap bit last cycle.

The fixture is **also** wired for CI, following `excerpt-window`'s stronger precedent
(`test/application/excerpt-window.test.ts` drives its corpus through `buildHarness`, in-memory, no CLI,
no `.compendio/`): add `EXCERPT_FENCE_DROP_DOCS` to `test/helpers/build.ts` and a
`test/application/excerpt-fence-drop.test.ts` asserting the fixture's own preconditions (one chunk
each, `\r\n` present in the two CRLF documents, a `~~~` delimiter present at all) plus the end-to-end
excerpt property. The probe is the *measurement*; the vitest test is what stops the fixture from
rotting in six months. See D9 — this pair is also the natural cut if size forces one.

### D6 — `scripts/excerpt-fence-drop-probe.mjs`, and the guard that guards the guard

Follows `excerpt-flatten-probe.mjs` / `section-lookup.mjs`: imports compiled `dist/`, widens no
production surface, downloads no model.

**Imports** — deliberately only two, and the omission is the point:

```js
import { flattenWithMap } from "../dist/domain/flatten-map.js";
import { SqliteIndexStore } from "../dist/infrastructure/sqlite/sqlite-index-store.js";
```

No `isFenceDelimiter`. The sibling's probe needed it because S1 is predicate-driven; S2 is not, and a
probe that imported the predicate would quietly imply otherwise.

**What it counts**, over every chunk of every document in `<root>/.compendio/compendio.db`:

| # | Count | Role |
|---|---|---|
| **C1** | chunks whose `flattenWithMap(content, true).text` still contains `~~~` | **Gate 1.** > 0 before, **0** after |
| **C2** | chunks whose raw content contains a `~~~` line at all | **Anti-vacuity denominator.** Must be > 0 in *both* runs |
| **C3** | chunks with ≥ 2 fence delimiter runs whose `true` output is byte-identical to their `false` output | **Gate 2** at corpus level. > 0 before, **0** after |
| **C4** | the two `*-crlf.md` documents' stored content contains `\r\n` | CRLF survived checkout **and** indexing |
| **C5** | `control-backtick-fence.md`'s `true` output, printed **verbatim** | Reported, not gated — the before/after diff lives in `verify-report.md`, since one run cannot compare itself to another |

**Asserted self-check — exits non-zero unless C2 > 0 **and** C4 holds **and** C1 === 0 **and**
C3 === 0.** Note the ordering of failure messages: a C2 or C4 failure must print
`GATE IS VACUOUS — fix the corpus, do not touch the regex`, distinct from a C1/C3 failure's
`the fix did not land`. Conflating them is how a vacuous gate gets read as a passing one.

**The verifier is itself verified against a broken state**, which this repo requires and has been burned
for skipping (`memory: agentes que reportan verde en falso` — *"verificar el verificador contra un
estado roto conocido"*). Two observations, both recorded in `verify-report.md`:

```bash
npm run build
node dist/cli.js --root test/fixtures/excerpt-fence-drop index --lexical
node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-fence-drop
#   BEFORE the regex change: MUST exit non-zero, with C1 > 0 and C3 > 0 recorded verbatim
#   AFTER  the regex change: MUST exit 0, with C1 === 0, C3 === 0, C2 unchanged and > 0

# The anti-vacuity guard, proved against a corpus known to contain no fences:
node dist/cli.js --root test/fixtures/excerpt-window index --lexical
node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-window
#   MUST exit non-zero on C2 (and print the VACUOUS message), in BOTH tree states
```

`.compendio/` is already gitignored at any depth, so neither index leaves a tracked artefact.

**What falsifies the change**, stated as numbers:

- **C1 === 0 or C3 === 0 in the "before" run → STOP.** The proposal's stop condition, restated: this is
  *not* the change passing. It means the fixture failed to create the case — a mangled line ending, a
  document that split into two chunks, or a fence that landed in the all-fenced fallback path. Fix the
  fixture and re-run; do **not** proceed to the regex.
- **C2 === 0 in either run → STOP.** The corpus has no tilde fences at all; every other number is noise.
- **C1 > 0 or C3 > 0 in the "after" run** → the regex does not behave inside `trackedReplace` the way
  M1 measured it in isolation. Suspect S1's output (a retained `\r`, a collapsed newline) changing what
  S2 sees. Re-analyze; do not widen the regex further.

### D7 — The balanced-parity divergence, in the same greppable place

`CLAUDE.md` already carries the S1 fence bullets consecutively; this goes **immediately after** the
`excerpt-fence-aware-flatten` bullet, as a new *Non-obvious decisions* entry. Exact wording:

> - **S2's fence drop (`flatten-map.ts:35`) is delimiter-agnostic, interior-agnostic, and — unlike every
>   other fence mechanism in this codebase — NOT balanced-gated** (`excerpt-fence-drop-generalization`).
>   The regex is `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, not the old `` /```[^`]*```/g ``: the old form
>   identified a fence by *character-class exclusion* over a string S1 had already stripped of newlines,
>   which spelled the delimiter in backticks (so a `~~~` fence was **never** dropped from any excerpt,
>   in either pass) and could not cross an interior backtick (so **one** stray backtick inside a fence
>   made the pair unmatchable, leaking the entire fence — delimiters, body and all — into the
>   `dropFencedBlocks: true` excerpt byte-identically to the `false` pass). Both are closed. `*?` is
>   load-bearing: a greedy `[\s\S]*` would match a chunk's first delimiter to its last, merging every
>   fence and deleting the prose between them, and neither I1-I3 nor I4 would notice (I4 carries the
>   same literal by design). **The accepted divergence**: S1, `read_doc`'s `headingsIn` and the chunker
>   all refuse to act on a chunk whose fence-delimiter-line count is ODD; S2 has no such whole-chunk
>   gate and will still drop a well-formed pair inside one, leaving the stray third delimiter as text
>   (S3 then blanks it). So S1 and S2 can now answer "do we trust this chunk's fence state?"
>   **differently for the same chunk**. This is not content loss — strictly more genuinely-fenced
>   content is correctly dropped than before — but it does break the "every mechanism shares one
>   fence-state rule" pattern the two prior cycles established as a value. Closing it would require S2
>   to consult whole-chunk parity before matching, which is the S1-fusion architecture this change
>   exists to avoid. One further non-guarantee, from `*?`'s nearest-closer rule: **improperly
>   interleaved** fences (`~~~ a ``` b ~~~ c ``` `) pair across the two styles and leave a residue.
>   Nesting either way round is handled correctly — the outer fence is consumed whole, which is what a
>   nested fence *is*. The gate corpus is `test/fixtures/excerpt-fence-drop/docs/`, whose two
>   `*-crlf.md` documents are pinned CRLF by `.gitattributes` **on purpose**: the CRLF half of the gate
>   is real evidence only if the line endings survive checkout. Probe:
>   `node scripts/excerpt-fence-drop-probe.mjs test/fixtures/excerpt-fence-drop` (needs
>   `node dist/cli.js --root test/fixtures/excerpt-fence-drop index --lexical` first).

Plus a **surgical amendment** to the existing `excerpt-fence-aware-flatten` bullet: its closing
sentence *"One measured, deliberately unfixed residual risk: … recorded rather than fixed, since fixing
it means designing and CRLF-verifying a second regex for a step (S2) this change deliberately did not
touch"* gains, at its end: **"— closed by `excerpt-fence-drop-generalization`; see the next bullet. The
0-of-21 measurement stands as the reason it was safe to defer, not as a live risk."** The sentence is
amended, never deleted: it is the paper trail.

### D8 — `isFenceDelimiter`'s relocation, third occurrence, deferred again

The trigger from `read-doc-fence-aware-sections`'s Decision 1 (*"move it to its own domain module when
a third consumer appears"*) **does not re-fire here**. This change adds no consumer — S2 never imports
the predicate, and the count stays at three (`split-text.ts` itself, `flatten-map.ts`'s S1,
`read-document.ts`'s `headingsIn`). Deferring is therefore consistent rather than negligent.

**But recording it is a deliverable, not a nicety** — the previous cycle's own lesson, verbatim from
`CLAUDE.md`: *"the previous deferral survived only as one line in an archived change's report and had to
be rediscovered by a whole new SDD cycle."* Amend the existing dedicated bullet by appending:

> **Third occurrence, `excerpt-fence-drop-generalization` (2026-08-16): the trigger did NOT re-fire and
> the deferral stands.** That change touches only S2's regex literal, which never imports the predicate,
> so the consumer count is still exactly three. Recorded here rather than in an archived report for the
> same reason the sentence above exists. **The next thing that adds a fourth importer should move it**
> — three deferrals is the point at which "cheap later" stops being an argument.

`sdd-apply` must append to the existing bullet, not create a second one: the whole value is that all
three occurrences are greppable in one place.

### D9 — Files touched and the size forecast

| File | Action | Forecast (lines) |
|---|---|---|
| `src/domain/flatten-map.ts` | Modify — the regex at `:35` and its quoting `// S2:` comment at `:33` | 2-4 |
| `src/domain/split-text.ts` | **Unchanged — asserted, zero-line diff** | 0 |
| `src/domain/excerpt.ts` | **Unchanged — asserted, zero-line diff** | 0 |
| `src/application/read-document.ts` | **Unchanged — asserted, zero-line diff** | 0 |
| `test/domain/flatten-map.test.ts` | Modify (`:32`, D3) + 5 `GENERATED_INPUTS` fixtures (tilde LF, tilde CRLF, nested both ways, adjacent-fences) + Gate 3b's explicit non-greedy assertion | 45-70 |
| `test/domain/excerpt.test.ts` | Modify (`:235-269`, D4) + tilde-fence and CRLF-tilde cases | 60-95 |
| `test/fixtures/excerpt-fence-drop/docs/*.md` | **New** — 5 documents (D5) | 110-150 |
| `.gitattributes` | Modify — 2 rules + their why-comment (D5) | 6-9 |
| `test/helpers/build.ts` | Modify — `EXCERPT_FENCE_DROP_DOCS` + doc comment | 8-12 |
| `test/application/excerpt-fence-drop.test.ts` | **New** — fixture preconditions + end-to-end excerpt | 70-110 |
| `scripts/excerpt-fence-drop-probe.mjs` | **New** — C1-C5, the two-message self-check, header (D6) | 110-170 |
| `openspec/specs/mcp-contract/spec.md` | **`sdd-spec` owns it** — one new requirement + scenarios | 40-80 |
| `CLAUDE.md` | Modify — one new bullet (D7) + two amendments (D7, D8) | 15-30 |
| **Total** | | **465-720** |

**Decision needed before apply: Yes · Chained PRs recommended: Yes · 400-line budget risk: High.**

**This exceeds ~400 lines and I am saying so explicitly, against the proposal's own estimate.** The
proposal forecast 154-294 and asserted *"there is no natural cut."* Both statements are superseded here,
and the reason is D5/D6, not padding: the proposal priced the gate corpus at 15-40 lines as a single
undecided line item, before it was designed as five documents, a `.gitattributes` contract, a CI-level
precondition test and a probe with a self-verified anti-vacuity guard. This repo's forecasts have run
1.3x-4x low for several cycles (`bounded-chunk-size` 240-420 → 773); even the *low* end here is already
over budget.

**The natural cut exists and `strict_tdd` fixes its direction — the gate must land FIRST, or it can
never be observed red:**

| PR | Contents | Lines | Ships as |
|---|---|---|---|
| **#1 — pin the defect** | `test/fixtures/excerpt-fence-drop/docs/`, `.gitattributes`, `build.ts` constant, `test/application/excerpt-fence-drop.test.ts` **asserting today's leak as current behaviour**, `scripts/excerpt-fence-drop-probe.mjs` with the "before" numbers recorded in its header | 200-350 | An executable, non-vacuous reproduction. Green on the unmodified tree, with the probe's non-zero exit recorded as the measurement it is |
| **#2 — the fix** | `flatten-map.ts:35`, `referenceFlatten:32`, the two `*.test.ts` assertion flips, `mcp-contract` delta, `CLAUDE.md` | 165-290 | The one-line change, against a gate that already proved it can fail |

If the user prefers one PR anyway, the trimming lever — named so `sdd-tasks` does not invent its own —
is **dropping `test/application/excerpt-fence-drop.test.ts` and the `build.ts` constant** (~80-120
lines), folding their preconditions into the probe's self-check. That costs permanent CI protection of
the fixture and keeps the gate manual-only, which is the sibling's status quo, not a regression. **Never
trim the probe, the CRLF fixtures, or the `.gitattributes` rules** — those *are* the change's evidence.

## Testing Strategy

`strict_tdd: true`. Every gate is written first and observed **failing**. No model download for Gates
1-4 (`index --lexical`).

| Gate | Layer | Case | Falsifies |
|---|---|---|---|
| 1 | Manual — `excerpt-fence-drop-probe.mjs` | C1 > 0 and C3 > 0 before, both 0 after, C2 > 0 and C4 true in both | The corpus half. **A "before" 0 is a STOP, not a pass** (D6) |
| 1b | Manual — the same probe against `test/fixtures/excerpt-window` | MUST exit non-zero on C2, in both tree states | The anti-vacuity guard itself. Verifying the verifier |
| 2 | Unit (`excerpt.test.ts`) | D4's inverted assertion: `"Before text. After text."`, passes diverge, none of the three leaked strings present | `[\s\S]*?` not pairing inside the real chain |
| 3 | Unit (`flatten-map.test.ts`) | All 16 existing `GENERATED_INPUTS` byte-identical in both modes **except** the odd-backtick one (`:94-97`); `excerpt.test.ts:220-233` passes unmodified | The scan crossing a boundary the old class respected |
| 3b | Unit, **additive** | Two adjacent same-kind fences with prose between → prose survives, both fences dropped. A direct `toBe`, **not** via `referenceFlatten` | A symmetric greedy typo in both literals, which I4 structurally cannot see (D2/D3) |
| 4 | Unit | I1-I4 over all fixtures old and new, both modes; **exactly three** modified existing assertions in the whole diff (D4, amended during apply — see the note above D4's enumeration); zero-line diffs on `split-text.ts` / `excerpt.ts` / `read-document.ts` | Scope drift |
| 5 | Suite | `npm test`, `npm run typecheck`, `npm run build`; `compendio eval` on `ejemplos/`: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22 | Retrieval movement. `ejemplos/` has neither defect shape, so identity is expected |

## Migration / Rollout

**None.** Excerpts are computed at query time from stored `chunk.content` (`search-documents.ts:128`);
nothing about excerpt computation is persisted. No reindex in either direction, no schema, no DDL, no
`reset()`, no `.compendio/` deletion, no config key, port, response field or path shape. Rollback is
`git revert` + `npm run build`; the only residue is behavioural and immediate.

## Open questions

1. **Delivery shape (D9) needs the user's answer before apply.** Chained PR #1 → #2, or one PR with the
   `excerpt-fence-drop.test.ts` lever pulled. The forecast is 465-720 either way; only the review
   packaging differs.
2. **`sdd-spec` is writing `mcp-contract` in parallel and cannot see D2 or D7.** Its new requirement
   must name the balanced-parity divergence in **S2's** shape (a well-formed pair inside an odd-count
   chunk IS dropped) and must not copy `spec.md:150`'s wording, which describes S1's opposite
   consequence. It should also carry D2's interleaved-fence non-guarantee. If the delta lacks both, it
   over-promises against the implementation.
3. **Proposal Q3 (is `~~~` worth supporting at all) is answered by construction, not by opinion**: the
   tilde branch costs one alternative and the fixture corpus now makes it falsifiable here even though
   the live corpus has none. Recorded so it is not re-asked.
4. **Proposal Q4 (should a leaked-fence excerpt be signalled to the caller) remains unanswered and
   nothing here depends on it.** This change shrinks the population it would apply to — unterminated
   and interleaved fences still leak — without eliminating it.
