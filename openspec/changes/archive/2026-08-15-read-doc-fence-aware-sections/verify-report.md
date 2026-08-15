# Verify Report: read-doc-fence-aware-sections

Phase: verify. Artifact store: openspec (Engram unavailable this cycle). Verifier: independent, source- and execution-based (upstream artifacts not taken at face value).

Verdict: PASS WITH FINDINGS

No CRITICAL findings. One WARNING (design.md own text left factually stale on the CRLF claim, even though the truth is recorded correctly and prominently in three other places). One SUGGESTION.

---

## 1. Command evidence (actual output, not summarized)

### npm test

```
Test Files  48 passed (48)
Tests  771 passed (771)
Duration  13.16s
```

Re-run after all ablation experiments below: identical, 771 passed (771).

### npm run typecheck

Clean, no output, exit 0.

### npm run build

Clean, no output, exit 0.

### Manual gate: scripts/section-lookup.mjs (fixed tree, current HEAD)

```
node dist/cli.js --root . index --lexical
Indexed 1 documents (13 chunks) in 31 ms [mode lexical]

node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"
Result type: section-not-found

availableSections (19):
1. Principles
10. Glossary
11. Checklist for PRs with documentation
12. Templates
2. Folder structure
3. File names
4. Compendio convention modes (backtick variant)
4. Compendio convention modes (plain variant)
5. Frontmatter
6. Internal document structure
7. Writing
8. Lifecycle
9. INDEX.md
API contract (docs/api/)
Appendix: technical rationale
Architecture decision (docs/adr/)
Functional specification (docs/functional/)
Project documentation convention
Test plan (docs/qa/)
EXIT: 0
```

Matches apply-progress.md Phase 5.1 claim exactly: 19 entries, none of the 17 phantom fenced names, exit 0.

### Manual gate: pre-fix tree (src/application/read-document.ts checked out from main, rebuilt)

```
git checkout main -- src/application/read-document.ts
npm run build   # clean, no errors

node scripts/section-lookup.mjs . "docs/documentation-convention.md" "Business rules"
Result type: section

Matched 1 chunk(s):
- chunk 12
  heading: "12. Templates" (matches requested section: false)
  fence-delimiter-line count: 8

SELF-CHECK FAILED: the result resolved to type section, but no
matched chunk own stored heading matches the requested section.
EXIT: 1
```

git checkout HEAD -- src/application/read-document.ts afterwards restored the fixed file; npm run build, reindex, and a re-run of the gate script reproduced the after state verbatim above and npm test was re-run clean (771/771). The manual gate genuinely asserts: it does not merely report exit 0 because nothing ran, it fails loudly and correctly on the pre-fix implementation and passes correctly on the fixed one. Phase 0.1 (delimiter count 8, not design own illustrative 2) and Phase 0.2 (pre-fix before state resolves to the wrong chunk) are both independently reproduced, matching apply-progress.md Phase 0/2.4 claims verbatim.

### compendio eval on ejemplos/ (hybrid, real model, cached, no network)

```
node dist/cli.js --root ejemplos index
Indexed 11 documents (29 chunks) in 3333 ms [mode hybrid]

node dist/cli.js --root ejemplos eval
Goldenset: 22 questions | k = 5

mode      recall@5   MRR      failures
hybrid    1.00       0.943    0
lexical   0.95       0.856    1

Failures in lexical mode:
- endpoint question -> docs/leadsviewer/alta-leads.md (position 11)
```

Chunk count (29) and hybrid metrics (recall@5 = 1.00, MRR = 0.943) match CLAUDE.md recorded baseline and apply-progress.md Phase 5.2 claim exactly. Gate 4 (chunk identity and quality unaffected) holds.

---

## 2. Independent confirmation of the CRLF mechanism claim

Reproduced directly with node -e, isolated from the codebase:

```
line = heading text plus a trailing CR
/^#{2,6}\s+(.+)$/.exec(line)      -> null           (design.md literal, unfixed pattern)
/^#{2,6}\s+(.+)\r?$/.exec(line)   -> matches, captures the heading text

full multi-line CRLF document
matchAll(/^#{2,6}\s+(.+)$/gm) over full -> both headings matched   (old matchAll/gm path succeeds)
```

