# Proposal: A Chunk Heading Is Never Empty

## Intent

`chunkOutline`'s intro branch pushes `path: [outline.title]` (`src/domain/chunking.ts:37`). For a
document with no H1, `RemarkMarkdownParser` never enters the branch that sets `title`
(`src/infrastructure/markdown/remark-markdown-parser.ts:44-47`), so `outline.title` stays `""`; with
no H2 either, `sections: []` and the whole body lands in `outline.intro`. That single piece goes
through `splitToBound`, and the `flatMap` at `chunking.ts:54-56` copies `p.path` onto **every** string
it returns. `heading: piece.path.join(" > ")` is then `[""].join(" > ")` — `""` — for all of them, by
construction rather than by accident.

Measured on a private corpus (`IMPROVEMENTS.md` §3, 2026-08-05): a 167 KB Word-export manual produced
**89 chunks with 1 distinct heading, `""`**. Same result in the healthy UTF-8 index, so it is
independent of the encoding defect that shipped as `2026-08-06-encoding-aware-reads`.

### The observable consequence, as a consuming agent experiences it

| Call | What comes back today |
|---|---|
| `search_docs` | `"section": ""` (`src/application/search-documents.ts:120`) — the routing field is blank |
| `read_doc({ path, section })` | Never matches: no chunk heading, and `headingsIn` requires `^#{2,6}` (`read-document.ts:105`) |
| The recovery path | `availableSections` is a `Set` collapsing to `{""}` (`read-document.ts:80-92`), rendered by `server.ts:208-213` as `Available sections:` followed by the literal line `- ` |
| The only working call left | `read_doc({ path })` → the entire ~167 KB body |

Read that column as a sequence, because that is the sequence an agent runs: it pays for a search, gets
a blank signpost, spends a `read_doc` that cannot match, reads a section list naming nothing, and its
only remaining move is the single most expensive call the server offers. **Three calls to arrive at
the worst one.** The failure is not that a field is empty; it is that every cheaper path is closed and
the recovery message actively fails to say so.

### Why now

Third and last of the three defects measured on 2026-08-05; improvements 1 and 2 shipped as
`2026-08-06-encoding-aware-reads` and `2026-08-06-match-centred-excerpt`. The excerpt cycle recorded
the interaction explicitly in its own Out of Scope table: a heading-less document's blank `section`
shifts routing load onto the excerpt, and centring "softens that symptom; it does not address the
defect". This is the change that addresses it.

And the input shape is not exotic. A Word export has no markdown headings at all — that is the
premise `scripts/generate-perf-corpus.mjs:16-18` is built on, and the reason the committed fixture
below exists.

### Corrections and sharpenings this proposal carries forward

Four claims were checked against source before writing this. Two correct prior documents, two are new.

1. **`IMPROVEMENTS.md:219` is wrong.** It reasons that a human-readable `section` is preferable
   because "a human-readable value is also what `docs_overview` and `INDEX.md` consume". They do not.
   `Overview`/`OverviewLine` (`src/application/get-overview.ts:6-18`) and `IndexEntry`
   (`src/domain/index-markdown.ts:9`) carry `path`/`title`/`summary`/`type`/`status` only; grep for
   `heading` or `section` across both files returns zero hits. Both consume the **document-level**
   `title`. Verified three times (exploration §3(f), orchestrator §0, again here). **Nothing in this
   change may be designed for those two surfaces.**
2. **A green suite says nothing about this defect.** `test/domain/chunking.test.ts:169-184`, named for
   the heading-less shape, cannot reach it: the `outline()` helper hardcodes `title: "Test doc"`
   (`chunking.test.ts:13-15`), so every chunk it produces carries a non-empty heading. Confirmed by
   search: no test constructs a `DocOutline` with `title: ""`, and no test anywhere asserts an empty
   `heading` — the only `title: ""` hits in `test/` are `convention.test.ts:69,187`, exercising the
   resolver, never chunking. `formatReadResult` has no dedicated test at all. **Zero coverage.**
