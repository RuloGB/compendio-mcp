# Exploration: read_doc large-document outline

## Idea

When `read_doc` is called without `section` on a large document, return the list of the document's sections (an outline) instead of the full content, so the agent calls `read_doc` again with the section it needs. The `read_doc` tool description (and the server instructions) must explain this. Reading a whole file end to end stays out of scope for Compendio: the tool description already sends that case to the agent's own file-reading tool.

Open question: when is a document "large"?

## Current state

`read_doc({ path, section? })` (`ReadDocument.execute`, `src/application/read-document.ts`) has two modes:

- **With `section`**: filters `getChunksByDocument(doc.id)` by `normalize(c.heading).includes(wanted)` or any heading line inside the chunk (`headingsIn`, fence-aware via `isFenceDelimiter`), and joins the matching chunks.
- **Without `section`**: joins every chunk in `position` order and re-attaches the H1. No size check exists. `formatReadResult` (`src/server.ts`) wraps it with rendered frontmatter in one MCP text block, with no truncation of its own.

Chunks come from the store, not from re-parsing the file. Each `IndexedChunk` carries `heading` (an "H2 > H3" path, never empty per `withNonEmptyHeadings`), `content` and `position`. `DocOutline` (`src/domain/outline.ts`) is index-time only and never persisted, so `read_doc` must build any outline from stored chunks.

Two `ReadResult` variants already list sections on a miss: `section-not-found` and `no-sections`. Both use the same `available` set (`chunk.heading` plus `headingsIn(chunk.content)`, empty strings excluded), built inline in the `matching.length === 0` branch. The outline should reuse that logic through a small shared helper instead of a second heading-collection path.

Size vocabulary already in the codebase:

- `estimateTokens` (`src/domain/tokens.ts`): `Math.ceil(text.length / 4)`, the unit `chunk.maxTokens` (default 480) is measured in.
- `excerptBudget` (`src/domain/excerpt.ts`): 1400 / 120 chars by rank.
- A single chunk is bounded by `chunk.maxTokens`; a whole document is not.

There is no CLI `read` command; `read_doc` is MCP-only.

Config precedent (`src/infrastructure/config.ts`): `mergeConfig` whitelists keys per section and `resolveNumeric` accepts only finite positive numbers.

## Measured document sizes

Measured by the orchestrator with `wc -m` / 4 (the same formula as `estimateTokens`) on 2026-09-12. The exploration agent had no shell and estimated from line counts; its estimates were low (it placed `docs/design-decisions.md` at 6k-11k tokens; the measured value is 11.5k).

| Document | Estimated tokens |
| --- | --- |
| `openspec/specs/indexing/spec.md` | 17,421 |
| `openspec/specs/mcp-contract/spec.md` | 14,639 |
| `docs/design-decisions.md` | 11,502 |
| `openspec/changes/retrieval-ranking-robustness/research.md` | 7,542 |
| `openspec/specs/configuration/spec.md` | 5,712 |
| `openspec/changes/retrieval-ranking-robustness/apply-progress.md` | 5,161 |
| `openspec/specs/index-progress/spec.md` | 4,974 |
| `docs/manual-gates.md` | 4,318 |
| `docs/documentation-convention.md` | 4,135 |
| Largest in `openspec/changes/archive/` (`bounded-chunk-size/apply-progress.md`) | 38,234 |

Archive distribution: 189 Markdown files; 88 above 4,000 tokens, 13 above 10,000.

`ejemplos/docs/`: every document is below 1,300 tokens. No reasonable threshold touches the golden-set corpus; a test should pin that so a threshold change can never silently alter it.

Takeaway: today, a plain `read_doc` on three live documents of this repo already crosses the client's ~10k warning line, and at least one archived document crosses the ~25k hard limit.

## Client output limits

Claude Code enforces `MAX_MCP_OUTPUT_TOKENS`: warning at ~10,000 tokens, hard limit at ~25,000 by default (configurable by env var). Sources cited by the exploration agent: anthropics/claude-code#9152, Xpoz help article, HikaruEgashira/claude-code-shared-settings `environment_variables.md`. Other clients (OpenCode) have their own limits; not verified.

## What "large" should mean

