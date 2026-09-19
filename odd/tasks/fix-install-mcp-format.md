# Fix install-mcp format per agent

## Objective
Fix `compendio install-mcp` to generate the correct configuration format for each supported agent.

## Problem
The current implementation uses a single format (`mcpServers` with `{command, args}`) for all agents, but each agent has its own configuration structure:

| Agent | Config Key | Format |
|---|---|---|
| Claude Code, Claude Desktop, Cursor, Windsurf, Cline, Gemini CLI | `mcpServers` | `{command, args}` |
| VS Code | `servers` | `{type: "stdio", command, args}` |
| OpenCode | `mcp` | `{type: "local", command: string[], enabled}` |
| Codex | TOML `mcp_servers` | `{command, args, enabled, startup_timeout_sec}` |
| Zed | `context_servers` | `{command, args, env}` |

## Why
The first real-world test (OpenCode) failed because the command generated `mcpServers` instead of `mcp` with the correct format.

## Scope
- Fix `mergeMcpConfig` to transform the entry according to the target agent
- Add tests for each agent's specific format
- No new agents, only fix the existing ones

## Constraints
- Must preserve existing config structure (other keys, other servers)
- Must handle missing config files
- Must overwrite server entry if name already exists

## Acceptance Criteria
- [ ] OpenCode generates `mcp` key with `{type: "local", command: string[], enabled}`
- [ ] VS Code generates `servers` key with `{type: "stdio", command, args}`
- [ ] Zed generates `context_servers` key with `{command, args, env}`
- [ ] Claude/Cursor/Windsurf/Cline/Gemini generate `mcpServers` with `{command, args}`
- [ ] Codex generates TOML with `mcp_servers` section
- [ ] All tests pass
- [ ] Manual test with OpenCode succeeds

## Applicable Checks
- `npm test` — full test suite
- `npm run typecheck` — TypeScript validation
- Manual test: `node dist/cli.js install-mcp opencode`

## Tasks

### Domain Layer
- [x] **T1**: Refactor `mergeMcpConfig` to transform entry per agent
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

- [x] **T2**: Add tests for each agent's specific format
  - Files: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

### Application Layer
- [x] **T3**: Update `InstallMcp` use case if needed
  - Files: `src/application/install-mcp.ts`
  - Tests: `test/application/install-mcp.test.ts`
  - Status: ✅ Complete

### Verification
- [x] **T4**: Run full test suite
  - Result: 1100 tests passing
  - Status: ✅ Complete

- [x] **T5**: Manual smoke test with OpenCode
  - Result: Config updated with correct format
  - Status: ✅ Complete

## Progress
- Total tasks: 5
- Completed: 5
- Failed: 0
- Skipped: 0

## Route Declaration
- **T1-T2**: Direct inline (domain logic, simple transformations)
- **T3**: Direct inline (application layer, minor changes)
- **T4-T5**: Direct inline (verification commands)

## Rationale for Route
Small, focused fix. The domain logic is simple (format transformation per agent). No complex design decisions required.
