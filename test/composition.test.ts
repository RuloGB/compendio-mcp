import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("rejects an empty declared root set", async () => {
    await writeDocsDir([]);
    expect(() => createContainer({ root: projectDir })).toThrow(
      /docsDir must declare at least one documentation root/,
    );
    expect(existsSync(join(projectDir, ".compendio"))).toBe(false);
  });

  it("accepts a valid, non-colliding root set and creates .compendio/", async () => {
    await writeDocsDir(["docs", "openspec"]);
    const container = createContainer({ root: projectDir });
    try {
      expect(existsSync(join(projectDir, ".compendio"))).toBe(true);
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
