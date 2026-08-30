import { cpSync, existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "../src/composition";

/**
 * Container-construction guard (design.md Decision 6, Gate 5): a colliding
 * `docsDir` set must be rejected before `new SqliteIndexStore` runs, so no
 * `.compendio/` directory is created for a fresh project — stronger than "the
 * database is not reset".
 */
describe("createContainer — the collision guard fires before anything is written", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "compendio-container-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeDocsDir(docsDir: unknown): Promise<void> {
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ docsDir }),
      "utf8",
    );
  }

  it("rejects nested roots, outer root declared first", async () => {
    await writeDocsDir(["docs", "docs/adr"]);
    expect(() => createContainer({ root: projectDir })).toThrow(/docs\/adr.*lies inside "docs"/);
    expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
  });

  it("rejects nested roots, inner root declared first", async () => {
    await writeDocsDir(["docs/adr", "docs"]);
    expect(() => createContainer({ root: projectDir })).toThrow(/docs\/adr.*lies inside "docs"/);
    expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
  });

  it("rejects duplicate roots", async () => {
    await writeDocsDir(["docs", "docs"]);
    expect(() => createContainer({ root: projectDir })).toThrow(
      /docsDir declares the same documentation root twice/,
    );
    expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
  });

  it.skipIf(process.platform !== "win32")(
    "rejects a case-differing duplicate on a case-insensitive filesystem (win32)",
    async () => {
      await writeDocsDir(["Docs", "docs"]);
      expect(() => createContainer({ root: projectDir })).toThrow(
        /docsDir declares the same documentation root twice/,
      );
      expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
    },
  );

  it("rejects an alias clash between two differently-located roots", async () => {
    await writeDocsDir(["a/docs", "b/docs"]);
    expect(() => createContainer({ root: projectDir })).toThrow(
      /docsDir declares two roots with the same directory name/,
    );
    expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
  });

  it("treats an empty declared root set as discovery mode without creating .compendio/", async () => {
    await writeDocsDir([]);
    const container = createContainer({ root: projectDir });
    try {
      expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
    } finally {
      container.close();
    }
  });

  it("accepts a valid, non-colliding root set without creating .compendio/ (lazy store)", async () => {
    await writeDocsDir(["docs", "openspec"]);
    const container = createContainer({ root: projectDir });
    try {
      // The store is lazy: no filesystem work until the first write.
      expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
    } finally {
      container.close();
    }
  });
});

/**
 * design.md Decision 10 / specs/configuration/spec.md's "`--dir` Replaces the
 * Declared Root Set With One Directory" requirement (added to close
 * verify-report.md WARNING #3). `ContainerOptions.docsDir` is the CLI's
 * `--dir <path>` flag; it is asserted "unchanged" throughout PR 1-3
 * (design.md's Interfaces/Contracts table) but had zero test coverage at any
 * layer before this — neither the override behavior nor the
 * replaces-not-adds semantics.
 */
describe("createContainer — docsDir override (--dir) replaces the configured root set, design.md Decision 10", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "compendio-dir-override-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("indexes only the overriding directory, ignoring a multi-root config entirely", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await mkdir(join(projectDir, "openspec"), { recursive: true });
    await mkdir(join(projectDir, "notes"), { recursive: true });
    await writeFile(join(projectDir, "docs", "a.md"), "# A\n\nFrom the configured docs root.\n");
    await writeFile(join(projectDir, "openspec", "b.md"), "# B\n\nFrom the configured openspec root.\n");
    await writeFile(join(projectDir, "notes", "c.md"), "# C\n\nFrom the --dir override.\n");
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ docsDir: ["docs", "openspec"] }),
      "utf8",
    );

    const container = createContainer({ root: projectDir, docsDir: "notes", forceLexical: true });
    try {
      const report = await container.indexDocuments.execute();
      // Only "notes/" is indexed: the configured ["docs", "openspec"] set is
      // not merged in, not consulted at all -- replaced, not added to.
      expect(report.indexed.map((d) => d.path)).toEqual(["notes/c.md"]);
    } finally {
      container.close();
    }
  });

  it("produces the identical prefixed path shape as declaring the same directory in docsDir", async () => {
    await mkdir(join(projectDir, "notes"), { recursive: true });
    await writeFile(join(projectDir, "notes", "c.md"), "# C\n\nSame content either way.\n");

    const viaOverride = createContainer({ root: projectDir, docsDir: "notes", forceLexical: true });
    let overridePaths: string[];
    try {
      overridePaths = (await viaOverride.indexDocuments.execute()).indexed.map((d) => d.path);
    } finally {
      viaOverride.close();
      await rm(join(projectDir, ".compendio"), { recursive: true, force: true });
    }

    await writeFile(join(projectDir, "compendio.config.json"), JSON.stringify({ docsDir: ["notes"] }), "utf8");
    const viaConfig = createContainer({ root: projectDir, forceLexical: true });
    let configPaths: string[];
    try {
      configPaths = (await viaConfig.indexDocuments.execute()).indexed.map((d) => d.path);
    } finally {
      viaConfig.close();
    }

    expect(overridePaths).toEqual(configPaths);
    expect(overridePaths).toEqual(["notes/c.md"]);
  });
});