3. **New — a committed fixture already reproduces the defect, and nobody noticed.** All six documents
   under `test/fixtures/vector-reach/docs/` contain **zero markdown headings of any level** (verified:
   `^#` matches nothing across the directory). Every one of them is the reported case. The manual Gate
   1b procedure in `CLAUDE.md` indexes that corpus on every chunking change, and has been producing
   all-empty headings the whole time. This materially lowers the cost of the regression gate: the
   corpus exists, is small (~30 KB), is deterministic, and is already committed.
4. **New — "use the document title" does not close the hole.** `humanizeFileName`
   (`src/domain/convention.ts:45-51`) returns `""` when the basename collapses to nothing:
   `"-.md"` → `"-"` → `" "` → `""`, and `length === 0` returns `collapsed` unchanged. `-.md` and
   `_.md` are discoverable — `FileDocumentSource` skips only names starting with `.`
   (`file-document-source.ts:57`). So the resolved `DocumentMeta.title` is not itself guaranteed
   non-empty, and a fix phrased as a *data source* rather than as an *invariant on the output* leaves
   a live path to the same defect. Gate 2 exists for exactly this.

One scoping fact worth stating because it removes a whole class of design worry: **this defect can
only occur under `convention.mode: "loose"`.** Under `strict`, a document with no H1 is skipped and
reported in `skipped` (`openspec/specs/indexing/spec.md:88-96`). The change's entire domain is the
default zero-config mode.

## Scope

### In Scope

The scope is the **symptom**, chosen deliberately over the larger options in exploration §4. Three
outcomes, each stated as something observable rather than as a mechanism:

- **Every persisted chunk carries a non-empty `heading`.** This is an invariant on the emitted
  `Chunk`, not a statement about where the value comes from (see correction 4). There are exactly two
  producers of `Chunk[]` in the codebase — `chunkOutline` (`chunking.ts:33-63`) and
  `wholeDocumentChunk` (`index-pipeline.ts:91-99`, the `NO_CHUNKING` path). The invariant applies to
  both; whether it is enforced once or twice is design's call.
- **`search_docs` never returns `"section": ""`.** It follows from the above (`search-documents.ts:120`
  is a straight copy of `chunk.heading`), and it is stated separately because it is the wire-visible
  half and the one a spec requirement must pin.
- **`read_doc`'s failure path says something true.** No bullet with an empty label, ever. And
  `IMPROVEMENTS.md`'s open question — *"What `read_doc` should answer when a document genuinely has no
  sections. The current empty bullet list is strictly worse than saying so."* — is answered in this
  change: when there is nothing to list, the response says so in prose and names the call that does
  work, instead of a heading followed by nothing.

Plus the work that makes those outcomes real and durable:

- **A red-first regression test for the case with zero coverage**, at both levels: a `chunkOutline`
  unit case built on a *new* outline fixture with `title: ""` (the existing helper cannot express it),
  and an end-to-end pass through the real index → search → read path.
- **The `index-pipeline` seam.** Exploration §2.5's finding: `transformFile` calls `policy.resolver`
  (`index-pipeline.ts:63-69`) and then calls `chunkOutline(parsed.outline, …)` (`:77`) with the
  **raw** outline. The resolver's non-empty title is computed and then not used by chunking. Any
  option that wants that value must route it across a seam that is currently separate — a signature
  or options-shape change to a function with 1 production and 14 test call sites. **This is not free,
  and the proposal does not pretend otherwise.**
- **Spec deltas.** The non-empty invariant is normative and currently unwritten; so is `read_doc`'s
  section-not-found rendering (`mcp-contract/spec.md` covers unknown *paths* at `:130-138` and says
  nothing about unknown sections).

### Out of Scope

