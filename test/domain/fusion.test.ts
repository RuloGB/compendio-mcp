import { describe, expect, it } from "vitest";
import { capPerDocument, reciprocalRankFusion } from "../../src/domain/fusion";

describe("reciprocalRankFusion", () => {
  it("scores an id present in both lists as the sum of 1/(60+rank)", () => {
    const fused = reciprocalRankFusion([[7], [7]]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.score).toBeCloseTo(2 / 61, 10);
  });

  it("ranks an id found by both legs above one found by a single leg", () => {
    // id 1: rank 1 in one list -> 1/61 ~= 0.0164
    // id 2: rank 2 in both lists -> 2/62 ~= 0.0323
    const fused = reciprocalRankFusion([
      [1, 2],
      [3, 2],
    ]);
    expect(fused[0]!.id).toBe(2);
  });

  it("preserves the order of a single list (lexical-only mode)", () => {
    const fused = reciprocalRankFusion([[5, 9, 3]]);
    expect(fused.map((f) => f.id)).toEqual([5, 9, 3]);
  });

  it("breaks score ties deterministically by best individual rank", () => {
    const fused = reciprocalRankFusion([
      [1, 2],
      [2, 1],
    ]);
    expect(fused.map((f) => f.id)).toEqual([1, 2]);
  });
});

describe("capPerDocument", () => {
  it("keeps at most N chunks of the same document, preserving order", () => {
    const results = [10, 11, 12, 20, 30].map((id, i) => ({ id, score: 1 - i * 0.1 }));
    const docOf = (id: number) => Math.floor(id / 10);
    const capped = capPerDocument(results, docOf, 2);
    expect(capped.map((r) => r.id)).toEqual([10, 11, 20, 30]);
  });
});
