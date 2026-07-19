import { describe, expect, it } from "vitest";
import { buildExcerpt } from "../../src/domain/excerpt";

describe("buildExcerpt", () => {
  it("drops heading lines and collapses whitespace", () => {
    const excerpt = buildExcerpt("### Duplicidad\n\nUn lead   se considera\nduplicado.");
    expect(excerpt).toBe("Un lead se considera duplicado.");
  });

  it("keeps link text and drops the URL", () => {
    const excerpt = buildExcerpt("Ver [el glosario](../glosario.md) del proyecto.");
    expect(excerpt).toContain("el glosario");
    expect(excerpt).not.toContain("glosario.md");
  });

  it("cuts long content at a word boundary with an ellipsis", () => {
    const excerpt = buildExcerpt(`${"palabra ".repeat(60)}final`, 100);
    expect(excerpt.length).toBeLessThanOrEqual(101);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});
