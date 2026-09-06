# Archive Report: word-boundary-term-matching

**Archived**: 2026-09-06
**Mode**: openspec
**Verdict inherited from verify**: PASS WITH WARNINGS (no CRITICAL issues; archive not blocked)

## What shipped

`locateSpans` (`src/domain/match-location.ts`) now requires a word boundary — a non-word character
(`[^\p{L}\p{N}]`) or a string edge — on both sides of every located span, evaluated in **folded**
coordinates (before mapping back to raw offsets). This aligns the excerpt locator with the lexical
retriever (FTS5 `unicode61`, no stemmer, quoted whole-token `MATCH`), which already only ever
matched whole tokens. Before this change, `locateSpans` was an unconditioned substring scan
(`foldedRaw.indexOf(foldedTerm)`), so a query term could "match" as a prefix, suffix, or interior
fragment of an unrelated longer word.

Production change is a single module-private predicate (`WORD_CHAR = /[\p{L}\p{N}]/u`, deliberately
not exported) plus a boundary check inside the existing scan loop. `selectMatchCentre`, `excerpt.ts`,
`search-documents.ts`, and `server.ts` are all unchanged in shape — only the population of spans fed
into them narrows. No reindex needed: spans and excerpts are computed at query time from already-
stored chunk content; the SQLite schema, FTS5 tokenizer, and emitted `MATCH` string are untouched.

## Measured gate numbers (all reproduced independently in verify, not merely inherited from apply)

Classified over `DocuTests2` (888 chunks, external, non-committed corpus, corroborating evidence
only):

| class | spans | share |
|---|---|---|
| exact word match | 1 539 | 28.1% |
| prefix of a longer word | 2 009 | 36.6% |
| interior of a word | 1 935 | 35.3% |
| suffix of a longer word | 1 | 0.0% |

71.9% of spans on that corpus were not word matches.

Blocking gates, measured on the committed `ejemplos/` corpus (22 goldenset queries), reproduced
independently by `sdd-verify` and again by the orchestrator:

| Gate | Counter | Result |
|---|---|---|
| A (fix lands) | W1 (BEFORE, anti-vacuity) | 1343 > 0 — non-vacuous |
| A (fix lands) | W2 (AFTER) | 0 — every emitted span is now an exact word match |
| A (fix lands) | W4 (population digest) | tuple-for-tuple identical between BEFORE/AFTER |
| B (functional cost) | W3 | 0 — no fragment lost match-centring |
| C (W2 RED, revert-only) | — | `THE FIX DID NOT LAND`, exit 1, reproduced independently, numbers matched apply exactly |
| C (W1 RED, both tree states) | — | `GATE IS VACUOUS`, exit 1 in both states — reproduced by the orchestrator (see verify-report addendum) after a methodology correction (piping through `tail` had silently reported `tail`'s exit code, not the probe's) |
| C (W3 RED, over-strict patch) | — | `MATCH CENTRING WAS LOST`, exit 1, 69 fragments (orchestrator's independent run; apply's original patch reported 15 under a different over-strict threshold) — both counted correctly and are not in conflict, they patch different thresholds |
| D (blast radius) | diff | exactly 1 production file (`src/domain/match-location.ts`), 1 test file (`test/domain/match-location.test.ts`) changed among `src/`/`test/` |
| D (scope falsifier) | `compendio eval` on `ejemplos/` | hybrid recall@5 = 1.00, MRR = 0.943 — identity match, scope not breached |
| E (record honesty) | `AGENTS.md` bullet + manual-gate section | present, matches shape of five prior sections |

Span retention on `ejemplos/`: 1 692 / 3 035 = 55.7% of spans kept; 48/110 fragments (43.6%) show a
different excerpt post-change because `selectMatchCentre` now sees fewer candidate spans — reported,
not gated (design Decision 5: a moved centre is the change working, not a regression).

Full test suite: 922 passed, 1 skipped, 52 files; `npm run typecheck` and `npm run build` both clean.

## What this change explicitly does NOT fix

