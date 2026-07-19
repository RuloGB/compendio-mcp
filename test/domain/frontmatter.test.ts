import { describe, expect, it } from "vitest";
import { validateFrontmatter } from "../../src/domain/frontmatter";

const BASE = {
  ruta: "funcional/doc.md",
  titulo: "Un documento",
  resumen: "Resumen del documento.",
  hash: "abc123",
};

describe("validateFrontmatter", () => {
  it("accepts a document with valid required fields", () => {
    const result = validateFrontmatter({
      ...BASE,
      data: {
        tipo: "funcional",
        modulo: "leadsviewer",
        estado: "vigente",
        propietario: "BA",
        etiquetas: ["Lead", "validacion"],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.tipo).toBe("funcional");
    expect(result.meta.etiquetas).toEqual(["lead", "validacion"]);
  });

  it("normalizes a YAML date (gray-matter parses dates into Date objects)", () => {
    const result = validateFrontmatter({
      ...BASE,
      data: {
        tipo: "guia",
        modulo: "transversal",
        estado: "vigente",
        actualizado: new Date("2026-07-19T00:00:00Z"),
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.actualizado).toBe("2026-07-19");
  });

  it("rejects a document without tipo", () => {
    const result = validateFrontmatter({
      ...BASE,
      data: { modulo: "leadsviewer", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errores.join(" ")).toContain("'tipo'");
  });

  it("rejects values outside the allowed lists", () => {
    const result = validateFrontmatter({
      ...BASE,
      data: { tipo: "manual", modulo: "leadsviewer", estado: "publicado" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errores).toHaveLength(2);
  });

  it("rejects a document without H1 title", () => {
    const result = validateFrontmatter({
      ...BASE,
      titulo: "",
      data: { tipo: "funcional", modulo: "leadsviewer", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects etiquetas that are not a list of strings", () => {
    const result = validateFrontmatter({
      ...BASE,
      data: { tipo: "funcional", modulo: "leadsviewer", estado: "vigente", etiquetas: "lead" },
    });
    expect(result.ok).toBe(false);
  });
});
