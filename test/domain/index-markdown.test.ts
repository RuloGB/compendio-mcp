import { describe, expect, it } from "vitest";
import {
  condenseResumen,
  MAX_RESUMEN_CHARS,
  renderIndexMd,
  type IndexEntry,
} from "../../src/domain/index-markdown";

function entry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    ruta: "funcional/doc.md",
    titulo: "Documento",
    resumen: "Resumen breve",
    tipo: "funcional",
    estado: "vigente",
    ...overrides,
  };
}

function listedRutas(salida: string): string[] {
  return salida
    .split("\n")
    .filter((line) => line.startsWith("- ["))
    .map((line) => line.split(" — ")[0]!.split("] ")[1]!);
}

describe("renderIndexMd", () => {
  it("renders the convention line format under the title", () => {
    const salida = renderIndexMd([entry({})]);
    expect(salida).toContain("# Índice de la documentación");
    expect(salida).toContain("Generado con");
    expect(salida).toContain("- [funcional] funcional/doc.md — Resumen breve (vigente)");
    expect(salida.endsWith("\n")).toBe(true);
  });

  it("orders root documents first, then by tipo in convention order, then by ruta", () => {
    const salida = renderIndexMd([
      entry({ ruta: "qa/plan.md", tipo: "qa" }),
      entry({ ruta: "adr/adr-0007-postgres.md", tipo: "adr" }),
      entry({ ruta: "glosario.md", tipo: "guia" }),
      entry({ ruta: "adr/adr-0001-mongodb.md", tipo: "adr", estado: "obsoleto" }),
      entry({ ruta: "funcional/alta.md", tipo: "funcional" }),
    ]);
    expect(listedRutas(salida)).toEqual([
      "glosario.md",
      "funcional/alta.md",
      "adr/adr-0001-mongodb.md",
      "adr/adr-0007-postgres.md",
      "qa/plan.md",
    ]);
  });

  it("collapses whitespace and truncates long summaries", () => {
    const salida = renderIndexMd([entry({ resumen: `linea\nrota   ${"x".repeat(200)}` })]);
    const linea = salida.split("\n").find((l) => l.startsWith("- ["))!;
    const resumen = linea.split(" — ")[1]!.replace(/ \(vigente\)$/, "");
    expect(resumen).toContain("linea rota");
    expect(resumen).toHaveLength(MAX_RESUMEN_CHARS);
    expect(resumen.endsWith("…")).toBe(true);
  });

  it("falls back to the title when the summary is empty", () => {
    const salida = renderIndexMd([entry({ resumen: "  ", titulo: "Guía de despliegue" })]);
    expect(salida).toContain("- [funcional] funcional/doc.md — Guía de despliegue (vigente)");
  });

  it("renders only the header for an empty corpus", () => {
    const salida = renderIndexMd([]);
    expect(salida).toContain("# Índice de la documentación");
    expect(salida).not.toContain("- [");
    expect(salida.endsWith("\n")).toBe(true);
  });
});

describe("condenseResumen", () => {
  it("keeps short texts intact after collapsing whitespace", () => {
    expect(condenseResumen("  hola \n mundo  ")).toBe("hola mundo");
  });

  it("truncates with an ellipsis at the limit", () => {
    const largo = condenseResumen("a".repeat(500));
    expect(largo).toHaveLength(MAX_RESUMEN_CHARS);
    expect(largo.endsWith("…")).toBe(true);
  });
});
