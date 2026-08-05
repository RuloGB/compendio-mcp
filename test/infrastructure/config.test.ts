import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SearchDocuments } from "../../src/application/search-documents";
import { DEFAULT_CONFIG, loadConfig } from "../../src/infrastructure/config";
import { SqliteIndexStore } from "../../src/infrastructure/sqlite/sqlite-index-store";

describe("loadConfig", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "compendio-config-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns documented defaults when no config file exists at all", () => {
    const config = loadConfig(join(dir, "no-such-project"));
    expect(config.convention).toEqual({
      mode: "loose",
      excludedStatuses: [],
      frontmatterFields: { type: "type", module: "module", status: "status" },
    });
  });

  it("defaults chunk.maxTokens to 480 when no config file exists", () => {
    const config = loadConfig(join(dir, "no-such-project"));
    expect(config.chunk).toEqual({ minTokens: 100, maxTokens: 480 });
  });

  it("defaults chunk.maxTokens to 480 when the config declares no chunk block", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-nochunk-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ docsDir: "documentation" }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    await rm(projectDir, { recursive: true, force: true });
    expect(config.chunk.maxTokens).toBe(480);
  });

  it("honours a declared chunk.maxTokens over the default", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-chunk-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ chunk: { maxTokens: 600 } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    await rm(projectDir, { recursive: true, force: true });
    expect(config.chunk.maxTokens).toBe(600);
  });

  it("keeps convention at its default when the config only declares docsDir", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-docsdir-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ docsDir: "documentation" }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.docsDir).toBe("documentation");
    expect(config.convention.mode).toBe("loose");
    expect(config.convention.excludedStatuses).toEqual([]);
    await rm(projectDir, { recursive: true, force: true });
  });

  it("merges a partial convention block without wiping sibling defaults", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-partial-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ convention: { mode: "strict" } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.convention.mode).toBe("strict");
    expect(config.convention.excludedStatuses).toEqual([]);
    expect(config.convention.frontmatterFields).toEqual({
      type: "type",
      module: "module",
      status: "status",
    });
    expect(config.convention.types).toBeUndefined();
    await rm(projectDir, { recursive: true, force: true });
  });

  // es-frozen: "tipo" is the feature under test (convention.frontmatterFields
  // mapping a non-English source key), not a leftover translation.
  it("merges a partial frontmatterFields object per key, not wholesale", async () => {
    // Declares a Spanish source key for one field only: this is the documented
    // path for a non-English corpus, and it must not wipe the sibling defaults.
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-fields-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ convention: { frontmatterFields: { type: "tipo" } } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.convention.frontmatterFields).toEqual({
      type: "tipo",
      module: "module",
      status: "status",
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("an unknown key under search never leaks into the loaded config or into search behavior", async () => {
    // `mergeConfig` builds `search` from an explicit whitelist rather than a
    // spread, so an unrecognized key cannot reach the returned config even
    // though the parsed JSON carries it at runtime.
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-unknown-key-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ search: { k: 5, unknownKey: ["draft"] } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.search).toEqual({ k: 5 });

    const store = new SqliteIndexStore(":memory:");
    store.saveDocument(
      { path: "a.md", title: "A", summary: "r", status: "borrador", tags: [], hash: "h" },
      [{ heading: "A", content: "unique unrepeatable test content marker", position: 0 }],
    );
    // Mirrors composition.ts's wiring: SearchDefaults comes from
    // config.convention.excludedStatuses (default []), never config.search.
    const search = new SearchDocuments(store, null, {
      k: config.search.k,
      excludedStatuses: config.convention.excludedStatuses,
    });
    const response = await search.execute({ query: "unique unrepeatable test content marker" });
    expect(response.results.map((r) => r.path)).toContain("a.md");

    store.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("DEFAULT_CONFIG.convention matches the documented zero-config defaults", () => {
    expect(DEFAULT_CONFIG.convention).toEqual({
      mode: "loose",
      excludedStatuses: [],
      frontmatterFields: { type: "type", module: "module", status: "status" },
    });
  });

  it("defaults sync.throttleMs to 30000 when no sync block is declared", () => {
    const config = loadConfig(join(dir, "no-such-project-sync"));
    expect(config.sync).toEqual({ throttleMs: 30000 });
  });

  it("accepts a custom sync.throttleMs", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-sync-custom-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ sync: { throttleMs: 60000 } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.sync.throttleMs).toBe(60000);
    await rm(projectDir, { recursive: true, force: true });
  });

  it("falls back to the default when sync.throttleMs is non-numeric, negative, or zero", async () => {
    for (const invalid of ["no-es-un-numero", -100, 0]) {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-sync-invalid-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ sync: { throttleMs: invalid } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.sync.throttleMs).toBe(30000);
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("accepts a very small positive throttleMs without clamping it to a floor", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-sync-small-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ sync: { throttleMs: 100 } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.sync.throttleMs).toBe(100);
    await rm(projectDir, { recursive: true, force: true });
  });
});
