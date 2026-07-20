import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileIndexWriter } from "../../src/infrastructure/fs/file-index-writer";

describe("FileIndexWriter", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "compendio-index-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the file on first write and reports it as changed", async () => {
    const writer = new FileIndexWriter(dir, "INDEX.md");
    const result = await writer.write("# Índice\n");
    expect(result.cambiado).toBe(true);
    expect(result.ruta).toBe(join(dir, "INDEX.md"));
    expect(await readFile(join(dir, "INDEX.md"), "utf8")).toBe("# Índice\n");
  });

  it("skips the write when the content is identical", async () => {
    const writer = new FileIndexWriter(dir, "INDEX.md");
    const result = await writer.write("# Índice\n");
    expect(result.cambiado).toBe(false);
  });

  it("rewrites when the content differs", async () => {
    const writer = new FileIndexWriter(dir, "INDEX.md");
    const result = await writer.write("# Índice v2\n");
    expect(result.cambiado).toBe(true);
    expect(await readFile(join(dir, "INDEX.md"), "utf8")).toBe("# Índice v2\n");
  });
});
