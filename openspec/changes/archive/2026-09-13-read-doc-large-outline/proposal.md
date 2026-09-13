# Proposal: `read_doc` Returns a Section Outline for Large Documents

## Intent

`read_doc({ path })` without `section` returns the whole document with no size check. Three live documents in this repo already exceed Claude Code's ~10k-token tool-output warning (`openspec/specs/indexing/spec.md` 17,421; `mcp-contract/spec.md` 14,639; `docs/design-decisions.md` 11,502) and one archived document exceeds the ~25k hard limit (38,234). The agent gets a truncated answer or a wasted round trip. Above a size threshold, `read_doc` should instead return the document's sections with their sizes so the agent requests the one it needs.

## Scope

### In Scope
- Constant threshold `6,000` estimated tokens (`estimateTokens`, chars/4) on the assembled body.
- New additive `ReadResult` variant (outline) when the body exceeds the threshold and the document has 2+ addressable sections.
- Outline rows: H2 headings with their H3s nested beneath, each with an estimated token size.
- Heading collection shared with the `section-not-found` path (one helper, not a second path).
- `formatReadResult` rendering; `read_doc` description updated (it currently states that omitting `section` returns the entire document).
- Tests, including one asserting every `ejemplos/` document stays under the threshold.
- `docs/design-decisions.md` entry; one-line `AGENTS.md` pointer.

### Out of Scope
- Changing section matching (substring; an H2 returns its H3 subtree).
- Nested outlines for a single oversized section.
- A config key or a "force full" override.
- A CLI read command; any fourth MCP tool.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `mcp-contract`: new requirement for the `read_doc` outline response (trigger, 0/1-section fallback, row shape, rows round-trip through `section`).

## Approach

Exploration approach 1: in the no-`section` branch of `ReadDocument.execute`, measure the joined body; above the constant with 2+ sections, return outline rows in first-`position` order instead of content. Otherwise behaviour is unchanged. No persisted state or reindex involved.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/application/read-document.ts` | Modified | Threshold, size check, outline variant, shared heading helper |
| `src/server.ts` | Modified | `formatReadResult` case; `read_doc` description; `SERVER_INSTRUCTIONS` review |
| `test/application/read-document.test.ts`, `test/server/format-read-result.test.ts`, `test/server.test.ts` | Extended | Outline, fallback, round-trip, `ejemplos/` bound |
| `docs/design-decisions.md`, `AGENTS.md` | Modified | Decision entry; one-line pointer |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Description or `SERVER_INSTRUCTIONS` keep claiming "returns the entire document" | High | Update both; keep the whole-file redirect consistent |
| `mcp-contract` "response shapes MUST remain unchanged" wording read as conflicting | Med | Spec phase scopes the new variant explicitly |
| `estimateTokens` drifts from real tokens (Spanish, code) | Med | 6,000 leaves margin below ~10k |
| Large heading-less documents still return in full | Low | Accepted, documented |
| Golden set affected | Low | `ejemplos/` bound test (all docs < 1,300) |

## Rollback Plan

Revert the change commits and rebuild. No persisted state, schema or config key is touched.

## Dependencies

- None.

## Open Questions (for design)

1. Grouping of split chunks sharing a heading (`splitToBound`) and how their sizes are summed.
2. Whether the outline carries frontmatter/meta like `document`.
3. Exact description wording and whether `SERVER_INSTRUCTIONS` needs a matching sentence.

## Success Criteria

- [ ] A document above 6,000 tokens with 2+ sections returns an outline, not content.
- [ ] A large document with 0/1 section returns in full.
- [ ] Every outline row resolves through `read_doc({ path, section })`.
- [ ] Every `ejemplos/` document is under the threshold; `eval` unchanged.
- [ ] MCP surface stays 3 tools; `npm test`, `typecheck`, `build` pass.
