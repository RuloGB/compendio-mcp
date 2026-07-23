import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHarness, type TestHarness } from "../helpers/build";
import { FakeEmbeddings } from "../helpers/fake-embeddings";
import type { EvalCase } from "../../src/domain/metrics";

const CASOS: EvalCase[] = [
  {
    pregunta: "campos obligatorios del formulario de alta",
    esperado: "leadsviewer/validacion-formulario.md",
  },
  {
    pregunta: "elección de PostgreSQL como base de datos",
    esperado: "transversal/adr-0007-eleccion-base-datos.md",
  },
  // Semantic-gap question: no lexical overlap with the corpus.
  {
    pregunta: "registros clonados",
    esperado: "leadsviewer/validacion-formulario.md",
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
    const report = await harness.evaluate.execute(CASOS, 5);
    expect(report.hibrido).toBeDefined();
    expect(report.hibrido!.recallAtK).toBe(1);
    expect(report.lexico.recallAtK).toBeCloseTo(2 / 3, 10);
    expect(report.lexico.fallos).toHaveLength(1);
    expect(report.lexico.fallos[0]!.pregunta).toBe("registros clonados");
    expect(report.hibrido!.mrr).toBeGreaterThanOrEqual(report.lexico.mrr);
  });

  it("omits the hybrid column when the index has no vectors", async () => {
    const lexicalHarness = buildHarness(null);
    await lexicalHarness.index.execute();
    const report = await lexicalHarness.evaluate.execute(CASOS.slice(0, 2), 5);
    expect(report.hibrido).toBeUndefined();
    expect(report.lexico.casos).toBe(2);
    lexicalHarness.close();
  });
});
