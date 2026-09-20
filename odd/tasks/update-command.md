# Feature: `compendio update` command

## Objective

Add a new CLI command `compendio update` that installs the latest available version of compendio-mcp from npm.

## Problem

Users currently need to manually run `npm install -g compendio-mcp@latest` to update. A dedicated command provides a better UX and matches common CLI patterns.

## Scope

- Add `update` subcommand to `src/cli.ts`
- Execute `npm install -g compendio-mcp@latest` via child_process
- Stream npm output to stdout in real time
- Report success/failure with clear messages
- Exit with appropriate code (0 success, 1 failure)

## Constraints

- Must work cross-platform (Windows, macOS, Linux)
- Must not block the event loop (async execution)
- Must preserve npm's colored output when available
- No configuration needed — zero options required

## Design Decisions

1. **Package manager**: Use `npm` directly. Rationale: compendio-mcp is published to npm, and `npx` (used in install-mcp) is npm's executor. Users who prefer yarn/pnpm can still run their own update command.

2. **Global install flag**: Use `-g` to update the global installation. This matches how users typically install CLI tools.

3. **Output streaming**: Pipe npm's stdout/stderr directly to the process streams. This preserves colors, progress bars, and real-time feedback.

4. **No version check first**: Skip querying npm registry before installing. Rationale: `npm install -g compendio-mcp@latest` already does this internally and is idempotent if already on latest.

## Acceptance Criteria

- [x] `compendio update` executes without errors
- [x] Command installs the latest version from npm
- [x] Output shows npm's installation progress in real time
- [x] Success message confirms the update
- [x] Failure (network error, permission denied) exits with code 1 and clear error
- [x] Works on Windows, macOS, and Linux
- [x] Tests cover the command execution and error paths

## Tasks

- [x] **T1**: Add `update` command to cli.ts
  - Registered command with Commander (line 330)
  - Extracted `runNpmUpdate` exported helper (line 343) for testability
  - Spawns `npm install -g compendio-mcp@latest` with `stdio: "inherit"`
  - Windows: uses `npm.cmd`; elsewhere: `npm`
  - Success → `console.log("compendio updated to the latest version.")`
  - Failure → `console.error("Error: failed to update compendio.")` + `process.exit(1)`
  - Files: `src/cli.ts`

- [x] **T2**: Add tests for the update command
  - 5 tests: spawn args, success message, non-zero exit, spawn error, platform detection
  - Mocks `node:child_process` via `vi.hoisted()` + dynamic import
  - Files: `test/cli-update.test.ts`

- [x] **T3**: Update CLI help text
  - `compendio --help` lists update command (Commander auto-registers)
  - `compendio update --help` shows "Updates compendio-mcp to the latest version from npm"
  - Files: `src/cli.ts` (inline with T1)

## Authorized Scope

Only the files listed in tasks above. No changes to domain, application, or infrastructure layers.

## Verification

- Run `npm run build` — must succeed
- Run `npm test` — must pass all tests
- Manual test: `node dist/cli.js update` — should attempt npm install
- Manual test: `node dist/cli.js --help` — should list update command

## Progress

- Status: **Complete — pending commit**
- T1 ✅ | T2 ✅ | T3 ✅ | T4 (README) ✅
- Verification: typecheck PASS, build PASS, 5/5 new tests PASS, 1105/1105 full suite PASS
- README updated: Quick start section + CLI command table
- Next step: Awaiting developer approval to commit

## Applicable Checks

- `npm run build`
- `npm test`
- Manual smoke test with `node dist/cli.js update`
