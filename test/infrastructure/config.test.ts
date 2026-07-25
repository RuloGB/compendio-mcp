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
    expect(config.convencion).toEqual({
      modo: "libre",
      excludedStatuses: [],
      camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
    });
  });

  it("keeps convencion at its default when the config only declares docsDir", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-docsdir-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ docsDir: "documentation" }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.docsDir).toBe("documentation");
    expect(config.convencion.modo).toBe("libre");
    expect(config.convencion.excludedStatuses).toEqual([]);
    await rm(projectDir, { recursive: true, force: true });
  });

  it("merges a partial convencion block without wiping sibling defaults", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-partial-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ convencion: { modo: "estricto" } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.convencion.modo).toBe("estricto");
    expect(config.convencion.excludedStatuses).toEqual([]);
    expect(config.convencion.camposFrontmatter).toEqual({
      type: "tipo",
      module: "modulo",
      status: "estado",
    });
    expect(config.convencion.types).toBeUndefined();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("merges a partial camposFrontmatter object per key, not wholesale", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-campos-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ convencion: { camposFrontmatter: { type: "type" } } }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.convencion.camposFrontmatter).toEqual({
      type: "type",
      module: "modulo",
      status: "estado",
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("emits a stderr deprecation notice naming convencion.estadosExcluidos when the legacy key is present", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-legacy-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ search: { estadosExcluidos: ["borrador"] } }),
      "utf8",
    );
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const config = loadConfig(projectDir);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("convencion.excludedStatuses");
    // The legacy value is never read into the returned config: `search` has
    // no `estadosExcluidos` property anywhere, only `k`.
    expect(config.search).toEqual({ k: 5 });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("a user-declared search.estadosExcluidos no longer changes search results", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-legacy-search-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ search: { estadosExcluidos: ["borrador"] } }),
      "utf8",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const config = loadConfig(projectDir);

    const store = new SqliteIndexStore(":memory:");
    store.saveDocument(
      { path: "a.md", title: "A", summary: "r", status: "borrador", tags: [], hash: "h" },
      [{ heading: "A", content: "contenido de prueba unico irrepetible", position: 0 }],
    );
    // Mirrors composition.ts's wiring: SearchDefaults comes from
    // config.convencion.excludedStatuses (default []), never config.search.
    const search = new SearchDocuments(store, null, {
      k: config.search.k,
      excludedStatuses: config.convencion.excludedStatuses,
    });
    const response = await search.execute({ query: "contenido de prueba unico irrepetible" });
    expect(response.resultados.map((r) => r.path)).toContain("a.md");

    store.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("does not warn when no legacy search.estadosExcluidos key is present", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-nolegacy-"));
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ search: { k: 3 } }),
      "utf8",
    );
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    loadConfig(projectDir);
    expect(stderrSpy).not.toHaveBeenCalled();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("DEFAULT_CONFIG.convencion matches the documented zero-config defaults", () => {
    expect(DEFAULT_CONFIG.convencion).toEqual({
      modo: "libre",
      excludedStatuses: [],
      camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
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
