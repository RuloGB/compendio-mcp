# install-mcp CLI Command

## Objective
Create `compendio install-mcp <agent>` command to automatically register compendio-mcp in AI agent configurations, eliminating manual setup.

## Problem
Users currently have to manually edit agent config files to add compendio-mcp. This is error-prone and creates friction during onboarding.

## Why
Improve user experience by providing a one-command installation for supported agents.

## Scope
- Support 5 agents: claude, claude-desktop, cursor, vscode, opencode
- Global installation only (per-project installation remains manual)
- TDD implementation

## Constraints
- Must preserve existing config structure
- Must handle missing config files (create them)
- Must handle existing servers (overwrite with same name)
- Must work cross-platform (Windows, macOS, Linux)

## Acceptance Criteria
- [x] Command accepts valid agent names
- [x] Command rejects invalid agent names with helpful error
- [x] Creates config file if it doesn't exist
- [x] Adds server to existing config without losing other entries
- [x] Overwrites server entry if name already exists
- [x] Works on Windows, macOS, Linux
- [x] All tests pass
- [x] Typecheck passes

## Applicable Checks
- `npm test` — full test suite
- `npm run typecheck` — TypeScript validation
- `npm run build` — compilation

## Tasks

### Domain Layer
- [x] **T1**: Define `McpAgent` type and validation
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete (14 tests passing)

- [x] **T2**: Implement `getAgentConfigPath` for all agents and platforms
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

- [x] **T3**: Implement `getAgentServerKey` and `mergeMcpConfig`
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

### Application Layer
- [x] **T4**: Create `InstallMcp` use case
  - Files: `src/application/install-mcp.ts`
  - Tests: `test/application/install-mcp.test.ts`
  - Status: ✅ Complete (5 tests passing)

### Infrastructure Layer
- [x] **T5**: Create filesystem adapter
  - Files: `src/infrastructure/fs/mcp-config-fs.ts`
  - Status: ✅ Complete

### CLI Integration
- [x] **T6**: Add `install-mcp` command to CLI
  - Files: `src/cli.ts`
  - Status: ✅ Complete

### Verification
- [x] **T7**: Run full test suite
  - Result: 1083 tests passing
  - Status: ✅ Complete

- [x] **T8**: Run typecheck and build
  - Result: Both pass
  - Status: ✅ Complete

- [x] **T9**: Manual smoke test
  - Command: `node dist/cli.js install-mcp opencode`
  - Result: Successfully added server to config
  - Status: ✅ Complete

### Documentation
- [x] **T10**: Create manual installation guide
  - Files: `docs/manual-installation.md`
  - Status: ✅ Complete

- [x] **T11**: Update README Quick Start section
  - Files: `README.md`
  - Status: ✅ Complete

- [x] **T12**: Update README CLI table
  - Files: `README.md`
  - Status: ✅ Complete

### Codex Support
- [x] **T13**: Add codex to McpAgent type and validation
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

- [x] **T14**: Implement getAgentConfigPath for codex
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

- [x] **T15**: Implement getAgentServerKey for codex (mcp_servers)
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

- [x] **T16**: Implement mergeCodexToml function
  - Files: `src/domain/mcp-agents.ts`
  - Tests: `test/domain/mcp-agents.test.ts`
  - Status: ✅ Complete

- [x] **T17**: Create TOML parser/serializer for Codex config
  - Files: `src/infrastructure/config/toml.ts`
  - Status: ✅ Complete

- [x] **T18**: Update InstallMcp use case to handle TOML
  - Files: `src/application/install-mcp.ts`
  - Tests: `test/application/install-mcp.test.ts`
  - Status: ✅ Complete

- [x] **T19**: Update CLI to include codex in supported agents
  - Files: `src/cli.ts`
  - Status: ✅ Complete

- [x] **T20**: Update README to include Codex in supported agents
  - Files: `README.md`
  - Status: ✅ Complete

## Progress
- Total tasks: 20
- Completed: 20
- Failed: 0
- Skipped: 0

## Verification Evidence
- Test suite: 1083/1083 passing
- Typecheck: clean
- Build: successful
- Manual test: command executed successfully, config file updated

## Next Step
Implementation complete. Awaiting user decision on commit.

## Route Declaration
- **T1-T3**: Direct inline (domain logic, simple functions)
- **T4-T6**: Direct inline (application + infrastructure + CLI wiring)
- **T7-T9**: Direct inline (verification commands)

## Rationale for Route
Small, well-scoped feature with clear boundaries. Domain logic is simple (path resolution, JSON merge). Application layer is straightforward (read-merge-write). No complex design decisions required.