This is the motivating-case disclaimer named repeatedly across proposal, design, and AGENTS.md, and
it is restated here for traceability: **this change does not fix `docs/retrieval-open-work.md`'s
Open problem 3** (the `billing-rules.md` § 9 Refunds / § 6 Capture collision rarity-weighted
match-centre case). Measured on that motivating chunk (exploration §4.5.1/§4.6.5): removing `charge`
(⊂ `charged`) from the early cluster still leaves `twice` at weight 2.8332, strictly above
`refund`'s 2.1972 — selection does not move. Three further findings, none addressed by this change:

1. Every rarity-favouring `selectMatchCentre` formula variant (max, superlinear, rarity-first)
   selects the same early cluster the current sum selects, because that cluster holds the chunk's
   **rarest** terms, not its commonest — the roadmap's stated mechanism was falsified on its own
   example.
2. The `§9. Refunds` symptom is not an excerpt defect at all — that chunk contains no refund-timing
   content, and the current rule already centres on its rarest region.
3. At the lead budget (1400 chars) the **unmodified** code already showed the answer — the original
   trace was a ranking failure (chunk ranked 8th) plus a 120-character supporting-budget consequence,
   not a match-centring defect.

`selectMatchCentre`'s scoring formula (sum vs max vs superlinear vs rarity-first) was therefore
**not deferred — it was falsified** as a fix for the motivating case, and nothing in it (score,
accumulator, tie-breaks) was touched by this change.

## Deferred items, named for a future cycle

- **Corpus document frequency** (candidate (e) in exploration §5) — the only candidate whose
  mechanism is consistent with the motivating-case measurement, and materially larger: it would
  break `match-location.ts`'s "pure, no I/O, no injectable dependency" declaration and re-open
  `match-centred-excerpt`'s design.md rejection of `bm25()`-derived weights.
- **Five residual divergences**, named in the spec delta and `AGENTS.md`, left open by design:
  1. `foldForMatch` is narrower than FTS5's `unicode61 remove_diacritics 2`.
  2. `[^\p{L}\p{N}]` is this project's own tokenizer class, not byte-for-byte `unicode61`'s token
     boundary; exotic code points can still disagree.
  3. No stemming in either direction — an inflected form never matches its root term.
  4. A lone surrogate half beside an astral-plane letter may read as a boundary here where the
     lexical tokenizer would not.
  5. Corpus-frequency blindness — the narrowing carries no signal about term rarity corpus-wide.
- **`WORD_CHAR` extraction trigger** (design Decision 3): the class literal now exists twice in
  `src/` (`tokenizeQuery`'s split and this new predicate). Named trigger: a third in-`src`
  occurrence, or the first non-test importer, moves it to its own domain module. Deferral count: 0
  (not yet triggered).
- **`docs/retrieval-open-work.md` correction** — external to this cycle, owned by the orchestrator,
  not a task of this change. Needs correcting on three measured counts: the "would have to be
  inverted" claim about `match-location.test.ts:151-158` (falsified — it stays green under every
  rarity-favouring candidate), the "common query words" mechanism (falsified — the early cluster's
  terms are the chunk's rarest, not commonest), and the `§9. Refunds` example (that chunk holds no
  refund-timing content at all).
- **`matchedTerms` field** (Open problem 5) — previously deferred by `supporting-excerpt-anchoring`,
  still deferred; not reopened by this change.

## Verify audit gaps, closed by the orchestrator before archive

