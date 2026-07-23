import { describe, expect, it } from "vitest";
import {
  condenseResumen,
  formatDocLine,
  MAX_RESUMEN_CHARS,
  renderIndexMd,
  type IndexEntry,
} from "../../src/domain/index-markdown";

function entry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    ruta: "auth/doc.md",
    titulo: "Documento",
    resumen: "Resumen breve",
    tipo: "guia",
    estado: "vigente",
    ...overrides,
  };
}

function listedRutas(salida: string): string[] {
  return salida
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.split(" — ")[0]!.replace(/^- (\[[^\]]+\] )?/, ""));
}

describe("renderIndexMd", () => {
  it("defaults to alphabetical order by ruta with no comparator supplied", () => {
    const salida = renderIndexMd([entry({ ruta: "b.md" }), entry({ ruta: "a.md" })]);
    expect(listedRutas(salida)).toEqual(["a.md", "b.md"]);
  });

  it("uses an injected comparator when supplied", () => {
    const inverso = (a: IndexEntry, b: IndexEntry) => b.ruta.localeCompare(a.ruta);
    const salida = renderIndexMd([entry({ ruta: "a.md" }), entry({ ruta: "b.md" })], inverso);
    expect(listedRutas(salida)).toEqual(["b.md", "a.md"]);
  });

  it("collapses whitespace and truncates long summaries", () => {
    const salida = renderIndexMd([entry({ resumen: `linea\nrota   ${"x".repeat(200)}` })]);
    const linea = salida.split("\n").find((l) => l.startsWith("- "))!;
    const resumen = linea.split(" — ")[1]!.replace(/ \(vigente\)$/, "");
    expect(resumen).toContain("linea rota");
    expect(resumen).toHaveLength(MAX_RESUMEN_CHARS);
    expect(resumen.endsWith("…")).toBe(true);
  });

  it("falls back to the title when the summary is empty", () => {
    const salida = renderIndexMd([entry({ resumen: "  ", titulo: "Guía de despliegue" })]);
    expect(salida).toContain("- [guia] auth/doc.md — Guía de despliegue (vigente)");
  });

  it("renders only the header for an empty corpus", () => {
    const salida = renderIndexMd([]);
    expect(salida).toContain("# Índice de la documentación");
    expect(salida).not.toContain("- [");
    expect(salida.endsWith("\n")).toBe(true);
  });
});

describe("formatDocLine — omits absent tipo/estado segments", () => {
  it("omits both segments when tipo and estado are absent", () => {
    const linea = formatDocLine({ tipo: undefined, ruta: "a.md", resumen: "r", estado: undefined });
    expect(linea).toBe("- a.md — r");
    expect(linea).not.toContain("[");
    expect(linea).not.toContain("(");
    expect(linea).not.toContain("undefined");
  });

  it("includes tipo and omits estado when only tipo is present", () => {
    const linea = formatDocLine({ tipo: "guia", ruta: "a.md", resumen: "r", estado: undefined });
    expect(linea).toBe("- [guia] a.md — r");
    expect(linea).not.toContain("(");
  });

  it("includes estado and omits tipo when only estado is present", () => {
    const linea = formatDocLine({ tipo: undefined, ruta: "a.md", resumen: "r", estado: "vigente" });
    expect(linea).toBe("- a.md — r (vigente)");
    expect(linea).not.toContain("[");
  });

  it("includes both segments when both are present", () => {
    const linea = formatDocLine({ tipo: "guia", ruta: "a.md", resumen: "r", estado: "vigente" });
    expect(linea).toBe("- [guia] a.md — r (vigente)");
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

  it("keeps a summary exactly at the limit intact", () => {
    const exacto = "a".repeat(MAX_RESUMEN_CHARS);
    expect(condenseResumen(exacto)).toBe(exacto);
  });

  it("truncates one character over the limit", () => {
    const resultado = condenseResumen("a".repeat(MAX_RESUMEN_CHARS + 1));
    expect(resultado).toHaveLength(MAX_RESUMEN_CHARS);
    expect(resultado.endsWith("…")).toBe(true);
  });
});
