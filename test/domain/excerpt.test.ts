import { describe, expect, it } from "vitest";
import {
  buildExcerpt,
  excerptBudget,
  LEAD_EXCERPT_CHARS,
  SUPPORTING_EXCERPT_CHARS,
} from "../../src/domain/excerpt";

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

  it("falls back to the fenced content when stripping would empty the excerpt", () => {
    // A templates/examples section is all code. An empty excerpt would spend
    // the rank's budget on silence and, carrying no "…", would tell the agent
    // the result is complete.
    const excerpt = buildExcerpt("## Templates\n\n```markdown\ntipo: funcional\n```");
    expect(excerpt.length).toBeGreaterThan(0);
    expect(excerpt).toContain("tipo: funcional");
  });

  it("still prefers prose over fenced content when both are present", () => {
    const excerpt = buildExcerpt("Regla vigente.\n\n```js\nconst ruido = 1;\n```");
    expect(excerpt).toBe("Regla vigente.");
  });

  it("leaves no ellipsis when the content fits, so '…' marks truncation", () => {
    // The tool contract tells agents to treat a trailing "…" as the signal to
    // call read_doc, so an untruncated excerpt must never carry one.
    expect(buildExcerpt("Corto y completo.").endsWith("…")).toBe(false);
  });
});

describe("excerptBudget", () => {
  it("gives the lead fragment room to answer and the rest room to signpost", () => {
    expect(excerptBudget(0)).toBe(LEAD_EXCERPT_CHARS);
    expect(excerptBudget(1)).toBe(SUPPORTING_EXCERPT_CHARS);
    expect(excerptBudget(4)).toBe(SUPPORTING_EXCERPT_CHARS);
  });

  it("keeps the lead budget well clear of the supporting one", () => {
    // The whole point of grading is that one fragment can carry an answer.
    // If these ever converge, the policy has silently become a uniform cap.
    expect(LEAD_EXCERPT_CHARS).toBeGreaterThan(SUPPORTING_EXCERPT_CHARS * 5);
  });
});