- **Unit**: `estimateTokens` on the assembled body. One size vocabulary across chunking, excerpts and this feature.
- **Primary signal**: size, not section count. Three huge sections is exactly what a section count misses.
- **Threshold**: a constant set well below the ~10k warning line. The agent proposed ~4,000 tokens (~16,000 chars). With the measured distribution, 4,000 turns every live document above `docs/documentation-convention.md` into an outline, and 88 of 189 archived documents. That is the intended effect for specs and designs, but it is aggressive; the value must be settled in proposal/design against the table above (candidates: 4,000 / 6,000 / 8,000).
- **Constant vs config key**: constant. It is a safety margin against a fixed client limit, not a content policy that varies by project. Promote to config only if a real project needs it (for example, one running with a raised `MAX_MCP_OUTPUT_TOKENS`).
- **Zero or one addressable heading**: an outline is useless (one extra round trip for nothing). Return the full document regardless of size, consistent with `no-sections`. Residual risk: a large heading-less document still returns in full. Real example of a heading-less document: `ejemplos/docs/glosario.md` (small).
- **A section larger than the threshold**: out of scope. `section` already returns "all of its parts joined" by contract.

## Section addressing: do outline entries round-trip through `section`?

Mostly yes, with one finding the exploration agent missed:

- **Substring matching (orchestrator finding).** Section lookup is `normalize(c.heading).includes(wanted)`. Requesting an H2 matches every chunk whose path is `H2 > H3...`, so an H2 returns its whole subtree; a short heading like "Scope" also matches any heading containing it. For outline-driven navigation this means: listing an H2 and its H3s as separate rows lets the agent pick the narrow H3; listing only H2s makes each follow-up call potentially as large as the H2 subtree. The outline design must decide granularity with this in mind. Changing the matching rule is out of scope (it is an established contract).
- **Split chunks share a heading.** `splitToBound` can cut one section into several chunks with the same `heading`; the outline must group by heading (in first-`position` order) and sum their sizes, not emit duplicate rows. To confirm in design.
- **Duplicate headings** in different parts of the document already match together and are joined; pre-existing, accepted behaviour.
- **H4+** are not chunk headings but are found by `headingsIn`. An outline from `chunk.heading` alone omits them; acceptable, same H2/H3 granularity as `search_docs`' `section` field.
- **CRLF and fences** are handled at the `headingsIn`/chunk level; the outline re-parses nothing.

## Affected areas

- `src/application/read-document.ts`: size check in the no-`section` branch, new `ReadResult` variant (e.g. `"outline"`), heading-collection helper shared with the miss path, threshold constant.
- `src/server.ts`: `formatReadResult` case for the new variant; `read_doc` description sentence (what triggers the outline, call again with a listed `section`), kept consistent with the existing "whole file → your own file-reading tool" sentence; check `SERVER_INSTRUCTIONS` for the same consistency.
- `src/domain/tokens.ts`: no change.
- `docs/design-decisions.md`: new decision entry (threshold, why a constant); one-line pointer in `AGENTS.md`.
- Tests: `test/application/read-document.test.ts` (large → outline; 0/1 heading → full; entries round-trip through `section`; split chunks grouped), `test/server/format-read-result.test.ts` (literal rendering), `test/server.test.ts` if it exercises `read_doc` end to end, plus an `ejemplos/` stays-under-threshold assertion.
- MCP surface stays exactly 3 tools: this is an additive variant inside `read_doc`.

## Approaches

1. **Outline-only response, constant threshold, reuse of the `available` logic.** Above the threshold and with 2+ addressable headings, return `{ heading, tokens }` rows in `position` order instead of the content; otherwise unchanged.
   - Pros: minimal new logic, no config surface, matches the "no force-full" stance, additive blast radius.
   - Cons: no MCP path to a whole large document (already discouraged; the agent can iterate sections or use its file tool).
   - Effort: low.
2. **Same, threshold as a config key** (`CompendioConfig`, `DEFAULT_CONFIG`, whitelist, `resolveNumeric`, tests).
   - Pros: tunable for clients with a raised limit.
   - Cons: no evidence anyone needs it; permanent validation and test surface.
   - Effort: medium.
3. **Outline plus a preamble** (intro or first section).
   - Pros: may save a round trip.
   - Cons: blurs routing (`read_doc` outline) with answering (`search_docs` excerpts); another budget to justify; inconsistent with `no-sections`, which carries no content.
   - Effort: medium.

## Recommendation

Approach 1. Each row carries `heading` and an estimated `tokens` count so the agent can budget the next call. No config key, no force-full override.

## Open items for proposal/design

1. Threshold value, chosen against the measured table (4,000 vs 6,000 vs 8,000).
2. Outline granularity given substring matching (H2 only vs H2 + H3 rows).
3. Grouping of split chunks that share a heading.
4. Whether the outline response includes frontmatter/meta like the `document` variant.

## Risks

- The threshold is a policy choice; the measurements are now exact under `estimateTokens`, but `estimateTokens` itself is approximate (chars/4 is not a tokenizer; Spanish and code-heavy text drift from it).
- Large heading-less documents keep returning in full.
- Oversized single sections are not addressed.
- Tool-description wording must stay consistent with the whole-file-read redirect.
- No functional overlap with the active `retrieval-ranking-robustness` change (search ranking only).