Item (c), the CRLF mechanism, is CONFIRMED independently. The dot metacharacter in a JS regex never matches CR (a line terminator), so a per-line exec() without the multiline flag requires the end anchor to sit at the exact string end; a trailing CR blocks that. The old matchAll over the whole document succeeds instead because multiline end-anchor matches immediately before any line terminator, including a bare CR, not just at end-of-string. This is exactly what design.md Decision 3 code comment claims happens, but the literal regex it specifies, without an optional CR before the end anchor, does not implement that claim once ported to a per-line loop. The fix, an optional CR before the end anchor, is correct and minimal.

Scope of what would have broken, confirmed on the real file. docs/documentation-convention.md is confirmed CRLF-encoded (275 CRLF sequences, measured directly). Checking out the pre-CRLF-fix headingsIn (the version without the optional-CR fix) and running the fence-only test suite reproduces exactly the three failures apply-progress.md predicts as genuinely fence-related (test 3.3, the tilde sibling, and test 3.5), see section 4 below, but the separate dedicated CRLF regression test, "a real heading found only inside chunk content still resolves on CRLF-encoded documents", is not one of those three; it specifically targets the regex-level bug, independent of fencing, exactly as its comment states. The claim that real, non-fenced sections ("3. File names", "10. Glossary") would stop resolving is corroborated structurally: those are real H2s reachable only through the second half of the OR condition in the match filter (headingsIn on chunk content), which is exactly the code path the heading pattern gates. A CRLF document with no optional CR fails to match any line via that branch, fenced or not.

Completeness of the fix. Searched the touched and neighboring files for other per-line end-anchored patterns:

- src/domain/flatten-map.ts line 92 (stripHeadingLines, the explicit non-goal) uses a prefix-only test with no end anchor at all. Unaffected by the CRLF bug by construction, confirmed empty diff, untouched, see section 4.
- src/domain/split-text.ts line 153 (isSeparatorRow, table detection) uses a pattern whose character class includes whitespace, which does match CR, so a trailing CR is consumed before the end anchor is tested. Not vulnerable to the same bug.
- src/domain/split-text.ts line 279 (isAbbreviation) matches a trailing letter-run on a backward slice, not a full-line match; same whitespace-absorbs-CR reasoning applies, and it is not evaluated per split-line.
- No other end-anchored, dot-adjacent-to-anchor, no-multiline-flag pattern was found in the changed files. The fix is complete for the code this change touches; it is scoped correctly rather than papering over one symptom.

Does the optional CR handle a lone CR (classic Mac line endings)? No. The split-on-newline call itself requires a newline character to split on; a document using bare-CR line endings would never be split into separate lines in the first place, so the heading pattern would never even get the chance to test most heading lines individually. This is not a gap introduced or left open by this fix, it is a pre-existing assumption shared by every split-on-newline call across the whole codebase, predates this change, and classic Mac OS line endings have been effectively extinct since Mac OS X in 2001. Not a finding against this PR; noted for completeness per the audit brief explicit question.

Are the artifacts now honest about this? Partially, and precisely characterized:

- The code comment on the HEADING_LINE constant (read-document.ts, around lines 118 to 137) is exemplary: it names design.md exact wrong claim, quotes it, explains mechanically why it does not hold, and states the fix.
- apply-progress.md documents the discovery, root cause, fix, regression test, and measured impact in detail, unprompted and un-smoothed.
- CLAUDE.md gained a dedicated Non-obvious decisions bullet for this exact gotcha.
- design.md itself was never corrected. Decision 3 code sample and its accompanying bullet, claiming CRLF behaviour is unchanged and instructing not to "fix" it, remain, verbatim, the original, now-falsified claim. design.md own header calls it "the artifact of record." A reader who trusts design.md in isolation, without cross-referencing apply-progress.md or the code comment, would be misled about the actual, shipped CRLF behavior. This is a genuine gap, not a hidden one, since the truth is recorded loudly in three other places. See WARNING-1 below.

---

## 3. Scenario-by-scenario spec compliance (amended spec, four non-guarantees)

