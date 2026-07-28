#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { formatOverview } from "./application/get-overview.js";
import type { SearchQuery } from "./application/search-documents.js";
import type { EvalCase, EvalSummary } from "./domain/metrics.js";
import { createContainer, type Container } from "./composition.js";
import { createMcpServer, SERVER_VERSION } from "./server.js";

interface GlobalOptions {
  root: string;
}

const program = new Command();

program
  .name("compendio")
  .description(
    "Indexes the project's markdown documentation and serves it to AI agents " +
      "through local hybrid search (BM25 + embeddings).",
  )
  .version(SERVER_VERSION)
  .option("-C, --root <dir>", "project root (where compendio.config.json lives)", process.cwd());

program
  .command("index")
  .description("Reindexes all documentation into .compendio/compendio.db")
  .option("--dir <dir>", "documentation directory (overrides the config)")
  .option("--lexical", "index without embeddings (lexical search only)")
  .action(async (options: { dir?: string; lexical?: boolean }) => {
    await withContainer(
      { docsDir: options.dir, forceLexical: options.lexical },
      async (container) => {
        const report = await container.indexDocuments.execute();
        for (const skippedItem of report.skipped) {
          console.warn(`WARNING ${skippedItem.path}: ${skippedItem.errors.join("; ")}`);
        }
        if (report.embeddingsWarning !== undefined) {
          console.warn(`WARNING ${report.embeddingsWarning}`);
        }
        console.log(
          `Indexed ${report.indexed.length} documents (${report.totalChunks} chunks) ` +
            `in ${report.durationMs} ms [mode ${report.mode}]`,
        );
        if (report.skipped.length > 0) {
          console.log(`Skipped ${report.skipped.length} documents with invalid frontmatter.`);
        }
      },
    );
  });

program
  .command("index-md")
  .description("Generates or updates INDEX.md in the documentation directory")
  .option("--dir <dir>", "documentation directory (overrides the config)")
  .action(async (options: { dir?: string }) => {
    await withContainer({ docsDir: options.dir }, async (container) => {
      const report = await container.generateIndexMd.execute();
      for (const skippedItem of report.skipped) {
        console.warn(
          `WARNING ${skippedItem.path}: ${skippedItem.errors.join("; ")} (not listed in INDEX.md)`,
        );
      }
      const outcome = report.changed ? "updated" : "unchanged";
      console.log(`INDEX.md ${outcome}: ${report.documents} documents at ${report.path}`);
    });
  });

program
  .command("search")
  .description("Searches the indexed documentation and prints the result as JSON")
  .argument("<query>", "natural language query")
  .option("-k, --k <n>", "number of results", parsePositiveInt)
  .option("--type <type>", "filter by document type (per the project's convention)")
  .option("--module <module>", "filter by module")
  .option("--tags <list>", "filter by tags, comma separated")
  .option("--all", "include documents excluded by convention.excludedStatuses")
  .option("--lexical", "force lexical-only search (no embeddings)")
  .action(
    async (
      queryText: string,
      options: {
        k?: number;
        type?: string;
        module?: string;
        tags?: string;
        all?: boolean;
        lexical?: boolean;
      },
    ) => {
      await withContainer({}, async (container) => {
        const query: SearchQuery = { query: queryText };
        if (options.type !== undefined) query.type = parseType(options.type);
        if (options.module !== undefined) query.module = options.module;
        if (options.tags !== undefined) {
          query.tags = options.tags.split(",").map((e) => e.trim());
        }
        if (options.k !== undefined) query.k = options.k;
        if (options.all === true) query.includeExcluded = true;
        if (options.lexical === true) query.forceLexical = true;
        const response = await container.searchDocuments.execute(query);
        console.log(JSON.stringify(response, null, 2));
      });
    },
  );

program
  .command("overview")
  .description("Shows the map of the indexed corpus (same as the docs_overview tool)")
  .action(async () => {
    await withContainer({}, async (container) => {
      console.log(formatOverview(container.getOverview.execute()));
    });
  });

program
  .command("eval")
  .description("Evaluates search quality against a goldenset (hybrid vs lexical)")
  .option("--goldenset <path>", "YAML file with questions and the expected document", "goldenset.yaml")
  .option("-k, --k <n>", "k for recall@k", parsePositiveInt)
  .action(async (options: { goldenset: string; k?: number }) => {
    const root = program.opts<GlobalOptions>().root;
    const cases = loadGoldenset(resolve(root, options.goldenset));
    await withContainer({}, async (container) => {
      const k = options.k ?? container.config.search.k;
      const report = await container.evaluateSearch.execute(cases, k);
      printEvalReport(report.lexical, report.hybrid, k);
    });
  });

