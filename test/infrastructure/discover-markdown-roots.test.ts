import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverMarkdownRootDetails,
  discoverMarkdownRoots,
  validateDiscoveredRootAlias,
} from "../../src/infrastructure/fs/discover-markdown-roots";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";

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
        realpathSync: Object.assign((path: unknown) => String(path), {
          native: (path: unknown) => String(path),
        }),
      };
    });
    const { discoverMarkdownRoots: discoverWithMock } = await import("../../src/infrastructure/fs/discover-markdown-roots");

    expect(() => discoverWithMock("/project")).toThrow(/EACCES|permission denied/);

    vi.doUnmock("node:fs");
    vi.resetModules();
  });
  // `trustedRealPath` is pinned here but revalidated by `FileDocumentSource` through
  // `fs/promises`' `realpath`. The two must agree on one canonical form, or a root that
  // never moved reads as "changed realpath after root selection" and discovery aborts.
  it("pins a trusted real path in the same canonical form the async validator produces", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await writeFile(join(projectDir, "docs", "a.md"), "# A\n\nbody\n");

    const [root] = discoverMarkdownRootDetails(projectDir);
    expect(root).toBeDefined();
    expect(root!.trustedRealPath).toBe(await realpath(join(projectDir, "docs")));
  });

  // Windows 8.3 short names are the one real-world case where the two canonical forms
  // diverge: the JS `realpathSync` preserves `AREALL~1`, the native/async one expands it.
  // This is the shape that failed CI on windows-latest while passing on macOS and Linux.
  it("indexes a project reached through a Windows 8.3 short path", async (ctx) => {
    if (process.platform !== "win32") return ctx.skip();

    const longName = "a really long project folder name";
    const longProject = join(projectDir, longName);
    await mkdir(join(longProject, "docs"), { recursive: true });
    await writeFile(join(longProject, "docs", "a.md"), "# A\n\nbody\n");

    const listing = execFileSync("cmd", ["/c", "dir", "/x", "/ad", projectDir], { encoding: "latin1" });
    const alias = new RegExp(String.raw`([A-Z0-9~]{1,8}(?:\.[A-Z0-9]{1,3})?)\s+` + longName, "i").exec(listing);
    // A volume with 8.3 generation disabled cannot exercise this at all. Skip visibly
    // rather than returning green: a silent pass here would assert nothing.
    if (alias === null) return ctx.skip();

    const shortProject = join(projectDir, alias[1]!);
    const [root] = discoverMarkdownRootDetails(shortProject);
    expect(root).toBeDefined();

    const source = new FileDocumentSource(join(shortProject, root!.declared), [], root!.declared, {
      discoveryMode: true,
      trustedRootRealPath: root!.trustedRealPath,
    });
    const result = await source.discover();
    expect(result.files.map((file) => file.path)).toEqual(["docs/a.md"]);
  });
});

describe("validateDiscoveredRootAlias", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "compendio-alias-validation-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("validates a present alias directory and pins its real path", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });

    const result = validateDiscoveredRootAlias(projectDir, "docs");

    expect(result).toEqual({ declared: "docs", trustedRealPath: await realpath(join(projectDir, "docs")) });
  });

  it("throws when the alias is a file instead of a directory", async () => {
    await writeFile(join(projectDir, "docs"), "not a directory", "utf8");

    expect(() => validateDiscoveredRootAlias(projectDir, "docs")).toThrow(/is not a directory/);
  });

  it("throws when the alias is a symlink or junction", async () => {
    const externalDir = await mkdtemp(join(tmpdir(), "compendio-alias-external-"));
    try {
      await symlink(externalDir, join(projectDir, "docs"), "junction");

      expect(() => validateDiscoveredRootAlias(projectDir, "docs")).toThrow(/symlink or junction/);
    } finally {
      await rm(externalDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when the alias directory was deleted (ENOENT)", async () => {
    // The alias is intentionally never created: lstat on a missing path fails ENOENT.
    const result = validateDiscoveredRootAlias(projectDir, "docs");

    expect(result).toBeUndefined();
  });

  it("validates an alias deleted then recreated as an empty directory before validation runs", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });
    await rm(join(projectDir, "docs"), { recursive: true, force: true });
    await mkdir(join(projectDir, "docs"), { recursive: true });

    const result = validateDiscoveredRootAlias(projectDir, "docs");

    expect(result).toEqual({ declared: "docs", trustedRealPath: await realpath(join(projectDir, "docs")) });
  });

  it("still throws (does not treat as deleted) when lstat fails with EACCES", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        lstatSync: (path: unknown) => {
          if (String(path).endsWith("docs")) {
            const error = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
            error.code = "EACCES";
            throw error;
          }
          return actual.lstatSync(path as string);
        },
      };
    });
    const { validateDiscoveredRootAlias: validateWithMock } = await import(
      "../../src/infrastructure/fs/discover-markdown-roots"
    );

    expect(() => validateWithMock(projectDir, "docs")).toThrow(/could not be inspected/);

    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("still throws (does not treat as deleted) when lstat fails with EPERM", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        lstatSync: (path: unknown) => {
          if (String(path).endsWith("docs")) {
            const error = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
            error.code = "EPERM";
            throw error;
          }
          return actual.lstatSync(path as string);
        },
      };
    });
    const { validateDiscoveredRootAlias: validateWithMock } = await import(
      "../../src/infrastructure/fs/discover-markdown-roots"
    );

    expect(() => validateWithMock(projectDir, "docs")).toThrow(/could not be inspected/);

    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("still throws (does not treat as deleted) when lstat fails with no code but 'ENOENT' in the message text", async () => {
    // Proves the check is `error.code`, not message string matching.
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        lstatSync: (path: unknown) => {
          if (String(path).endsWith("docs")) {
            throw new Error("ENOENT: something went wrong, but this error carries no .code");
          }
          return actual.lstatSync(path as string);
        },
      };
    });
    const { validateDiscoveredRootAlias: validateWithMock } = await import(
      "../../src/infrastructure/fs/discover-markdown-roots"
    );

    expect(() => validateWithMock(projectDir, "docs")).toThrow(/could not be inspected/);

    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("throws when lstat succeeds but realpathSync.native fails with ENOENT", async () => {
    await mkdir(join(projectDir, "docs"), { recursive: true });

    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        realpathSync: Object.assign((path: unknown) => actual.realpathSync(path as string), {
          native: (path: unknown) => {
            if (String(path).endsWith("docs")) {
              const error = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
              error.code = "ENOENT";
              throw error;
            }
            return actual.realpathSync.native(path as string);
          },
        }),
      };
    });
    const { validateDiscoveredRootAlias: validateWithMock } = await import(
      "../../src/infrastructure/fs/discover-markdown-roots"
    );

    expect(() => validateWithMock(projectDir, "docs")).toThrow(/could not be resolved/);

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
