# Proposal: One Character Class, Two Excerpt Defects — Generalizing S2's Fence Drop

`flatten-map.ts:35`'s S2 step is `` /```[^`]*```/g ``. Two previously-recorded open items are the
**same defect**, not two: S2 identifies a fence by *character-class exclusion* (`[^`]*`) over a string
from which **S1 has already removed every newline**. That single shape produces both symptoms:

| Symptom | Mechanism, from that one shape |
|---|---|
| **A `~~~` fence is never dropped from any excerpt**, in either pass | The class-exclusion pattern is literally spelled with backticks. A tilde-fenced block contains **zero** backticks, so the regex matches nothing at all |
| **A backtick fence whose interior contains a backtick is never dropped** | `[^`]*` cannot cross a backtick. One stray interior backtick makes the pair unmatchable, so S2 makes **zero** replacements and the whole fence — delimiters, body, everything — leaks into the `dropFencedBlocks: true` ("excluded") excerpt, byte-identical to the `false` pass |

Both were **measured**, not theorized, by the two archived sibling cycles
(`archive/2026-08-15-excerpt-fence-aware-flatten/exploration.md` §0 rows 2-3; that change's design.md
Decision 5), deliberately deferred with their measurements, and recorded in the same greppable
`CLAUDE.md` paragraph. The second one is already a committed test
(`test/domain/excerpt.test.ts:259-269`) that asserts the leak as *current, accepted* behaviour.

This change closes both by widening the class the regex is willing to scan. It is the third cycle in
the same lineage (`read-doc-fence-aware-sections` → `excerpt-fence-aware-flatten` → this), and it
finishes the S2 half the second one explicitly declared out of scope.

## Evidence discipline

The exploration sub-agent ran without `Bash`; §§1-7 are hand-traced static analysis. §8 is the
orchestrator's **executed** addendum. This proposal preserves that split, as the sibling did:

| Label | Meaning |
|---|---|
| **MEASURED** | Executed in `exploration.md` §8, or committed as an existing passing test |
| **DERIVED** | A deduction whose premises are measured, with the deduction shown |
| **INFERRED** | Hand-traced from source. Not executed |

## Intent

### What a caller receives today

A doc mixing prose with a tilde-fenced config example (`exploration.md` §1b, hand-traced):

```
Un proyecto declara sus raíces de documentación así: ~~~json { "docsDir": ["docs", "adr"] } ~~~ Cada raíz aporta su alias como prefijo del path indexado.
```

The raw fence markers and JSON body are delivered as visible prose, **with no `…`** — the tool
contract reads that as a *complete* answer, so the agent is told not to call `read_doc`. At the
120-char `SUPPORTING_EXCERPT_CHARS` budget the damage is worse: a chunk opening with such a fence
spends nearly the whole budget on `~~~json { "docsDir": [...` and carries almost no prose signpost,
defeating the supporting excerpt's documented purpose (`excerpt.ts:12-17`).

The interior-backtick case is identical in kind and is **MEASURED and committed**
(`excerpt.test.ts:249-258`, verbatim from the file):

```
Before text. js # a comment with an odd ` backtick const x = 1; After text.
```

— produced by *both* passes, identically. Fence exclusion is silently off for that chunk.

### Blast radius: every rank, both defects

`dropFencedBlocks` is threaded from exactly one place, `buildExcerpt` (`excerpt.ts:61,68`), whose one
production caller is `SearchDocuments.execute` (`search-documents.ts:128`). Rank changes only
`maxChars` and whether spans are located — **not** flattening. So this affects the lead and every
supporting fragment identically (`exploration.md` §1a).

**One nuance that bounds the win, stated up front**: for a chunk that is *entirely* fenced, the `true`
pass already strips to empty and `excerpt.ts:68`'s fallback takes over — and the fallback never calls
S2 at all. **The user-visible effect is concentrated in *mixed* chunks** (prose + fence), not in pure-code
chunks. This change does not make the all-fenced case better or worse.

### Why now

1. **Both gaps carry executed measurements already**; nothing here is speculative.
2. **The fix is one regex literal.** The cheapest possible closure of a twice-deferred item.
3. **It reaches an existing corpus with no reindex** — excerpts are computed at query time from stored
   chunk content, exactly as the sibling change established.
4. **The paper trail is the whole point.** The previous such item survived only as one archive-report
   line and needed a whole SDD cycle to rediscover. Deferring a third time costs more than fixing.

## Scope

### In Scope

- **One regex literal in production**: `flatten-map.ts:35`'s `` /```[^`]*```/g `` →
  `` /```[\s\S]*?```|~~~[\s\S]*?~~~/g ``, still passed to the same
  `trackedReplace(flat, regex, (m) => singleSpaceAt(flat, m.index))` call.
- **The identical one-line mirror in `referenceFlatten`** (`test/domain/flatten-map.test.ts:32`). I4's
  golden reference hardcodes S2's regex source; the edit is symmetric and one-for-one.
- **A deliberate, documented update to `excerpt.test.ts:259-269`**, whose current assertion pins the
  defect. See "The test that must change on purpose".
- **New fixtures** — a tilde-fence case and an interior-backtick case, added to `GENERATED_INPUTS` so
  they feed both the I1-I3 and I4 suites automatically.
- **New corpus content to make the gate non-vacuous** — see the OPEN QUESTION below; this is the one
  scope item this proposal does *not* decide unilaterally.
- **The balanced-parity divergence written down** as a named, accepted non-guarantee.
- **One `mcp-contract` requirement** (see Capabilities).
- **`CLAUDE.md`**, including re-recording the `isFenceDelimiter` deferral in the same greppable place.

### Out of Scope

| Item | Why it is out |
|---|---|
| **CommonMark's closer-length ≥ opener-length, same-character rule** | The project's stated preference, in `isFenceDelimiter`'s own doc comment (`split-text.ts:88-96`): "one shared, imperfect definition… keeps every consumer agreeing with the chunker, which matters more than any one of them being independently more correct." Implementing it here would make `flatten-map.ts` *more* correct than the chunker it must stay consistent with — the exact trap that comment warns against |
| **S3's unconditional `` [`*_>|] `` blanking** | Pre-existing, orthogonal, deliberate |
| **`read_doc`'s `headingsIn` / `read-document.ts`** | The first sibling's territory. A diff there means scope moved |
| **`stripHeadingLines` (S1) and `isFenceDelimiter`** | The chosen candidate never touches or imports either. Zero-line diffs, asserted |
| **Closing the balanced-parity divergence** | Would require S2 to consult whole-chunk delimiter parity before matching — which re-introduces the architecture change this candidate exists to avoid. Recording it is in scope; closing it is not |
| **The backreference form** `` /(```+|~~~+)[\s\S]*?\1/g `` | **Recorded as UNEVALUATED, not rejected.** It was never traced under CRLF or against mixed-fence content. It must not be adopted in `sdd-design` without the same verbatim-trace treatment the two-alternative form received |
| **Migrations, schema markers, shims** | Beta, no installed users (`config.yaml` `rules.proposal`). Nothing here is persisted |

## Approach

### The chosen candidate (exploration 3b), and the two rejected ones

```ts
// before
flat = trackedReplace(flat, /```[^`]*```/g, (m) => singleSpaceAt(flat, m.index));
// after
flat = trackedReplace(flat, /```[\s\S]*?```|~~~[\s\S]*?~~~/g, (m) => singleSpaceAt(flat, m.index));
```

The `~~~` alternative fixes symptom 1. Swapping the negated class `[^`]*` for the non-greedy
any-character `[\s\S]*?` fixes symptom 2: the scan now crosses an interior backtick and stops at the
*nearest* real closing run.

| Rejected candidate | Reasoning (from `exploration.md` §3) |
|---|---|
| **(a) A separate, post-S1, `isFenceDelimiter`-driven line-based removal** | **Not implementable as scoped, and that finding is itself load-bearing.** `isFenceDelimiter` is line-anchored (`/^\s*(```\|~~~)/`) — it must see where a line *starts*. But S1 has already collapsed every `"\n"` into a synthesized `" "` before S2 runs, so by then the chunk is one line with no newlines left. Applied there, the predicate could only ever test the very start of the whole string. It can only be used while line structure still exists — which means fusing it into S1, i.e. candidate (c) |
| **(c) Fuse the fence drop into `stripHeadingLines`** | Correct and arguably more principled, but: it needs a **new multi-line-collapse map-emission shape** S1 has never had; it needs `dropFencedBlocks` threaded into a function whose doc comment scopes it to heading suppression only; it must explicitly special-case the `false` pass so one function cleanly does two jobs; and it requires the **same order-of-magnitude `referenceFlatten` rewrite the previous cycle already paid once** for the heading half. Effort Medium-High versus Low, for the same two symptoms |

### Why the invariants come for free — the decisive argument

I1 (`map.length === text.length`), I2 (non-decreasing), I3 (verbatim-or-space) are enforced
**generically** by `trackedReplace` (`flatten-map.ts:141-172`) for *any* match set and *any*
replacement shape — the previous cycle's design.md D3 already argued this once. This candidate changes
**only which substrings the regex matches**, never how matches are replaced, so it inherits that
argument unmodified. **Zero new invariant reasoning.** Candidates (a)/(c) would each need new
map-tracking machinery. This is the single biggest differentiator between them.

### MEASURED — old vs new regex, seven cases

`exploration.md` §8/M1, executed on this repo's Node floor, replacing each pattern with `" "`:

| Input shape | Old `` /```[^`]*```/g `` | New `` /```[\s\S]*?```\|~~~[\s\S]*?~~~/g `` | Verdict |
|---|---|---|---|
| Plain backtick fence (LF) | dropped | dropped | **unchanged** |
| Plain backtick fence (CRLF) | dropped | dropped | **unchanged** |
| Two fences + an inline-code span between them | both dropped, span kept | both dropped, span kept | **unchanged** |
| Unterminated fence (no closer) | not dropped | not dropped | **unchanged** |
| Interior-backtick fence | **not dropped** (leaks whole fence) | dropped | **fixes symptom 2** |
| Tilde fence (LF) | **not dropped** | dropped | **fixes symptom 1** |
| Tilde fence (CRLF) | **not dropped** | dropped | **fixed, CRLF-safe** |

Three things this table settles as MEASURED rather than argued: the common case is **byte-identical**
before and after; the change is **CRLF-safe**; and the unterminated fence is **left exactly alone**.
What it does **not** exercise is `trackedReplace`'s I1-I4 map invariants — that is the test suite's
job, not this probe's.

### CRLF: inherited immunity, not new reasoning

Neither the old nor the new pattern carries a `^`/`$` anchor — both are pure substring searches over
`flat.text`. Any `\r` left on a kept line by `split("\n")` survives into `flat.text`, and `[\s\S]`
matches it like any other character. **This change widens a character class; it adds no anchor**, so
it inherits the immunity the sibling exploration already established. Confirmed by M1's two CRLF rows.
The house rule from `CLAUDE.md`'s `HEADING_LINE` bullet still binds any *new* regex: **anchor-free and
prefix-only, always.**

### The accepted non-guarantee: S1 and S2 may now disagree about fence trust

Consider a chunk with **three** delimiters — `D1` (open), `D2` (close, a genuinely well-formed pair),
and a stray `D3` (an opener continuing into a later chunk):

- **S1 and `read_doc`'s `headingsIn`** see an *odd* count, declare the chunk's fence state untrusted,
  and touch **nothing** (`balanced === false`).
- **The new S2** has no whole-chunk gate. It finds and drops the well-formed `D1`–`D2` pair, leaving
  `D3` as leftover text.

**This is not a content-safety regression** — nothing that should survive is deleted; if anything,
*more* genuinely-fenced content is correctly dropped than today. But it **breaks the pattern the last
two cycles established as a value**: that every mechanism here evaluates chunk-local fence state
through the same balanced-count rule (`CLAUDE.md`'s `isFenceDelimiter`-sharing bullets). S1 and S2 can
now answer "do we trust this chunk's fence state?" differently for the same chunk.

**Closing it is explicitly out of scope**, and the reason is structural, not budgetary: S2 would have
to consult whole-chunk delimiter parity before matching, which is candidate (c)'s architecture change
under another name — the exact cost this candidate exists to avoid. It is recorded, named, and
accepted, in the shape `CLAUDE.md` already has a template for.

### The vacuous-gate problem — a first-class scope item

**MEASURED** (`exploration.md` §8/M2): `grep -rn '^\s*~~~'` returns **zero matches in `docs/`, and zero
matches anywhere in this repository** — not `test/fixtures/`, not `openspec/specs/`, not source. Every
`~~~` an unanchored grep finds is prose *about* fences. This is **stronger than** §6's inferred claim
that tilde fences "appear in test fixtures, specs, and `split-text.ts`'s doc comment." They do not
appear as fences at all.

**A count of 0 is not evidence the gate passes — it means there is nothing to falsify.** Without new
content, the corpus-driven half of the gate passes vacuously and this change ships with a
verification that cannot fail. That is precisely the failure mode this repo's memory records under
"agents that report green in false."

The exploration named two fixes and deliberately deferred the choice to this phase:

| Option | Argument for | Argument against |
|---|---|---|
| **(i) Dedicated fixture directory** `test/fixtures/excerpt-fence-drop/docs/` | Follows `test/fixtures/excerpt-window/docs/`'s existing precedent (5 files, same shape). Cheap, isolated, **zero risk to the live corpus**, no CRLF entanglement | Weaker proof: a hand-built fixture is a case we invented for ourselves, not a case the project actually has |
| **(ii) Extend `docs/documentation-convention.md`** with a tilde-fenced example | **The stronger proof**, and it continues the exact self-referential "live case on this repository's own corpus" pattern both prior cycles maintained — that framing is what made those changes credible | It mutates the **live corpus**, and that specific file is **CRLF-encoded** and is already the fixture for **two prior manual gates** (`section-lookup.mjs`'s before/after table and this change lineage's Scenario 6). Editing it risks perturbing measurements two archived cycles depend on |

**Recommendation: (i), the dedicated fixture directory, plus keeping the corpus-wide `~~~` count as a
reported-not-gated measurement.** The reasoning: option (ii)'s strength is that it proves the defect on
*real* content — but there is no real tilde-fenced content, so (ii) would mean *authoring* a tilde
fence into a live document purely to have something to test against, which is a hand-built case wearing
a live-corpus costume. It buys the appearance of the self-referential proof without its substance, and
it pays for that appearance by disturbing the single most measurement-entangled file in the repository.
Option (i) is honest about what it is.

**This is the user's call, not ours** — it edits either the test tree or the live corpus. See OPEN
QUESTION 1.

### The test that must change on purpose

`test/domain/excerpt.test.ts:259-269` is a Gate-4 measurement-only test from the previous cycle. Its
one assertion is:

```ts
expect(withFencesExcluded).toBe(flattenWithMap(markdown, false).text);
```

— i.e. it **pins the interior-backtick defect**: the `true` pass must equal the `false` pass, because
S2 makes zero replacements. **After this fix they diverge**, and that test fails. That is the fix
working, not a regression.

Required, intentional handling, decided here so `sdd-tasks` does not have to guess:

- The assertion **must be inverted and re-commented**, with the 15-line verbatim measurement block
  above it (`:244-258`) updated to a third recorded state, preserving the before/after chain rather
  than deleting it.
- The new expectation is a **positive** one: the `true` pass excludes the fence entirely, and the two
  passes differ.
- **This is a known, intended test change, flagged at proposal level** — not an incidental one. The
  risk it exists to prevent is real and has happened in this repo before: someone reads the red test as
  "the fix broke a passing test" and reverts the regex.

`referenceFlatten`'s line 32 is the *other* deliberate change, and it is one-for-one symmetric. Every
existing `GENERATED_INPUTS` fixture — including the odd-backtick one at `:94-97` — stays automatically
covered by I4 with no new fixture required for I4 to remain meaningful.

## Capabilities

### New Capabilities

- None. This is a defect inside `search_docs`'s existing excerpt construction.

### Modified Capabilities

- **`mcp-contract`** — one **new** requirement: fenced content MUST be excluded from a `search_docs`
  excerpt's fenced-blocks-excluded pass regardless of which delimiter style (` ``` ` or `~~~`) opens
  the fence, and regardless of whether the fence's interior contains a backtick.

  Checked against the neighbouring requirements' actual text, not assumed new:

  | Existing requirement (`openspec/specs/mcp-contract/spec.md`) | Why it does not cover this |
  |---|---|
  | *A Heading-Pattern Line Inside a Fenced Code Block Is Not Stripped From a `search_docs` Excerpt* (`:135`) | The immediate sibling. Governs S1's **retention** of heading-pattern lines. Its scenario at `:172` already assumes a fence "with **no interior backtick**" — that qualifier is exactly the gap this change closes, and it should be **left in place**, since it stays true |
  | *A Heading Line Inside a Fenced Code Block Is Not an Addressable Section* (`:87`) | `read_doc`'s territory, self-scoped at `:97`. **Not edited** |
  | *Graduated Excerpt Budget* (`:403`), *Lead Excerpt Is a Window* (`:417`), *Supporting Excerpts* (`:430`), *Truncation Is Marked* (`:446`) | Govern **how much** excerpt and **where** the window sits. None governs which text the flatten chain removes before windowing. An excerpt full of leaked fence content satisfies all four |

  The new requirement MUST carry the balanced-parity divergence as a named non-guarantee, and MUST NOT
  copy `:150`'s wording for it — that text describes S1's shape-4 consequence, which is different from
  S2's.

