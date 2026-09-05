# Apply Progress: Anchor Supporting Excerpts on the Match

Status: **all 36 tasks complete** (`tasks.md`, Phases 1-6). Full detail, verbatim command output and
gate numbers live in `verify-report.md`; this file is the short status record for the artifact store
(Engram unavailable for this change — openspec is the artifact store).

## What was done

- **Phase 1** — `scripts/supporting-anchor-probe.mjs` created; Gate B (anti-vacuity guard) verified
  firing on a nonsense query set; Gate A baseline recorded on unmodified code
  (C1=8/9.1%, C2=88, exit 1 `THE FIX DID NOT LAND`) — exact match to design's prediction.
- **Phase 2** — Both ancestor canaries (`search-documents-spans.test.ts`,
  `index-and-search.test.ts`) inverted to assert every-rank span computation; both demonstrated
  failing against unmodified `src/` (G2 mandatory red run, recorded verbatim).
- **Phase 3** — Three new spec-scenario tests appended to a new `describe` block in
  `search-documents-spans.test.ts`; all red pre-change (one fixture — the non-positional-selection
  test — needed a widened neutral gap after the fix exposed an isolation gap in the original
  fixture; both red-before and green-after re-verified against the corrected fixture).
- **Phase 4** — Production fix: `src/application/search-documents.ts:123`'s `rank === 0 ?` guard
  removed; comment replaced with Decision 1's text. Both canaries and all 3 new tests green.
- **Phase 5** — Gate A after (C1=0, C2=88 identical population, digest tuple-for-tuple match against
  the before run — no `POPULATION DRIFTED BETWEEN RUNS`); Gate B re-fired identically; Gate C
  (`compendio eval`) identical to four decimals (hybrid 1.00/0.943, lexical 0.95/0.856); C7's
  underlying shape measured directly against the database (0 duplicate pairs, largest chunk 1332
  chars — closes design's Review-response CLOSED open question).
- **Phase 6** — `server.ts`'s split-literal middle string rewritten (ellipsis-contract sentence left
  untouched); `AGENTS.md`'s MCP §2 clause, graduated-budget bullet, new Manual gate section, and
  `matchedTerms` deferral bullet added; exactly 3 stale `Decision 7` comments re-cited
  (comment-only); full suite green (52 files / 914 passed / 1 skipped — the required 911+3);
  `typecheck` and `build` clean; non-touch of `src/domain/{flatten-map,match-location,ports,fusion}.ts`
  and `src/infrastructure/**` confirmed empty via `git diff --stat`.

## Deviations from the artifacts, recorded honestly

- The non-positional-selection test's original fixture (a 100-char neutral gap between the
  high-frequency and distinctive-term clusters) let the post-fix window legitimately straddle both
  clusters — `selectMatchCentre` scoring a window containing both distinct terms higher than one
  containing only the rare term, when both fit the budget together. This was a fixture-isolation
  defect, not a production defect: widened the gap to 200 chars so no single 120-char window can
  reach both clusters. Re-verified red-before/green-after against the corrected fixture.
- Real diffstat is 594 changed lines on the implementation surface (`src`/`test`/`scripts`/
  `AGENTS.md`/`server.ts`), against the tasks-phase forecast of 440-480 — a ~24-35% overshoot,
  continuing this project's recorded pattern. Full breakdown and driver-by-driver comparison in
  `verify-report.md`'s "Real diffstat vs. forecast" section.

## Commits (branch `feat/supporting-excerpt-anchoring`, none pushed)

1. `feat(search): add Gate A/B probe for supporting-excerpt-anchoring` — probe script + SDD artifacts
2. `test(search): invert excerpt-anchoring canaries and add spec-scenario coverage` — Phases 2-3, red
3. `feat(search): locate match spans for every result rank, not rank 0 only` — Phase 4, the fix
4. `docs(sdd): record Phase 4/5 verification for supporting-excerpt-anchoring` — verify-report.md
5. `docs: make the contract prose match every-rank excerpt anchoring` — Phase 6 prose + citations

## Not done in this apply

- Merging `openspec/changes/.../specs/mcp-contract/spec.md`'s delta into `openspec/specs/` —
  `sdd-archive`'s job, with the two destructive-delta warnings (REMOVED requirement, RENAMED
  requirement) it must surface.
- No commit, push, or PR beyond what's listed above — user did not request a commit push or PR, and
  none was made.

---

## Orchestrator gate (independent, 2026-09-05)

Apply's report was re-verified against the tree rather than accepted. Everything checked holds.

- `npm run build`, `npm run typecheck` clean. `npm test`: **52 files / 914 passed / 1 skipped** —
  matches apply's claim exactly (baseline was 911 passed).
- Branch `feat/supporting-excerpt-anchoring`, 6 commits, `main` untouched at `7e210c4`, nothing
  pushed, working tree clean. **Zero AI attribution** in any commit body.
- Diffstat: 594 changed lines on the implementation surface (`src`/`test`/`scripts`/`AGENTS.md`),
  2 495 in `openspec/`. Apply's 594 figure is correct and the split is legitimate.
- **The 12 must-not-touch `Decision 7` citations are byte-identical to `main`** — `composition.ts`,
  `convention.ts`, `read-document.test.ts`, `convention.test.ts`, `build.ts` untouched, and
  `index-and-search.test.ts:331` (`multiple-doc-roots`'s Decision 7) intact. The find-and-replace
  trap was avoided.
- **Canaries inverted, not silenced.** Canary 1: expect-count 8 → 23. Canary 2: 148 → 148, with
  `expect(result.excerpt.startsWith("…")).toBe(false)` replaced by
  `expect(supporting.some((r) => r.excerpt.startsWith("…"))).toBe(true)` — the trip-wire fires in
  the opposite direction. The one G4-permitted weakening (+1 → +2) is declared in a comment with its
  reason, not slipped in.
- Gates reproduced independently: C1=0, C2=88, C3=69 (78.4%), C4=4.00, C5=8 (9.1%), C6=0, C7=0.
  `compendio eval` unmoved (hybrid 1.00/0.943, lexical 0.95/0.856).

### One correction to this note's own method, recorded because it nearly passed

The first attempt to prove the gate red against the pre-change build ran the probe after
`git checkout main`. It exited 1 — and that was a **FALSE PASS**: `scripts/supporting-anchor-probe.mjs`
does not exist on `main`, so `node` exited 1 for a missing file, not because the gate fired. The
check was redone correctly: **keep the probe, revert only the production guard line**. Result:

```
Gate A, probe present + production REVERTED: exit = 1
C1 (zero query terms visible, of C2): 8 (9.1%)
THE FIX DID NOT LAND
```

and restored to exit 0 after re-applying. Only now is the red run attributable to the change rather
than to a missing file. Gate B (known-vacuous corpus) exits 1 with `GATE IS VACUOUS`. The gate is
therefore verified in all three states: green where it should be, and red in two distinct,
independently caused known-bad states.

This is the same class of error the exploration's own gate specification made (§11.4) and the same
one this project has recorded repeatedly: **the verification mechanism failing for the wrong reason
and being read as success.** Recorded rather than quietly fixed.
