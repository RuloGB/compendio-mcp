import { describe, expect, it } from "vitest";
import type { DiscoverResult, DocumentFile, DocumentSource, EncodingNotice, ReadError } from "../../src/domain/ports";
import { CompositeDocumentSource, type RootSource } from "../../src/infrastructure/fs/composite-document-source";

/** A fake per-root `DocumentSource`: no filesystem, deterministic. */
class FakeSource implements DocumentSource {
  constructor(
    private readonly files: DocumentFile[] = [],
    private readonly readErrors: ReadError[] = [],
    private readonly encodingNotices: EncodingNotice[] = [],
  ) {}
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: this.readErrors, encodingNotices: this.encodingNotices };
  }
}

/** A fake per-root `DocumentSource` that always rejects, mirroring
 * `FileDocumentSource`'s root-unreadable throw (design.md Decision 2). */
class ThrowingSource implements DocumentSource {
  constructor(private readonly message: string) {}
  async discover(): Promise<DiscoverResult> {
    throw new Error(this.message);
  }
}

function root(declared: string, source: DocumentSource, prefix: string = declared): RootSource {
  return { declared, dir: `/abs/${declared}`, prefix, source };
}

describe("CompositeDocumentSource", () => {
  it("runs for a single-element root set too — no branch, same code path as N roots", async () => {
    const composite = new CompositeDocumentSource([
      root("docs", new FakeSource([{ path: "docs/a.md", content: "a" }])),
    ]);

    const result = await composite.discover();

    expect(result.files).toEqual([{ path: "docs/a.md", content: "a" }]);
    expect(result.readErrors).toEqual([]);
  });

  it("merges files from every root, preserving declaration order before the final sort", async () => {
    const composite = new CompositeDocumentSource([
      root("openspec", new FakeSource([{ path: "openspec/z.md", content: "z" }])),
      root("docs", new FakeSource([{ path: "docs/a.md", content: "a" }])),
    ]);

    const result = await composite.discover();

    // Sorted by path.localeCompare, not by declaration order: "docs/a.md" < "openspec/z.md".
    expect(result.files.map((f) => f.path)).toEqual(["docs/a.md", "openspec/z.md"]);
  });

  it("sorts merged files by path.localeCompare across roots, not within a single root's own order", async () => {
    const composite = new CompositeDocumentSource([
      root("b-root", new FakeSource([{ path: "b-root/m.md", content: "m" }]), "b-root"),
      root("a-root", new FakeSource([{ path: "a-root/z.md", content: "z" }]), "a-root"),
    ]);

    const result = await composite.discover();

    expect(result.files.map((f) => f.path)).toEqual(["a-root/z.md", "b-root/m.md"]);
  });

  it("concatenates readErrors and encodingNotices from every root, in declaration order", async () => {
    const composite = new CompositeDocumentSource([
      root(
        "docs",
        new FakeSource(
          [{ path: "docs/a.md", content: "a" }],
          [{ path: "docs/bad.md", error: "permission denied" }],
          [{ path: "docs/a.md", encoding: "windows-1252" }],
        ),
      ),
      root(
        "openspec",
        new FakeSource(
          [],
          [{ path: "openspec/broken.md", error: "ENOENT" }],
          [],
        ),
      ),
    ]);

    const result = await composite.discover();

    expect(result.readErrors).toEqual([
      { path: "docs/bad.md", error: "permission denied" },
      { path: "openspec/broken.md", error: "ENOENT" },
    ]);
    expect(result.encodingNotices).toEqual([{ path: "docs/a.md", encoding: "windows-1252" }]);
  });

  it("a throwing root propagates immediately — no catch in this PR, exactly like today's single root", async () => {
    const composite = new CompositeDocumentSource([
      root("docs", new ThrowingSource("cannot read the documentation directory \"docs\": ENOENT")),
      root("openspec", new FakeSource([{ path: "openspec/a.md", content: "a" }])),
    ]);

    await expect(composite.discover()).rejects.toThrow(/cannot read the documentation directory "docs"/);
  });

  it("a throwing second root still propagates, even when the first root succeeded", async () => {
    const composite = new CompositeDocumentSource([
      root("docs", new FakeSource([{ path: "docs/a.md", content: "a" }])),
      root("openspec", new ThrowingSource("root directory unreachable")),
    ]);

    await expect(composite.discover()).rejects.toThrow(/root directory unreachable/);
  });
});
