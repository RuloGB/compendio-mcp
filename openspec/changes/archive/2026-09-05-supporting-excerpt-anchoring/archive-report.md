# Archive report — `supporting-excerpt-anchoring`

**Change**: `supporting-excerpt-anchoring`
**Date archived**: 2026-09-05
**Artifact store**: openspec
**Verify status**: PASS WITH WARNINGS (0 CRITICAL, 3 WARNING, 2 SUGGESTION)
**Archived by**: the orchestrator directly, not delegated — see "Why this phase was not delegated".

## What shipped

`search_docs` supporting fragments (rank >= 1) now receive a match-centred window instead of a
start-anchored prefix, within an unchanged 120-character `SUPPORTING_EXCERPT_CHARS` budget. The
production change is the removal of the `rank === 0 ?` guard in `SearchDocuments.runSearch`.

Branch `feat/supporting-excerpt-anchoring`, 6 commits off `main`. **Not pushed, no PR opened.**

## Destructive delta — the `rules.archive` warning, discharged

`openspec/config.yaml`'s `rules.archive` requires warning before merging destructive deltas. This
change carried one, and it was surfaced to the user before the merge ran:

- **REMOVED** `### Requirement: Supporting Excerpts Remain Start-Anchored Prefixes` from
  `openspec/specs/mcp-contract/spec.md`. It asserted the exact behaviour this change deletes, and it
  carried its own quality rationale — *"a supporting fragment routes between results rather than
  answers, and a prefix stays legible against `path`/`section` in a way a stripped-context window
  would not."* That rationale was not discarded: its surviving half (a supporting fragment routes
  rather than answers, which is why the 120-character budget is untouched) is carried forward
  verbatim into the replacement requirement. `Reason` and `Migration` notes were present in the delta
  as the merge rules require.
- **RENAMED** `Lead Match Selection Is Not Positional` -> `Match Selection Is Not Positional`, with
  both names explicit in the delta. The old name survives in the main spec only inside the
  `(Previously titled ...)` historical annotation; zero live headings carry it.

## Merge result, verified

