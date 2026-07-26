import { describe, expect, it } from "vitest";
import type { DocumentMeta } from "../../src/domain/model";
import {
  collectFacets,
  describeDroppedFilters,
  dropImpossibleFilters,
  explainEmptyResult,
} from "../../src/domain/search-diagnostics";

function doc(overrides: Partial<DocumentMeta>): DocumentMeta {
  return {
    path: "a.md",
    title: "A",
    summary: "",
    tags: [],
    hash: "h",
    ...overrides,
  };
}

const NO_FACETS = { types: [], modules: [], tags: [], statuses: [] };

describe("collectFacets", () => {
  it("collects distinct declared values and lowercases tags", () => {
    const facets = collectFacets([
      doc({ type: "adr", module: "transversal", status: "vigente", tags: ["PostgreSQL"] }),
      doc({ type: "guia", module: "transversal", tags: ["postgresql", "pipeline"] }),
      doc({}),
    ]);
    expect(facets.types).toEqual(["adr", "guia"]);
    expect(facets.modules).toEqual(["transversal"]);
    expect(facets.statuses).toEqual(["vigente"]);
    expect(facets.tags).toEqual(["pipeline", "postgresql"]);
  });

  it("reports empty facets for a corpus that declares no metadata", () => {
    expect(collectFacets([doc({}), doc({ path: "b.md" })])).toEqual(NO_FACETS);
  });
});

describe("dropImpossibleFilters", () => {
  it("drops a filter on a field no document declares", () => {
    const { filters, droppedFields } = dropImpossibleFilters({ type: "uc" }, NO_FACETS);
    expect(droppedFields).toEqual(["type"]);
    expect(filters.type).toBeUndefined();
  });

  it("keeps a filter on a declared field even when the value is unknown", () => {
    // Answerable request: the caller gets zero plus the real values and can
    // correct itself. Dropping this would hide a legitimate no-match.
    const { filters, droppedFields } = dropImpossibleFilters(
      { type: "inexistente" },
      { ...NO_FACETS, types: ["adr"] },
    );
    expect(droppedFields).toEqual([]);
    expect(filters.type).toBe("inexistente");
  });

  it("never touches the status deny-list, which is config and not a request", () => {
    const { filters, droppedFields } = dropImpossibleFilters(
      { excludedStatuses: ["obsoleto"] },
      NO_FACETS,
    );
    expect(droppedFields).toEqual([]);
    expect(filters.excludedStatuses).toEqual(["obsoleto"]);
  });

  it("leaves the caller's filters object untouched", () => {
    const original = { type: "uc", module: "core" };
    dropImpossibleFilters(original, NO_FACETS);
    expect(original).toEqual({ type: "uc", module: "core" });
  });

  it("drops several fields at once", () => {
    const { droppedFields } = dropImpossibleFilters(
      { type: "uc", module: "core", tags: ["x"] },
      NO_FACETS,
    );
    expect(droppedFields).toEqual(["type", "module", "tags"]);
  });
});

describe("describeDroppedFilters", () => {
  it("names the field and points at the real fix", () => {
    const text = describeDroppedFilters(["type"]);
    expect(text).toContain("type");
    expect(text).toContain("unfiltered");
    expect(text).toContain("convention.frontmatterFields");
  });

  it("reads correctly for several dropped fields", () => {
    const text = describeDroppedFilters(["type", "module"]);
    expect(text).toContain("filters");
    expect(text).toContain("those fields");
  });
});

describe("explainEmptyResult", () => {
  it("stays silent on an unfiltered miss", () => {
    // A bare query matching nothing needs no explanation; inventing one would
    // be noise on every empty search.
    expect(explainEmptyResult({}, NO_FACETS)).toBeUndefined();
  });

  it("says a type filter can never match when the project declares no types", () => {
    // The DocuTests case: agent infers `type: "uc"` from the docs/uc/ directory
    // against a project whose Spanish frontmatter keys were never mapped.
    const reason = explainEmptyResult({ type: "uc" }, NO_FACETS);
    expect(reason).toContain("never match");
    expect(reason).toContain("retry without it");
  });

  it("lists the declared types when the requested one is not among them", () => {
    const reason = explainEmptyResult({ type: "uc" }, { ...NO_FACETS, types: ["adr", "guia"] });
    expect(reason).toContain('"uc"');
    expect(reason).toContain('"adr", "guia"');
  });

  it("lists the declared modules when the requested one is unknown", () => {
    const reason = explainEmptyResult({ module: "ventas" }, { ...NO_FACETS, modules: ["core"] });
    expect(reason).toContain('"ventas"');
    expect(reason).toContain('"core"');
  });

  it("reports tags only when none of the requested ones exist", () => {
    const facets = { ...NO_FACETS, tags: ["pipeline"] };
    expect(explainEmptyResult({ tags: ["ausente"] }, facets)).toContain('"ausente"');
    // One valid tag means the filter is not the obvious culprit.
    expect(explainEmptyResult({ tags: ["pipeline", "ausente"] }, facets)).not.toContain('"ausente"');
  });

  it("surfaces the project's status deny-list, which the caller cannot guess", () => {
    const reason = explainEmptyResult(
      { excludedStatuses: ["obsoleto"] },
      { ...NO_FACETS, statuses: ["vigente", "obsoleto"] },
    );
    expect(reason).toContain("include_excluded");
    expect(reason).toContain('"obsoleto"');
  });

  it("ignores a deny-list that excludes a status no document actually has", () => {
    const reason = explainEmptyResult(
      { excludedStatuses: ["obsoleto"] },
      { ...NO_FACETS, statuses: ["vigente"] },
    );
    expect(reason).toBeUndefined();
  });

  it("blames the combination when every filter is individually valid", () => {
    const reason = explainEmptyResult(
      { type: "adr", module: "core" },
      { ...NO_FACETS, types: ["adr"], modules: ["core"] },
    );
    expect(reason).toContain("fewer filters");
  });
});
