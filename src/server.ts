import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatOverview, toSyncInfo } from "./application/get-overview.js";
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
    throw new Error("package.json does not declare 'version'");
  }
  const version = (parsed as { version: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json declares a 'version' that is not a valid string");
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
      title: "Documentation map",
      description:
        "Returns a map of the documentation corpus: counts by type and module, plus one line per " +
        "document ([type] path — summary (status)). Start here before searching — it is the " +
        "cheapest way to learn what exists.",
      inputSchema: {},
    },
    async () => {
      await container.syncScheduler.maybeSync();
      const overview = container.getOverview.execute();
      const sync = toSyncInfo(container.syncScheduler.lastReport);
      return { content: [{ type: "text", text: formatOverview(overview, sync) }] };
    },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Documentation search",
      description:
        "Hybrid search (lexical BM25 + semantic) in natural language over the project's " +
        "documentation, with metadata filters. Returns compact fragments (path, section, " +
        "excerpt); call read_doc to read a full section. If the project declares " +
        "convention.excludedStatuses, documents in those statuses are left out unless " +
        "include_excluded is set; if it declares none, no document is excluded by status.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language query"),
        type: z.string().optional().describe("Filter by document type (as defined by the project's convention)"),
        module: z.string().optional().describe("Filter by module"),
        tags: z.array(z.string()).optional().describe("Filter by tags (matching one is enough)"),
        k: z.number().int().min(1).max(20).optional().describe("Number of results (5 by default)"),
        include_excluded: z
          .boolean()
          .optional()
          .describe(
            "Include documents whose status is listed in convention.excludedStatuses " +
              "(no effect if the project declares no exclusions)",
          ),
      },
    },
    async (args) => {
      await container.syncScheduler.maybeSync();
      const query: SearchQuery = { query: args.query };
      if (args.type !== undefined) query.type = args.type;
      if (args.module !== undefined) query.module = args.module;
      if (args.tags !== undefined) query.tags = args.tags;
      if (args.k !== undefined) query.k = args.k;
      if (args.include_excluded !== undefined) query.includeExcluded = args.include_excluded;
      const response = await container.searchDocuments.execute(query);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 1) }] };
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Read a document",
      description:
        "Returns one section of a document (or the whole document when no section is given), " +
        "along with its frontmatter. If the path does not exist, responds with the 3 closest " +
        "matching paths instead of failing.",
      inputSchema: {
        path: z.string().min(1).describe("Document path, relative to the docs directory"),
        section: z
          .string()
          .optional()
          .describe("Heading (or part of it) of the section to read, e.g. 'Business rules'"),
      },
    },
    async (args) => {
      await container.syncScheduler.maybeSync();
      const request: { path: string; section?: string } = { path: args.path };
      if (args.section !== undefined) request.section = args.section;
      const result = container.readDocument.execute(request);
      return { content: [{ type: "text", text: formatReadResult(result) }] };
    },
  );

  return server;
}

function formatReadResult(
  result: ReturnType<Container["readDocument"]["execute"]>,
): string {
  switch (result.type) {
    case "document":
      return `${formatFrontmatter(result.meta)}\n\n${result.content}`;
    case "section":
      return `${formatFrontmatter(result.meta)}\n\n${result.content}`;
    case "path-not-found":
      return [
        `No indexed document exists at path "${result.path}".`,
        "Closest matching paths:",
        ...result.suggestions.map((s) => `- ${s}`),
      ].join("\n");
    case "section-not-found":
      return [
        `Document "${result.meta.path}" has no section matching "${result.section}".`,
        "Available sections:",
        ...result.availableSections.map((s) => `- ${s}`),
      ].join("\n");
  }
}