| Requirement | Action | Scenarios after |
|---|---|---|
| Supporting Excerpts Are Centred On the Matched Span, With a Start-Anchored Fallback | ADDED (in the removed requirement's slot, not appended — it is a replacement, and reading order matters) | 3 |
| Truncation Is Marked at Either Edge, Within Budget | MODIFIED (text unchanged; `(Previously: ...)` note and a supporting-tier scenario added) | 4 |
| Match Selection Is Not Positional | RENAMED + MODIFIED | 2 |
| Vector-Only Results Produce Well-Formed Excerpts | untouched — its text already reads "within its rank's budget" and is rank-agnostic | 1 |
| Graduated Excerpt Budget by Result Rank | untouched — the 1400/120 split is not re-litigated | 1 |
| Supporting Excerpts Remain Start-Anchored Prefixes | REMOVED | — |

Post-merge checks: 752 CRLF line endings, **0 bare LF** (line endings preserved; `core.autocrlf` is
`true` here and this file is not covered by `.gitattributes`). `git diff` on the main spec is
67 insertions / 14 deletions — content only, no line-ending churn. The residual-Spanish-vocabulary
check required by `rules.archive` found only pre-existing, deliberate occurrences: requirements that
*quote* the retired Spanish parameter names in order to forbid them, and `frontmatterFields` mapping
examples. Nothing introduced by this change.

### A merge error caught by its own check, recorded rather than hidden

The first merge attempt was **wrong and was reverted**. The block extractor used the pattern `^##+ `
to find where a requirement block ends, which also matches `#### Scenario:` — so each block was
truncated at its first scenario and the merge silently dropped scenarios (ADDED landed with 1 of 3,
Truncation with 3 of 4). It was caught by counting scenarios after the merge rather than trusting
the merge, then fixed with `^#{2,3} ` and re-asserted on both sides before writing. The corrected
run asserts the extracted scenario counts (3/4/2 from the delta, 1/3/1 from the main spec) before
touching the file, so the same failure cannot recur silently.

## Why this phase was not delegated

The user directed that `sdd-archive` be run by the orchestrator rather than a sub-agent, on a
recorded failure of that agent: it has no delete tool, so it **copies instead of moving** the change
folder and normalises CRLF to LF in the process. The move here was done with `git mv` and verified:
the source folder no longer exists, and `exploration.md`'s md5 is byte-identical before and after
(`118812d0b92df152073cef4ddf675e92`).

## Cycle record

| Phase | Outcome |
|---|---|
| explore | Falsified the originating hypothesis (raising `SUPPORTING_EXCERPT_CHARS` to 300-400). Its own §2c conclusion was later corrected: it read `design.md` and missed a second, quality rationale living in `openspec/specs/` |
| verification cycle | All 7 orchestrator requests executed. Blast radius confirmed exact. **The exploration's own gate specification failed** — C2's denominator was defined over raw content instead of flattened text; corrected, with counter C6 added to keep the correction visible |
| propose | Corrected the orchestrator's framing (the ellipsis contract text does not become false — only its frequency changes) and found the destructive spec delta the exploration had missed |
| spec | First use of `RENAMED Requirements` in this repository (39 ADDED / 21 MODIFIED / 1 REMOVED before it) — valid per `openspec-convention.md:68` and handled by `sdd-archive/SKILL.md:108` |
| design | Found the `Decision 7` citation trap: 15 occurrences from two different changes, with one file carrying both kinds |
| design review (fresh context) | Found that Gate A compared population **size**, not identity — a rank swap at constant size would pass while corrupting every rate. Closed with an ordered `(query, rank, path, section)` digest |
| tasks | Third forecast growth of the cycle; `size:exception` granted by the user with the real number in front of them |
| apply | 36 tasks, 6 commits, canaries inverted not silenced, all gates green |
| verify (fresh context) | PASS. Stress-tested the digest with a synthetic swapped tuple and confirmed `POPULATION DRIFTED BETWEEN RUNS` fires — the mechanism is verified, not merely present |

**Forecast versus actual**: 285-335 (proposal) -> ~415 (design) -> 440-480 (tasks) -> **594 actual**
on the implementation surface. Fourth consecutive growth, consistent with this project's recorded
pattern (`bounded-chunk-size`: 240-420 -> 555-695 -> 773). The `size:exception` was granted against
the 440-480 figure; the actual overshot it by 24-35%.

## Carried forward — open, recorded, not fixed

1. **The behavioural effect of the both-ellipsis shift is unmeasured.** Supporting fragments carrying
   `…` on both edges went 0% -> 78.4% (`ejemplos/`) / 84.4% (external corpus). The `…` signal's
   meaning weakens from "more after this" to "more on both sides". This is the deleted requirement's
   own predicted failure mode, materialising. It is accepted on the reasoning that a fragment showing
   the matched terms routes better than one showing unrelated opening prose — **a term-coverage
   proxy, not an observation of an agent routing.** The falsifying observable is recorded in
   `design.md`: agent traces showing *more* `read_doc` chaining on supporting hits. If this change is
   ever reverted, that is the first thing to read.
2. **Canary #2's assertion is probabilistic.** `some(excerpt.startsWith("…"))` over four supporting
   fragments of one goldenset query rests on a corpus-wide 78.4% rate. Measured 4-of-4 at verify time
   — comfortably non-marginal today, unproven under future corpus drift. The documented response is
   to move the test to another goldenset query and record both, never to drop the assertion.
3. **`matchedTerms` metadata is deferred to its own SDD cycle** by explicit user decision. Recorded
   as a greppable named follow-up in `AGENTS.md`, on the `isFenceDelimiter` precedent — an archived
   report is where deferrals go to be forgotten in this repository.
4. **Lever B rejected outright** (raising the budget: falsified by measurement, not deferred).
   **Lever C deferred** (`selectMatchCentre`'s rarity-versus-distinctness scoring): it changes rank-0
   behaviour on every search, `compendio eval` is structurally blind to that regression, and no
   committed fixture reproduces the discriminating shape. It needs its own fixture and its own
   excerpt-content gate.
5. **`Decision N` citations are overloaded repo-wide.** "Decision 7" has 16 occurrences across
   `src/` and `test/` from two different archived designs, and "Decision 8" has at least three live
   citations pointing at three different designs — to which this change adds a fourth meaning.
   Nothing was at risk this cycle (none of those citations live in a file this change edits), so the
   convention fix was deliberately not bundled in. **The next change that has to disambiguate a bare
   `Decision N` citation should fix the convention**, citing by change slug instead of bare number.
6. **`isFenceDelimiter`'s relocation trigger remains deferred** — unchanged by this cycle; recorded
   here only so the pointer is not lost.
