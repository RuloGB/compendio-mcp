# Design: Match Query Terms on Word Boundaries, Not Substrings

## Technical Approach

One filter, inside `locateSpans`' existing scan loop (`src/domain/match-location.ts:76-84`): an
occurrence is emitted only when both of its ends sit at a string edge or against a
non-`[\p{L}\p{N}]` character. Everything else in the pipeline is untouched — `tokenizeQuery`,
`toFtsQuery`, `selectMatchCentre`, `excerpt.ts`, `search-documents.ts`. The module stays **pure**
(`match-location.ts:1-5`); no port, no injectable dependency, no renegotiation of that header.

### Flow (the insertion point, and one trap)

```
query ─ tokenizeQuery ─→ terms ─┬─→ toFtsQuery ──→ FTS5 MATCH        (unchanged, byte-identical)
                                └─→ locateSpans(chunk.content, terms)
                                      foldRawWithMap → foldedRaw + map
                                      indexOf loop ──→ [NEW] boundary test in FOLDED coords
                                                   ──→ map back to raw → MatchSpan
                                                   ──→ searchFrom = idx + 1   ← ALWAYS
                                      ↓
                        buildExcerpt → mapSpansToFlat → selectMatchCentre → computeWindow
```

**Trap**: a rejected occurrence must `continue` the scan, never `break`. `"charged charge"` rejects
at 0 and accepts at 8. The `searchFrom = idx + 1` advance stays exactly where it is.

## Architecture Decisions

### Decision 1 — W2 is measured by recomputing SPANS, not by reading excerpt text

| Option | Verdict |
|---|---|
| (a) Probe calls `dist/`'s own `locateSpans` on the resolved chunk and classifies each emitted span against the chunk's raw text | **Chosen** |
| (b) Widen `SearchResultItem` to emit spans | Rejected |
| (c) Proxy over the returned excerpt TEXT | Rejected — **technically broken** |

**Rationale.** `SearchResultItem` is `{path, title, section, excerpt, score, status?}` — verified; the
pipeline emits no spans, so W2 as the proposal words it has no observable. (c) cannot be repaired:
excerpt text shows *content*, not the *decision*. A window correctly centred on a genuine span will
routinely still contain `timestamp` beside the term `time`, so (c) is non-zero after a correct fix —
an unfalsifiable gate, worse than none. (b) widens the MCP contract for a test, and collides with
the `matchedTerms` deferral `AGENTS.md` already records.

The probe-family rule — *observe the excerpt the pipeline produced, never recompute one to compare
against itself* — exists to stop a probe re-deriving **the artifact it judges** with reimplemented
logic. (a) does neither: it calls the production function under test, and the artifact judged (a
span) is an input to the excerpt, not the excerpt.

**What this costs, stated plainly.** W2 proves the predicate was **applied**, corpus-wide, through
the real pipeline (`createContainer`, hybrid, default `k`) — not that it is **right**. Predicate
correctness is owned by the unit tests (Decisions 3-4). Two guards keep W2 from being a tautology:
the probe's classifier is written **independently, in raw coordinates**, and the production predicate
is **not exported** so the probe cannot import it (Decision 3). Because folded rejection is strictly
stricter than raw rejection (Decision 2), the raw classifier can only under-count — it can never
raise a false `THE FIX DID NOT LAND`. W1 and W2 are the same classifier over the BEFORE and AFTER
trees; W1's population is the returned fragments only (proposal open question 3: confirmed —
`strict-cost.mjs`'s shape), with `boundary-probe.mjs`'s corpus-wide classification kept as W5 colour.

### Decision 2 — the boundary test runs in FOLDED coordinates

**Choice**: test `foldedRaw[idx - 1]` and `foldedRaw[idx + foldedTerm.length]`, before mapping to
raw. **Rejected**: raw coordinates (`raw[span.start - 1]`, `raw[span.end]`) — which is what
`strict-cost.mjs` measured with.

**Rationale**: raw is not normalization-form invariant. `"áthe"` written NFD (`a` + U+0301 + `the`)
puts a bare combining mark at `raw[start - 1]`; a mark is `\p{M}`, so raw **accepts** a span that is
plainly a word interior. The same text written NFC puts `á` there and raw **rejects** it. Folded
coordinates give one answer for both, and are where the match itself was made. The end side cannot
disagree at all: `map[endFoldedIndex]` already skips characters that folded away.

