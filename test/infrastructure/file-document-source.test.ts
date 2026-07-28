import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());
const readdirMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => readFileMock(...args),
    readdir: (...args: Parameters<typeof actual.readdir>) => readdirMock(...args),
  };
});

const { FileDocumentSource } = await import("../../src/infrastructure/fs/file-document-source");

async function realReadFile(path: unknown): Promise<string> {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return actual.readFile(path as string, "utf8");
}

async function realReaddir(
  path: unknown,
  options: unknown,
): Promise<unknown> {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return actual.readdir(path as string, options as Parameters<typeof actual.readdir>[1]);
}

describe("FileDocumentSource", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "compendio-fds-"));
    readFileMock.mockReset();
    readFileMock.mockImplementation(async (path: unknown) => realReadFile(path));
    readdirMock.mockReset();
    readdirMock.mockImplementation(async (path: unknown, options: unknown) => realReaddir(path, options));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("discovers every readable file when nothing fails", async () => {
    writeFileSync(join(dir, "a.md"), "content a");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.md"), "content b");

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.files.map((f) => f.path).sort()).toEqual(["a.md", "sub/b.md"]);
    expect(result.readErrors).toEqual([]);
  });

  it("collects an unreadable file into readErrors and keeps discovering the rest", async () => {
    writeFileSync(join(dir, "good.md"), "good content");
    writeFileSync(join(dir, "bad.md"), "bad content");
    readFileMock.mockImplementation(async (path: unknown) => {
      if (String(path).endsWith("bad.md")) {
        throw new Error("permission denied");
      }
      return realReadFile(path);
    });

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.files.map((f) => f.path)).toEqual(["good.md"]);
    expect(result.readErrors).toEqual([{ path: "bad.md", error: "permission denied" }]);
  });

  it("reports an unreadable subdirectory in readErrors, without files beneath it, and does not throw", async () => {
    writeFileSync(join(dir, "root.md"), "root content");
    mkdirSync(join(dir, "guides"));
    writeFileSync(join(dir, "guides", "hidden.md"), "hidden content");
    readdirMock.mockImplementation(async (path: unknown, options: unknown) => {
      if (String(path).endsWith("guides")) {
        throw new Error("permission denied");
      }
      return realReaddir(path, options);
    });

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.files.map((f) => f.path)).toEqual(["root.md"]);
    expect(result.readErrors).toEqual([{ path: "guides", error: "permission denied" }]);
  });

  it("still throws when the docs root itself cannot be read", async () => {
    readdirMock.mockImplementation(async (path: unknown) => {
      if (path === dir) {
        throw new Error("root directory unreachable");
      }
      return [];
    });

    const source = new FileDocumentSource(dir, []);

    await expect(source.discover()).rejects.toThrow(/root directory unreachable/);
  });
});
