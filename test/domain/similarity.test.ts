import { describe, expect, it } from "vitest";
import { closestMatches, levenshtein, normalize } from "../../src/domain/similarity";

describe("levenshtein", () => {
  it("measures edit distance", () => {
    expect(levenshtein("lead", "lead")).toBe(0);
    expect(levenshtein("lead", "leads")).toBe(1);
    expect(levenshtein("abc", "xyz")).toBe(3);
  });
});

describe("closestMatches", () => {
  it("returns the most similar paths first", () => {
    const candidates = [
      "funcional/leadsviewer-validacion-formulario.md",
      "adr/adr-0007-eleccion-base-datos.md",
      "guias/transversal-despliegue.md",
    ];
    const matches = closestMatches("funcional/leadsviewer-validacion.md", candidates, 3);
    expect(matches[0]).toBe("funcional/leadsviewer-validacion-formulario.md");
  });
});

describe("normalize", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalize("Validación de Teléfonos")).toBe("validacion de telefonos");
  });
});