Folded is therefore strictly stricter than raw. Consequence for the evidence: §4.6.4's `0/110` and
`0/50` are **raw-mode** numbers and are a lower bound on strictness, not this design's result — the
gate re-measures (Gate B). Pinned by a test on a decomposed-accent input; closes residual
divergence 4 (*"a combining mark adjacent to a span may read as a word boundary"* — under this
choice, it does not).

### Decision 3 — the predicate, and where it lives

Boundary = index out of range, or the character there does not match `/[\p{L}\p{N}]/u`.

| Case | Result | Aligned with FTS5 `unicode61`? |
|---|---|---|
| String edge | boundary | yes |
| `_` (`time_stamp` ← `time`) | boundary — `_` is neither `\p{L}` nor `\p{N}` | yes (unicode61 treats it as a separator) |
| Digit beside letter (`v2` ← `v`) | **not** a boundary → rejected | yes (`v2` is one token) |
| Lone surrogate half beside an astral letter | reads as boundary → span kept | **no** — named non-guarantee 5 |

**Placement**: a module-private `const WORD_CHAR = /[\p{L}\p{N}]/u` + helper beside `tokenizeQuery`
in `match-location.ts`. **Deliberately not exported and not a new module.** Non-export is
load-bearing, not tidiness: an exported predicate is one the probe would import, which is exactly
what makes W2 tautological. This puts the class literal in `src/` twice
(`tokenizeQuery`'s `[^\p{L}\p{N}]+` split and the new predicate); that duplication is accepted, and —
learning from `isFenceDelimiter`'s three silent deferrals — the extraction trigger is named here:
**a third in-`src` occurrence, or the first non-test importer, moves it to its own domain module.**
Deferral count: 0.

### Decision 4 — the canary is inverted, and demonstrated RED first

`test/domain/match-location.test.ts:96-107` becomes a positive assertion of the new behaviour:
`locateSpans("theta value", ["the", "theta"])` yields exactly `[{start: 0, end: 5, term: "theta"}]`,
plus a standalone `locateSpans("theta value", ["the"])` → `[]`. The comment stating "both should be
found" is rewritten, never deleted into silence.

**RED demonstration** — note it is *cheaper* than the probe's: vitest runs from `src/`, so under
strict TDD the rewritten test is authored and run **before** the predicate exists, and its failure
diff (received still carrying `{start: 0, end: 3, term: "the"}`) is the transcript. No `git stash`,
no `dist/` rebuild. The probe's RED (Gate C) is the one that needs a `src/domain/match-location.ts`-
only revert plus `npm run build`. The transcript must show the assertion diff / the failure message,
never merely a non-zero exit — `retrieval-open-work.md:218-222` records that exact fake.

### Decision 5 — centre movement is reported, never gated

Fewer spans means `selectMatchCentre` sees a smaller input, so some fragments' chosen centre WILL
move. **This design does not gate on that, and does not claim the resulting excerpts read better.**

**Rationale**: a moved centre is the change working (a spurious span stopped pulling the window), so
any threshold would penalise the intended effect; there is no excerpt-quality metric in the
repository (`compendio eval` is structurally blind — exploration §6), so a threshold would be the
tolerance-band theatre `bounded-chunk-size` Gate 2 warns against. **What IS gated is the floor**:
W3 === 0, no fragment loses match-centring. Above that floor, excerpt quality change is
**unmeasured and accepted**. W5 gains a reported sub-count — fragments whose selected centre moved —
with two verbatim before/after excerpt pairs in `verify-report.md` so a reviewer can eyeball rather
than trust. **Reopen trigger**, named so it is not rediscovered: agent traces showing supporting hits
driving excess `read_doc` chaining — the same trigger already recorded for `matchedTerms`.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/match-location.ts` | Modify | Private `WORD_CHAR` predicate + folded-coordinate boundary test in the scan loop; doc comment `:57-65` updated to state whole-token semantics |
| `test/domain/match-location.test.ts` | Modify | Canary inverted (Decision 4); new prefix/interior/suffix/exact + decomposed-accent cases. **The only existing test file that may change** (Gate D) |
| `scripts/word-boundary-probe.mjs` | Create | W0-W5, five distinct failure messages, `--compare-digest`; imports `dist/`, drives `createContainer` |
| `openspec/specs/mcp-contract/spec.md` | Modify | Narrowing delta |
| `AGENTS.md` | Modify | Non-obvious-decision bullet + manual-gate section |
| `src/domain/excerpt.ts`, `src/application/search-documents.ts`, `src/server.ts` | **No change** | Outcome changes, shape does not |

## Interfaces / Contracts

`MatchSpan`, `locateSpans`' signature and `SearchResultItem` are all unchanged. The only contract
movement is semantic: **"a locatable query term" now means a whole token.** Spec's call whether that
is one new `mcp-contract` requirement or two clauses; recommendation — **one new requirement**
("Located Spans Are Whole-Token Matches") carrying the five non-guarantees (folding still narrower
than `remove_diacritics 2`; our tokenizer's class, not `unicode61`'s; no stemming either way;
Decision 2 closes the combining-mark case; astral-adjacency from Decision 3), plus a one-line
narrowing on each of the two window requirements pointing at it.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | Predicate correctness: exact / prefix / interior / suffix, `_`, digit-adjacency, string edges, folded `DUPLICADO` + `dirección` (must stay green), decomposed-accent pin for Decision 2 | Vitest, `test/domain/match-location.test.ts`, RED-first |
| Integration | None new — no call-site shape changes | Existing suite must stay green unchanged (Gate D) |
| System gate | W0-W5 over the real pipeline on `ejemplos/` hybrid | `scripts/word-boundary-probe.mjs`, `npm run build` between runs, **no reindex** |
| Anti-verification | Every gate observed RED: W2 (revert `match-location.ts` only), W1 (nonsense query set, both tree states), W3 (deliberately over-strict patch) | Transcripts quoting the messages |

## Migration / Rollout

No migration. Nothing is persisted: spans and excerpts are computed at query time, the schema, the
FTS5 tokenizer and the emitted MATCH string are untouched. `npm run build`; a running
`compendio serve` picks it up on restart. Beta, no installed users — no shim, no schema marker.

## Open Questions

- [ ] Spec's call: one new `mcp-contract` requirement vs two clauses (recommendation above).
- [ ] `sdd-tasks` must forecast budget risk; the proposal already flags Medium-to-High and prefers a
      single PR with `size:exception` over splitting the gate from the change it gates.

---

## Orchestrator addendum — Decision 2 verified, and a gate gap it opens (measured 2026-09-06)

Decision 2's normalization-form argument was flagged in the phase result as *derived, not measured*.
The orchestrator measured it.

**The asymmetry is real**, reproduced against compiled `dist/`:

| input | span | `raw[start-1]` | `/[\p{L}\p{N}]/u` | raw-coordinate verdict |
|---|---|---|---|---|
| `"áthe value"` NFC | 1-4 | `"á"` | true | correctly **rejected** |
| `"áthe value"` NFD | 2-5 | U+0301 combining acute | **false** | wrongly **accepted** |

Same text, two normalization forms, opposite answers in raw coordinates. Folded coordinates yield
`"a"` in both and reject both. The directional claim also holds by construction: `foldForMatch`
lowercases and strips combining marks and never turns a letter into a non-letter, so **folded is
strictly stricter than raw, never the reverse**. Decision 2 stands.

**But the corpora cannot currently test it.** Stored chunk content that is not already NFC:

| corpus | chunks | not already NFC |
|---|---|---|
| `ejemplos/` | 29 | **0** |
| `DocuTests2` | 888 | **0** |

Three consequences:

1. On today's data, folded and raw coordinates produce **identical** results. Exploration §4.6.4's
   `0/110` and `0/50` therefore do hold in practice — but by accident of the corpora, not by design.
   Gate B must still re-measure, and the design's "raw-mode lower bound" framing is the right one.
2. The case for folded is **robustness**, not an observed defect: a Markdown file saved from macOS
   or passed through an NFD-normalizing tool triggers it, and the failure is silent.
3. **The gate gap.** With zero NFD content anywhere, no committed corpus can distinguish the folded
   implementation from the raw one. That half of Decision 2 would ship with **no test capable of
   failing** — this project's own standing rule ("a gate never observed failing has not been
   verified") forbids that. **`sdd-spec` and `sdd-tasks` must require an NFD fixture** — a unit
   test over `locateSpans` with decomposed input is the cheapest sufficient form, and it also
   discharges the phase result's own open item ("apply should pin it with the decomposed-accent test
   before relying on it"). If a fixture file is used instead of an inline string, remember that
   `.gitattributes` governs line endings but nothing governs normalization form: a normalizing
   editor can silently revert the fixture, so the test must assert its own input is NFD before
   asserting behaviour, per `test/fixtures/excerpt-window/`'s self-asserted-precondition pattern.
