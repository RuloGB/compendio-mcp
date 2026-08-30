# Proposal: Auto-discover Markdown Roots

## Intent

Replace hidden zero-config `docsDir: ["docs"]` with Markdown root discovery, so Compendio indexes real layouts like `openspec/` without config.

## Scope

### In Scope
- Auto-discover top-level project folders containing at least one `.md` at any depth when config is absent, `docsDir` is omitted, or `docsDir: []` is declared.
- Keep populated valid `docsDir` authoritative; malformed or wrong-typed `docsDir` fails, never falls back.
- Preserve root-alias-prefixed paths, `exclude` semantics, and the three-tool MCP surface.
- Write discovery-mode `INDEX.md` at project root; keep explicit `docsDir` writing to the first declared root.

### Out of Scope
- Root inference below top-level folders.
- New MCP tools, config flags, compatibility shims, or migrations.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `configuration`: replace implicit default `docsDir: ["docs"]` with discovery mode; preserve explicit validation.
- `indexing`: define discovered root selection, ignored technical/generated roots, path prefixing, and excludes.
- `index-md`: change output location only for discovery mode.
- `mcp-contract`: preserve tool names/params while updating zero-config path expectations.

## Approach

Split root selection from root validation. Config loading decides explicit vs discovery mode; then existing root resolution, `FileDocumentSource`, `CompositeDocumentSource`, module inference, and sync protection keep operating on alias-prefixed roots. Discovery scans only top-level project entries, ignores `.git`, `.compendio`, `node_modules`, `dist`, `build`, and `coverage`, and must not ignore `openspec` or archived changes.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/infrastructure/config.ts` | Modified | Config parsing, fallback, root validation. |
| `src/composition.ts` | Modified | Wire selected roots and `INDEX.md` target. |
| `src/infrastructure/fs/*document-source.ts` | Modified | Root discovery and prefixed paths. |
| `openspec/specs/{configuration,indexing,index-md,mcp-contract}/spec.md` | Modified | Behavioral contracts. |
| `test/**` | Modified | Discovery, explicit config, malformed config, excludes, `INDEX.md`. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Accidental generated/internal indexing | Med | Pin ignored top-level names and anti-vacuity fixtures. |
| Path-shape regressions | Med | Assert prefixed paths and `read_doc` round-trip. |
| `openspec` archive missed | Low | Gate all current `openspec/**/*.md`. |

## Rollback Plan

Revert the proposal/spec/design/implementation and restore `docsDir: ["docs"]` plus first-root `INDEX.md` behavior.

## Dependencies

- Existing hexagonal config/source composition seams.
- Exploration baseline: `openspec` had 170 Markdown files when measured; acceptance must dynamically count every `.md` present under `openspec` at measurement/index time.

## Success Criteria

- [ ] Zero-config indexing selects all top-level Markdown-bearing roots except ignored technical/generated roots.
- [ ] This repository indexes every `.md` present under `openspec` at measurement/index time, dynamically counted, including top-level, nested specs, active changes, and archive content.
- [ ] Explicit valid `docsDir` remains authoritative; malformed/wrong-typed `docsDir` fails.
- [ ] Discovery-mode `index-md` writes project-root `INDEX.md`; explicit mode keeps existing placement.
