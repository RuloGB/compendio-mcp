import { describe, expect, it } from "vitest";
import type { Container } from "../src/composition.js";
import { createMcpServer } from "../src/server.js";

/**
 * Smoke-level contract test: schema validation for the `search_docs` tool's
 * `tipo` parameter must accept any string (open, project-defined taxonomy),
 * not just values from the retired closed `TIPOS` list. `getOverview` /
 * `searchDocuments` / `readDocument` are never invoked by these assertions
 * (schema parsing happens independently of the tool handler), so a minimal
 * fake container is sufficient.
 */
function fakeContainer(): Container {
  return {} as Container;
}

interface RegisteredToolLike {
  inputSchema?: { parse: (value: unknown) => unknown };
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

describe("search_docs tool — open tipo schema", () => {
  it("accepts a tipo value outside any closed taxonomy", () => {
    const server = createMcpServer(fakeContainer());
    const tool = getRegisteredTool(server, "search_docs");
    expect(() => tool.inputSchema?.parse({ query: "algo", tipo: "playbook" })).not.toThrow();
  });

  it("still accepts a request with tipo entirely omitted", () => {
    const server = createMcpServer(fakeContainer());
    const tool = getRegisteredTool(server, "search_docs");
    expect(() => tool.inputSchema?.parse({ query: "algo" })).not.toThrow();
  });

  it("rejects a request missing the required query field", () => {
    const server = createMcpServer(fakeContainer());
    const tool = getRegisteredTool(server, "search_docs");
    expect(() => tool.inputSchema?.parse({ tipo: "playbook" })).toThrow();
  });
});