- **`indexing`** — **no delta, asserted.** An `indexing` delta in `sdd-spec`'s output means the change
  drifted.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/flatten-map.ts:35` | Modified | One regex literal, plus its `// S2:` comment at `:33` which quotes the old pattern |
| `src/domain/split-text.ts` | **Unchanged — asserted** | `isFenceDelimiter` is neither imported nor touched by this change |
| `src/domain/excerpt.ts` | **Unchanged — asserted** | Two-pass fallback, budgets, windowing, ellipsis all untouched |
| `src/application/read-document.ts` | **Unchanged — asserted** | A diff here means scope moved |
| `test/domain/flatten-map.test.ts:32` | **Modified — deliberately** | `referenceFlatten`'s S2 line, mirrored one-for-one; plus new `GENERATED_INPUTS` fixtures |
| `test/domain/excerpt.test.ts:235-269` | **Modified — deliberately** | The pinned Gate-4 assertion inverted and re-commented (see above) |
| `test/fixtures/excerpt-fence-drop/docs/` | Possibly added | Only under OPEN QUESTION 1 option (i) |
| `docs/documentation-convention.md` | Possibly modified | Only under OPEN QUESTION 1 option (ii). **CRLF-encoded; fixture for two prior manual gates** |
| `scripts/excerpt-fence-drop-probe.mjs` | Added | Direct-drive probe in the `excerpt-flatten-probe.mjs` shape. No model download |
| `openspec/specs/mcp-contract/spec.md` | Modified | One new requirement + scenarios. No existing requirement edited |
| `CLAUDE.md` | Modified | The `excerpt-fence-aware-flatten` bullet's S2 follow-up sentence becomes "closed by `excerpt-fence-drop-generalization`"; the new balanced-parity non-guarantee is recorded; the `isFenceDelimiter` deferral is re-recorded in the same greppable place |

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement
contradicting the reasoning — not on a tolerance band (`CLAUDE.md`, Gate 2 of `bounded-chunk-size`).
`strict_tdd: true` applies: every gate is written first and observed **failing** on the current tree.
**A gate that passes unfixed is not measuring what it claims** — and given M2's zero-tilde-fence count,
that is this change's single likeliest failure mode.