/**
 * design.md Decision 5, 6 (Slice 2): `createContainer` switches from
 * `loadConfig` to `loadConfigReport` and exposes the resulting warnings as
 * `Container.configWarnings`, so the CLI and `docs_overview` have something
 * to render.
 */
describe("createContainer — configWarnings sourced from loadConfigReport (design.md Decision 5, 6)", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "compendio-config-warnings-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("exposes one configWarnings entry for an invalid declared chunk.maxTokens", async () => {
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ chunk: { maxTokens: 0 } }),
      "utf8",
    );
    const container = createContainer({ root: projectDir });
    try {
      expect(container.configWarnings).toContainEqual(
        expect.objectContaining({ kind: "invalid-value", key: "chunk.maxTokens" }),
      );
    } finally {
      container.close();
    }
  });

  it("exposes an empty configWarnings array for a clean, valid config", async () => {
    await writeFile(
      join(projectDir, "compendio.config.json"),
      JSON.stringify({ chunk: { maxTokens: 480 } }),
      "utf8",
    );
    const container = createContainer({ root: projectDir });
    try {
      expect(container.configWarnings).toEqual([]);
    } finally {
      container.close();
    }
  });

  it("exposes an empty configWarnings array when no config file exists at all", async () => {
    const container = createContainer({ root: projectDir });
    try {
      expect(container.configWarnings).toEqual([]);
    } finally {
      container.close();
    }
  });
});