| Spec scenario | Covering test | Result |
|---|---|---|
| A request naming only a fenced heading returns section-not-found | read-document.test.ts, task 3.3 / Gate 2d case | PASS, verified in the 771-test run; also independently reproduced RED on pre-fix main (section 4) |
| The live case: docs/documentation-convention.md, Business rules | Manual gate scripts/section-lookup.mjs (Phase 0.2, 2.4, 5.1) | PASS, reproduced directly above, both before (type section, wrong chunk, exit 1) and after (section-not-found, exit 0) |
| A fenced heading is absent from the available-sections listing | Same task 3.3 test (asserts Phantom is excluded from availableSections); manual gate availableSections enumeration | PASS |
| Both fence marker styles suppress the phantom heading | task 3.3 sibling test (tilde fence behaves identically to backticks) | PASS |
| A genuine section heading outside any fence still resolves | task 3.1 / Gate 2a (H4 outside fence) and task 3.2 / Gate 2b (tiny section merged by mergeTinyPieces) | PASS |
| A fence left open across chunk boundaries is a documented non-guarantee (mid-fence-start) | task 3.4 / Gate 2c, the load-bearing case | PASS, and independently confirmed load-bearing (section 4) |
| Fourth non-guarantee (misaligned-even parity hole) | task 3.5 pin test; spec.md fourth non-guarantee paragraph (task 6.4) | PASS, and independently confirmed to genuinely engage the balanced-parity mechanism (section 4) |

Every scenario has a named, passing, runtime-executed covering test, or for the live-case scenario, a passing manual-gate run that is itself asserted, not eyeballed. The fourth non-guarantee spec prose (task 6.4) is a separate paragraph, distinguished by its opposite, regression-direction, consequence from the mid-fence-start non-guarantee, exactly as tasks.md required, confirmed by direct reading of specs/mcp-contract/spec.md.

---

## 4. The three specific ablation checks requested

### (a) Does 2c (Gate 2c / task 3.4) go RED with the guard neutralized?

Yes, confirmed directly. Replaced the conditional toggle ("if balanced, flip inFence") with an unconditional flip in src/application/read-document.ts, ran the Gate 2c test in isolation:

```
FAIL [3.4 / Gate 2c] a lone unbalanced fence delimiter must not suppress a real heading after it
AssertionError: expected section-not-found to be section
Expected: "section"
Received: "section-not-found"
```

File restored via git checkout HEAD -- src/application/read-document.ts immediately after; full suite re-run confirmed 25/25 in the file, 771/771 overall. 2c is genuinely load-bearing: it is not a test that would pass under both the guarded and naive implementations.

### (b) Does the 3.5 fixture genuinely reproduce the parity-hole suppression, or does it pass for an unrelated reason?

It genuinely exercises the balanced-parity mechanism, confirmed by a targeted ablation, not just observing that it returns section-not-found: built the project, ran the exact 3.5 fixture content (a fence-opener line, two content lines including the target heading, a blank line, a body line, a fence-closer line; two delimiters total, balanced) through ReadDocument directly, result section-not-found, matching the pinned assertion. Then removed the closing fence delimiter from the same fixture, making the count one, odd, unbalanced, and re-ran: result flipped to section, the heading resolves. This confirms the suppression in 3.5 is specifically caused by the balanced-parity guard engaging, not by some unrelated failure such as a normalization bug or headingsIn returning an empty array unconditionally.

One nuance worth stating precisely, not smoothed over. design.md itself states the misaligned-even shape is chunk-locally indistinguishable from a genuine, self-contained, balanced fence, and that is exactly what the code does and must do: there is no code path that can tell the 3.5 fixture apart from an ordinary complete fence containing a phantom heading, the Gate 2d / task 3.3 shape. So 3.5 does not, and cannot, demonstrate anything the code treats differently from 3.3; by design it is the identical mechanism on an identical-looking input. What 3.5 legitimately adds is, first, a named, commented pin against silent regression or an unreviewed fix of this specific accepted limitation, matching its stated purpose in tasks.md exactly; and second, it is seeded directly via an in-memory store plus saveDocument, not produced by the real chunker across an actual document boundary, so it demonstrates the code behavior on this input shape, not that this exact shape is reachable from a real document via the real indexing pipeline splitting logic. Reachability itself was argued in tasks.md by prose, the three-independent-conditions argument, not independently verified by an integration test that drives the real chunker to actually produce a misaligned-even chunk. This matches the established style of tasks 3.3 and 3.4, also direct in-memory seeds, not chunker-driven, so it is not an inconsistency task 3.5 introduces, but it means "reproduces the suppression" is true in the narrow, code-level sense the task asked for. Recorded for precision per the audit brief explicit ask; not a finding.

