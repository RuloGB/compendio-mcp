import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => readFileMock(...args),
  };
});

const { FileDocumentSource } = await import("../../src/infrastructure/fs/file-document-source");

async function realReadFile(path: unknown): Promise<string> {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return actual.readFile(path as string, "utf8");
}

describe("FileDocumentSource", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "compendio-fds-"));
    readFileMock.mockReset();
    readFileMock.mockImplementation(async (path: unknown) => realReadFile(path));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("discovers every readable file when nothing fails", async () => {
    writeFileSync(join(dir, "a.md"), "contenido a");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.md"), "contenido b");

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.files.map((f) => f.ruta).sort()).toEqual(["a.md", "sub/b.md"]);
    expect(result.erroresLectura).toEqual([]);
  });

  it("collects an unreadable file into erroresLectura and keeps discovering the rest", async () => {
    writeFileSync(join(dir, "good.md"), "contenido bueno");
    writeFileSync(join(dir, "bad.md"), "contenido malo");
    readFileMock.mockImplementation(async (path: unknown) => {
      if (String(path).endsWith("bad.md")) {
        throw new Error("permiso denegado");
      }
      return realReadFile(path);
    });

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.files.map((f) => f.ruta)).toEqual(["good.md"]);
    expect(result.erroresLectura).toEqual([{ ruta: "bad.md", error: "permiso denegado" }]);
  });
});
