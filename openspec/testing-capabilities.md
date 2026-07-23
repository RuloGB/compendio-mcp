# Testing Capabilities — compendio-mcp

**Strict TDD Mode**: enabled (default — no agent marker or existing config found; vitest runner present)
**Detected**: 2026-07-22

### Test Runner

- Command: `npm test` (`vitest run`)
- Watch: `npm run test:watch` (`vitest`)
- Single file: `npx vitest run test/domain/chunking.test.ts`
- Single test: `npx vitest run -t "name of the test"`
- Framework: Vitest 4.x
- Pool: `forks` (`vitest.config.ts`) — required because `better-sqlite3` is a native addon loaded once per worker; do not switch to `threads`.
- `CI=true` sets `forbidOnly: true` so a stray `it.only` cannot silently slim the suite outside CI.

### Test Layers

| Layer       | Available | Tool                                                                                     |
| ----------- | --------- | ----------------------------------------------------------------------------------------- |
| Unit        | ✅        | Vitest — `test/domain/*.test.ts` (chunking, excerpt, frontmatter, fusion, metrics, similarity, index-markdown) |
| Integration | ✅        | Vitest — `test/application/*.test.ts` and `test/infrastructure/*.test.ts`, including `test/application/index-and-search.test.ts` (full pipeline against the real `ejemplos/` corpus with the deterministic `test/helpers/fake-embeddings.ts` stub) |
| E2E         | ❌        | — (no Playwright/Cypress/Selenium configured)                                             |

### Coverage

- Available: ❌ (no `--coverage` script; `@vitest/coverage-*` not installed)
- Command: —

### Quality Tools

| Tool         | Available | Command                    |
| ------------ | --------- | --------------------------- |
| Linter       | ❌        | — (no lint script, no ESLint/Biome/Prettier config found) |
| Type checker | ✅        | `npm run typecheck` (`tsc --noEmit`) |
| Formatter    | ❌        | — (no `.prettierrc`/Biome config found) |

### Other commands

- Build: `npm run build` (`tsc` → `dist/`)
- Dev (no compile): `npm run dev -- <args>` (`tsx src/cli.ts`)
- `prepublishOnly`: runs `build` then `test` — publishing fails if either fails.
- Manual smoke test against the example corpus:
  ```bash
  node dist/cli.js --root ejemplos index
  node dist/cli.js --root ejemplos eval
  node dist/cli.js --root ejemplos search "¿cuándo se considera duplicado un lead?"
  ```