| Item | Why |
|---|---|
| **A stable per-chunk identifier / hash column** (exploration §4 Option A) | Explicit user decision on 2026-08-07: symptom only. **No SQLite schema change.** The `chunks` DDL (`sqlite-index-store.ts:59-65`) must come out of this change byte-identical |
| **Per-chunk-unique headings** (Option B in its per-chunk form) | Collides with the pinned reassembly behaviour — see the hard constraint below. Would require amending a normative MUST |
| **Line ranges / provenance ranges** (Option D) | Offsets are structurally discarded before chunking runs (`DocSection`/`DocOutline` carry no offset field, `src/domain/outline.ts:8-23`), and `splitTable`/`splitFence` re-emit preambles so a split piece's content is provably not a contiguous slice of the source (`split-text.ts:153-192`, `:200-244`). Byte-exact ranges are categorically impossible, not merely unbuilt |
| **`MAX_CHUNKS_PER_DOCUMENT`** (exploration §7) | `IMPROVEMENTS.md`'s own framing: "deserves a measurement before anything is changed". The probe recipe is recorded in exploration §7. Do not raise it "while in the area" |
| **GitHub-style slug anchors** | Already settled as a downgrade: exact-equality breaks when a title is reworded, where normalized substring matching does not |
| **Citation registry / stale-citation tracking** | Explicitly rejected in `IMPROVEMENTS.md`; the server is stateless between queries by design |
| **Migrations, schema markers, compatibility shims** | Beta, no installed users; breaking the public contract is an accepted cost (`openspec/config.yaml`, `rules.proposal`) |
| **Any change to `Chunk.content`** | Ruled out here rather than left to design, because it is a plausible temptation — injecting a synthesized `##` line into content would make the heading findable by `headingsIn`, and would also move retrieval. See Approach constraint 4 |

### The hard constraint: reassembly is load-bearing, and this scope reinforces it

Multiple chunks sharing one heading is **not** a bug awaiting a general fix. It is the mechanism that
makes `read_doc({ section })` return a whole split section instead of one arbitrary fragment:
`read-document.ts:74-79` matches by normalized substring against `heading`, and `:93-98` joins every
match. `test/application/read-document.test.ts:116-166` seeds a real 480-token-bounded pipeline,
confirms multiple chunks share the heading `"Sección extensa"`, and asserts the joined content
contains sentence 0 and sentence 119 in order. `openspec/specs/indexing/spec.md:442-450` makes it a
normative MUST: *"every resulting chunk MUST carry the same full heading path… Splitting for size MUST
NOT truncate, renumber, or otherwise alter the heading path."* Two more tests pin it
(`chunking.test.ts:74-89`, `:91-114`).

The chosen scope is **compatible with that requirement, and strengthens it.** Today, case A is the one
place where "propagate the same heading path to every split piece" degrades into propagating a
*malformed* one. Converting it into the ordinary shared-heading case removes a special case from a
rule that is otherwise uniform. A reviewer arriving at this proposal expecting a conflict should stop
here: there isn't one, and Gate 5 asserts it by requiring those three tests to pass **unchanged**.

### Decision: individual fragment addressability is NOT delivered

Stated plainly rather than obscured, because the change name promises more than the change ships.

After this change, the 89-chunk manual still has **89 chunks sharing one heading**, and
`read_doc({ path, section: <that heading> })` still returns all 89 joined — effectively the same bytes
`read_doc({ path })` returns. A caller still cannot address one fragment of that document rather than
another. That is a deliberate boundary, not an oversight.

Three reasons it is the right first slice, strongest first:

1. **The empty string and the shared heading are different kinds of defect.** `""` is a *malformed
   value*: it breaks the matcher, it makes the field uninterpretable by the caller, and it renders a
   list of nothing. A shared non-empty heading is a *coarse but truthful* statement — "these chunks
   all belong to this one region". One is a lie about the data model; the other is a granularity
   limit. Fixing the first does not require solving the second, and conflating them is how a two-file
   change becomes a schema change.
