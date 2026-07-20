#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { formatOverview } from "./application/get-overview.js";
import type { SearchQuery } from "./application/search-documents.js";
import type { EvalCase, EvalSummary } from "./domain/metrics.js";
import { TIPOS, type Tipo } from "./domain/model.js";
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
      { docsDir: options.dir, forzarLexico: options.lexico },
      async (container) => {
        const report = await container.indexDocuments.execute();
        for (const omitido of report.omitidos) {
          console.warn(`AVISO ${omitido.ruta}: ${omitido.errores.join("; ")}`);
        }
        if (report.avisoEmbeddings !== undefined) {
          console.warn(`AVISO ${report.avisoEmbeddings}`);
        }
        console.log(
          `Indexados ${report.indexados.length} documentos (${report.totalChunks} chunks) ` +
            `en ${report.duracionMs} ms [modo ${report.modo}]`,
        );
        if (report.omitidos.length > 0) {
          console.log(`Omitidos ${report.omitidos.length} documentos con frontmatter invalido.`);
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
      for (const omitido of report.omitidos) {
        console.warn(
          `AVISO ${omitido.ruta}: ${omitido.errores.join("; ")} (no aparece en INDEX.md)`,
        );
      }
      const resultado = report.cambiado ? "actualizado" : "sin cambios";
      console.log(`INDEX.md ${resultado}: ${report.documentos} documentos en ${report.ruta}`);
    });
  });

program
  .command("search")
  .description("Busca en la documentacion indexada y muestra el resultado en JSON")
  .argument("<query>", "consulta en lenguaje natural")
  .option("-k, --k <n>", "numero de resultados", parsePositiveInt)
  .option("--tipo <tipo>", `filtra por tipo (${TIPOS.join(", ")})`)
  .option("--modulo <modulo>", "filtra por modulo")
  .option("--etiquetas <lista>", "filtra por etiquetas, separadas por comas")
  .option("--todos", "incluye documentos en borrador u obsoletos")
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
        if (options.tipo !== undefined) query.tipo = parseTipo(options.tipo);
        if (options.modulo !== undefined) query.modulo = options.modulo;
        if (options.etiquetas !== undefined) {
          query.etiquetas = options.etiquetas.split(",").map((e) => e.trim());
        }
        if (options.k !== undefined) query.k = options.k;
        if (options.todos === true) query.incluirNoVigentes = true;
        if (options.lexico === true) query.forzarLexico = true;
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
    const casos = loadGoldenset(resolve(root, options.goldenset));
    await withContainer({}, async (container) => {
      const k = options.k ?? container.config.search.k;
      const report = await container.evaluateSearch.execute(casos, k);
      printEvalReport(report.lexico, report.hibrido, k);
    });
  });

program
  .command("serve")
  .description("Arranca el servidor MCP por stdio (para registrarlo en un cliente MCP)")
  .action(async () => {
    const root = program.opts<GlobalOptions>().root;
    const container = createContainer({ root });
    const server = createMcpServer(container);
    // stdout belongs to the MCP protocol: all logging goes to stderr.
    console.error(`compendio-mcp v${SERVER_VERSION}: servidor MCP iniciado (stdio)`);
    await server.connect(new StdioServerTransport());
  });

async function withContainer(
  options: { docsDir?: string | undefined; forzarLexico?: boolean | undefined },
  action: (container: Container) => Promise<void>,
): Promise<void> {
  const root = program.opts<GlobalOptions>().root;
  const containerOptions: Parameters<typeof createContainer>[0] = { root };
  if (options.docsDir !== undefined) containerOptions.docsDir = options.docsDir;
  if (options.forzarLexico !== undefined) containerOptions.forzarLexico = options.forzarLexico;
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

function parseTipo(value: string): Tipo {
  if (!TIPOS.includes(value as Tipo)) {
    console.error(`Tipo invalido: "${value}". Permitidos: ${TIPOS.join(", ")}`);
    process.exit(2);
  }
  return value as Tipo;
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
    console.error("El goldenset debe ser una lista YAML de { pregunta, esperado }.");
    process.exit(2);
  }
  const casos: EvalCase[] = [];
  for (const entry of parsed) {
    const pregunta = (entry as Record<string, unknown>)["pregunta"];
    const esperado = (entry as Record<string, unknown>)["esperado"];
    if (typeof pregunta !== "string" || typeof esperado !== "string") {
      console.error(`Entrada invalida en el goldenset: ${JSON.stringify(entry)}`);
      process.exit(2);
    }
    casos.push({ pregunta, esperado });
  }
  return casos;
}

function printEvalReport(
  lexico: EvalSummary,
  hibrido: EvalSummary | undefined,
  k: number,
): void {
  console.log(`Goldenset: ${lexico.casos} preguntas | k = ${k}\n`);
  const header = `modo      recall@${k}   MRR      fallos`;
  console.log(header);
  console.log("-".repeat(header.length));
  if (hibrido !== undefined) {
    console.log(formatEvalRow("hibrido", hibrido));
  }
  console.log(formatEvalRow("lexico", lexico));
  if (hibrido === undefined) {
    console.log("\nEl indice no tiene vectores: solo se evalua el modo lexico.");
  }
  for (const [modo, summary] of [
    ["hibrido", hibrido],
    ["lexico", lexico],
  ] as const) {
    if (summary === undefined || summary.fallos.length === 0) continue;
    console.log(`\nFallos en modo ${modo}:`);
    for (const fallo of summary.fallos) {
      const posicion = fallo.posicion === null ? "no aparece" : `posicion ${fallo.posicion}`;
      console.log(`- "${fallo.pregunta}" -> ${fallo.esperado} (${posicion})`);
    }
  }
}

function formatEvalRow(modo: string, summary: EvalSummary): string {
  return (
    modo.padEnd(10) +
    summary.recallAtK.toFixed(2).padEnd(11) +
    summary.mrr.toFixed(3).padEnd(9) +
    String(summary.fallos.length)
  );
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