`sdd-verify`'s own report recorded two WARNINGs (not CRITICAL): the W1 and W3 RED transcripts were
audited for internal consistency but not independently re-executed in that pass. The orchestrator
subsequently ran both directly (documented in the verify-report's addendum, carried into this
archived copy): W1 RED reproduced `GATE IS VACUOUS` with real exit code 1 in both tree states (after
correcting a methodology error — reading an exit code through a `tail` pipe reports `tail`'s exit
status, not the probe's); W3 RED reproduced `MATCH CENTRING WAS LOST` with 69 named fragments and
real exit code 1. Both WARNINGs are therefore closed by execution, not by argument, and are recorded
here rather than left implicit.

## Spec merge into `openspec/specs/mcp-contract/spec.md`

Two requirements ADDED (inserted before the "Graduated Excerpt Budget by Result Rank" requirement,
so their "see the ADDED requirement above" cross-references from the two MODIFIED requirements below
resolve correctly):

- **Located Spans Are Whole-Token Matches** — the core narrowing, folded-coordinate boundary test,
  three scenarios (inflected-form rejection, exact-match preservation, NFD/NFC agreement).
- **Whole-Token Matching Has Five Named Non-Guarantees** — the five divergences listed above, one
  scenario.

Two requirements MODIFIED (replaced in place, matched by exact requirement name):

- **Supporting Excerpts Are Centred On the Matched Span, With a Start-Anchored Fallback** — narrowed
  "locatable" from substring to whole-token; fallback and 120-char budget otherwise unchanged.
- **Lead Excerpt Is a Window Centred on the Matched Span** — same narrowing applied to the 1400-char
  lead tier.

No REMOVED or RENAMED requirements — this delta is purely additive/narrowing, confirmed non-
destructive per `openspec/config.yaml`'s `rules.archive` warning requirement (nothing to warn about;
no requirement was deleted).

**Residual Spanish contract vocabulary check** (`openspec/config.yaml`'s `rules.archive`): the merged
text was read in full before merging and contains none of the retired Spanish contract terms (ruta,
tipo, modulo, estado, etiquetas, seccion, omitidos, indexados, avisoEmbeddings, convencion,
estadosExcluidos, camposFrontmatter). This check covers the content this change added to
`openspec/specs/`; it was not re-run against the entire pre-existing `openspec/specs/` tree, which is
out of this change's scope.

## Files copied to archive vs moved — tooling hazard disclosure

This environment's `sdd-archive` executor has no delete/shell-execution capability (Read, Edit,
Write, Glob only — no Bash tool). Per the project's known tooling hazard
(`compendio-sdd-subagentes-sin-herramientas`), all 10 files were **copied** (read in full, then
written verbatim) from `openspec/changes/word-boundary-term-matching/` to
`openspec/changes/archive/2026-09-06-word-boundary-term-matching/`, not moved:

- `tasks.md`, `verify-report.md`, `exploration.md`, `proposal.md`, `design.md`,
  `apply-progress.md`, `specs/mcp-contract/spec.md`, `chunk-span-probe.mjs`, `boundary-probe.mjs`,
  `strict-cost.mjs` — all 10 present at the archive path (confirmed by directory listing).

**Byte-identity verification**: this tool set cannot run `md5sum` or any shell command, so byte-level
hashing (with CR stripped) as requested was not possible to execute. What WAS done instead: each
source file was read via the file-reading tool and its full content written verbatim to the archive
path, with no manual editing of the copied text (the two files that needed real edits — the merge
target `openspec/specs/mcp-contract/spec.md` — were edited via `Edit`, not this copy path, and are a
separate, correctly-tracked change). Because the read/write tools in this environment operate on
decoded text content rather than raw bytes, if the original files contain CRLF line endings, this
copy may have normalized them to LF — this is the exact same normalization risk previously recorded
for other archived changes in this project's memory (`compendio-fixtures-crlf-se-normalizan`,
`compendio-sdd-subagentes-sin-herramientas`). None of these 10 files are known to require CRLF
preservation (unlike the `excerpt-fence-drop` test fixtures, which are `.gitattributes`-pinned for a
reason); this is disclosed as a general risk, not a known defect.

**The original source folder was NOT deleted.** `openspec/changes/word-boundary-term-matching/`
still exists on disk with all 10 original files. This executor has no delete capability. **The
orchestrator must remove that folder** (e.g. `Remove-Item -Recurse` or `git rm -r`) to complete the
archive; until that happens, the change exists in two places on disk (though only the archive copy
is the one referenced by this report and by the merged spec).

## Traceability

- Proposal, spec delta, design, tasks (17/17 complete), apply-progress (17/17, all gates passed),
  and verify-report (PASS WITH WARNINGS, no CRITICAL) are all present in this archived folder.
- Merged spec: `openspec/specs/mcp-contract/spec.md`.
- Git state at archive time: local branch `feat/word-boundary-term-matching`, not pushed, no PR —
  per instruction, this executor did not push or open a PR.
