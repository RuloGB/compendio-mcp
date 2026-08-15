import { describe, expect, it } from "vitest";
import {
  condenseSummary,
  formatDocLine,
  MAX_SUMMARY_CHARS,
  renderIndexMd,
  type IndexEntry,
} from "../../src/domain/index-markdown";

function entry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    path: "auth/doc.md",
    title: "Document",
    summary: "Short summary",
    type: "guia",
    status: "vigente",
    ...overrides,
  };
}

function listedPaths(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.split(" — ")[0]!.replace(/^- (\[[^\]]+\] )?/, ""));
}

describe("renderIndexMd", () => {
  it("defaults to alphabetical order by path with no comparator supplied", () => {
    const output = renderIndexMd([entry({ path: "b.md" }), entry({ path: "a.md" })]);
    expect(listedPaths(output)).toEqual(["a.md", "b.md"]);
  });

  it("uses an injected comparator when supplied", () => {
    const inverso = (a: IndexEntry, b: IndexEntry) => b.path.localeCompare(a.path);
    const output = renderIndexMd([entry({ path: "a.md" }), entry({ path: "b.md" })], inverso);
    expect(listedPaths(output)).toEqual(["b.md", "a.md"]);
  });

  it("collapses whitespace and truncates long summaries", () => {
    const output = renderIndexMd([entry({ summary: `linea\nrota   ${"x".repeat(200)}` })]);
    const linea = output.split("\n").find((l) => l.startsWith("- "))!;
    const summary = linea.split(" — ")[1]!.replace(/ \(vigente\)$/, "");
    expect(summary).toContain("linea rota");
    expect(summary).toHaveLength(MAX_SUMMARY_CHARS);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("falls back to the title when the summary is empty", () => {
    const output = renderIndexMd([entry({ summary: "  ", title: "Guía de despliegue" })]);
    expect(output).toContain("- [guia] auth/doc.md — Guía de despliegue (vigente)");
  });

  it("renders only the header for an empty corpus", () => {
    const output = renderIndexMd([]);
    expect(output).toContain("# Documentation index");
    expect(output).not.toContain("- [");
    expect(output.endsWith("\n")).toBe(true);
  });
});

describe("formatDocLine — omits absent type/status segments", () => {
  it("omits both segments when type and status are absent", () => {
    const linea = formatDocLine({ type: undefined, path: "a.md", summary: "r", status: undefined });
    expect(linea).toBe("- a.md — r");
    expect(linea).not.toContain("[");
    expect(linea).not.toContain("(");
    expect(linea).not.toContain("undefined");
  });

  it("includes type and omits status when only type is present", () => {
    const linea = formatDocLine({ type: "guia", path: "a.md", summary: "r", status: undefined });
    expect(linea).toBe("- [guia] a.md — r");
    expect(linea).not.toContain("(");
  });

  it("includes status and omits type when only status is present", () => {
    const linea = formatDocLine({ type: undefined, path: "a.md", summary: "r", status: "vigente" });
    expect(linea).toBe("- a.md — r (vigente)");
    expect(linea).not.toContain("[");
  });

  it("includes both segments when both are present", () => {
    const linea = formatDocLine({ type: "guia", path: "a.md", summary: "r", status: "vigente" });
    expect(linea).toBe("- [guia] a.md — r (vigente)");
  });
});

describe("condenseSummary", () => {
  it("keeps short texts intact after collapsing whitespace", () => {
    expect(condenseSummary("  hola \n mundo  ")).toBe("hola mundo");
  });

  it("truncates with an ellipsis at the limit", () => {
    const largo = condenseSummary("a".repeat(500));
    expect(largo).toHaveLength(MAX_SUMMARY_CHARS);
    expect(largo.endsWith("…")).toBe(true);
  });

  it("keeps a summary exactly at the limit intact", () => {
    const exacto = "a".repeat(MAX_SUMMARY_CHARS);
    expect(condenseSummary(exacto)).toBe(exacto);
  });

  it("truncates one character over the limit", () => {
    const result = condenseSummary("a".repeat(MAX_SUMMARY_CHARS + 1));
    expect(result).toHaveLength(MAX_SUMMARY_CHARS);
    expect(result.endsWith("…")).toBe(true);
  });
});
