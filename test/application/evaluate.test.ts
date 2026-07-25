import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHarness, type TestHarness } from "../helpers/build";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import type { EvalCase } from "../../src/domain/metrics";

const CASES: EvalCase[] = [
  {
    question: "campos obligatorios del formulario de alta",
    expected: "leadsviewer/validacion-formulario.md",
  },
  {
    question: "elección de PostgreSQL como base de datos",
    expected: "transversal/adr-0007-eleccion-base-datos.md",
  },
  // Semantic-gap question: no lexical overlap with the corpus.
  {
    question: "registros clonados",
    expected: "leadsviewer/validacion-formulario.md",
  },
];

describe("EvaluateSearch: hybrid vs lexical on the same goldenset", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = buildHarness(new FakeEmbeddings());
    await harness.index.execute();
  });

  afterAll(() => {
    harness.close();
  });

  it("reports both modes, and hybrid recovers what lexical misses", async () => {
    const report = await harness.evaluate.execute(CASES, 5);
    expect(report.hybrid).toBeDefined();
    expect(report.hybrid!.recallAtK).toBe(1);
    expect(report.lexical.recallAtK).toBeCloseTo(2 / 3, 10);
    expect(report.lexical.failures).toHaveLength(1);
    expect(report.lexical.failures[0]!.question).toBe("registros clonados");
    expect(report.hybrid!.mrr).toBeGreaterThanOrEqual(report.lexical.mrr);
  });

  it("omits the hybrid column when the index has no vectors", async () => {
    const lexicalHarness = buildHarness(null);
    await lexicalHarness.index.execute();
    const report = await lexicalHarness.evaluate.execute(CASES.slice(0, 2), 5);
    expect(report.hybrid).toBeUndefined();
    expect(report.lexical.cases).toBe(2);
    lexicalHarness.close();
  });
});
