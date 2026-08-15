# Exploration — fence-aware flatten for `search_docs` excerpts

**Change**: `excerpt-fence-aware-flatten`
**Date**: 2026-08-15
**Phase**: `sdd-explore`
**Artifact store**: openspec
**Status**: done — ready for proposal

## Origin

An open item recorded at the close of a previous change,
`openspec/changes/archive/2026-08-15-read-doc-fence-aware-sections/archive-report.md:229`:

> **`src/domain/flatten-map.ts:92`**: Same fence-blindness issue affects `search_docs` excerpts.
> Deliberately untouched here; deserves its own change. Confirmed by diff: zero-line change to this file.

Its origin is finding 1.4 of `code-review-src-2026-08-14.md`, whose `read_doc` half was already fixed
and archived as `2026-08-15-read-doc-fence-aware-sections`. This exploration covers the half that was
left open.

## Evidence status

The `sdd-explore` sub-agent ran without `Bash` or `Write` tools, so its findings are static analysis
and hand-traced execution, labeled INFERRED throughout. The orchestrator then executed the real
`flattenWithMap` from `dist/` against the inputs the exploration named. **Section 0 (Measurement
addendum) records what was actually measured**; where a measurement confirms or corrects an inferred
claim, that is stated explicitly. Claims not covered by section 0 remain INFERRED.

---

## 0. Measurement addendum (MEASURED by the orchestrator, `dist/domain/flatten-map.js`, Node v22.22.0)

A probe script imported the production `flattenWithMap` and ran both passes over four inputs. The
"12. Templates" section of this repository's own `docs/documentation-convention.md` was extracted with
a **fence-aware** line scan; a naive `^##\s` scan stops at line 180 (`## Context and objective`, which
lives *inside* the template fence) and yields a truncated 18-line, 291-char section that measures
nothing interesting — the extraction tool reproducing the very defect under study. The correct section
is lines 162–261, 100 lines, 1 484 chars.

| Input | `dropFencedBlocks: true` | `dropFencedBlocks: false` | Verdict |
|---|---|---|---|
| Real `#12 Templates` section (1 484 chars) | **0 chars (empty)** | 774 chars | Fallback at `excerpt.ts:68` **is live on this repo** |
| Backtick fence containing a backtick | 50 chars, code leaks | 50 chars, identical | S2 makes **zero** replacements |
| Tilde fence (`~~~`) with `#` comment | 52 chars, fence never dropped | 52 chars, identical | S2 does not recognize `~~~` at all |
| Backtick fence with `#` comment | `"Prose before. Prose after."` | `"Prose before. python print('hi') Prose after."` | **S1 defect, isolated** |

Token-presence check on the real Templates section — present in the raw markdown, absent from **both**
flatten passes: `Business rules`, `Use cases`, `Out of scope`.

Four consequences, all measured:

1. **The cited S1 defect is real and reachable on production content.** The last row isolates it
   cleanly: with `dropFencedBlocks: false`, the fence's code survives (`python print('hi')`) while the
   `# a python comment` line is gone. Nothing but S1 removed it.
2. **The `dropFencedBlocks` fallback does not rescue anything S1 destroyed.** The real Templates
   section flattens to the empty string on the first pass — the exact trigger for
   `excerpt.ts:68`'s second pass — and the second pass still contains none of the three heading names.
   The exploration's central hand-traced claim is **confirmed by execution**.
3. **S2 has two independent gaps of its own**, both measured: a backtick-fence containing an interior
   backtick matches nothing (`[^`]*` cannot cross it), so the code leaks into the excerpt as prose;
   and `~~~` fences are outside its regex entirely, so tilde-fenced code is never dropped in either
   pass. These are the *opposite* failure direction from S1's (content leaks in rather than being
   lost) and are what the scope fork in section 6 is about.
4. **The real corpus impact is not hypothetical**: a `search_docs` query matching this chunk on the
   words "business rules" retrieves it (FTS indexes raw content, unaffected) and returns an excerpt
   containing none of the matched vocabulary.

### 0b. Second measurement round — against the STORED chunk (post-proposal)

The proposal flagged, correctly, that section 0 measured a *hand-extracted* section while `search_docs`
operates on the **stored chunk**, whose boundaries and fence-delimiter parity could differ — and that an
odd count would put the motivating case into non-guarantee 1/2, leaving the fix correct but its live
example unreached. That was its risk 2 and its question 4. Both are now closed by measurement.

Ran `node dist/cli.js --root . index --lexical` (13 chunks for `docs/documentation-convention.md`), then
read the stored rows directly and applied the production `isFenceDelimiter`:

| Property of the stored `12. Templates` chunk | Measured |
|---|---|
| Chunk length | 1 473 chars (hand-extracted was 1 484 — same section) |
| Fence delimiter lines | **8 — EVEN, the balanced gate FIRES** |
| `dropFencedBlocks: true` | 0 chars — fallback at `excerpt.ts:68` taken |
| `dropFencedBlocks: false` | 774 chars |
| `Business rules` / `Use cases` / `Out of scope` / `Context and objective` | present in raw, **absent from both passes** |

The stored chunk reproduces the hand-extracted result exactly. **The "live on this repository" framing
holds and does not need retracting.**

Two further corpus-wide measurements over all 13 stored chunks:

- **Chunks with an odd delimiter count: 0 of 13.** Non-guarantees 1 and 2 are not exercised anywhere in
  this document; the gate fires on every chunk.
- **Fence-interior `#`-lines the fix will newly retain: 21. Of those, containing a backtick: 0.**