2. **The granularity limit is universal, not specific to heading-less documents.** Any H2 section
   large enough to split already yields several chunks with an identical heading, and `read_doc`
   already returns them joined — on purpose, pinned twice over. Case A is merely where that same
   policy degrades. This change removes the degradation; it leaves the policy alone. A future cycle
   that wants fragment granularity should change it for **all** documents uniformly — otherwise it
   reintroduces exactly the per-shape special case this change is removing.
3. **Delivering it here would mean either amending a normative MUST or building a parallel
   "whole-section" path.** Both are larger decisions than the reported defect warrants, and both are
   better made against evidence this change will produce (see the recorded observation below).

**The cost of this boundary, recorded rather than hidden.** A non-empty `section` is an *affordance*.
A caller that sees `section: "Operations manual"` may reasonably request it and receive 167 KB. Today
it sees `""` and learns immediately — if uselessly — that section addressing is unavailable. Honest
assessment: this is **not a regression in cost**, because the caller's only working move today is
`read_doc({ path })`, which returns those same bytes; but it **is** a change in expectation. It
therefore constrains this change in one concrete way: **nothing shipped here may describe `section` as
fragment-level.** Tool descriptions, spec text and `CLAUDE.md` must claim document-region granularity,
not fragment granularity.

**What would reopen it, and who runs it.** A recorded observation in `verify-report.md`, not a gate:
for the committed heading-less fixture, the distinct-heading count and the maximum
chunks-per-heading. That number is the baseline a future fragment-addressability cycle argues from,
and it costs one query to collect. Paired with exploration §7's `MAX_CHUNKS_PER_DOCUMENT` probe
(`scripts/rank-probe.mjs`, reading the `after cap` row), it is the whole evidence base a follow-up
would need. Neither is run as a gate here.

## Capabilities

### New Capabilities

- None as a new spec domain. Chunk headings and `read_doc`'s recovery path are existing behaviour that
  happens to be spec-silent.

### Modified Capabilities

- **`indexing`** — add the non-empty heading invariant. It MUST be written so it composes with
  "Every Split Piece Retains Its Full Heading Path" (`spec.md:442-450`) rather than competing with it:
  the path is non-empty *before* splitting, and splitting propagates it unchanged, exactly as today.
  A second requirement is likely needed for the operational consequence in Risks below — `heading` is
  persisted, and incremental sync fingerprints on content hash alone (`spec.md:468-482`), so a
  heading-only change does not reach unchanged documents without a full `compendio index`. The
  existing requirement is scoped to *boundary* changes and does not literally cover this; spec must
  decide whether to broaden it or add a sibling.
- **`mcp-contract`** — two requirements, both currently absent: `search_docs`'s `section` is never the
  empty string, and `read_doc`'s section-not-found response never lists an empty section and says so
  in prose when there is nothing to list. Today the spec covers unknown *paths* (`:130-138`) and is
  silent on unknown sections.

## Approach

The mechanism is deliberately **not** chosen. Exploration §4 leaves two options inside this scope, and
selecting between them is `sdd-design`'s call. What follows is split into what is fixed because it is
a correctness constraint, and what is genuinely open.

### Fixed here

1. **The guarantee is an invariant on the emitted `Chunk.heading`, not a data source.** "Pass
   `resolution.meta.title` into chunking" is a *mechanism*; "no emitted chunk has an empty heading" is
   the *requirement*. Correction 4 above shows the two are not equivalent. Gate 2 fails any
   implementation that conflates them.
2. **The value is identical for every chunk of the affected document.** Per-chunk variation is out of
   scope and would break reassembly.
3. **The value must round-trip through the public contract.** Whatever `search_docs` returns as
   `section` must, passed back verbatim to `read_doc({ path, section })`, resolve through the existing
   normalized-substring matcher (`read-document.ts:74-79`). Copy-and-paste is what agents actually do;
   a non-empty but unmatchable value is the same defect wearing a different mask. Gate 3.
