import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverMarkdownRoots } from "../../src/infrastructure/fs/discover-markdown-roots";

describe("discoverMarkdownRoots", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "compendio-root-discovery-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("selects top-level markdown-bearing folders in deterministic raw-name order", async () => {
    await mkdir(join(projectDir, "zeta"), { recursive: true });
    await mkdir(join(projectDir, "Alpha", "deep"), { recursive: true });
    await writeFile(join(projectDir, "zeta", "readme.md"), "# Z\n");
    await writeFile(join(projectDir, "Alpha", "deep", "guide.Md"), "# A\n");
    await writeFile(join(projectDir, "root.md"), "# Root is not a discovered root\n");

    expect(discoverMarkdownRoots(projectDir)).toEqual(["Alpha", "zeta"]);
    expect(discoverMarkdownRoots(projectDir)).toEqual(["Alpha", "zeta"]);
  });

  it("ignores technical directory names recursively and case-insensitively without ignoring openspec", async () => {
    await mkdir(join(projectDir, "docs", "NODE_MODULES"), { recursive: true });
    await mkdir(join(projectDir, "openspec", "changes", "archive"), { recursive: true });
    await writeFile(join(projectDir, "docs", "NODE_MODULES", "hidden.md"), "# Hidden\n");
    await writeFile(join(projectDir, "openspec", "changes", "archive", "kept.md"), "# Kept\n");

    expect(discoverMarkdownRoots(projectDir)).toEqual(["openspec"]);
  });

  it("does not follow symlink candidate roots, nested directories, or markdown files", async () => {
    await mkdir(join(projectDir, "outside"), { recursive: true });
    await writeFile(join(projectDir, "outside", "external.md"), "# External\n");
    await mkdir(join(projectDir, "docs", "real"), { recursive: true });
    await writeFile(join(projectDir, "docs", "real", "kept.md"), "# Kept\n");
    await symlink(join(projectDir, "outside"), join(projectDir, "linked-root"), "junction");
    await symlink(join(projectDir, "outside"), join(projectDir, "docs", "linked-dir"), "junction");
    expect(discoverMarkdownRoots(projectDir)).toEqual(["docs", "outside"]);
  });

  it("returns an empty list when scanning succeeds and no top-level folder owns markdown", async () => {
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "README.md"), "# Root file\n");

    expect(discoverMarkdownRoots(projectDir)).toEqual([]);
  });

  it("aborts scan failures instead of returning an empty discovery result", async () => {
    expect(() => discoverMarkdownRoots(join(projectDir, "missing"))).toThrow(/ENOENT|no such file/i);
  });

  it("continues scanning after early markdown and aborts a later unreadable subtree regardless of entry order", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        readdirSync: (path: unknown, options?: unknown) => {
          const text = String(path);
          if (text === "/project") {
            return [
              dirent("docs", "dir"),
            ];
          }
          if (text === join("/project", "docs")) {
            return [
              dirent("a.md", "file"),
              dirent("later", "dir"),
            ];
          }
          if (text === join("/project", "docs", "later")) {
            const error = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
            error.code = "EACCES";
            throw error;
          }
          return actual.readdirSync(path as string, options as Parameters<typeof actual.readdirSync>[1]);
        },
        lstatSync: (path: unknown) => {
          const text = String(path);
          if (text.endsWith("a.md")) return stats("file");
          if (text.endsWith("later") || text.endsWith("docs")) return stats("dir");
          return actual.lstatSync(path as string);
        },
        realpathSync: (path: unknown) => String(path),
      };
    });
    const { discoverMarkdownRoots: discoverWithMock } = await import("../../src/infrastructure/fs/discover-markdown-roots");

    expect(() => discoverWithMock("/project")).toThrow(/EACCES|permission denied/);

    vi.doUnmock("node:fs");
    vi.resetModules();
  });
});

function dirent(name: string, kind: "dir" | "file" | "symlink") {
  return {
    name,
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  };
}

function stats(kind: "dir" | "file" | "symlink") {
  return {
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  };
}