### (c) Is the CRLF mechanism confirmed, and is the fix complete?

Confirmed, see section 2, independent node -e reproduction and real-file corroboration. Fix is complete for the code this change touches: no other per-line end-anchored, dot-adjacent-to-anchor pattern in the changed or neighboring files shares the bug, checked flatten-map.ts and split-text.ts other two end-anchored regexes. Lone-CR, classic Mac, line endings are unaffected by the optional-CR fix and remain unhandled everywhere in the codebase, pre-existing, not a gap opened by this change. Artifact truth is incomplete in one place: design.md itself retains the original, now-falsified CRLF claim, uncorrected, see WARNING-1.

---

## 5. Structural and scope checks

| Check | Result |
|---|---|
| Both call sites (match branch, listing branch) covered by one fix | Confirmed by diff: git diff main -- src/application/read-document.ts touches only the import line and the headingsIn function, plus its doc comment and the heading-line constant; the two call sites are byte-identical to main. Decision 5 "verified, not assumed" claim holds. |
| Chunking unchanged | Confirmed: git diff main -- src/domain/split-text.ts is exactly the export keyword plus a doc comment on isFenceDelimiter; body, callers, and every other function are untouched. compendio eval numbers on ejemplos/ match CLAUDE.md recorded baseline exactly, section 1, so the chunking gates referenced by CLAUDE.md remain valid. |
| src/domain/flatten-map.ts untouched | Confirmed: git diff main -- src/domain/flatten-map.ts produces zero output. |
| H1 not widened | Confirmed: the heading pattern is bounded to two-through-six hashes, not one-through-six. |
| RED state reproduced from main | Confirmed: checked out src/application/read-document.ts from main, rebuilt cleanly, ran test/application/read-document.test.ts: 3 genuine failures, task 3.3, the tilde sibling, and task 3.5, matching apply-progress.md report exactly, 22 passed. The CRLF regression test also passes on main implementation, correctly, since main matchAll-based implementation was never broken by the CRLF bug; that bug was introduced by this change own per-line refactor, not present before it. Manual gate against this checked-out state also failed exactly as predicted, section 1. File restored via git checkout HEAD --, full suite re-confirmed green. |
| Manual gate genuinely asserts, not a trust-the-exit-0 gate | Confirmed: reproduced both the before failure (exit 1, self-check banner) and the after success (exit 0) directly, not inferred from apply-progress.md claims alone. |
| Delivery size overrun explained | Partially by CRLF, mostly by a pre-existing forecast-underestimation pattern. git diff --stat confirms 612 lines total (425 tracked plus or minus 5, plus a 117-line scripts/section-lookup.mjs and a 65-line test/application/fence-aware-round-trip.test.ts), matching apply-progress.md own count. Isolating the CRLF-specific additions (the heading-line-constant doc comment, roughly 20 lines; the dedicated CRLF regression test, roughly 33 lines; the CLAUDE.md CRLF bullet, roughly 9 lines; roughly 60 lines total) leaves the bulk of the overrun against design own 278 to 488 forecast unexplained by CRLF alone. Comparing per-file against design own row estimates: read-document.test.ts alone, 252 actual lines, already exceeds its 90 to 160 forecast by 90-plus lines before subtracting the CRLF test. This matches CLAUDE.md own documented pattern that forecasts have landed low for several cycles, and apply-progress.md own stated accounting that the overrun is driven by the CRLF discovery and fuller doc comments than the forecast priced in. Both causes are real, but the second is the larger one. delivery_strategy exception-ok was pre-accepted, so this is not itself a finding. |

---

## 6. Task completeness

All 8 phases in tasks.md are checked complete in apply-progress.md. Independent spot-checks above (tests, build, manual gate, diffs) corroborate every completion claim this verify was able to check by re-execution rather than by reading the claim. This verify did not independently re-derive the git commit hashes referenced in Phase 7, not load-bearing for correctness, or re-run the test-watch command, not applicable to a one-shot verify.

---