That second figure closes the proposal's risk 1 (retaining a line could inject a backtick into the
string S2 scans, breaking `` /```[^`]*```/g `` where it previously matched) for this corpus: the
mechanism is real but has **zero live instances here**. Note the trap in a naive check — filtering *all*
`#`-lines containing a backtick returns 4 hits (`### Functional specification (\`docs/functional/\`)` and
its siblings), but those sit **outside** the fences, are still dropped after the fix, and carry an even
number of backticks anyway. Only fence-*interior* lines are relevant, and there are none with backticks.
Gate 4 should still run — this measures one corpus, not the mechanism.

---

## 1. Current state

`flattenWithMap` (`src/domain/flatten-map.ts:27-49`) is a 6-step pipeline: **S1** `stripHeadingLines`
→ **S2** conditional fenced-block drop → **S3** strip `` `*_>| `` → **S4** resolve markdown links →
**S5** collapse whitespace → **S6** trim. It has exactly one production call site, `buildExcerpt`
(`src/domain/excerpt.ts:61,68`), which itself has one caller, `SearchDocuments.execute`
(`src/application/search-documents.ts:128`), passing `chunk.content` — the same chunk-local,
already-persisted string `read_doc`'s `headingsIn` (`src/application/read-document.ts:167`) consumes.

Line 92, inside `stripHeadingLines`:

```ts
if (/^\s*#{1,6}\s/.test(line)) continue;
```

This runs unconditionally, on every line of the raw chunk markdown, with zero fence awareness — no
distinction between a real ATX heading and a `#`-prefixed line inside a fenced code block (a
Python/shell/YAML comment, or a markdown-template example).

## 2. Reachability

**S1 runs once, unconditionally, before the `dropFencedBlocks` branch** (line 29 vs. the `if` at line
32). `flattenWithMap(markdown, true)` and `flattenWithMap(markdown, false)` call the *same*
`stripHeadingLines` on the *same* raw string. The flag only controls S2; it does not restore anything
S1 already dropped. Confirmed by measurement — see section 0, rows 1 and 4.

Sub-cases examined:

- **(a) The `dropFencedBlocks: false` fallback** — a section whose body is entirely fenced. MEASURED
  live on `docs/documentation-convention.md` §12: first pass empty, fallback taken, heading names
  still absent.
- **(b) Fence containing a literal backtick** — S2's `/```[^`]*```/g` cannot cross interior backticks,
  so no match occurs anywhere and the fence survives S2 untouched; S3 then blanks each backtick into a
  space, leaking code into the excerpt as prose. MEASURED.
- **(c) Tilde fence** — S2 is backtick-only and never recognizes `~~~`. Its `#`-prefixed lines are
  still dropped by S1, confirming the defect is not backtick-fence-specific. MEASURED.
- **(d) Can S1's line removal change S2's delimiter pairing?** INFERRED: no. A heading line by
  definition starts with `#`, never a backtick, so removing it deletes zero backticks and S2's pairing
  is unaffected. One theoretical exception — a heading line carrying an *unmatched* inline-code
  backtick — was searched for in `docs/documentation-convention.md` and not found; recorded as a
  low-probability residual risk, not a live finding. Separately, an **unterminated** fence followed by
  a closed one causes S2 to mis-pair openers, swallowing intervening prose and leaking the second
  fence's content. Pre-existing, independent of S1.

## 3. Blast radius on the offset map

- **Invariants I1–I4 are preserved by any correct "keep more lines" change.** The map-emission
  machinery for a *kept* line is already generic and unconditional; a fence-aware fix only gates the
  existing `continue` at line 92 with an additional `&& !inFence`. No new map machinery is required.
