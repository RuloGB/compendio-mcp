import { describe, expect, it } from "vitest";
import {
  crearComparadorIndice,
  crearConvencionPolicy,
  humanizarNombreArchivo,
  inferirModulo,
  type ConvencionConfig,
} from "../../src/domain/convencion";
import type { IndexEntry } from "../../src/domain/index-markdown";

const IDENTIDAD = { tipo: "tipo", modulo: "modulo", estado: "estado" };

function cfgLibre(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "libre",
    estadosExcluidos: [],
    camposFrontmatter: IDENTIDAD,
    ...overrides,
  };
}

function cfgEstricto(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "estricto",
    estadosExcluidos: [],
    camposFrontmatter: IDENTIDAD,
    ...overrides,
  };
}

const BASE_INPUT = {
  ruta: "auth/login.md",
  titulo: "Iniciar sesion",
  resumen: "Como iniciar sesion.",
  hash: "abc123",
};

describe("humanizarNombreArchivo", () => {
  it("strips .md, replaces separators, collapses whitespace, sentence-cases the first letter", () => {
    expect(humanizarNombreArchivo("docs/mi-guia_de-uso.md")).toBe("Mi guia de uso");
  });

  it("handles a root-level filename with no directory segment", () => {
    expect(humanizarNombreArchivo("readme.md")).toBe("Readme");
  });
});

describe("inferirModulo", () => {
  it("returns the first POSIX segment when ruta contains a slash", () => {
    expect(inferirModulo("auth/login.md")).toBe("auth");
  });

  it("returns undefined for a root-level ruta with no slash", () => {
    expect(inferirModulo("readme.md")).toBeUndefined();
  });
});

describe("crearConvencionPolicy — libre", () => {
  it("uses the H1 title when present", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.titulo).toBe("Iniciar sesion");
  });

  it("falls back to the humanized filename when there is no H1", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, titulo: "", data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.titulo).toBe("Login");
  });

  it("infers modulo from the first path segment under docsDir", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.modulo).toBe("auth");
  });

  it("leaves modulo absent for a root-level file", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, ruta: "readme.md", data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.modulo).toBeUndefined();
  });

  it("prefers frontmatter over folder inference for modulo", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: { modulo: "identity" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.modulo).toBe("identity");
  });

  it("never invents tipo or estado when there is no signal", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.tipo).toBeUndefined();
    expect(result.meta.estado).toBeUndefined();
  });

  it("treats empty-string modulo as absent and falls through to folder inference", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: { modulo: "" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.modulo).toBe("auth");
  });

  it("treats empty-string tipo and null estado as absent, not as literal values", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: { tipo: "", estado: null } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.tipo).toBeUndefined();
    expect(result.meta.estado).toBeUndefined();
  });
});

describe("crearConvencionPolicy — estricto", () => {
  it("rejects a tipo value outside the declared taxonomy", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ tipos: ["guia"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "adr", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errores.join(" ")).toContain("'tipo' invalido");
  });

  it("validates tipo and estado independently when only one taxonomy is declared", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ tipos: ["guia"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "guia", modulo: "auth", estado: "anything-non-empty" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.tipo).toBe("guia");
    expect(result.meta.estado).toBe("anything-non-empty");
  });

  it("accepts any non-empty tipo when no taxonomy is declared", () => {
    const policy = crearConvencionPolicy(cfgEstricto());
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "anything", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.tipo).toBe("anything");
  });

  it("rejects a missing/empty tipo even when no taxonomy is declared", () => {
    const policy = crearConvencionPolicy(cfgEstricto());
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errores.join(" ")).toContain("obligatorio 'tipo'");
  });

  it("always validates modulo by presence only, regardless of tipo/estado declarations", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ tipos: ["guia"], estados: ["vigente"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "guia", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errores.join(" ")).toContain("obligatorio 'modulo'");
  });

  it("skips a document with no H1 and does not fall back to filename humanization", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ tipos: ["guia"], estados: ["vigente"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      titulo: "",
      data: { tipo: "guia", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errores.join(" ")).toContain("titulo H1");
  });
});

describe("crearConvencionPolicy — camposFrontmatter", () => {
  it("resolves tipo from a custom mapped field name", () => {
    const policy = crearConvencionPolicy(
      cfgLibre({ camposFrontmatter: { tipo: "type", modulo: "modulo", estado: "estado" } }),
    );
    const result = policy.resolver({ ...BASE_INPUT, data: { type: "guide" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.tipo).toBe("guide");
  });

  it("leaves modulo/estado at their identity mapping when only tipo is remapped", () => {
    const policy = crearConvencionPolicy(
      cfgLibre({ camposFrontmatter: { tipo: "type", modulo: "modulo", estado: "estado" } }),
    );
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { type: "guide", modulo: "identity", estado: "vigente" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.modulo).toBe("identity");
    expect(result.meta.estado).toBe("vigente");
  });

  it("resolves both fields from a shared source key with no collision error", () => {
    const policy = crearConvencionPolicy(
      cfgLibre({
        camposFrontmatter: { tipo: "clasificacion", modulo: "modulo", estado: "clasificacion" },
      }),
    );
    const result = policy.resolver({ ...BASE_INPUT, data: { clasificacion: "guia-vigente" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.tipo).toBe("guia-vigente");
    expect(result.meta.estado).toBe("guia-vigente");
  });
});

describe("crearComparadorIndice", () => {
  function entry(ruta: string, tipo: string): IndexEntry {
    return { ruta, titulo: "t", resumen: "r", tipo: tipo as never, estado: "vigente" as never };
  }

  it("defaults to alphabetical order by ruta", () => {
    const comparar = crearComparadorIndice(cfgLibre());
    const entries = [entry("b.md", "guia"), entry("a.md", "guia")];
    const sorted = [...entries].sort(comparar);
    expect(sorted.map((e) => e.ruta)).toEqual(["a.md", "b.md"]);
  });

  it("under estricto with declared tipos, sorts by declared order then alphabetically by ruta", () => {
    const comparar = crearComparadorIndice(cfgEstricto({ tipos: ["guia", "adr"] }));
    const entries = [entry("z.md", "adr"), entry("b.md", "guia"), entry("a.md", "guia")];
    const sorted = [...entries].sort(comparar);
    expect(sorted.map((e) => e.ruta)).toEqual(["a.md", "b.md", "z.md"]);
  });

  it("falls back to alphabetical order when estricto has no declared tipos", () => {
    const comparar = crearComparadorIndice(cfgEstricto());
    const entries = [entry("b.md", "guia"), entry("a.md", "adr")];
    const sorted = [...entries].sort(comparar);
    expect(sorted.map((e) => e.ruta)).toEqual(["a.md", "b.md"]);
  });
});
