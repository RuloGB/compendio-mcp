import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GenerateIndexMd } from "../../src/application/generate-index-md";
import { createIndexComparator, createConventionPolicy, type ConventionConfig } from "../../src/domain/convention";
import type {
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  EncodingNotice,
  IndexFileWriter,
  IndexWriteResult,
  ReadError,
} from "../../src/domain/ports";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";

const LOOSE: ConventionConfig = {
  mode: "loose",
  excludedStatuses: [],
  frontmatterFields: { type: "type", module: "module", status: "status" },
};

function cfgStrict(overrides: Partial<ConventionConfig> = {}): ConventionConfig {
  return {
    mode: "strict",
    excludedStatuses: [],
    frontmatterFields: { type: "type", module: "module", status: "status" },
    ...overrides,
  };
}

class MemoryIndexWriter implements IndexFileWriter {
  content: string | null = null;
  async write(content: string): Promise<IndexWriteResult> {
    this.content = content;
    return { path: "docs/INDEX.md", changed: true };
  }
}

class StaticSource implements DocumentSource {
  constructor(
    private readonly files: DocumentFile[],
    private readonly readErrors: ReadError[] = [],
  ) {}
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: this.readErrors };
  }
}

/** Separate from `StaticSource` (which stays untouched, per design Decision
 * 6) so it can additionally return `encodingNotices` without widening the
 * fake every other test in this file relies on. */
class SourceWithEncodingNotices implements DocumentSource {
  constructor(
    private readonly files: DocumentFile[],
    private readonly encodingNotices: EncodingNotice[],
  ) {}
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, readErrors: [], encodingNotices: this.encodingNotices };
  }
}

const VALID_DOC: DocumentFile = {
  path: "guides/transversal-valid.md",
  content:
    "---\ntype: guide\nmodule: transversal\nstatus: current\n---\n\n# Valid guide\n\nSummary of the guide.\n",
};

function buildUseCase(
  source: DocumentSource,
  convention: ConventionConfig = LOOSE,
): { useCase: GenerateIndexMd; writer: MemoryIndexWriter } {
  const writer = new MemoryIndexWriter();
  const policy = createConventionPolicy(convention);
  const compare = createIndexComparator(convention);
  return {
    useCase: new GenerateIndexMd(source, new RemarkMarkdownParser(), writer, policy, compare),
    writer,
  };
}

describe("GenerateIndexMd — loose mode over inline fixtures", () => {
  it("lists a frontmatter-less document, ordered alphabetically by path", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        { path: "b.md", content: "# Document B\n\nSummary B.\n" },
        { path: "a.md", content: "# Document A\n\nSummary A.\n" },
      ]),
    );
    const report = await useCase.execute();

    expect(report.documents).toBe(2);
    expect(report.skipped).toEqual([]);
    const lineas = writer.content!.split("\n").filter((l) => l.startsWith("- "));
    expect(lineas).toEqual(["- a.md — Summary A.", "- b.md — Summary B."]);
  });

  it("never lists INDEX.md itself, even when the source yields it", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([{ path: "INDEX.md", content: "# Old index\n" }, VALID_DOC]),
    );
    const report = await useCase.execute();

    expect(report.documents).toBe(1);
    expect(report.skipped).toEqual([]);
    expect(writer.content).not.toContain("] INDEX.md");
  });

  it("renders only the header for an empty corpus", async () => {
    const { useCase, writer } = buildUseCase(new StaticSource([]));
    const report = await useCase.execute();

    expect(report.documents).toBe(0);
    expect(writer.content).toContain("# Documentation index");
    expect(writer.content!.split("\n").some((l) => l.startsWith("- "))).toBe(false);
  });

  it("falls back to the title for a document with no paragraph at all", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        {
          path: "guides/transversal-no-summary.md",
          content: "# Only title\n\n## Steps\n\n- step one\n- step two\n",
        },
      ]),
    );
    await useCase.execute();

    expect(writer.content).toContain("— Only title");
  });
});

