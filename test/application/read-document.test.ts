import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatFrontmatter } from "../../src/application/read-document";
import type { DocumentMeta } from "../../src/domain/model";
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
    const result = harness.read.execute({ ruta: "leadsviewer/validacion-formulario.md" });
    expect(result.tipo).toBe("documento");
    if (result.tipo !== "documento") return;
    expect(result.contenido.startsWith("# Validación del formulario de alta de leads")).toBe(true);
    expect(result.contenido).toContain("## Reglas de negocio");
    // Zero-config document (no frontmatter): modulo comes from folder inference.
    expect(result.meta.modulo).toBe("leadsviewer");
  });

  it("does not duplicate the H1 of documents indexed as a single chunk", () => {
    const result = harness.read.execute({ ruta: "glosario.md" });
    expect(result.tipo).toBe("documento");
    if (result.tipo !== "documento") return;
    expect(result.contenido.match(/^# Glosario/gm)).toHaveLength(1);
  });

  it("finds a section by partial, accent-insensitive heading", () => {
    const result = harness.read.execute({
      ruta: "leadsviewer/validacion-formulario.md",
      seccion: "reglas de duplicidad",
    });
    expect(result.tipo).toBe("seccion");
    if (result.tipo !== "seccion") return;
    expect(result.contenido).toContain("Un lead se considera duplicado");
  });

  it("suggests the 3 closest paths when the ruta does not exist", () => {
    const result = harness.read.execute({ ruta: "leadsviewer/validacion-formulari.md" });
    expect(result.tipo).toBe("ruta-no-encontrada");
    if (result.tipo !== "ruta-no-encontrada") return;
    expect(result.sugerencias).toHaveLength(3);
    expect(result.sugerencias[0]).toBe("leadsviewer/validacion-formulario.md");
  });

  it("lists available sections when the requested one does not exist", () => {
    const result = harness.read.execute({
      ruta: "leadsviewer/validacion-formulario.md",
      seccion: "seccion inventada",
    });
    expect(result.tipo).toBe("seccion-no-encontrada");
    if (result.tipo !== "seccion-no-encontrada") return;
    expect(result.seccionesDisponibles.length).toBeGreaterThan(0);
  });
});

describe("formatFrontmatter — conditional rendering of absent fields", () => {
  function baseMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
    return { ruta: "a.md", titulo: "A", resumen: "r", etiquetas: [], hash: "h", ...overrides };
  }

  it("renders all three lines when tipo/modulo/estado are present", () => {
    const salida = formatFrontmatter(baseMeta({ tipo: "guia", modulo: "auth", estado: "vigente" }));
    expect(salida).toContain("tipo: guia");
    expect(salida).toContain("modulo: auth");
    expect(salida).toContain("estado: vigente");
  });

  it("omits only the modulo line when modulo is absent", () => {
    const salida = formatFrontmatter(baseMeta({ tipo: "guia", estado: "vigente" }));
    expect(salida).toContain("tipo: guia");
    expect(salida).not.toContain("modulo:");
    expect(salida).toContain("estado: vigente");
  });

  it("omits tipo and estado when only modulo is present", () => {
    const salida = formatFrontmatter(baseMeta({ modulo: "auth" }));
    expect(salida).not.toContain("tipo:");
    expect(salida).toContain("modulo: auth");
    expect(salida).not.toContain("estado:");
  });

  it("omits all three lines when none of tipo/modulo/estado are present", () => {
    const salida = formatFrontmatter(baseMeta());
    expect(salida).not.toContain("tipo:");
    expect(salida).not.toContain("modulo:");
    expect(salida).not.toContain("estado:");
  });
});
