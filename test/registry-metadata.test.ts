import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MCP registry publication guard.
 *
 * `registry.modelcontextprotocol.io` hosts metadata only: the artifact stays on
 * npm, and the registry proves ownership by reading the PUBLISHED tarball — the
 * `mcpName` field of its `package.json` and the `mcp-name:` marker inside its
 * `README.md`. A marker that exists only on `main` verifies nothing, and every
 * mismatch here is discovered at `mcp-publisher publish` time, i.e. after the
 * version number has already been spent on npm.
 *
 * `release.yml` only checks the tag against `package.json`, and only during a
 * release. These assertions run on every pull request instead, which is where a
 * drift is still free to fix.
 */
const repoRoot = join(import.meta.dirname, "..");

function readJson(name: string): Record<string, any> {
  return JSON.parse(readFileSync(join(repoRoot, name), "utf8"));
}

const pkg = readJson("package.json");
const server = readJson("server.json");
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

describe("MCP registry metadata stays in sync", () => {
  it("declares the server name in both package.json and server.json", () => {
    expect(server.name).toBe("io.github.rulogb/compendio-mcp");
    expect(pkg.mcpName).toBe(server.name);
  });

  it("keeps the registry description within the schema's 100-character limit", () => {
    // Hit for real: the registry rejected a 166-character description with a
    // 422 at `mcp-publisher publish`, i.e. after the npm version was spent.
    // npm's own `description` has no such limit, so the two deliberately differ.
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it("carries the ownership marker in the README", () => {
    expect(readme).toContain(`<!-- mcp-name: ${server.name} -->`);
  });

  it("ships the README inside the npm tarball, where the registry reads it", () => {
    expect(pkg.files).toContain("README.md");
  });

  it("pins the same version in all three places", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it("points at this npm package over stdio", () => {
    expect(server.packages[0].registryType).toBe("npm");
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].transport).toEqual({ type: "stdio" });
  });

  it("starts the binary with the `serve` subcommand", () => {
    // Without this the client runs `compendio` bare, which prints help and
    // exits: the registry entry publishes cleanly and is still unusable.
    expect(server.packages[0].packageArguments).toEqual([
      { type: "positional", value: "serve", valueHint: "serve" },
    ]);
  });

  it("declares no remotes and no required environment variables", () => {
    // Compendio is local by design, and `mcp-publisher init` seeds an example
    // `environmentVariables` entry with `isSecret: true` that must be removed.
    expect(server.remotes).toBeUndefined();
    expect(server.packages[0].environmentVariables).toBeUndefined();
  });
});