- **The single largest concrete item**: `test/domain/flatten-map.test.ts` contains `referenceFlatten`
  (lines 10–23), a hand-copied, deliberately fence-blind reimplementation of today's S1 regex, and the
  I4 test asserts `flattenWithMap` is byte-identical to it for every fixture. **Verified by reading the
  file.** None of the current `GENERATED_INPUTS` fixtures place a `#`-line *inside* a fence (the
  "fenced code block, dropped" fixture is `const x = 1; console.log(x);`; the "all-fenced input
  (two-pass case)" fixture is `type: functional`), so I4 would likely still pass today's fixtures —
  but its premise is exactly what the fix must break for any *new* fixture. This needs explicit
  handling in design and tasks, not silent surprise.
- `toFlatOffset` / `mapSpansToFlat` / `selectMatchCentre`: a match landing inside a currently-stripped
  fence-interior heading line is today silently un-locatable — `toFlatOffset` resolves a destroyed raw
  offset forward, so the span collapses to `end === start` and is filtered out at `excerpt.ts:98`. A
  fence-aware fix makes such spans locatable: a behavior improvement, but a behavior change, worth
  naming in design.
- `test/domain/excerpt.test.ts`'s two fenced-content cases (lines 31–43) use fence bodies with no
  `#`-line inside; unaffected by a scoped S1 fix.
- `test/fixtures/excerpt-window/docs/`: grepped for fence delimiters — **zero matches**. That suite is
  structurally unaffected.
- `scripts/excerpt-offset-distribution.mjs` has no hard-coded pass/fail on specific offsets — a
  measurement to re-run, not a test that can break.

## 4. Is dropping heading lines even right inside a fence?

Two distinct questions:

- **Should a `#`-prefixed line inside a fence be kept?** Yes. S1's stated purpose is stripping
  *markdown headings* because the matched chunk's heading is already surfaced separately as
  `SearchResultItem.section` (`search-documents.ts:127`). That rationale has no application to
  fence-interior content, which is illustrative content the corpus author wrote deliberately.
- **Is there any case where keeping it makes the excerpt worse?** One plausible, unmeasured quality
  risk: a fence packed with several short heading-like lines (exactly the Templates case) could, once
  kept, read as a terse fragment list rather than prose inside the 120-char
  `SUPPORTING_EXCERPT_CHARS` budget. A minor quality tradeoff, not a correctness defect — and strictly
  better than the status quo, where that budget is spent on YAML noise with zero matched vocabulary.

## 5. Precedent reuse — `isFenceDelimiter` + the balanced gate

Strong structural fit:

- **Same input granularity**: both `headingsIn(chunk.content)` and `buildExcerpt(chunk.content, …)`
  operate on the identical chunk-local string.
- `isFenceDelimiter` (`src/domain/split-text.ts:98`, `` /^\s*(```|~~~)/ ``) is prefix-only with no
  `$` anchor — already CRLF-safe by construction — and already handles `~~~`, unlike S2's own regex.
  Verified present and exported.
- The mechanical change is small: S1 already computes `lines = markdown.split("\n")`; adding a
  balanced-count check and an `inFence` toggle mirrors `headingsIn` almost verbatim, gating the
  existing drop condition. No new map-tracking logic.
- Hexagonal boundary: `split-text.ts` and `flatten-map.ts` are both `src/domain/`. Domain-to-domain
  import, no port needed. Compliant.

**The four documented non-guarantees, checked one by one:**

1. **Unterminated fence** — carries over in shape, but the *consequence differs in polarity*. For
   `headingsIn`, "uncertain → don't suppress" leaves a phantom heading wrongly addressable. For S1,
   "uncertain → don't treat as fenced" means the heading drop still happens — i.e. the original bug
   simply is not fixed for that chunk, **not a new regression**. A minimal balanced-gate fix is
   partial by construction; say so up front.
2. **Chunk-crossing fence** — same shape, same reasoning. LOWER CONFIDENCE, UNVERIFIED: whether
   `RemarkMarkdownParser`'s AST-based outline extraction can even produce a chunk boundary splitting a
   fence is unknown (per CommonMark an unterminated fence consumes the rest of the document as code,
   which would suppress subsequent heading nodes at the AST level). Flagged, not asserted.
3. **4-space indented code block** — carries over unchanged. No fence delimiter exists to detect, so a
   `#`-prefixed line inside an indented block is still incorrectly stripped after the fix.
4. **Misaligned-even parity hole** — changes shape, with an **inverted and milder** consequence. For
   `headingsIn` it makes a real heading unreachable (the accepted-worse direction). For S1 the mirror
   case misclassifies a real document heading as fence-interior and **keeps** it, leaking a heading
   name into the excerpt body as prose — cosmetically odd, not a correctness break. Name this
   distinction explicitly in design rather than assuming symmetry with the archived change.

## 6. CRLF

Line 92's regex `/^\s*#{1,6}\s/` has **no `$` anchor at all** — a pure prefix test with no requirement
to reach end-of-line, so a trailing `\r` left by `split("\n")` on CRLF content cannot affect whether
it matches. **The "not vulnerable" claim is confirmed by reading the exact pattern**, not repeated on
trust. Any new fence-aware regex should follow `isFenceDelimiter`'s own anchor-free, prefix-only shape
to inherit the same immunity, sidestepping the archived change's CRLF regression class entirely —
which bit `read-document.ts`'s `HEADING_LINE` (`/^#{2,6}\s+(.+)\r?$/`) precisely because that pattern
does need to capture to end-of-line. `docs/documentation-convention.md` is CRLF-encoded and is the
live probe.

## 7. Scope fork (for the proposal phase to decide, not decided here)

Three issues surfaced in the same pipeline, of different character:

- **S1 (line 92, the cited defect)** — heading-pattern lines dropped inside fences, unconditionally.
  Directly matches the code-review finding and the archived open item. Minimal, surgical fix.
- **S2 (backtick-only regex)** — does not recognize `~~~` at all, and fails silently on any
  backtick-fence containing an interior backtick. Both cause fenced *content to leak into* the
  excerpt: the opposite failure direction from S1's. MEASURED, section 0.
- **S3 (`` [`*_>|] `` blanking unconditionally)** — a pre-existing, deliberate design choice rather
  than fence blindness. Arguably out of scope even for a broader fix.

### Approach 1 — Minimal: fence-aware S1 only

Reuse `isFenceDelimiter` + a balanced-count gate, mirroring `headingsIn`.

- **Pros**: directly matches the cited defect and archived open item; smallest diff; zero new domain
  surface; CRLF-safe by construction; no currently-passing suite outside the I4 golden reference is
  affected (checked `excerpt.test.ts` and the `excerpt-window` fixtures directly).
- **Cons**: leaves S2's `~~~`/embedded-backtick gaps unfixed; partial by construction for
  unterminated and chunk-crossing fences, same accepted limitation as `headingsIn`.
- **Effort**: Low.

### Approach 2 — Broader: also fix S2's fence recognition

Support `~~~` and tolerate embedded backticks.

- **Pros**: closes the whole fence-blindness theme in this file at once.
- **Cons**: roughly doubles the blast radius — a second regex to design and CRLF-verify, more
  golden-reference divergence, more test surface; goes beyond what the open item and code-review
  finding named.
- **Effort**: Medium.

### Recommendation

Approach 1 (minimal, S1-only) for this change, with S2's `~~~` and embedded-backtick gaps recorded as
an explicit named follow-up — mirroring exactly how this exploration itself originated as a scoped-out
follow-up. Note that the measurement in section 0 raises the stakes on that follow-up: the S2 gaps are
confirmed live, not theoretical. This is a recommendation for the proposal phase to weigh, not a
decision made here.

## 8. Constraint verification

- **Hexagonal boundary**: reusing `isFenceDelimiter` is a domain-to-domain import. No SQLite,
  transformers.js, or filesystem dependency introduced. Compliant.
- **No reindex needed** — verified by tracing the call path, not assumed. `SearchDocuments.execute`
  calls `buildExcerpt(chunk.content, …)` at **query time**, on content read live from SQLite on every
  search. Nothing about excerpt computation is persisted. Unlike `chunk.maxTokens` or heading changes,
  which alter *stored* rows and need a full `compendio index`, this fix takes effect on the very next
  `search_docs` call. The opposite mechanism from the chunk-boundary caveat in `CLAUDE.md`.
- **Beta, no migrations**: no schema or contract compatibility work is implicated. Only the text a
  `search_docs` excerpt contains changes, not the tool's response shape.

## 9. Risks carried into the proposal

- The I4 golden-reference test is a deliberate change-detector against a fence-blind reference. It
  **will** need an intentional update. If this is missed, either the fix cannot ship or someone
  "fixes" the test by reverting the fence-awareness.
- The minimal fix is provably partial for unterminated and chunk-crossing fences. Document up front,
  as `headingsIn`'s non-guarantees were, rather than discovering it during verify.
- The `RemarkMarkdownParser` AST-fence-consumption sub-claim (non-guarantee 2) is unverified and
  lower-confidence.
- Sub-agent claims outside section 0 remain hand-traced. Design and apply should convert the ones they
  depend on into measurements, following this repo's `vector-reach.mjs` / `section-lookup.mjs`
  precedent.

## Ready for proposal

Yes. The defect, its reachability mechanism, the precedent to reuse, the CRLF non-issue, and the scope
fork are identified with code-level evidence, and the central reachability claim has been executed
rather than argued.
