import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp1252Bytes } from "../helpers/cp1252";

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

// Production reads raw bytes (no encoding argument) and routes them through
// `decodeText`, so the mock must hand back a `Buffer` too -- matching the
// real `readFile(path)` contract instead of the old hardcoded "utf8" read.
async function realReadFile(path: unknown): Promise<Buffer> {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return actual.readFile(path as string);
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

  it("still throws when the docs root itself cannot be read, even with a non-empty path prefix", async () => {
    readdirMock.mockImplementation(async (path: unknown) => {
      if (path === dir) {
        throw new Error("root directory unreachable");
      }
      return [];
    });

    const source = new FileDocumentSource(dir, [], "docs");

    await expect(source.discover()).rejects.toThrow(/root directory unreachable/);
  });

  it("decodes a CP1252 file (curly quotes, dash, ellipsis, accented vowels) with zero readErrors", async () => {
    const original =
      "# Titulo\n\n“Cita” con guion – y puntos suspensivos… vocales: á é í ó ú ñ.\n";
    writeFileSync(join(dir, "cp1252.md"), cp1252Bytes(original));

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.readErrors).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content).toBe(original);
  });

  it("collects a binary, non-UTF-8, non-plausible-CP1252 file into readErrors with a distinct message, absent from files", async () => {
    // JPEG magic header: contains 0x00, which rules out both UTF-8 and CP1252.
    const binary = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    writeFileSync(join(dir, "binary.md"), binary);

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.files).toEqual([]);
    expect(result.readErrors).toHaveLength(1);
    expect(result.readErrors[0]!.path).toBe("binary.md");
    // Distinguishable from a generic I/O error like "EACCES: permission denied".
    expect(result.readErrors[0]!.error).not.toMatch(/EACCES|ENOENT|permission denied/);
    expect(result.readErrors[0]!.error).toContain("windows-1252");
  });

  it("decodes a UTF-16LE-with-BOM file correctly", async () => {
    const original = "# UTF-16LE\n\nHola mundo.\n";
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(original, "utf16le")]);
    writeFileSync(join(dir, "utf16le.md"), bytes);

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.readErrors).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content).toBe(original);
  });

  // W1 (verify-report.md): mirrors the UTF-16LE test above, but for the
  // hand-rolled swap16 branch -- design.md names this "the least exercised
  // branch" because it cannot use TextDecoder. Before this test, only
  // decode-text.test.ts's pure-function unit test covered BE at all; nothing
  // exercised the real FileDocumentSource -> decodeText wiring for it.
  it("decodes a UTF-16BE-with-BOM file correctly", async () => {
    const original = "# UTF-16BE\n\nHola mundo.\n";
    const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(original, "utf16le").swap16()]);
    writeFileSync(join(dir, "utf16be.md"), bytes);

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.readErrors).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content).toBe(original);
  });

  it("reports a transcoded CP1252 file as an encoding notice", async () => {
    const original = "# Titulo\n\nTexto con “comillas” y guion – acentuado: ó.\n";
    writeFileSync(join(dir, "cp1252.md"), cp1252Bytes(original));

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.encodingNotices).toEqual([{ path: "cp1252.md", encoding: "windows-1252" }]);
  });

  it("produces no encoding notice for a plain UTF-8 corpus", async () => {
    writeFileSync(join(dir, "utf8.md"), "# Plain UTF-8\n\nNo transcoding needed.\n");

    const source = new FileDocumentSource(dir, []);
    const result = await source.discover();

    expect(result.encodingNotices).toEqual([]);
  });

  it("excludes an entire directory when exclude declares its prefix", async () => {
    writeFileSync(join(dir, "root.md"), "root content");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "x.md"), "sub content");

    const source = new FileDocumentSource(dir, ["sub"]);
    const result = await source.discover();

    expect(result.files.map((f) => f.path).sort()).toEqual(["root.md"]);
  });

  it("strips a trailing slash from an exclude entry before matching the directory prefix", async () => {
    writeFileSync(join(dir, "root.md"), "root content");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "x.md"), "sub content");

    const source = new FileDocumentSource(dir, ["sub/"]);
    const result = await source.discover();

    expect(result.files.map((f) => f.path).sort()).toEqual(["root.md"]);
  });

  it("does not exclude a sibling directory whose name merely starts with the excluded entry", async () => {
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "x.md"), "docs content");
    mkdirSync(join(dir, "docs-old"));
    writeFileSync(join(dir, "docs-old", "x.md"), "docs-old content");

    const source = new FileDocumentSource(dir, ["docs"]);
    const result = await source.discover();

    expect(result.files.map((f) => f.path).sort()).toEqual(["docs-old/x.md"]);
  });
});