## 7. Findings

### WARNING-1: design.md CRLF claim is left uncorrected in the design artifact itself

Where: openspec/changes/2026-08-15-read-doc-fence-aware-sections/design.md, Decision 3 code sample and its accompanying commentary claiming CRLF behaviour is unchanged.

What: this claim was measured false during apply, confirmed independently in section 2 of this report. The correction is recorded accurately and prominently in the code comment on the heading-line constant, in apply-progress.md, and in CLAUDE.md, but design.md itself, which its own header calls "the artifact of record," was never amended, annotated, or given a forward-reference note. A reader who consults only design.md, not an unreasonable thing to do given its stated role, would be told something false about the shipped behavior.

Why it matters, precisely: this repository has an established practice of not smoothing over measured-wrong claims. CLAUDE.md own bounded-chunk-size section explicitly says to re-measure a table before trusting it; apply-progress.md itself repeatedly uses "recorded honestly rather than smoothed over" phrasing. Task 6.4 already set the precedent of amending an openspec artifact, spec.md, for a mid-apply finding, the parity hole; no equivalent task existed for the CRLF discovery because it was a genuine, unplanned discovery, but nothing stopped the final docs commit, which created design.md as a new file in this repository history and had every opportunity, from adding a one-line addendum.

Recommendation: before archive, add a short addendum note to design.md Decision 3, in the style CLAUDE.md itself uses for similar corrections, pointing to the actual behavior and the code comment. Low cost, does not require reopening the PR.

Severity: WARNING, not CRITICAL. The correct information exists and is easy to find in three other places; nothing shipped is wrong; no spec scenario or test is affected.

### SUGGESTION-1: task 3.5 evidentiary scope could be stated more precisely in its own comment

Where: test/application/read-document.test.ts, the task 3.5 test comment block.

What: the comment says the fixture pins the parity-hole behavior, which is accurate, but does not note that, by design own admission of chunk-local indistinguishability, this test is mechanically identical in code path to task 3.3 / Gate 2d, a phantom heading inside a genuine complete fence. It cannot and does not demonstrate reachability via the real chunker across a document boundary; that argument is prose-only, in tasks.md. This is not wrong, just slightly over-stated relative to what an in-memory-seeded unit test can actually prove.

Recommendation: optional. A one-line addition to the comment noting this fixture is code-path-identical to Gate 2d / task 3.3, and that the guard cannot and is not meant to distinguish the two, would make the test evidentiary weight self-evident to a future reader without cross-referencing tasks.md. Not blocking.

Severity: SUGGESTION, cosmetic precision only.

---

## 8. Summary judgement

- Every spec scenario, including the amended fourth non-guarantee, has a real, executed, passing covering test.
- The two designated load-bearing tests, Gate 2c / task 3.4 and task 3.5, were independently ablation-tested, not merely trusted: 2c goes genuinely red without the guard; 3.5 genuinely engages the balanced-parity mechanism, confirmed by flipping the same fixture from balanced to unbalanced and observing the result flip.
- The manual gate script genuinely asserts, confirmed by reproducing both a real failure, pre-fix tree exit 1, and a real success, fixed tree exit 0, independently, not by trusting apply-progress.md transcript.
- The CRLF deviation is real, its mechanism is independently confirmed, its scope, real non-fenced headings not just fenced ones, is corroborated, and the fix is complete for the code this change touches, no sibling per-line end-anchored bug found elsewhere in the touched or neighboring files.
- Chunking, split-text.ts, and flatten-map.ts are confirmed unchanged and untouched by diff, not by claim.
- Both call sites are confirmed covered by one edit, by diff.
- H1 is confirmed not widened.
- npm test (771/771), npm run typecheck, and npm run build all pass cleanly, independently re-run.
- compendio eval on ejemplos/ matches the recorded baseline exactly, hybrid recall at 5 equals 1.00, MRR equals 0.943.
- One WARNING, design.md own text stale on the CRLF claim, the truth exists elsewhere just not there, and one cosmetic SUGGESTION. Neither blocks archive.

Verdict: PASS WITH FINDINGS. One WARNING, one SUGGESTION, zero CRITICAL. Recommend fixing WARNING-1 before archive, cheap, one addendum line, but it does not need to block a decision to proceed.
