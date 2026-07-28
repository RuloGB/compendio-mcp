import { describe, expect, it } from "vitest";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";

const SAMPLE = `---
type: functional
module: leadsviewer
status: current
tags: [lead, validation]
---

# Form validation

Summary of the document in a paragraph that stands on its own.

Additional introductory text.

## Context and objective

Context of the feature.

## Business rules

Intro to the rules.

### Fields

| Field | Rule |
|---|---|
| Email | required |

#### Nested detail

Text under an H4 that does not open a new section.

### Duplicates

A lead is considered a duplicate by email.

## References

Links.
`;

describe("RemarkMarkdownParser", () => {
  const parser = new RemarkMarkdownParser();

  it("extracts frontmatter, H1 title and summary paragraph", () => {
    const parsed = parser.parse(SAMPLE);
    expect(parsed.data["type"]).toBe("functional");
    expect(parsed.data["tags"]).toEqual(["lead", "validation"]);
    expect(parsed.outline.title).toBe("Form validation");
    expect(parsed.outline.summary).toBe("Summary of the document in a paragraph that stands on its own.");
  });

  it("captures the intro between the H1 and the first H2, without the H1 line", () => {
    const { outline } = parser.parse(SAMPLE);
    expect(outline.intro).toContain("Summary of the document");
    expect(outline.intro).toContain("Additional introductory");
    expect(outline.intro).not.toContain("# Form validation");
    expect(outline.intro).not.toContain("## Context");
  });

  it("builds H2 sections with their H3 children, slices including heading lines", () => {
    const { outline } = parser.parse(SAMPLE);
    expect(outline.sections.map((s) => s.title)).toEqual([
      "Context and objective",
      "Business rules",
      "References",
    ]);
    const rules = outline.sections[1]!;
    expect(rules.text.startsWith("## Business rules")).toBe(true);
    expect(rules.text).toContain("Intro to the rules.");
    expect(rules.text).not.toContain("### Fields");
    expect(rules.children.map((c) => c.title)).toEqual(["Fields", "Duplicates"]);
    expect(rules.children[0]!.text.startsWith("### Fields")).toBe(true);
  });

  it("keeps H4+ headings inline inside their enclosing section", () => {
    const { outline } = parser.parse(SAMPLE);
    const fields = outline.sections[1]!.children[0]!;
    expect(fields.text).toContain("#### Nested detail");
    expect(fields.text).toContain("| Email | required |");
  });

  it("handles a document without sections", () => {
    const { outline } = parser.parse("# Only title\n\nA single paragraph.\n");
    expect(outline.title).toBe("Only title");
    expect(outline.sections).toEqual([]);
    expect(outline.intro).toBe("A single paragraph.");
  });
});
