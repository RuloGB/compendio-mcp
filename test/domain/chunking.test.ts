import { describe, expect, it } from "vitest";
import { chunkOutline } from "../../src/domain/chunking";
import type { DocOutline, DocSection } from "../../src/domain/outline";

// minTokens 25 = 100 chars; maxTokens 100 = 400 chars (4 chars per token).
const OPTS = { minTokens: 25, maxTokens: 100 };

function section(title: string, chars: number, children: DocSection[] = []): DocSection {
  return { title, text: `## ${title}\n\n${"x".repeat(chars)}`, children };
}

function outline(sections: DocSection[], intro = ""): DocOutline {
  return { title: "Test doc", summary: "Summary.", intro, sections };
}

describe("chunkOutline", () => {
  it("creates one chunk per H2 section when sizes are within limits", () => {
    const chunks = chunkOutline(outline([section("Context", 200), section("Rules", 250)]), OPTS);
    expect(chunks.map((c) => c.heading)).toEqual(["Context", "Rules"]);
    expect(chunks[0]!.content).toContain("## Context");
    expect(chunks.map((c) => c.position)).toEqual([0, 1]);
  });

  it("emits the intro (text between H1 and first H2) under the document title", () => {
    const chunks = chunkOutline(
      outline([section("Context", 200)], "Summary paragraph with enough context."),
      OPTS,
    );
    expect(chunks[0]!.heading).toBe("Test doc");
    expect(chunks[0]!.content).toContain("Summary paragraph");
  });

  it("splits an oversized H2 into its H3 children with full heading paths", () => {
    const big = section("Business rules", 0, [
      { title: "Fields", text: `### Fields\n\n${"a".repeat(300)}`, children: [] },
      { title: "Duplicates", text: `### Duplicates\n\n${"b".repeat(300)}`, children: [] },
    ]);
    big.text = `## Business rules\n\n${"i".repeat(150)}`;
    const chunks = chunkOutline(outline([big]), OPTS);
    expect(chunks.map((c) => c.heading)).toEqual([
      "Business rules",
      "Business rules > Fields",
      "Business rules > Duplicates",
    ]);
  });

  it("keeps an H2 whole when it fits, even if it has H3 children", () => {
    const parent = section("Rules", 0, [
      { title: "Fields", text: "### Fields\n\nshort", children: [] },
    ]);
    parent.text = "## Rules\n\nbrief intro";
    const chunks = chunkOutline(outline([parent]), OPTS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("### Fields");
  });

  it("merges tiny contiguous sections into the previous chunk", () => {
    const chunks = chunkOutline(
      outline([section("Context", 200), section("References", 20), section("Notes", 20)]),
      OPTS,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe("Context");
    expect(chunks[0]!.content).toContain("## References");
    expect(chunks[0]!.content).toContain("## Notes");
  });

  it("does not merge when the combination would exceed maxTokens", () => {
    const chunks = chunkOutline(outline([section("Big", 390), section("Mini", 20)]), OPTS);
    expect(chunks).toHaveLength(2);
  });

  it("keeps a section with a huge table whole (tables are never split)", () => {
    const table = `## Table\n\n| a | b |\n|---|---|\n${"| value | value |\n".repeat(60)}`;
    const chunks = chunkOutline(
      outline([{ title: "Table", text: table, children: [] }]),
      OPTS,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(table);
  });
});
