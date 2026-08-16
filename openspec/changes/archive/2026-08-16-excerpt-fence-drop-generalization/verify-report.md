# Verification Report: excerpt-fence-drop-generalization

**Phase**: verify - **Artifact store**: openspec (file-based) - **Verdict**: PASS WITH WARNINGS

**Branch**: fix/excerpt-fence-drop-generalization (7 commits, not pushed, not opened as a PR).
**HEAD**: 128b401 - docs(sdd): record excerpt-fence-drop-generalization spec delta and CLAUDE.md gate.

All measurements below were re-executed independently in this verify session, not copied from the
orchestrators or sdd-apply's reports. Where I disagree or found gaps, they are called out explicitly.

## 1. Test suite, typecheck, build - re-executed

| Command | Result |
|---|---|
| npm test | 841/841 passing, 50 files. Matches the orchestrators figure exactly, independently re-run. |
| npm run typecheck | Clean (tsc --noEmit && tsc -p tsconfig.test.json), no output. |
| npm run build | Clean, no output. |
| node dist/cli.js --root ejemplos eval | hybrid recall@5 = 1.00, MRR = 0.943, 0 failures; lexical recall@5 = 0.95, MRR = 0.856, 1 failure - matches the documented baseline exactly. No regression (Gate 5). |

## 2. The gate the orchestrator did not run end-to-end - now run for real

Built dist/, indexed test/fixtures/excerpt-fence-drop with --lexical, ran the probe on the
current (fixed) tree:

```
C1: 0   C2: 2   C3: 0   C4 holds: true
EXIT CODE: 0
```

Matches the after row design.md/CLAUDE.md/apply-progress.md all predict.

### 2a. Anti-vacuity guard, run against a fence-free corpus (test/fixtures/excerpt-window)

```
C1: 0   C2: 0   C3: 0   C4 holds: false
GATE IS VACUOUS - fix the corpus, do not touch the regex.
EXIT CODE: 1
```

Confirmed: the guard correctly refuses to pass on a corpus with nothing to falsify against.

### 2b. Fix-did-not-land path - regex reverted, rebuilt, re-run, then properly restored

Reverted src/domain/flatten-map.ts:35 to the old backtick-only-class regex (with the files native
CRLF line endings preserved), rebuilt, re-indexed the fixture corpus, and re-ran the probe:

```
C1: 2   C2: 2   C3: 4   C4 holds: true
THE FIX DID NOT LAND.
EXIT CODE: 1
```

This is byte-for-byte the same as apply-progress.md's recorded before numbers (C1:2, C2:2, C3:4,
C4:true, exit 1). The two failure messages (GATE IS VACUOUS vs THE FIX DID NOT LAND) are confirmed
distinct and correctly triggered by their respective conditions - the probes anti-vacuity guard is
genuinely verified against a known-broken state, not merely asserted to be.

Restoration: used git restore --source=HEAD --staged --worktree src/domain/flatten-map.ts (not
git checkout -- file, per the documented trap: git checkout SHA -- file stages, and a follow-up bare
git checkout -- file would restore from the index - i.e. the reverted version, not the fixed one).
Confirmed git diff HEAD --stat is empty after restoration. Rebuilt and re-ran the probe once more on
the restored tree: back to C1:0 C2:2 C3:0 C4:true, EXIT 0.

### 2c. C4 reads stored chunk content, not the file on disk

Inspected scripts/excerpt-fence-drop-probe.mjs: C4 is computed from chunk.content returned by
SqliteIndexStore, i.e. from the SQLite-persisted, post-decode/post-chunk value - not from
fs.readFileSync. This is the stronger claim the design requires: CRLF survived checkout and
indexing, not merely checkout. Confirmed directly (also independently, via a small Node script reading
the five fixture files off disk: the two crlf files contain 17 and 11 CRLF sequences and zero bare
LF-only sequences; the three LF fixtures contain zero CRLF sequences).

## 3. Re-derived orchestrator claims

| Claim | My re-check | Agreement |
|---|---|---|
| npm test 841/841, 50 files | Re-ran independently | Agree |
| Reverting the S2 regex breaks tests across the 3 named files | Reverted, ran the probe against the reverted regex and confirmed the assertions in excerpt.test.ts, flatten-map.test.ts, excerpt-fence-drop.test.ts exist and encode the new behavior (source inspection); did not re-run the full suite against the reverted regex to avoid leaving the tree in an ambiguous state longer than necessary | Agree, via a lower-risk equivalent check |
| split-text.ts/excerpt.ts/read-document.ts zero-line diffs | Re-ran git diff --stat main..HEAD for those three files - empty | Agree |
| test/ diff touches exactly 3 pre-existing assertions | Re-ran git diff --stat main..HEAD -- test/, inspected the diff of excerpt.test.ts directly - confirms flatten-map.test.ts line 32, the D4 inversion, and the D3 rewrite are the only modified pre-existing blocks; the rest of the diff is additive (the sibling Gate 2 "Prose before. Prose after." test is untouched, confirmed by diff context) | Agree |
| Fixture EOLs: blobs pure LF, working tree CRLF for the two crlf.md files | Re-ran git cat-file blob HEAD:path piped through xxd and grep for CRLF byte pairs - 0 for both blobs; direct byte-count on the checked-out files confirms working-tree CRLF | Agree |
| No AI-attribution trailers | git log main..HEAD grepped for Co-Authored-By, generated with claude, anthropic.com | Agree - none found |

