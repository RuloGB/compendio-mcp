import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SearchDocuments } from "../../src/application/search-documents";
import { DEFAULT_CONFIG, loadConfig, resolveRoots } from "../../src/infrastructure/config";
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
      JSON.stringify({ docsDir: ["documentation"] }),
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
      JSON.stringify({ docsDir: ["documentation"] }),
      "utf8",
    );
    const config = loadConfig(projectDir);
    expect(config.docsDir).toEqual(["documentation"]);
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

  it("DEFAULT_CONFIG.docsDir is a single-element array, not a string", () => {
    expect(DEFAULT_CONFIG.docsDir).toEqual(["docs"]);
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

  // design.md Decision 3: chunk.minTokens / chunk.maxTokens / search.k now
  // validate with the same `positiveNumber` policy sync.throttleMs already
  // applied (generalized from `validThrottleMs`); search.k additionally
  // requires a whole number via `positiveInteger`.
  describe("chunk.minTokens / chunk.maxTokens validation (positiveNumber)", () => {
    const INVALID_NUMERIC = [0, -5, null, "abc", {}, [1, 2], true, 1e400] as const;

    it.each(INVALID_NUMERIC)("chunk.maxTokens falls back to the default on %j", async (invalid) => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-maxtokens-invalid-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ chunk: { maxTokens: invalid } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.chunk.maxTokens).toBe(480);
      await rm(projectDir, { recursive: true, force: true });
    });

    it.each(INVALID_NUMERIC)("chunk.minTokens falls back to the default on %j", async (invalid) => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-mintokens-invalid-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ chunk: { minTokens: invalid } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.chunk.minTokens).toBe(100);
      await rm(projectDir, { recursive: true, force: true });
    });

    it("honors chunk.maxTokens: 1 and chunk.minTokens: 3 without clamping", async () => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-tokens-valid-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ chunk: { minTokens: 3, maxTokens: 1 } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.chunk).toEqual({ minTokens: 3, maxTokens: 1 });
      await rm(projectDir, { recursive: true, force: true });
    });
  });

  describe("search.k validation (positiveInteger)", () => {
    it.each([0, "abc", null, 5.01] as const)("search.k falls back to the default on %j", async (invalid) => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-k-invalid-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ search: { k: invalid } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.search.k).toBe(5);
      await rm(projectDir, { recursive: true, force: true });
    });

    it.each([1, 3] as const)("honors search.k: %d without clamping", async (valid) => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-k-valid-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ search: { k: valid } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.search.k).toBe(valid);
      await rm(projectDir, { recursive: true, force: true });
    });
  });

  // design.md Decision 4: embeddings, chunk, and convention.frontmatterFields
  // become explicit whitelists, matching the pattern search already used —
  // an unrecognized key under any of the three must never leak into the
  // loaded config, mirroring the existing `search` case above.
  describe("unknown-key hygiene (explicit whitelists, design.md Decision 4)", () => {
    it("an unknown key under chunk never leaks into the loaded config", async () => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-unknown-chunk-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ chunk: { maxTokens: 600, unknownKey: "nope" } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.chunk).toEqual({ minTokens: 100, maxTokens: 600 });
      await rm(projectDir, { recursive: true, force: true });
    });

    it("an unknown key under embeddings never leaks into the loaded config", async () => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-unknown-embeddings-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({ embeddings: { model: "custom-model", unknownKey: "nope" } }),
        "utf8",
      );
      const config = loadConfig(projectDir);
      expect(config.embeddings).toEqual({ provider: "local", model: "custom-model" });
      await rm(projectDir, { recursive: true, force: true });
    });

    it("an unknown key under convention.frontmatterFields never leaks into the loaded config", async () => {
      const projectDir = await mkdtemp(join(tmpdir(), "compendio-config-unknown-fields-"));
      await writeFile(
        join(projectDir, "compendio.config.json"),
        JSON.stringify({
          convention: { frontmatterFields: { type: "tipo", unknownKey: "nope" } },
        }),
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
  });
});

