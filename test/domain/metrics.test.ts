import { describe, expect, it } from "vitest";
import { summarizeEval } from "../../src/domain/metrics";

describe("summarizeEval", () => {
  it("computes recall@k and MRR from positions", () => {
    const summary = summarizeEval(
      [
        { pregunta: "a", esperado: "x.md", posicion: 1 },
        { pregunta: "b", esperado: "y.md", posicion: 3 },
        { pregunta: "c", esperado: "z.md", posicion: null },
      ],
      5,
    );
    expect(summary.casos).toBe(3);
    expect(summary.recallAtK).toBeCloseTo(2 / 3, 10);
    expect(summary.mrr).toBeCloseTo((1 + 1 / 3) / 3, 10);
    expect(summary.fallos).toHaveLength(1);
    expect(summary.fallos[0]!.pregunta).toBe("c");
  });

  it("counts a hit beyond k as a failure for recall but not for MRR", () => {
    const summary = summarizeEval([{ pregunta: "a", esperado: "x.md", posicion: 7 }], 5);
    expect(summary.recallAtK).toBe(0);
    expect(summary.mrr).toBeCloseTo(1 / 7, 10);
    expect(summary.fallos).toHaveLength(1);
  });

  it("handles an empty goldenset without dividing by zero", () => {
    const summary = summarizeEval([], 5);
    expect(summary.recallAtK).toBe(0);
    expect(summary.mrr).toBe(0);
  });
});
