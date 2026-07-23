import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatOverview } from "./application/get-overview.js";
import { formatFrontmatter } from "./application/read-document.js";
import type { SearchQuery } from "./application/search-documents.js";
import type { Container } from "./composition.js";

/**
 * Read from package.json at runtime rather than importing it: `rootDir` is
 * `src`, so a `resolveJsonModule` import of `../package.json` would pull a file
 * from outside the root and shift the whole emitted layout under `dist/`.
 *
 * `../package.json` resolves to the package root from both `src/server.ts`
 * (under `tsx`) and `dist/server.js` (published), since `outDir` sits one level
 * below the root just like `rootDir`.
 */
export const SERVER_VERSION: string = readPackageVersion();

function readPackageVersion(): string {
  const manifest = new URL("../package.json", import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error("package.json no declara 'version'");
  }
  const version = (parsed as { version: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json declara una 'version' que no es una cadena valida");
  }
  return version;
}

/**
 * MCP server over stdio with the three progressive-disclosure tools:
 * orient cheap (docs_overview) -> search cheap (search_docs) -> read only
 * what is needed (read_doc).
 */
export function createMcpServer(container: Container): McpServer {
  const server = new McpServer({ name: "compendio-mcp", version: SERVER_VERSION });

  server.registerTool(
    "docs_overview",
    {
      title: "Mapa de la documentacion",
      description:
        "Devuelve el mapa del corpus documental: recuento por tipo y modulo, y una linea por " +
        "documento ([tipo] ruta — resumen (estado)). Es el primer paso recomendado antes de buscar.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: formatOverview(container.getOverview.execute()) }],
    }),
  );

  server.registerTool(
    "search_docs",
    {
      title: "Busqueda en la documentacion",
      description:
        "Busqueda hibrida (lexica BM25 + semantica) en lenguaje natural sobre la documentacion " +
        "del proyecto, con filtros por metadatos. Devuelve fragmentos compactos (ruta, seccion, " +
        "extracto); usa read_doc para leer una seccion completa. Si el proyecto declara " +
        "convencion.estadosExcluidos, los documentos en esos estados quedan fuera salvo " +
        "incluir_no_vigentes; si no lo declara, no se excluye ningun documento por su estado.",
      inputSchema: {
        query: z.string().min(1).describe("Consulta en lenguaje natural"),
        tipo: z.string().optional().describe("Filtra por tipo de documento (segun la convencion del proyecto)"),
        modulo: z.string().optional().describe("Filtra por modulo"),
        etiquetas: z.array(z.string()).optional().describe("Filtra por etiquetas (basta una)"),
        k: z.number().int().min(1).max(20).optional().describe("Numero de resultados (5 por defecto)"),
        incluir_no_vigentes: z
          .boolean()
          .optional()
          .describe(
            "Incluye documentos cuyo estado figura en convencion.estadosExcluidos " +
              "(sin efecto si el proyecto no declara exclusiones)",
          ),
      },
    },
    async (args) => {
      const query: SearchQuery = { query: args.query };
      if (args.tipo !== undefined) query.tipo = args.tipo;
      if (args.modulo !== undefined) query.modulo = args.modulo;
      if (args.etiquetas !== undefined) query.etiquetas = args.etiquetas;
      if (args.k !== undefined) query.k = args.k;
      if (args.incluir_no_vigentes !== undefined) query.incluirNoVigentes = args.incluir_no_vigentes;
      const response = await container.searchDocuments.execute(query);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 1) }] };
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Lectura de un documento",
      description:
        "Devuelve una seccion concreta de un documento (o el documento completo si no se indica " +
        "seccion), con su frontmatter. Si la ruta no existe, responde con las 3 rutas mas parecidas.",
      inputSchema: {
        ruta: z.string().min(1).describe("Ruta del documento relativa al directorio de docs"),
        seccion: z
          .string()
          .optional()
          .describe("Encabezado (o parte) de la seccion a leer, p. ej. 'Reglas de negocio'"),
      },
    },
    async (args) => {
      const request: { ruta: string; seccion?: string } = { ruta: args.ruta };
      if (args.seccion !== undefined) request.seccion = args.seccion;
      const result = container.readDocument.execute(request);
      return { content: [{ type: "text", text: formatReadResult(result) }] };
    },
  );

  return server;
}

function formatReadResult(
  result: ReturnType<Container["readDocument"]["execute"]>,
): string {
  switch (result.tipo) {
    case "documento":
      return `${formatFrontmatter(result.meta)}\n\n${result.contenido}`;
    case "seccion":
      return `${formatFrontmatter(result.meta)}\n\n${result.contenido}`;
    case "ruta-no-encontrada":
      return [
        `No existe ningun documento indexado con la ruta "${result.ruta}".`,
        "Rutas mas parecidas:",
        ...result.sugerencias.map((s) => `- ${s}`),
      ].join("\n");
    case "seccion-no-encontrada":
      return [
        `El documento "${result.meta.ruta}" no tiene ninguna seccion que coincida con "${result.seccion}".`,
        "Secciones disponibles:",
        ...result.seccionesDisponibles.map((s) => `- ${s}`),
      ].join("\n");
  }
}