4. **`Chunk.content` is not modified.** Injecting a synthesized heading line into content would make
   it findable by `headingsIn` — and would change what is embedded and what FTS5 indexes, moving
   retrieval. This change is metadata, not retrieval. Gate 5 asserts `compendio eval` does not move
   **at all**.

### Handed to `sdd-design`

| Option | For | Against |
|---|---|---|
| **B (per-document synthesis)** — derive the heading from the document's own content, e.g. its leading line | Independent of the convention layer, so no seam to cross; the value describes the content rather than the filename, which reads better in a `search_docs` result | Needs its own well-definedness rules (what if the leading line is 4 000 characters, or is a table row, or is identical across documents?); introduces a second notion of "what this document is called" alongside `DocumentMeta.title` |
| **C (minimal backfill)** — feed the already-resolved non-empty title into the intro piece's heading | Smallest diff at the chunking site; reuses a value the pipeline already computes; makes chunk headings agree with what whole-document `read_doc` already renders (`read-document.ts:67` prints `# ${doc.title}`) | Must cross the `index-pipeline` seam (§2.5), which touches `chunkOutline`'s signature or `ChunkingOptions`, rippling into 14 test call sites; and does not by itself satisfy the invariant (correction 4) |

Both satisfy the chosen scope and both produce the same accepted limitation. The seam cost is the main
asymmetry and is stated above so design weighs it with the right number rather than assuming it is
free.

