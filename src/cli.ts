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
    "Indexa la documentacion markdown del proyecto y la sirve a agentes de IA " +
      "mediante busqueda hibrida local (BM25 + embeddings).",
  )
  .version(SERVER_VERSION)
  .option("-C, --root <dir>", "raiz del proyecto (donde vive compendio.config.json)", process.cwd());

program
  .command("index")
  .description("Reindexa toda la documentacion en .compendio/compendio.db")
  .option("--dir <dir>", "directorio de documentacion (sobrescribe la configuracion)")
  .option("--lexico", "indexa sin embeddings (solo busqueda lexica)")
  .action(async (options: { dir?: string; lexico?: boolean }) => {
    await withContainer(
      { docsDir: options.dir, forceLexical: options.lexico },
      async (container) => {
        const report = await container.indexDocuments.execute();
        for (const skippedItem of report.skipped) {
          console.warn(`AVISO ${skippedItem.path}: ${skippedItem.errors.join("; ")}`);
        }
        if (report.embeddingsWarning !== undefined) {
          console.warn(`AVISO ${report.embeddingsWarning}`);
        }
        console.log(
          `Indexados ${report.indexed.length} documentos (${report.totalChunks} chunks) ` +
            `en ${report.durationMs} ms [modo ${report.mode}]`,
        );
        if (report.skipped.length > 0) {
          console.log(`Omitidos ${report.skipped.length} documentos con frontmatter invalido.`);
        }
      },
    );
  });

program
  .command("index-md")
  .description("Genera o actualiza INDEX.md en el directorio de documentacion")
  .option("--dir <dir>", "directorio de documentacion (sobrescribe la configuracion)")
  .action(async (options: { dir?: string }) => {
    await withContainer({ docsDir: options.dir }, async (container) => {
      const report = await container.generateIndexMd.execute();
      for (const skippedItem of report.skipped) {
        console.warn(
          `AVISO ${skippedItem.path}: ${skippedItem.errors.join("; ")} (no aparece en INDEX.md)`,
        );
      }
      const resultado = report.changed ? "actualizado" : "sin cambios";
      console.log(`INDEX.md ${resultado}: ${report.documents} documentos en ${report.path}`);
    });
  });

program
  .command("search")
  .description("Busca en la documentacion indexada y muestra el resultado en JSON")
  .argument("<query>", "consulta en lenguaje natural")
  .option("-k, --k <n>", "numero de resultados", parsePositiveInt)
  .option("--tipo <tipo>", "filtra por tipo de documento (segun la convencion del proyecto)")
  .option("--modulo <modulo>", "filtra por modulo")
  .option("--etiquetas <lista>", "filtra por etiquetas, separadas por comas")
  .option("--todos", "incluye documentos excluidos por convencion.estadosExcluidos")
  .option("--lexico", "fuerza busqueda solo lexica (sin embeddings)")
  .action(
    async (
      queryText: string,
      options: {
        k?: number;
        tipo?: string;
        modulo?: string;
        etiquetas?: string;
        todos?: boolean;
        lexico?: boolean;
      },
    ) => {
      await withContainer({}, async (container) => {
        const query: SearchQuery = { query: queryText };
        if (options.tipo !== undefined) query.type = parseType(options.tipo);
        if (options.modulo !== undefined) query.module = options.modulo;
        if (options.etiquetas !== undefined) {
          query.tags = options.etiquetas.split(",").map((e) => e.trim());
        }
        if (options.k !== undefined) query.k = options.k;
        if (options.todos === true) query.includeExcluded = true;
        if (options.lexico === true) query.forceLexical = true;
        const response = await container.searchDocuments.execute(query);
        console.log(JSON.stringify(response, null, 2));
      });
    },
  );

program
  .command("overview")
  .description("Muestra el mapa del corpus indexado (igual que la tool docs_overview)")
  .action(async () => {
    await withContainer({}, async (container) => {
      console.log(formatOverview(container.getOverview.execute()));
    });
  });

program
  .command("eval")
  .description("Evalua la calidad de la busqueda contra un goldenset (hibrido vs lexico)")
  .option("--goldenset <path>", "fichero YAML con preguntas y documento esperado", "goldenset.yaml")
  .option("-k, --k <n>", "k para recall@k", parsePositiveInt)
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
  .description("Arranca el servidor MCP por stdio (para registrarlo en un cliente MCP)")
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
    console.error(`compendio-mcp v${SERVER_VERSION}: servidor MCP iniciado (stdio)`);
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
    throw new Error(`valor invalido: "${value}" (se espera un entero positivo)`);
  }
  return parsed;
}

/**
 * `tipo` is an open, project-defined string (declared via `convencion.types`
 * in `compendio.config.json`, or freeform in `libre` mode) — there is no
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
    console.error(`No se encuentra el goldenset en "${path}".`);
    process.exit(2);
  }
  const parsed = parseYaml(raw) as unknown;
  if (!Array.isArray(parsed)) {
    // es-frozen: quotes ejemplos/goldenset.yaml's real (frozen) key names
    console.error("El goldenset debe ser una lista YAML de { pregunta, esperado }.");
    process.exit(2);
  }
  const cases: EvalCase[] = [];
  for (const entry of parsed) {
    // es-frozen: indexes into ejemplos/goldenset.yaml's real (frozen) keys
    const question = (entry as Record<string, unknown>)["pregunta"];
    // es-frozen: indexes into ejemplos/goldenset.yaml's real (frozen) keys
    const expected = (entry as Record<string, unknown>)["esperado"];
    if (typeof question !== "string" || typeof expected !== "string") {
      console.error(`Entrada invalida en el goldenset: ${JSON.stringify(entry)}`);
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
  console.log(`Goldenset: ${lexical.cases} preguntas | k = ${k}\n`);
  const header = `modo      recall@${k}   MRR      failures`;
  console.log(header);
  console.log("-".repeat(header.length));
  if (hybrid !== undefined) {
    console.log(formatEvalRow("hybrid", hybrid));
  }
  console.log(formatEvalRow("lexical", lexical));
  if (hybrid === undefined) {
    console.log("\nEl indice no tiene vectores: solo se evalua el modo lexical.");
  }
  for (const [modo, summary] of [
    ["hybrid", hybrid],
    ["lexical", lexical],
  ] as const) {
    if (summary === undefined || summary.failures.length === 0) continue;
    console.log(`\nFailures en modo ${modo}:`);
    for (const failure of summary.failures) {
      const rank = failure.rank === null ? "no aparece" : `posicion ${failure.rank}`;
      console.log(`- "${failure.question}" -> ${failure.expected} (${rank})`);
    }
  }
}

function formatEvalRow(modo: string, summary: EvalSummary): string {
  return (
    modo.padEnd(10) +
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
