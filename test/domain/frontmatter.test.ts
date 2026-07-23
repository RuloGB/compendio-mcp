import { describe, expect, it } from "vitest";
import type { DocumentMeta } from "../../src/domain/model";
import {
  aplicarCamposOpcionales,
  isNonEmptyString,
  resolveEtiquetas,
} from "../../src/domain/frontmatter";

describe("isNonEmptyString", () => {
  it("accepts a non-empty string", () => {
    expect(isNonEmptyString("hola")).toBe(true);
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
  });
});

describe("resolveEtiquetas", () => {
  it("normalizes a list of strings: trimmed and lowercased", () => {
    const result = resolveEtiquetas({ etiquetas: ["Lead", " validacion  "] });
    expect(result.etiquetas).toEqual(["lead", "validacion"]);
    expect(result.error).toBeUndefined();
  });

  it("drops empty entries after trimming", () => {
    const result = resolveEtiquetas({ etiquetas: ["lead", "   "] });
    expect(result.etiquetas).toEqual(["lead"]);
  });

  it("returns an empty list when the field is absent", () => {
    expect(resolveEtiquetas({})).toEqual({ etiquetas: [] });
  });

  it("reports an error when etiquetas is not a list of strings", () => {
    const result = resolveEtiquetas({ etiquetas: "lead" });
    expect(result.etiquetas).toEqual([]);
    expect(result.error).toContain("lista de cadenas");
  });
});

describe("aplicarCamposOpcionales", () => {
  function baseMeta(): DocumentMeta {
    return { ruta: "a.md", titulo: "A", resumen: "R", etiquetas: [], hash: "h" };
  }

  it("attaches a trimmed propietario when present", () => {
    const meta = baseMeta();
    aplicarCamposOpcionales(meta, { propietario: " BA " });
    expect(meta.propietario).toBe("BA");
  });

  it("normalizes a YAML date (gray-matter parses dates into Date objects)", () => {
    const meta = baseMeta();
    aplicarCamposOpcionales(meta, { actualizado: new Date("2026-07-19T00:00:00Z") });
    expect(meta.actualizado).toBe("2026-07-19");
  });

  it("keeps a string actualizado trimmed as-is", () => {
    const meta = baseMeta();
    aplicarCamposOpcionales(meta, { actualizado: " 2026-07-19 " });
    expect(meta.actualizado).toBe("2026-07-19");
  });

  it("leaves both fields absent when neither is present", () => {
    const meta = baseMeta();
    aplicarCamposOpcionales(meta, {});
    expect(meta.propietario).toBeUndefined();
    expect(meta.actualizado).toBeUndefined();
  });
});