describe("createContainer — auto-discovered markdown roots", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "compendio-discovery-container-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("indexes discovered top-level roots with alias-prefixed paths and supports verbatim read_doc round-trips", async () => {
    await mkdir(join(projectDir, "openspec", "specs"), { recursive: true });
    await writeFile(join(projectDir, "openspec", "specs", "feature.md"), "# Feature\n\nUnique round trip marker.\n");

    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      const report = await container.indexDocuments.execute();
      expect(report.indexed.map((d) => d.path)).toEqual(["openspec/specs/feature.md"]);
      const search = await container.searchDocuments.execute({ query: "Unique round trip marker", forceLexical: true });
      expect(search.results[0]?.path).toBe("openspec/specs/feature.md");
      expect(container.readDocument.execute({ path: "openspec/specs/feature.md" }).type).toBe("document");
    } finally {
      container.close();
    }
  });

  it("constructs a zero-root discovery container without creating a lazy database", () => {
    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
      expect(container.getOverview.execute().totalDocuments).toBe(0);
    } finally {
      container.close();
    }
  });

  it("writes INDEX.md at project root in discovery mode and inside --dir override in explicit mode", async () => {
    await mkdir(join(projectDir, "openspec"), { recursive: true });
    await mkdir(join(projectDir, "notes"), { recursive: true });
    await writeFile(join(projectDir, "openspec", "a.md"), "# A\n\nDiscovery content.\n");
    await writeFile(join(projectDir, "notes", "b.md"), "# B\n\nOverride content.\n");

    const discovery = createContainer({ root: projectDir, forceLexical: true });
    try {
      const report = await discovery.generateIndexMd.execute();
      expect(report.path).toBe(join(projectDir, "INDEX.md"));
      expect(existsSync(join(projectDir, "INDEX.md"))).toBe(true);
      expect(existsSync(join(projectDir, "openspec", "INDEX.md"))).toBe(false);
    } finally {
      discovery.close();
    }

    const explicitOverride = createContainer({ root: projectDir, docsDir: "notes", forceLexical: true });
    try {
      const report = await explicitOverride.generateIndexMd.execute();
      expect(report.path).toBe(join(projectDir, "notes", "INDEX.md"));
      expect(existsSync(join(projectDir, "notes", "INDEX.md"))).toBe(true);
    } finally {
      explicitOverride.close();
    }
  });

  it("indexes the exact dynamic openspec markdown path set in lexical discovery mode", async () => {
    cpSync(join(process.cwd(), "openspec"), join(projectDir, "openspec"), { recursive: true });
    const expected = collectMarkdownPaths(join(projectDir, "openspec")).map((path) => `openspec/${path}`);

    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      const report = await container.indexDocuments.execute();
      expect(report.mode).toBe("lexical");
      expect(report.indexed.map((d) => d.path)).toEqual(expected);
    } finally {
      container.close();
    }
  });

  it("preserves indexed documents by aborting sync when a discovered root becomes unreadable", async () => {
    await mkdir(join(projectDir, "openspec"), { recursive: true });
    await writeFile(join(projectDir, "openspec", "keep.md"), "# Keep\n\nOriginal content.\n");
    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      await container.indexDocuments.execute();
      await rm(join(projectDir, "openspec"), { recursive: true, force: true });
      await writeFile(join(projectDir, "openspec"), "not a directory", "utf8");

      await expect(container.syncIndex.execute()).rejects.toThrow(/ENOTDIR|not a directory/);
      expect(container.store.listDocuments().map((doc) => doc.path)).toEqual(["openspec/keep.md"]);
    } finally {
      container.close();
    }
  });

  it("preserves indexed documents by aborting sync when a discovered root disappears with ENOENT", async () => {
    await mkdir(join(projectDir, "openspec"), { recursive: true });
    await writeFile(join(projectDir, "openspec", "keep.md"), "# Keep\n\nOriginal content.\n");
    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      await container.indexDocuments.execute();
      await rm(join(projectDir, "openspec"), { recursive: true, force: true });

      await expect(container.syncIndex.execute()).rejects.toThrow(/ENOENT|no such file/i);
      expect(container.store.listDocuments().map((doc) => doc.path)).toEqual(["openspec/keep.md"]);
    } finally {
      container.close();
    }
  });

  it("discovers a new top-level markdown root on a later sync pass without rebuilding the container", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await writeFile(join(projectDir, "docs", "a.md"), "# A\n\nInitial docs content.\n");

    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      await container.indexDocuments.execute();
      await mkdir(join(projectDir, "notes"), { recursive: true });
      await writeFile(join(projectDir, "notes", "b.md"), "# B\n\nNew notes content.\n");

      const report = await container.syncIndex.execute();

      expect(report.indexed.map((d) => d.path)).toEqual(["notes/b.md"]);
      expect(container.store.listDocuments().map((doc) => doc.path)).toEqual([
        "docs/a.md",
        "notes/b.md",
      ]);
    } finally {
      container.close();
    }
  });

  it("preserves indexed discovered roots that disappear before sync in a freshly reconstructed container", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await writeFile(join(projectDir, "docs", "keep.md"), "# Keep\n\nOriginal content.\n");

    const firstContainer = createContainer({ root: projectDir, forceLexical: true });
    try {
      await firstContainer.indexDocuments.execute();
    } finally {
      firstContainer.close();
    }

    await rm(join(projectDir, "docs"), { recursive: true, force: true });

    const reconstructed = createContainer({ root: projectDir, forceLexical: true });
    try {
      await expect(reconstructed.syncIndex.execute()).rejects.toThrow(/docs.*ENOENT|ENOENT.*docs/s);
      expect(reconstructed.store.listDocuments().map((doc) => doc.path)).toEqual(["docs/keep.md"]);
    } finally {
      reconstructed.close();
    }
  });

  it("aborts discovery-mode sync on a nested markdown read failure before mutating healthy files", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await writeFile(join(projectDir, "docs", "good.md"), "# Good\n\nOriginal content.\n");
    await writeFile(join(projectDir, "docs", "bad.md"), "# Bad\n\nOriginal content.\n");

    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      await container.indexDocuments.execute();
      container.close();
    } catch (error) {
      container.close();
      throw error;
    }

    await writeFile(join(projectDir, "docs", "good.md"), "# Good\n\nMutated content.\n");

    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        readFile: (path: unknown) => {
          if (String(path).endsWith("bad.md")) {
            throw new Error("EACCES: permission denied");
          }
          return actual.readFile(path as string);
        },
      };
    });
    const { createContainer: createContainerWithMock } = await import("../src/composition");
    const mocked = createContainerWithMock({ root: projectDir, forceLexical: true });
    try {
      await expect(mocked.syncIndex.execute()).rejects.toThrow(/bad\.md.*EACCES|EACCES.*bad\.md/s);
      const good = mocked.store.getDocumentByPath("docs/good.md");
      expect(good).not.toBeNull();
      const content = mocked.store.getChunksByDocument(good!.id).map((chunk) => chunk.content).join("\n");
      expect(content).toContain("Original content.");
      expect(content).not.toContain("Mutated content.");
    } finally {
      mocked.close();
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

  it("fails closed on any unreadable discovered root before mutating healthy roots", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await mkdir(join(projectDir, "openspec"), { recursive: true });
    await writeFile(join(projectDir, "docs", "a.md"), "# A\n\nOriginal docs content.\n");
    await writeFile(join(projectDir, "openspec", "b.md"), "# B\n\nOriginal openspec content.\n");

    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      await container.indexDocuments.execute();
      await writeFile(join(projectDir, "docs", "a.md"), "# A\n\nMutated docs content.\n");
      await rm(join(projectDir, "openspec"), { recursive: true, force: true });

      await expect(container.syncIndex.execute()).rejects.toThrow(/openspec.*ENOENT|ENOENT.*openspec/s);
      expect(container.store.listDocuments().map((doc) => doc.path)).toEqual([
        "docs/a.md",
        "openspec/b.md",
      ]);
      const docs = container.store.getDocumentByPath("docs/a.md");
      expect(docs).not.toBeNull();
      const chunks = container.store.getChunksByDocument(docs!.id);
      expect(chunks.map((chunk) => chunk.content).join("\n")).toContain("Original docs content.");
      expect(chunks.map((chunk) => chunk.content).join("\n")).not.toContain("Mutated docs content.");
    } finally {
      container.close();
    }
  });

  it("preserves indexed documents when a discovered root is replaced by a link to external markdown", async () => {
    const externalDir = await mkdtemp(join(tmpdir(), "compendio-external-docs-"));
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await writeFile(join(projectDir, "docs", "keep.md"), "# Keep\n\nOriginal content.\n");
    await writeFile(join(externalDir, "external.md"), "# External\n\nMust not be indexed.\n");

    const container = createContainer({ root: projectDir, forceLexical: true });
    try {
      await container.indexDocuments.execute();
      await rm(join(projectDir, "docs"), { recursive: true, force: true });
      // Junctions are creatable without elevation on Windows, so a failure here is a real
      // environment problem, not a permission tier to tolerate. Fail loudly: silently
      // returning would leave this test passing while asserting nothing at all.
      await symlink(externalDir, join(projectDir, "docs"), "junction");

      await expect(container.syncIndex.execute()).rejects.toThrow(/symlink|realpath|trusted|documentation root/i);
      expect(container.store.listDocuments().map((doc) => doc.path)).toEqual(["docs/keep.md"]);
      expect(container.store.getDocumentByPath("docs/external.md")).toBeNull();
    } finally {
      container.close();
      await rm(externalDir, { recursive: true, force: true });
    }
  });
});

function collectMarkdownPaths(root: string): string[] {
  const paths: string[] = [];
  visit(root);
  return paths.sort();

  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        paths.push(relative(root, absolute).split(sep).join("/"));
      }
    }
  }
}