**No model download for any gate.** `index --lexical` exists (`src/cli.ts:37`).

### Gate 1 — Tilde fences leave the excluded pass entirely (BLOCKING)

- [ ] **Before**: over the gate corpus (whatever OPEN QUESTION 1 resolves to), the count of tilde-fence
      content surviving into `dropFencedBlocks: true` output is **> 0**, recorded verbatim.
- [ ] **After**: that count is **0**.

**FALSIFICATION**: a "before" count of **0** means the gate corpus contains no tilde fence and the gate
is vacuous — **stop and fix the corpus, do not proceed**. An "after" count **> 0** means the regex does
not do what M1 measured in isolation, and the `trackedReplace` integration is the suspect.

### Gate 2 — The interior-backtick fence stops leaking (BLOCKING)

- [ ] **Before**: for `excerpt.test.ts:261`'s exact input, `dropFencedBlocks: true` output is
      byte-identical to the `false` output (today's committed, passing assertion).
- [ ] **After**: the two **differ**, and the `true` pass contains none of
      `js`, `# a comment with an odd`, `const x = 1;`.

**FALSIFICATION**: if the two passes still produce identical output, `[\s\S]*?` did not fix the pairing
in the real chain even though M1 says it does in isolation — meaning something upstream (S1's retained
line, a `\r`) changes what S2 actually sees. Stop and re-analyze.

### Gate 3 — The common case is byte-identical (BLOCKING)

- [ ] Every one of the 16 existing `GENERATED_INPUTS` fixtures produces **byte-identical** `flattenWithMap`
      output before and after, in both modes, **except** the odd-backtick one (`:94-97`).

**FALSIFICATION**: any other fixture moving means the non-greedy scan is matching across a boundary the
old pattern respected. Stop — the change is wider than M1's seven cases showed.

### Gate 4 — Invariants and the whole suite (BLOCKING)

- [ ] I1-I4 hold for every fixture, old and new, in both modes.
- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.
- [ ] **The only modified existing test assertions in the whole diff are `referenceFlatten:32` and
      `excerpt.test.ts:268`.** Any third one is a tripwire.
- [ ] `split-text.ts`, `excerpt.ts` and `read-document.ts` carry **zero-line diffs**.

### Gate 5 — Retrieval unmoved

- [ ] `compendio eval` on `ejemplos/`: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22. `ejemplos/` has no
      tilde fences and no interior-backtick fences, so identity is the expected result.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The gate ships vacuous** — zero tilde fences to falsify against, so Gate 1 passes without being able to fail | **High** | Gate 1's falsification clause makes a "before" count of 0 a **stop condition**, not a pass. OPEN QUESTION 1 forces the corpus decision before `sdd-spec` |
| **The pinned Gate-4 assertion at `excerpt.test.ts:268` is "repaired" by reverting the regex**, because it reads as the fix breaking a passing test | **High** | Named at proposal level with the required handling spelled out. Gate 4's third bullet makes it one of exactly two permitted existing-assertion changes |
| **`[\s\S]*?` matches across a boundary the old class respected**, in a shape M1's seven cases missed | Med | Gate 3's byte-identity assertion across all 16 existing fixtures, in both modes |
| **The balanced-parity divergence is later reported as a regression** | Med | Named here, in the spec requirement, and in `CLAUDE.md`, with its direction (drops *more* correctly, never deletes what should survive) stated explicitly |
| **Option (ii) perturbs `docs/documentation-convention.md`'s prior gate measurements** | Med (only if (ii) chosen) | Recommendation is (i). If (ii) wins, `sdd-design` must re-run `scripts/section-lookup.mjs`'s before/after table and record the new numbers |
| **The backreference alternative is adopted in design as "obviously equivalent"** | Low | Recorded in Out of Scope as **UNEVALUATED, not rejected**, with the specific evidence missing (CRLF, mixed-fence content) |
| **The `isFenceDelimiter` relocation is silently forgotten a third time** | Med | The revisit trigger does **not** re-fire here (this candidate adds no consumer — it never imports the predicate), so deferring again is consistent, **provided it is re-recorded**. That re-recording is an explicit In-Scope `CLAUDE.md` item |
| **Excerpt quality changes for chunks that are now fully dropped** where they previously leaked | Low | The `excerpt.ts:68` fallback already covers the all-fenced case; the affected population is mixed chunks, where dropping the fence is the documented intent |

## Rollback Plan

1. Revert the change commits.
2. `npm run build`.
3. **Nothing else.**

Verified by call-path trace, same as the sibling: excerpts are computed at query time from
`chunk.content` (`search-documents.ts:128`), **nothing about excerpt computation is persisted**. No
reindex in either direction, no `.compendio/` deletion, no DDL, no `reset()`. No config key, port,
response field or path shape changes, so `ejemplos/goldenset.yaml` and `compendio eval` are
structurally unaffected. The only residue after a revert is behavioral and immediate.

## Dependencies

- **Zero new npm dependencies. Zero new exported symbols. Zero new imports.**
- **No model download for Gates 1-4**; only Gate 5's `eval` needs embeddings, and it is an existing,
  already-required measurement.

## Delivery size

| Driver | Estimate (changed lines) |
|---|---|
| `flatten-map.ts` — one regex + its comment | 2-4 |
| `flatten-map.test.ts` — mirrored line + 2 new fixtures | 12-25 |
| `excerpt.test.ts` — inverted assertion + rewritten measurement block | 25-45 |
| Fixture corpus (OQ1 option (i)) or corpus edit (option (ii)) | 15-40 |
| `scripts/excerpt-fence-drop-probe.mjs` | 50-90 |
| `mcp-contract` spec delta — one requirement + scenarios | 40-70 |
| `CLAUDE.md` | 10-20 |
| **Total** | **154-294** |

**This repository's forecasts have landed 1.3x-4x low for several cycles running** — `bounded-chunk-size`
240-420 → 773; `match-centred-excerpt` 300-470 → ~1 521; `incremental-reindex` missed by 2x. Recorded
rather than assumed away. The mitigating difference here is stronger than the sibling's: the production
surface is **one regex literal**, so essentially all variance sits in tests, the probe script and spec
prose. Even at the historical 2x multiplier this lands near the 400-line review budget rather than past
it.

**One PR is the working assumption.** There is no natural cut if it overruns: one regex, one
requirement. An overrun means trimming probe/test breadth, not splitting the change.
**`400-line budget risk: Low`** — flagged loudly here rather than silently absorbed, per the delivery
strategy (`ask-on-risk`).

## Resolved decisions

| Question | Decision |
|---|---|
| Root cause framing | **One defect, two symptoms** — S2 does character-class *exclusion* over a string S1 has already stripped of newlines |
| Candidate | **3b**, the regex generalization. `` /```[\s\S]*?```\|~~~[\s\S]*?~~~/g `` |
| Candidate (a) | **Rejected as not implementable as scoped** — the line-anchored predicate cannot run post-S1; corrected, (a) collapses into (c) |
| Candidate (c) | **Rejected** — new map-emission shape, a second `referenceFlatten` rewrite, a parameter through a narrowly-scoped function, and a `false`-pass special case, all for the same two symptoms |
| Invariants I1-I3 | **Inherited from `trackedReplace` unchanged** — this candidate changes only which substrings match, not how matches are replaced |
| CRLF | **Safe by inheritance**, MEASURED in M1's two CRLF rows. Hard constraint stands: any new regex is anchor-free and prefix-only |
| Balanced-parity divergence | **Accepted, named, documented. Not closed** — closing it re-introduces candidate (c) |
| CommonMark closer-length rule | **Out**, on the project's own stated preference (`split-text.ts:88-96`) |
| S3, `headingsIn`, `stripHeadingLines`, `isFenceDelimiter` | **Untouched, zero-line diffs asserted** |
| Backreference alternative | **UNEVALUATED, not rejected.** Must not be adopted without CRLF + mixed-fence tracing |
| `isFenceDelimiter` relocation | **Deferred again, consistently** (no new consumer, trigger does not re-fire) — **but re-recorded in `CLAUDE.md`**, which is an In-Scope deliverable, not a nicety |
| `excerpt.test.ts:268` | **Must be inverted deliberately**, with the measurement block extended to a third state, not deleted |
| Reindex | **None needed, either direction.** Query-time computation |
| Rollback | **Revert + build.** Not a risky change |
| Artifact store | **openspec** (file-based) |
| Gate corpus | **OPEN — see question 1.** Not decided here |

## Proposal question round (open — for the user, before `sdd-spec`)

1. **Where should the tilde-fence gate corpus live?** This is the one decision this proposal
   deliberately does not make alone, because it edits either the test tree or the live documentation.
   **MEASURED context**: this repository contains **zero** real `~~~` fences anywhere, so without new
   content the corpus half of the gate cannot fail.
   - **(i) `test/fixtures/excerpt-fence-drop/docs/`** — follows `test/fixtures/excerpt-window/docs/`'s
     precedent, isolated, no risk. **Recommended.**
   - **(ii) Extend `docs/documentation-convention.md`** — continues the self-referential "live case on
     our own corpus" proof of the last two cycles, but mutates a **CRLF-encoded** file that is already
     the fixture for two prior manual gates, and the "live case" would be one we authored ourselves
     anyway, since no real tilde fence exists.

2. **Does the balanced-parity divergence bother you?** Assumed: **no** — it is accepted and documented.
   It means S1 refuses to act on an odd-delimiter chunk while the new S2 will still drop a well-formed
   pair inside one. Nothing that should survive is deleted. But it does break the "every mechanism
   shares one fence-state rule" pattern the last two cycles established as a *value*, and if that
   consistency matters more to you than this change's cheapness, the answer is candidate (c) and a
   larger change.

3. **Is `~~~` worth supporting at all for your corpora?** Assumed: **yes** — it is standard CommonMark
   and costs one regex alternative. But this repo has zero of them, so the concrete benefit lands on
   *other* projects' documentation, not ours. If you know your target corpora never use tilde fences,
   symptom 2 (interior backticks, common in documentation *about* markdown) is the whole value here and
   the change could be scoped to that alone.

4. **Should a leaked-fence excerpt ever be signalled to the caller?** Assumed: **no**, and unchanged by
   this change — the excerpt simply contains or does not contain the text. Carried forward from the
   sibling proposal's question 1, still unanswered, still not proposed. Flagging it only because this
   change reduces the population it would apply to without eliminating it (unterminated fences still
   leak).
