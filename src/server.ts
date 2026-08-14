import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatOverview, toSyncInfo } from "./application/get-overview.js";
import { formatFrontmatter, type ReadResult } from "./application/read-document.js";
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
/**
 * Server-level instructions, surfaced by MCP clients as guidance rather than
 * buried in a tool list.
 *
 * They describe the server's COMPETENCE, not its substrate. An agent does not
 * classify "what message does the user see on a malformed email?" as a
 * documentation question — it classifies it as "find the validation code" and
 * reaches for grep. Naming the question shapes this server answers is what
 * puts it in the running at all.
 *
 * They deliberately do NOT tell an agent to search here instead of reading
 * source. Documentation goes stale and source cannot, so on "what does it do
 * today" the code is the authority and a doc is only a claim about it. What
 * source can never hold is intent — why a choice was made, what a rule is
 * meant to guarantee — and that is the claim worth making. An instruction that
 * over-claims gets discounted wholesale, so conceding the ground compendio
 * does not own is what makes the rest of it credible.
 */
const SERVER_INSTRUCTIONS = [
  "Compendio indexes this project's own documentation: the decisions, business rules,",
  "workflows, limits and user-facing messages the team wrote down.",
  "",
  "Reach for search_docs whenever a question touches what the project does or why —",
  "behaviour, validation rules, the exact text of a user-facing message, limits,",
  "endpoints, deployment steps, or the reasoning behind a technical choice. It usually",
  "answers in one call, and it is the cheapest way to find out where to look next.",
  "",
  "Source code stays the authority on what the system does today: documentation can go",
  "stale, code cannot. What code cannot hold is intent — why a choice was made, which",
  "alternatives were rejected, what a rule is meant to guarantee. For that the docs are",
  "the only record. Use both: search here to learn what the project says and why, then",
  "confirm against source when the answer has to reflect current behaviour.",
].join("\n");

export function createMcpServer(container: Container): McpServer {
  const server = new McpServer(
    { name: "compendio-mcp", version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "docs_overview",
    {
      title: "Documentation map",
      description:
        "Map of the documentation corpus: counts by type and module, plus one line per document " +
        "([type] path — summary (status)). Use it to enumerate what exists, or to pick filter " +
        "values for search_docs. For a specific question, call search_docs first — it answers in " +
        "one call, while orienting here lists the whole corpus before you can read anything.",
      inputSchema: {},
    },
    async () => {
      await container.syncScheduler.maybeSync();
      const overview = container.getOverview.execute();
      const sync = toSyncInfo(container.syncScheduler.lastReport);
      return { content: [{ type: "text", text: formatOverview(overview, sync, container.configWarnings) }] };
    },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Documentation search",
      description:
        "Hybrid search (lexical BM25 + semantic) in natural language over the project's " +
        "documentation, with metadata filters. Entry point for any question about what the " +
        "project does or why — behaviour, business rules, the exact text of a user-facing " +
        "message, limits, endpoints, deployment steps, or the reasoning behind a decision. " +
        "Cheapest first probe for such a question; source code remains the authority on " +
        "current behaviour, while these docs are the only record of intent. " +
        "The top result carries a full-length excerpt, centred on the part of the document that " +
        "matched, which usually answers outright; the rest carry short ones from the start of " +
        "their section, enough to tell whether the top result is the right one. Each result has " +
        "path, title, section, excerpt and score; section names the document region the fragment " +
        "came from — a document with no headings reports one region for the whole file. A '…' at " +
        "either end of an excerpt marks content omitted there — that is the signal to call " +
        "read_doc with its path and section. If the project declares convention.excludedStatuses, " +
        "documents in those statuses are left out unless include_excluded is set; if it declares " +
        "none, no document is excluded by status.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language query"),
        // Filters are a footgun on first contact: their values are
        // project-defined and frequently absent altogether, so an agent that
        // infers them from directory names gets a guaranteed empty result.
        // Cheaper to stop the guess than to explain it afterwards.
        type: z
          .string()
          .optional()
          .describe(
            "Filter by document type — project-defined, and absent entirely in many projects. " +
              "Omit it unless docs_overview showed you the value; never infer it from directory " +
              "names or paths.",
          ),
        module: z
          .string()
          .optional()
          .describe("Filter by module — same caveat as type: omit unless docs_overview showed the value."),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "Filter by tags (matching one is enough) — same caveat: omit unless docs_overview showed them.",
          ),
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
        "along with its frontmatter. Prefer passing section: a whole document costs several " +
        "times more than the section you actually need. If the path does not exist, responds " +
        "with the 3 closest matching paths instead of failing.",
      inputSchema: {
        path: z.string().min(1).describe("Document path, relative to the docs directory"),
        section: z
          .string()
          .optional()
          .describe(
            "Heading (or part of it) of the section to read, e.g. 'Business rules'. " +
              "Use the section field of a search_docs result. Sections name a region of a " +
              "document, not a single fragment: a large section returns all of its parts joined.",
          ),
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

/**
 * Exported (only) for `test/server/format-read-result.test.ts`, which asserts
 * its literal rendered output for every `ReadResult` variant (Gate 4) --
 * in-repo precedent: `toFtsQuery` (`sqlite-index-store.ts`).
 *
 * Retyped from `ReturnType<Container["readDocument"]["execute"]>` to the
 * named `ReadResult` union so the test can construct any variant directly,
 * without a live `Container`.
 */
export function formatReadResult(result: ReadResult): string {
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
    case "section-not-found": {
      // Filtered again here, independent of ReadDocument's own filtering
      // (design.md Decision 5): Gate 4 is a property of formatReadResult for
      // ANY input, not conditional on a well-behaved caller. If nothing
      // survives, there is genuinely nothing to list.
      const available = result.availableSections.filter((s) => s !== "");
      if (available.length === 0) {
        return formatNoSections(result.meta.path);
      }
      return [
        `Document "${result.meta.path}" has no section matching "${result.section}".`,
        "Available sections:",
        ...available.map((s) => `- ${s}`),
      ].join("\n");
    }
    case "no-sections":
      return formatNoSections(result.meta.path);
  }
}

function formatNoSections(path: string): string {
  return [
    `Document "${path}" has no addressable sections.`,
    `Read it whole with read_doc({ path: "${path}" }).`,
  ].join("\n");
}