describe("resolveRoots", () => {
  const PROJECT = resolve(sep === "\\" ? "C:\\project" : "/project");

  it("normalizes a single declared root: trailing slash, leading './', and bare form all yield the same alias", () => {
    for (const declared of ["docs/", "./docs", "docs"]) {
      const [root] = resolveRoots(PROJECT, [declared]);
      expect(root!.declared).toBe(declared);
      expect(root!.dir).toBe(resolve(PROJECT, "docs"));
      expect(root!.prefix).toBe("docs");
    }
  });

  it("derives one alias per root for a two-root array, in declaration order", () => {
    const roots = resolveRoots(PROJECT, ["docs", "openspec"]);
    expect(roots.map((r) => r.prefix)).toEqual(["docs", "openspec"]);
    expect(roots.map((r) => r.declared)).toEqual(["docs", "openspec"]);
  });

  it("rejects a non-array docsDir", () => {
    // @ts-expect-error -- exercising the runtime guard against a wrong-shaped
    // value a config author could actually write, deliberately outside the type
    expect(() => resolveRoots(PROJECT, "docs")).toThrow(
      "docsDir must be an array of documentation root paths",
    );
  });

  it("rejects an empty array", () => {
    expect(() => resolveRoots(PROJECT, [])).toThrow(
      "docsDir must declare at least one documentation root",
    );
  });

  it("rejects a non-string entry, naming its index and typeof", () => {
    // @ts-expect-error -- exercising the runtime guard against a wrong-shaped
    // entry a config author could actually write, deliberately outside the type
    expect(() => resolveRoots(PROJECT, ["docs", 42])).toThrow(
      "docsDir entries must be strings; entry 1 is number",
    );
  });

  it("rejects duplicate entries, naming both declared strings", () => {
    expect(() => resolveRoots(PROJECT, ["docs", "docs"])).toThrow(
      /docsDir declares the same documentation root twice: "docs" and "docs" both resolve to/,
    );
  });

  it.skipIf(process.platform !== "win32")(
    "rejects a case-differing duplicate on a case-insensitive filesystem (win32)",
    () => {
      expect(() => resolveRoots(PROJECT, ["Docs", "docs"])).toThrow(
        /docsDir declares the same documentation root twice: "Docs" and "docs" both resolve to/,
      );
    },
  );

  it("rejects nested roots, outer root declared first", () => {
    expect(() => resolveRoots(PROJECT, ["docs", "docs/adr"])).toThrow(
      /docsDir declares nested documentation roots: "docs\/adr" .* lies inside "docs"/,
    );
  });

  it("rejects nested roots, inner root declared first — the one-directional-sweep escape", () => {
    // A predicate that only tests one declaration order would miss this case
    // (design.md's measured `relative('...docs\\adr', '...docs')` -> "..").
    expect(() => resolveRoots(PROJECT, ["docs/adr", "docs"])).toThrow(
      /docsDir declares nested documentation roots: "docs\/adr" .* lies inside "docs"/,
    );
  });

  it("rejects a nested root whose directory name begins with two dots — the strict-vs-loose predicate escape", () => {
    // design.md Decision 5 / P1 (measured 2026-08-07, win32, Node v22.22.0):
    // relative('C:\\A\\docs', 'C:\\A\\docs\\..cache') -> "..cache". The loose
    // predicate `!rel.startsWith("..")` reads that as NOT contained (wrong —
    // "..cache" is a single path segment, a literal directory name, not a
    // parent-traversal marker); the strict form this project's `resolveRoots`
    // actually uses (`rel !== ".." && !rel.startsWith(`..${sep}`)`) reads it
    // correctly as contained. Verify-report.md's WARNING #1: implementation
    // was correct by inspection, with zero automated coverage until this test.
    expect(() => resolveRoots(PROJECT, ["docs", "docs/..cache"])).toThrow(
      /docsDir declares nested documentation roots: "docs\/\.\.cache" .* lies inside "docs"/,
    );
  });

  it("rejects an alias clash between two differently-located roots sharing a basename", () => {
    expect(() => resolveRoots(PROJECT, ["a/docs", "b/docs"])).toThrow(
      /docsDir declares two roots with the same directory name: "a\/docs" and "b\/docs" both use the path prefix "docs"/,
    );
  });

  it("accepts a valid, non-colliding two-root array", () => {
    expect(() => resolveRoots(PROJECT, ["docs", "openspec"])).not.toThrow();
  });
});