describe("GenerateIndexMd — strict mode over inline fixtures", () => {
  it("orders entries by declared types, tie-broken alphabetically by path", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        { path: "z.md", content: "---\ntype: adr\nmodule: m\nstatus: current\n---\n\n# Z\n\nr\n" },
        { path: "b.md", content: "---\ntype: guide\nmodule: m\nstatus: current\n---\n\n# B\n\nr\n" },
        { path: "a.md", content: "---\ntype: guide\nmodule: m\nstatus: current\n---\n\n# A\n\nr\n" },
      ]),
      cfgStrict({ types: ["guide", "adr"] }),
    );
    const report = await useCase.execute();

    expect(report.documents).toBe(3);
    const paths = writer.content!
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.split(" — ")[0]!.split("] ")[1]!);
    expect(paths).toEqual(["a.md", "b.md", "z.md"]);
  });

  it("skips and reports a document missing a declared taxonomy value", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        {
          path: "guides/type-invalid.md",
          content: "---\ntype: not-declared\nmodule: m\nstatus: current\n---\n\n# X\n\nr\n",
        },
      ]),
      cfgStrict({ types: ["guide"] }),
    );
    const report = await useCase.execute();

    expect(report.documents).toBe(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("guides/type-invalid.md");
    expect(writer.content).toContain("guides/transversal-valid.md");
  });
});

describe("GenerateIndexMd — resilience (mode-independent)", () => {
  it("skips and reports a document with malformed YAML frontmatter, and continues", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        { path: "guides/frontmatter-broken.md", content: "---\ntype: [unclosed\n---\n\n# X\n" },
      ]),
    );
    const report = await useCase.execute();

    expect(report.documents).toBe(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("guides/frontmatter-broken.md");
    expect(report.skipped[0]!.errors[0]!.length).toBeGreaterThan(0);
    expect(writer.content).toContain("guides/transversal-valid.md");
  });

  it("skips and reports a document with malformed frontmatter under strict too", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        { path: "guides/frontmatter-broken.md", content: "---\ntype: [unclosed\n---\n\n# X\n" },
      ]),
      cfgStrict({ types: ["guide"] }),
    );
    const report = await useCase.execute();

    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.path).toBe("guides/frontmatter-broken.md");
    expect(writer.content).toContain("guides/transversal-valid.md");
  });

  it("folds an unreadable file (readErrors) into skipped and continues", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([VALID_DOC], [{ path: "guides/unreadable.md", error: "permission denied" }]),
    );
    const report = await useCase.execute();

    expect(report.documents).toBe(1);
    expect(report.skipped).toEqual([{ path: "guides/unreadable.md", errors: ["permission denied"] }]);
    expect(writer.content).toContain("guides/transversal-valid.md");
  });
});

describe("GenerateIndexMd — encoding notices (encoding-aware-reads)", () => {
  it("lists and reports a transcoded document, filtered on INDEX.md like skipped", async () => {
    const { useCase, writer } = buildUseCase(
      new SourceWithEncodingNotices(
        [VALID_DOC],
        [
          { path: "guides/transversal-valid.md", encoding: "windows-1252" },
          { path: "INDEX.md", encoding: "windows-1252" },
        ],
      ),
    );
    const report = await useCase.execute();

    expect(report.documents).toBe(1);
    expect(writer.content).toContain("guides/transversal-valid.md");
    expect(report.encodingNotices).toEqual([
      { path: "guides/transversal-valid.md", encoding: "windows-1252" },
    ]);
  });
});

// W4 (verify-report.md): every resilience test above uses a fake DocumentSource
// that hands GenerateIndexMd an already-decoded readError string (e.g. "permission
// denied") -- never the real decodeText-produced message. This uses a real
// FileDocumentSource over actual on-disk bytes so the "distinguishable from a
// generic I/O error" half of the index-md spec's undecodable-content scenario is
// proven against production wiring, not a hand-written stand-in for it.
describe("GenerateIndexMd — undecodable content, real decodeText rejection message", () => {
  it("skips a binary file with a message distinguishable from a generic I/O error, and lists the remaining document", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compendio-indexmd-undecodable-"));
    mkdirSync(join(dir, "guides"));
    writeFileSync(join(dir, "guides", "transversal-valid.md"), VALID_DOC.content);
    // JPEG magic header: contains 0x00, which rules out both UTF-8 and CP1252.
    writeFileSync(
      join(dir, "guides", "binary.md"),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
    );

    const source = new FileDocumentSource(dir, []);
    const { useCase, writer } = buildUseCase(source);

    try {
      const report = await useCase.execute();

      expect(report.documents).toBe(1);
      expect(writer.content).toContain("guides/transversal-valid.md");
      expect(report.skipped).toHaveLength(1);
      expect(report.skipped[0]!.path).toBe("guides/binary.md");
      expect(report.skipped[0]!.errors[0]).not.toMatch(/EACCES|ENOENT|permission denied/);
      expect(report.skipped[0]!.errors[0]).toContain("windows-1252");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
