import { describe, expect, it } from "vitest";
import { summarizeEval } from "../../src/domain/metrics";

describe("summarizeEval", () => {
  it("computes recall@k and MRR from positions", () => {
    const summary = summarizeEval(
      [
        { question: "a", expected: "x.md", rank: 1 },
        { question: "b", expected: "y.md", rank: 3 },
        { question: "c", expected: "z.md", rank: null },
      ],
      5,
    );
    expect(summary.cases).toBe(3);
    expect(summary.recallAtK).toBeCloseTo(2 / 3, 10);
    expect(summary.mrr).toBeCloseTo((1 + 1 / 3) / 3, 10);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]!.question).toBe("c");
  });

  it("counts a hit beyond k as a failure for recall but not for MRR", () => {
    const summary = summarizeEval([{ question: "a", expected: "x.md", rank: 7 }], 5);
    expect(summary.recallAtK).toBe(0);
    expect(summary.mrr).toBeCloseTo(1 / 7, 10);
    expect(summary.failures).toHaveLength(1);
  });

  it("handles an empty goldenset without dividing by zero", () => {
    const summary = summarizeEval([], 5);
    expect(summary.recallAtK).toBe(0);
    expect(summary.mrr).toBe(0);
  });
});
