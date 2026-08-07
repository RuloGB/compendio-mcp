import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
