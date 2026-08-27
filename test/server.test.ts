import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createContainer, type Container } from "../src/composition.js";
import { createMcpServer, SERVER_VERSION } from "../src/server.js";

/**
 * Smoke-level contract test: schema validation for the `search_docs` tool's
 * `type` parameter must accept any string (open, project-defined taxonomy),
 * not just values from a closed, fixed list. `getOverview` /
 * `searchDocuments` / `readDocument` are never invoked by these assertions
 * (schema parsing happens independently of the tool handler), so a minimal
 * fake container is sufficient.
 */
function fakeContainer(): Container {
  return {} as Container;
}

interface RegisteredToolLike {
  inputSchema?: { parse: (value: unknown) => unknown };
  handler: (...args: unknown[]) => Promise<unknown>;
}

function getRegisteredTool(
  server: ReturnType<typeof createMcpServer>,
  name: string,
): RegisteredToolLike {
  const internals = server as unknown as {
    _registeredTools: Record<string, RegisteredToolLike>;
  };
  const tool = internals._registeredTools[name];
  if (tool === undefined) {
    throw new Error(`tool "${name}" was not registered`);
  }
  return tool;
}

describe("server instructions", () => {
  it("ships routing guidance that frames competence, not file format", () => {
    const server = createMcpServer(fakeContainer());
    const internals = server.server as unknown as { _instructions?: string };
    const instructions = internals._instructions ?? "";
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions).toContain("search_docs");
    // An agent classifies "what message does the user see?" as a code question.
    // Naming the question shapes is what puts this server in the running; if
    // this drops out, the instructions have gone back to describing markdown
    // files instead of the questions they answer.
    expect(instructions).toMatch(/business rules/i);
    // And they must keep conceding what source code owns — an instruction that
    // over-claims gets discounted wholesale.
    expect(instructions).toMatch(/authority/i);
  });
});

describe("search_docs tool — open type schema", () => {
  it("accepts a type value outside any closed taxonomy", () => {
    const server = createMcpServer(fakeContainer());
    const tool = getRegisteredTool(server, "search_docs");
    expect(() => tool.inputSchema?.parse({ query: "algo", type: "playbook" })).not.toThrow();
  });

  it("still accepts a request with type entirely omitted", () => {
    const server = createMcpServer(fakeContainer());
    const tool = getRegisteredTool(server, "search_docs");
    expect(() => tool.inputSchema?.parse({ query: "algo" })).not.toThrow();
  });

  it("rejects a request missing the required query field", () => {
    const server = createMcpServer(fakeContainer());
    const tool = getRegisteredTool(server, "search_docs");
    expect(() => tool.inputSchema?.parse({ type: "playbook" })).toThrow();
  });
});

/**
 * `SERVER_VERSION` is what the CLI reports via `--version` and what the MCP
 * server announces to clients. It drifted from `package.json` once already
 * (hardcoded `"0.1.0"` against a published `0.1.2`), under-reporting the real
 * version to every client. This test is the thing that keeps the two tied.
 */
/**
 * Thin integration check that a REAL registered handler (not a reimplemented
 * copy of the wiring) awaits `syncScheduler.maybeSync()` before doing its
 * own work — the incremental-sync trigger required by the Indexing spec's
 * "Incremental Sync Triggers" requirement. Covers all three tool handlers
 * (`docs_overview`, `search_docs`, `read_doc`), not just the first one: the
 * mcp-contract spec's throttled-check requirement applies to all three, and
 * each handler wires `maybeSync()` independently (a regression in one
 * handler would not be caught by testing only another).
 */
function fakeContainerWithScheduler(maybeSync: () => Promise<void>): Container {
  return {
    syncScheduler: { maybeSync, lastReport: null },
    getOverview: { execute: () => ({ totalDocuments: 0, byType: {}, byModule: {}, documents: [] }) },
    searchDocuments: { execute: async () => ({ mode: "lexical", results: [] }) },
    readDocument: { execute: () => ({ type: "path-not-found", path: "no-importa.md", suggestions: [] }) },
  } as unknown as Container;
}

