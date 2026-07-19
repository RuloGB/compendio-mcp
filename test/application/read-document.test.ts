import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHarness, type TestHarness } from "../helpers/build";
import { FakeEmbeddings } from "../helpers/fake-embeddings";

describe("ReadDocument over the ejemplos corpus", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = buildHarness(new FakeEmbeddings());
    await harness.index.execute();
  });

  afterAll(() => {
    harness.close();
  });

  it("returns the full document with its H1 restored", () => {
    const result = harness.read.execute({ ruta: "funcional/leadsviewer-validacion-formulario.md" });
    expect(result.tipo).toBe("documento");
    if (result.tipo !== "documento") return;
    expect(result.contenido.startsWith("# Validación del formulario de alta de leads")).toBe(true);
    expect(result.contenido).toContain("## Reglas de negocio");
    expect(result.meta.estado).toBe("vigente");
  });

  it("does not duplicate the H1 of documents indexed as a single chunk", () => {
    const result = harness.read.execute({ ruta: "glosario.md" });
    expect(result.tipo).toBe("documento");
    if (result.tipo !== "documento") return;
    expect(result.contenido.match(/^# Glosario/gm)).toHaveLength(1);
  });

  it("finds a section by partial, accent-insensitive heading", () => {
    const result = harness.read.execute({
      ruta: "funcional/leadsviewer-validacion-formulario.md",
      seccion: "reglas de duplicidad",
    });
    expect(result.tipo).toBe("seccion");
    if (result.tipo !== "seccion") return;
    expect(result.contenido).toContain("Un lead se considera duplicado");
  });

  it("suggests the 3 closest paths when the ruta does not exist", () => {
    const result = harness.read.execute({ ruta: "funcional/leadsviewer-validacion.md" });
    expect(result.tipo).toBe("ruta-no-encontrada");
    if (result.tipo !== "ruta-no-encontrada") return;
    expect(result.sugerencias).toHaveLength(3);
    expect(result.sugerencias[0]).toBe("funcional/leadsviewer-validacion-formulario.md");
  });

  it("lists available sections when the requested one does not exist", () => {
    const result = harness.read.execute({
      ruta: "funcional/leadsviewer-validacion-formulario.md",
      seccion: "seccion inventada",
    });
    expect(result.tipo).toBe("seccion-no-encontrada");
    if (result.tipo !== "seccion-no-encontrada") return;
    expect(result.seccionesDisponibles.length).toBeGreaterThan(0);
  });
});