Two further open questions belong to design, not here: whether `read_doc`'s "no sections" answer is a
new `ReadResult` variant or a shape change to `section-not-found`; and whether `formatReadResult`
(`server.ts:194`, not exported) is exported for testing or tested through the `read_doc` handler.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/chunking.ts:36-38` | Modified | The intro branch's `path: [outline.title]` — the origin of the defect |
| `src/application/index-pipeline.ts:63-99` | Modified | The seam; `wholeDocumentChunk` shares the shape and is covered by the same invariant |
| `src/application/read-document.ts:80-92` | Modified | `availableSections` assembly — an empty member must not survive into it; the no-sections result shape |
| `src/server.ts:208-213` | Modified | The empty-bullet render and the no-sections prose. **No test covers `formatReadResult` at all** — silent if forgotten, and the compiler flags nothing |
| `test/domain/chunking.test.ts` | Extended | A **new** outline fixture with `title: ""`. The existing `outline()` helper (`:13-15`) hardcodes a title, so adding an assertion to `:169-184` cannot reach the case |
| `test/application/read-document.test.ts` | Extended | `:89-97` only asserts `availableSections.length > 0` against `ejemplos/`; the `{""}` collapse is unexercised |
| `test/` (new) | New | A `formatReadResult` test, and an end-to-end index → search → read round trip over a heading-less document |
| `test/fixtures/vector-reach/docs/` | **Reused, not modified** | Six committed heading-less documents, already the exact failing shape (correction 3). Whether the automated gate uses this corpus or an in-memory equivalent (the `vector-only-excerpt.test.ts` pattern) is design's call; it is named so a new corpus is not built by default |
| `openspec/specs/indexing/spec.md` | Modified | Non-empty heading invariant; the reindex consequence |
| `openspec/specs/mcp-contract/spec.md` | Modified | Non-empty `section`; section-not-found rendering |
| `CLAUDE.md` | Modified | Add the invariant to the non-obvious decisions list. Nothing there currently tells a future reader that a chunk heading can never be empty, nor that a heading-only change needs a full reindex to land |
| `src/infrastructure/sqlite/sqlite-index-store.ts` | **Unchanged — asserted** | The `chunks` DDL must be byte-identical. A change here means Option A, which is scoped out |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The fix ships and never reaches an existing corpus.** `heading` is persisted; incremental sync's fingerprint is the document content hash alone (`indexing/spec.md:468-482`) and this change does not alter content, so a `serve`-only upgrade keeps every empty heading forever | **High** | Named as an operational step in Rollback and pinned by a spec requirement. The gates run through the full `IndexDocuments` path (whose `reset()` drops and recreates), never a sync pass |
| **A green suite proves nothing** — case A has zero coverage today, so nothing fails while the defect is present | **High** | Red-first is a gate, and the baseline must be **run and recorded before** the fix. `bounded-chunk-size` Gate 2 discipline: a gate that cannot fail is not a gate |
| **"Just pass the title" leaves the hole open** — `humanizeFileName` returns `""` for `-.md`/`_.md` | Med | Gate 2 targets exactly this input. It is the cheapest gate in the set and the one that separates fixing the defect from relocating it |
| **A non-empty `section` over-promises** fragment addressability | Med | The accepted limitation is stated above; no artifact shipped may describe `section` as fragment-level; the distinct-heading observation is recorded in `verify-report.md` for the follow-up cycle |
| **`formatReadResult` ships wrong, silently** — no test exists and it is not exported | Med | New test required, listed in Affected Areas, and Gate 4 asserts its literal output |
| **Scope creep into `MAX_CHUNKS_PER_DOCUMENT`** — it compounds this defect and sits one file away | Med | Out of Scope table plus exploration §7's recorded recipe. Raising it is a separate cycle |
| **Reassembly regression** — a per-chunk-varying value breaks `read-document.test.ts:116-166` and violates `indexing/spec.md:442-450` | Low (scoped out) | Approach constraint 2, and Gate 5 requires the three pinning tests to pass **unchanged**, not adapted |
| **Retrieval moves** because the synthesized value leaked into `Chunk.content` | Low | Approach constraint 4; Gate 5 requires `compendio eval` to be identical, and `ejemplos/` cannot be touched by this change (all 11 indexed documents carry exactly one H1 — verified) |

## Rollback Plan

Included per `openspec/config.yaml`'s `rules.proposal`, and the honest assessment is that this is a
**low-risk** change — but not a zero-risk one, because unlike `match-centred-excerpt` it writes to
persisted state.

1. Revert the change commits, `npm run build`.
2. **No data is at risk and no state is corrupted.** Headings written under the new code remain in the
   database and are harmless under the old code: `heading` is a free-form `TEXT` column, and a
   non-empty value is exactly what every document *with* headings already stores. Nothing reads it
   except `section` output and `read_doc` matching, and both handle non-empty values as their normal
   case.
3. **No DDL to undo.** The schema is unchanged by construction (Gate 5), so `migrate()` and `reset()`
   are untouched and no database needs deleting.
4. To restore the pre-change values byte-for-byte, run a full `compendio index`. This is required for
   *exactness*, not for correctness.
5. A running `compendio serve` picks up the revert on restart.

The one asymmetry worth naming: rolling **forward** is more expensive than rolling back. The fix does
not reach an existing corpus without a full `compendio index`, for the same reason `bounded-chunk-size`
did not — content-hash fingerprinting. That is an operational step to document, not a risk to mitigate.

## Dependencies

- **Zero new npm dependencies.** Pure domain logic plus existing wiring.
- **No new fixture corpus is required.** `test/fixtures/vector-reach/docs/` is already six committed,
  deterministic, heading-less documents (~30 KB) — the exact failing shape, generated by
  `scripts/generate-perf-corpus.mjs --profile fixture`. Its Spanish procedural prose is a pre-existing
  property of that generator, not a choice this change makes. If design prefers an in-memory scenario
  over a filesystem corpus, `test/application/vector-only-excerpt.test.ts` is the precedent for
  building one against `SqliteIndexStore(":memory:")`.
- **`ejemplos/` and `goldenset.yaml` are untouched.** They stay Spanish and unmodified; they serve here
  only as the scope falsifier in Gate 5.
- **Existing instruments, reused for the record only**: `compendio eval`, and `scripts/rank-probe.mjs`
  for the recorded `MAX_CHUNKS_PER_DOCUMENT` observation that this change does not act on.

## Success Criteria

Each gate can **fail and stop the change**. This project gates on *falsification* — a measurement
contradicting the reasoning — not on a tolerance band around a prediction (`CLAUDE.md`, Gate 2
precedent). A gate that cannot fail is not a gate.

### Gate 1 — The defect reproduces first, then disappears (BLOCKING)

Over a heading-less document (no H1, no H2) large enough to exceed `chunk.maxTokens` so it yields
several chunks, exercised through the real `IndexDocuments` → `SearchDocuments` → `ReadDocument` path,
not only at `chunkOutline` unit level.

- [ ] **Baseline, on current code, run and recorded first**: every chunk's `heading === ""`,
      `search_docs` returns `section: ""`, and `read_doc({ path, section: <anything> })` returns
      `section-not-found` whose `availableSections` is exactly `[""]`. **If any of these already
      passes today, the fixture is void and MUST be rebuilt.** This step is what makes the gate
      capable of failing; case A's zero coverage means skipping it produces a gate that passes for
      free.
- [ ] **After the change**: every chunk's `heading` is non-empty, and it is the **same** value across
      all of them.

**STOP condition.** A still-empty heading falsifies the change as implemented.

### Gate 2 — The invariant is on the output, not on a data source (BLOCKING)

- [ ] A heading-less document whose filename humanizes to the empty string — `-.md` or `_.md`, per
      `convention.ts:45-51`, where `collapsed.length === 0` returns `""` — still produces non-empty
      chunk headings.

**STOP condition.** This is the gate that fails a naive "pass `meta.title` through" implementation. It
costs one test and is the difference between fixing the defect and moving it one function upstream.

### Gate 3 — Round trip through the public contract (BLOCKING)

- [ ] The `section` value `search_docs` returns for that document, passed back **verbatim** as
      `read_doc({ path, section })`, resolves to a `section` result — not `section-not-found`.

**STOP condition.** A non-empty but unmatchable `section` is the original defect with a new value. The
round trip, not the non-emptiness, is what the caller actually needs.

### Gate 4 — The failure path says something true (BLOCKING)

- [ ] `formatReadResult` never emits a bullet with an empty label, for any input — asserted on its
      **literal output**, which settles exploration §8's unmeasured claim 3.
- [ ] When a document has no addressable sections at all, the rendered answer says so in prose and
      names the working alternative (`read_doc({ path })`), rather than a heading followed by nothing.

### Gate 5 — Scope falsifiers: nothing else moved (BLOCKING)

- [ ] `test/application/read-document.test.ts:116-166` (reassembly) passes **unchanged** — not
      adapted, not relaxed. If it needs editing, the change has left its stated scope.
- [ ] `test/domain/chunking.test.ts:74-89` and `:91-114` (identical headings across split pieces) pass
      **unchanged**.
- [ ] The `chunks` table DDL (`sqlite-index-store.ts:59-65`) is byte-identical to today. A schema
      change means the change took Option A, which the user scoped out.
- [ ] `compendio eval` on `ejemplos/`: MRR ≥ 0.943, recall@5 = 1.00, top-1 ≥ 20/22 — these must not
      move **at all**. Identity is the right assertion, not a tolerance band: all 11 indexed
      `ejemplos/` documents carry exactly one H1, so this change cannot reach them. Any movement means
      `Chunk.content` changed and Approach constraint 4 was violated.
- [ ] `npm test`, `npm run typecheck`, `npm run build` pass.

### Gate 6 — The operational consequence is written down (BLOCKING)

- [ ] A spec requirement states that a heading-only change does not reach unchanged documents through
      an incremental sync pass, and that a full `compendio index` is required — either by broadening
      `indexing/spec.md:468-482` or by adding a sibling requirement.
- [ ] `CLAUDE.md` carries the same note.

Without this, the change is correct in the repository and invisible in every existing installation.

### Recorded observations (not gates)

- [ ] For the heading-less fixture: distinct-heading count and maximum chunks-per-heading, written
      into `verify-report.md`. This is the baseline a future fragment-addressability cycle argues
      from.
- [ ] Exploration §7's `MAX_CHUNKS_PER_DOCUMENT` probe recipe restated in `verify-report.md`, **not
      run**.

## Resolved decisions

Recorded so later phases do not re-litigate them.

| Question | Decision |
|---|---|
| Scope | **Symptom only** — explicit user decision, 2026-08-07. Individual fragment addressability is not delivered |
| Stable per-chunk id / hash column (Option A) | **Rejected for this cycle.** No SQLite schema change; Gate 5 asserts it |
| Per-chunk-unique headings (Option B, per-chunk form) | **Rejected.** Collides with a normative MUST and a real test |
| Line / provenance ranges (Option D) | **Rejected.** Byte-exact is categorically impossible for split table/fence pieces; provenance ranges need offset plumbing that does not exist |
| `MAX_CHUNKS_PER_DOCUMENT` | **Unchanged.** Measurement recipe recorded instead |
| Slug anchors, citation registry | **Rejected**, already settled in `IMPROVEMENTS.md` |
| Migrations / schema markers / shims | **None.** Beta, no installed users |
| Mechanism (B per-document synthesis vs C backfill) | **Open — `sdd-design`'s call.** Fixed here only: the invariant is on the output, the value is uniform per document, it must round-trip, and content is not modified |
| `read_doc`'s "no sections" response shape | **Open — design's call** between a new `ReadResult` variant and a shape change. The *behaviour* is fixed: prose, not an empty bullet |
| Designing for `docs_overview` / `INDEX.md` | **Forbidden.** Neither consumes the chunk-level heading; `IMPROVEMENTS.md:219` is wrong |
| Reproducing the 89-chunks / 1-heading figures | **Not attempted.** Private corpus. The gates falsify the defect's *shape* on a committed fixture |

## Delivery size — a decision for the `sdd-tasks` gate

Driver-based, and explicitly a **proposal-phase** figure:

| Driver | Estimate |
|---|---|
| `chunking.ts` intro branch + non-empty guarantee | 15–30 |
| The `index-pipeline` seam (signature/options shape, `wholeDocumentChunk`) | 15–35 |
| `read-document.ts` — `availableSections` filtering, no-sections result shape | 15–35 |
| `server.ts` — `formatReadResult` and its prose | 15–25 |
| Tests: chunking fixture, read-document collapse, `formatReadResult`, end-to-end round trip, the `-.md` case | 150–250 |
| Spec deltas (`indexing` + `mcp-contract`) | 60–100 |
| `CLAUDE.md` and tool-description prose | 20–30 |

That lands roughly **290–505 changed lines** against a 400-line PR budget.

**Treat that range as a lower bound.** This project's forecast has grown at every phase, twice
measured: `bounded-chunk-size` 240–420 (explore) → 555–695 (tasks) → **773 actual**;
`match-centred-excerpt` 300–470 (proposal) → 750–800 (design) → **~1521 actual**, roughly 4× its
proposal figure. Resolve the delivery shape at the review-workload gate, not at apply time.

One lever worth flagging to design because it moves the number materially: **do not commit a bulk
heading-less document.** `test/fixtures/vector-reach/docs/` already exists, and where a new scenario is
needed, `chunking.test.ts`'s generated-text helpers and `vector-only-excerpt.test.ts`'s in-memory store
are the established cheap patterns. A committed 40 KB fixture would consume the budget on filler prose.

The natural cut line, if one is needed:

- **PR 1** — the chunking invariant, the seam, the spec delta and their tests. The defect's root, and
  the half that requires a reindex to land.
- **PR 2** — `read_doc`'s failure-path answer. Independently valuable, independently testable, no
  reindex needed, and the part `IMPROVEMENTS.md` phrases as its own separate question.