describe("docs_overview tool — incremental sync trigger", () => {
  it("awaits syncScheduler.maybeSync() before answering", async () => {
    const maybeSync = vi.fn().mockResolvedValue(undefined);
    const server = createMcpServer(fakeContainerWithScheduler(maybeSync));
    const tool = getRegisteredTool(server, "docs_overview");

    await tool.handler({});

    expect(maybeSync).toHaveBeenCalledTimes(1);
  });
});

describe("search_docs tool — incremental sync trigger", () => {
  it("awaits syncScheduler.maybeSync() before answering", async () => {
    const maybeSync = vi.fn().mockResolvedValue(undefined);
    const server = createMcpServer(fakeContainerWithScheduler(maybeSync));
    const tool = getRegisteredTool(server, "search_docs");

    await tool.handler({ query: "algo" });

    expect(maybeSync).toHaveBeenCalledTimes(1);
  });
});

describe("read_doc tool — incremental sync trigger", () => {
  it("awaits syncScheduler.maybeSync() before answering", async () => {
    const maybeSync = vi.fn().mockResolvedValue(undefined);
    const server = createMcpServer(fakeContainerWithScheduler(maybeSync));
    const tool = getRegisteredTool(server, "read_doc");

    await tool.handler({ path: "algo.md" });

    expect(maybeSync).toHaveBeenCalledTimes(1);
  });
});

describe("SERVER_VERSION", () => {
  it("matches the version declared in package.json", () => {
    const manifest = new URL("../package.json", import.meta.url);
    const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };

    expect(SERVER_VERSION).toBe(version);
  });
});

/**
 * No-docs MCP coverage: verifies the server starts and all three tools return
 * well-formed empty responses when no database exists and no documents are
 * present. Uses a real container pointed at an empty temp directory.
 */
describe("MCP tools — no documents, no database", () => {
  function withEmptyContainer(fn: (container: Container) => void | Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "compendio-server-empty-"));
    const container = createContainer({ root: dir, forceLexical: true });
    return Promise.resolve(fn(container)).finally(() => {
      container.close();
      rmSync(dir, { recursive: true, force: true });
    });
  }

  it("docs_overview returns zero documents with no fabricated buckets", async () => {
    await withEmptyContainer(async (container) => {
      const server = createMcpServer(container);
      const tool = getRegisteredTool(server, "docs_overview");
      const result = (await tool.handler({})) as { content: { type: string; text: string }[] };
      const text = result.content[0]!.text;
      expect(text).toContain("Indexed documents: 0");
      expect(text).not.toContain("By type:");
      expect(text).not.toContain("By module:");
    });
  });

  it("search_docs returns normal mode with empty results", async () => {
    await withEmptyContainer(async (container) => {
      const server = createMcpServer(container);
      const tool = getRegisteredTool(server, "search_docs");
      const result = (await tool.handler({ query: "anything" })) as { content: { type: string; text: string }[] };
      const payload = JSON.parse(result.content[0]!.text) as { mode: string; results: unknown[] };
      expect(payload.mode).toBe("lexical");
      expect(payload.results).toEqual([]);
    });
  });

  it("read_doc returns path-not-found with no suggestions", async () => {
    await withEmptyContainer(async (container) => {
      const server = createMcpServer(container);
      const tool = getRegisteredTool(server, "read_doc");
      const result = (await tool.handler({ path: "anything.md" })) as { content: { type: string; text: string }[] };
      const text = result.content[0]!.text;
      expect(text).toContain("No indexed document exists at path");
    });
  });

  it("search_docs with filters returns empty results, not an error, when no database exists", async () => {
    await withEmptyContainer(async (container) => {
      const server = createMcpServer(container);
      const tool = getRegisteredTool(server, "search_docs");
      const result = (await tool.handler({
        query: "anything",
        type: "guide",
        module: "auth",
        tags: ["setup"],
      })) as { content: { type: string; text: string }[] };
      const payload = JSON.parse(result.content[0]!.text) as {
        mode: string;
        results: unknown[];
        filterWarning?: string;
      };
      expect(payload.mode).toBe("lexical");
      expect(payload.results).toEqual([]);
      // Filters targeting undeclared fields are dropped with a warning, not an error.
      expect(payload.filterWarning).toBeDefined();
    });
  });
});