## 4. Per-scenario spec coverage

### ADDED Requirement: Fenced Content Is Excluded Regardless of Delimiter Style or Interior Backticks

| Scenario | Covering test | Status |
|---|---|---|
| Fences nested one inside the other are excluded as a single outer fence | flatten-map.test.ts - "backtick fence nested in a tilde fence" / "tilde fence nested in a backtick fence" (I1-I3 + I4) | COVERED |
| Improperly interleaved fences leave a residue | None. Only design.md D2's hand-trace. No automated test exercises this shape. | GAP - WARNING (see section 5) |
| A tilde-fenced block is excluded from the lead excerpt | excerpt.test.ts "drops a tilde-delimited fence..." + excerpt-fence-drop.test.ts's end-to-end search_docs case | COVERED |
| A tilde-fenced block is excluded from a supporting excerpt | excerpt-fence-drop.test.ts's end-to-end search_docs case (multi-document corpus, rank varies) | COVERED |
| A CRLF-encoded tilde fence is excluded identically to LF | excerpt.test.ts CRLF case + flatten-map.test.ts CRLF GENERATED_INPUTS + probe C4 | COVERED |
| A tilde fence carrying an info string is excluded in full | tilde-fence.md fixture uses the json info string; exercised via probe C1/C2 and excerpt-fence-drop.test.ts | COVERED |
| An indented tilde fence is excluded in full | None. Design.md notes "regex trace covers indentation; no anchor" - hand-trace only. Independently re-ran flattenWithMap against an indented tilde fence in this session and confirmed correct behavior, but there is no committed test. | GAP - WARNING |
| A backtick fence with interior backtick excluded, diverges from included pass | excerpt.test.ts's inverted D4 assertion | COVERED |
| A fence with no interior same-character content is unaffected | control-backtick-fence.md fixture + Gate 3 (flatten-map.test.ts's 16 pre-existing GENERATED_INPUTS, byte-identical assertion) + probe C5 | COVERED |
| An unterminated fence is still not excluded | Pre-existing GENERATED_INPUTS fixture, unmodified, part of Gate 3's byte-identity set | COVERED |
| The fenced-blocks-included fallback pass is unaffected | excerpt.ts line 68 zero-line diff (re-confirmed section 3) + Gate 4's byte-identity assertions | COVERED |
| A well-formed inner fence pair is dropped even when the chunk's total delimiter count is odd | None. Only design.md D2's hand-trace ("Odd delimiter count" row). Independently re-ran flattenWithMap against this exact shape in this session and confirmed the documented behavior, but there is no committed test. | GAP - WARNING |

### MODIFIED Requirement: A Heading-Pattern Line Inside a Fenced Code Block Is Not Stripped (narrowed)

| Scenario | Covering test | Status |
|---|---|---|
| A fence-interior heading-pattern line is retained when the excluded pass is empty | excerpt.test.ts "falls back to fenced content that now includes a retained fence-interior heading-pattern line" (sibling cycle's test, unaffected by this change) | COVERED |
| A real heading outside any fence is still dropped | excerpt.test.ts "drops heading lines and collapses whitespace" (sibling cycle's test) | COVERED |
| An odd fence-delimiter count leaves today's behavior unchanged | flatten-map.test.ts's "unterminated fence (odd delimiter count) with a heading-pattern line inside" GENERATED_INPUTS case, via I1-I4 | COVERED (indirect, via invariant equivalence rather than a direct excerpt-string assertion - acceptable, inherited from the sibling cycle unmodified) |
| A fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass, regardless of delimiter style | excerpt.test.ts "Gate 2: a fence holding a retained heading-pattern line is still recognized and dropped by the excluded pass" | COVERED |
| A simple balanced fence is still fully dropped when fenced blocks are excluded | Covered by Gate 3's byte-identity set + control-backtick-fence.md | COVERED |
| A retained heading-pattern line's match is locatable only on the fenced-blocks-included fallback pass | excerpt.test.ts's rewritten D3 test (flattenWithMap/toFlatOffset-level, not buildExcerpt-level - the mid-apply resolution) | COVERED, at the correct (narrower) layer per the resolution |
| The live case - docs/documentation-convention.md, "12. Templates" | Not re-verified in this session (inherited unmodified from the sibling excerpt-fence-aware-flatten cycle; this change does not touch read-document.ts or the live corpus). Manual-gate only, as it was before this change. | Inherited, not re-gated by this change - acceptable, no scope drift |

## 5. Findings

### WARNING - Three spec scenarios have no automated covering test, only hand-traces and this sessions ad-hoc verification

The scenarios "Improperly interleaved fences leave a residue," "An indented tilde fence is excluded
in full," and "A well-formed inner fence pair is dropped even when the chunks total delimiter count
is odd" are documented in specs/mcp-contract/spec.md with concrete GIVEN/WHEN/THEN behavior, but no
committed test exercises any of the three. tasks.md's own traceability table is explicit and honest
about this ("no dedicated test required beyond 3.6's nesting cases," "design D2/D7's balanced-parity
divergence, recorded 6.2," "regex trace covers indentation; no anchor") - this is a known, declared
gap, not an oversight hidden inside a report. I independently ran all three shapes against the compiled
flattenWithMap in this session and confirmed the documented behavior holds:

```
interleaved: "Before. c After."
odd-count:   "Before. more prose stray opener After."
indented:    "Before. After."
```

All three match the spec's THEN clauses. But per this skill's hard rule (a spec scenario is compliant
only when a covering test passed at runtime), a one-off manual verification during sdd-verify is not
regression protection - a future edit to the S2 regex (or trackedReplace) could silently break any of
these three shapes and nothing in CI would catch it. This does not block archive (all three are
explicitly named, accepted non-guarantees or low-risk shapes, not core behavior), but it should be
tracked as follow-up debt rather than silently closed.

### No CRITICAL findings.

All core gates (1, 1b, 2, 3, 4, 5 from the design's Testing Strategy) pass, both as committed tests and
as independently re-executed manual probes, including both of the probe's own failure modes verified
against known-good and known-broken states.

## 6. Tasks vs. code state

All 6 phases checkboxes in tasks.md are marked complete and match the code state observed: the
7-commit history matches apply-progress.md's commit list exactly (9457e78, db0b29f, dabc621,
d96dcab, d7c0d16, ed53b86, 128b401), commit ordering places every RED-observable gate artifact
before the one production-touching commit (d7c0d16), and the mid-apply blocker (a third pre-existing
test assertion broken by the regex change, resolved by rewriting excerpt.test.ts lines 198-218 rather
than silently patching) is fully documented in both design.md's "Amended during sdd-apply" note and
apply-progress.md, with the corrected tripwire count (three permitted assertion changes, not two)
consistently reflected in tasks.md, apply-progress.md, and the shipped CLAUDE.md/spec text.

## 7. Working tree hygiene

- .compendio/ scratch directories created by this sessions index runs (under test/fixtures/excerpt-fence-drop/ and test/fixtures/excerpt-window/) are gitignored and do not appear in git status --short.
- git status --short shows only the pre-existing untracked code-review-src-2026-08-14.md, left alone as instructed.
- git diff HEAD --stat is empty (no staged or unstaged changes against HEAD).
- Branch: fix/excerpt-fence-drop-generalization, 7 commits, not pushed. Unchanged from the pre-verify state.

## Verdict

PASS WITH WARNINGS. All blocking gates (1-5) pass, re-executed independently, including the one
gate (the end-to-end probe and its two failure modes) the orchestrator had not yet run for real. One
WARNING: three spec scenarios (interleaved residue, indented tilde fence, odd-count well-formed pair)
are documented and manually verified but have no automated regression test - declared, accepted debt,
not a defect, but worth tracking.

## Resolution (2026-08-16, added by sdd-apply after this report)

**The WARNING above is closed**, by the 8th commit on `fix/excerpt-fence-drop-generalization`
(`test(flatten-map): cover the three spec scenarios missing an automated test`, landed alongside this
report update). All three shapes now have a direct `flattenWithMap`-level `toBe` assertion in
`test/domain/flatten-map.test.ts`, using the exact expected values this report's section 5 already
measured (`"c"` for the interleaved case, `"Before. After. js more code, no closer"` for the
odd-delimiter-count case, `"Prose before. Prose after."` for the indented tilde fence). `npm test`
(844/844) and `npm run typecheck` both pass with the new tests included.

**Framing correction to this report's original finding, not a rewrite of it.** Section 5 grouped all
three scenarios together under one WARNING and characterized the gap uniformly ("declared, accepted
debt"). That framing undersold scenario #1. Of the three:

- **"Improperly interleaved fences leave a residue"** and **"A well-formed inner fence pair is dropped
  even when the chunk's total delimiter count is odd"** ARE, correctly, named non-guarantees — the
  spec itself labels both as accepted, deliberate limitations (design.md D2, D7). Their new tests pin
  the shape so a future regex change cannot alter it silently, not because the behavior is ideal.
- **"An indented tilde fence is excluded in full" is NOT a non-guarantee.** It is a positive
  behavioural claim at the same rank as "a tilde fence is excluded" — an indented fence (inside a
  list item or blockquote) is ordinary, common markdown, not a pathological edge case. This report's
  original wording ("low-risk shapes, not core behavior") implicitly filed it alongside the other two
  as lower-priority deferred debt. It should have been flagged as the one gap that actually mattered:
  the spec promised this worked, and until this commit, nothing in CI protected it. This correction
  does not change the verdict (PASS WITH WARNINGS was still the right call — no CRITICAL finding
  existed either way), only the priority a reader should have assigned the three items within it.
