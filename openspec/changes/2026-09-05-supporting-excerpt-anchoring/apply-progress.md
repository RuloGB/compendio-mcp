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