program
  .command("serve")
  .description("Starts the MCP server over stdio, to register it in an MCP client")
  .action(async () => {
    const root = program.opts<GlobalOptions>().root;
    const container = createContainer({ root });
    const server = createMcpServer(container);
    // Synchronously assigns the startup sync pass to the scheduler's
    // in-flight promise — NOT awaited: the stdio transport connects without
    // waiting for it, but every tool call (including the very first) is
    // gated on it via maybeSync() awaiting that same in-flight promise.
    container.syncScheduler.startup();
    // stdout belongs to the MCP protocol: all logging goes to stderr.
    console.error(`compendio-mcp v${SERVER_VERSION}: MCP server started (stdio)`);
    await server.connect(new StdioServerTransport());
  });

async function withContainer(
  options: { docsDir?: string | undefined; forceLexical?: boolean | undefined },
  action: (container: Container) => Promise<void>,
): Promise<void> {
  const root = program.opts<GlobalOptions>().root;
  const containerOptions: Parameters<typeof createContainer>[0] = { root };
  if (options.docsDir !== undefined) containerOptions.docsDir = options.docsDir;
  if (options.forceLexical !== undefined) containerOptions.forceLexical = options.forceLexical;
  const container = createContainer(containerOptions);
  try {
    await action(container);
  } finally {
    container.close();
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`invalid value: "${value}" (expected a positive integer)`);
  }
  return parsed;
}

/**
 * `type` is an open, project-defined string (declared via `convention.types`
 * in `compendio.config.json`, or freeform in `loose` mode) — there is no
 * closed list to validate against at the CLI layer, so this is a passthrough,
 * never a hard exit. Exported for direct unit testing.
 */
export function parseType(value: string): string {
  return value.trim();
}

function loadGoldenset(path: string): EvalCase[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`Goldenset not found at "${path}".`);
    process.exit(2);
  }
  const parsed = parseYaml(raw) as unknown;
  if (!Array.isArray(parsed)) {
    // es-frozen: quotes ejemplos/goldenset.yaml's real (frozen) key names
    console.error("The goldenset must be a YAML list of { pregunta, esperado } entries.");
    process.exit(2);
  }
  const cases: EvalCase[] = [];
  for (const entry of parsed) {
    // es-frozen: indexes into ejemplos/goldenset.yaml's real (frozen) keys
    const question = (entry as Record<string, unknown>)["pregunta"];
    // es-frozen: indexes into ejemplos/goldenset.yaml's real (frozen) keys
    const expected = (entry as Record<string, unknown>)["esperado"];
    if (typeof question !== "string" || typeof expected !== "string") {
      console.error(`Invalid goldenset entry: ${JSON.stringify(entry)}`);
      process.exit(2);
    }
    cases.push({ question, expected });
  }
  return cases;
}

function printEvalReport(
  lexical: EvalSummary,
  hybrid: EvalSummary | undefined,
  k: number,
): void {
  console.log(`Goldenset: ${lexical.cases} questions | k = ${k}\n`);
  const header = `mode      recall@${k}   MRR      failures`;
  console.log(header);
  console.log("-".repeat(header.length));
  if (hybrid !== undefined) {
    console.log(formatEvalRow("hybrid", hybrid));
  }
  console.log(formatEvalRow("lexical", lexical));
  if (hybrid === undefined) {
    console.log("\nThe index has no vectors: only lexical mode is evaluated.");
  }
  for (const [mode, summary] of [
    ["hybrid", hybrid],
    ["lexical", lexical],
  ] as const) {
    if (summary === undefined || summary.failures.length === 0) continue;
    console.log(`\nFailures in ${mode} mode:`);
    for (const failure of summary.failures) {
      const rank = failure.rank === null ? "not found" : `position ${failure.rank}`;
      console.log(`- "${failure.question}" -> ${failure.expected} (${rank})`);
    }
  }
}

function formatEvalRow(mode: string, summary: EvalSummary): string {
  return (
    mode.padEnd(10) +
    summary.recallAtK.toFixed(2).padEnd(11) +
    summary.mrr.toFixed(3).padEnd(9) +
    String(summary.failures.length)
  );
}

// Guard against side effects when this module is imported (e.g. by tests)
// instead of executed directly (`node dist/cli.js ...` / `tsx src/cli.ts ...`).
//
// `realpathSync`, not `resolve`: npm installs the `bin` entries as symlinks to
// `dist/cli.js` on macOS/Linux, and Node resolves symlinks for `import.meta.url`
// but NOT for `process.argv[1]`. Comparing the un-resolved paths makes this
// guard false under `npx compendio` / a global install, so the CLI would exit 0
// having silently done nothing. `resolve` only normalizes; it never follows a link.
const isMainModule = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  program.parseAsync(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
