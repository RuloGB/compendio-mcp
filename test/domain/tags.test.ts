import { describe, expect, it } from "vitest";
import { normalizeTags } from "../../src/domain/tags";

describe("normalizeTags", () => {
  it("trims and lowercases each entry", () => {
    expect(normalizeTags(["Lead", " Validacion  "])).toEqual(["lead", "validacion"]);
  });

  it("drops entries that are empty after trimming", () => {
    expect(normalizeTags(["api", "  "])).toEqual(["api"]);
  });

  it("handles a mixed array of valid and blank entries", () => {
    expect(normalizeTags(["api", "", "  ", "Leads"])).toEqual(["api", "leads"]);
  });

  it("returns an empty array when every entry is blank", () => {
    expect(normalizeTags(["", "   ", "\t"])).toEqual([]);
  });

  it("returns an empty array for an empty input array", () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it("is idempotent: already-canonical input is unchanged", () => {
    const canonical = ["api", "leads"];
    expect(normalizeTags(canonical)).toEqual(canonical);
  });
});
