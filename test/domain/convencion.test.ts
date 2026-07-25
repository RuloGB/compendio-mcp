import { describe, expect, it } from "vitest";
import {
  crearComparadorIndice,
  crearConvencionPolicy,
  humanizarNombreArchivo,
  inferirModulo,
  type ConvencionConfig,
} from "../../src/domain/convencion";
import type { IndexEntry } from "../../src/domain/index-markdown";

const IDENTIDAD = { type: "tipo", module: "modulo", status: "estado" };

function cfgLibre(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "libre",
    excludedStatuses: [],
    camposFrontmatter: IDENTIDAD,
    ...overrides,
  };
}

function cfgEstricto(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "estricto",
    excludedStatuses: [],
    camposFrontmatter: IDENTIDAD,
    ...overrides,
  };
}

const BASE_INPUT = {
  path: "auth/login.md",
  title: "Iniciar sesion",
  summary: "Como iniciar sesion.",
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
  it("returns the first POSIX segment when path contains a slash", () => {
    expect(inferirModulo("auth/login.md")).toBe("auth");
  });

  it("returns undefined for a root-level path with no slash", () => {
    expect(inferirModulo("readme.md")).toBeUndefined();
  });
});

describe("crearConvencionPolicy — libre", () => {
  it("uses the H1 title when present", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.title).toBe("Iniciar sesion");
  });

  it("falls back to the humanized filename when there is no H1", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, title: "", data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.title).toBe("Login");
  });

  it("infers module from the first path segment under docsDir", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBe("auth");
  });

  it("leaves module absent for a root-level file", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, path: "readme.md", data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBeUndefined();
  });

  it("prefers frontmatter over folder inference for module", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: { modulo: "identity" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBe("identity");
  });

  it("never invents type or status when there is no signal", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBeUndefined();
    expect(result.meta.status).toBeUndefined();
  });

  it("treats empty-string module as absent and falls through to folder inference", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: { modulo: "" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBe("auth");
  });

  it("treats empty-string type and null status as absent, not as literal values", () => {
    const policy = crearConvencionPolicy(cfgLibre());
    const result = policy.resolver({ ...BASE_INPUT, data: { tipo: "", estado: null } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBeUndefined();
    expect(result.meta.status).toBeUndefined();
  });
});

describe("crearConvencionPolicy — estricto", () => {
  it("rejects a type value outside the declared taxonomy", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ types: ["guia"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "adr", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("'type' invalido");
  });

  it("validates type and status independently when only one taxonomy is declared", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ types: ["guia"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "guia", modulo: "auth", estado: "anything-non-empty" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("guia");
    expect(result.meta.status).toBe("anything-non-empty");
  });

  it("accepts any non-empty type when no taxonomy is declared", () => {
    const policy = crearConvencionPolicy(cfgEstricto());
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "anything", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("anything");
  });

  it("rejects a missing/empty type even when no taxonomy is declared", () => {
    const policy = crearConvencionPolicy(cfgEstricto());
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("obligatorio 'tipo'");
  });

  it("always validates module by presence only, regardless of type/status declarations", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ types: ["guia"], statuses: ["vigente"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { tipo: "guia", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("obligatorio 'modulo'");
  });

  it("skips a document with no H1 and does not fall back to filename humanization", () => {
    const policy = crearConvencionPolicy(cfgEstricto({ types: ["guia"], statuses: ["vigente"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      title: "",
      data: { tipo: "guia", modulo: "auth", estado: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("titulo H1");
  });
});

describe("crearConvencionPolicy — camposFrontmatter", () => {
  it("resolves type from a custom mapped field name", () => {
    const policy = crearConvencionPolicy(
      cfgLibre({ camposFrontmatter: { type: "type", module: "modulo", status: "estado" } }),
    );
    const result = policy.resolver({ ...BASE_INPUT, data: { type: "guide" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("guide");
  });

  it("leaves module/status at their identity mapping when only type is remapped", () => {
    const policy = crearConvencionPolicy(
      cfgLibre({ camposFrontmatter: { type: "type", module: "modulo", status: "estado" } }),
    );
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { type: "guide", modulo: "identity", estado: "vigente" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBe("identity");
    expect(result.meta.status).toBe("vigente");
  });

  it("resolves both fields from a shared source key with no collision error", () => {
    const policy = crearConvencionPolicy(
      cfgLibre({
        camposFrontmatter: { type: "clasificacion", module: "modulo", status: "clasificacion" },
      }),
    );
    const result = policy.resolver({ ...BASE_INPUT, data: { clasificacion: "guia-vigente" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("guia-vigente");
    expect(result.meta.status).toBe("guia-vigente");
  });
});

describe("crearComparadorIndice", () => {
  function entry(path: string, type: string): IndexEntry {
    return { path, title: "t", summary: "r", type: type as never, status: "vigente" as never };
  }

  it("defaults to alphabetical order by path", () => {
    const comparar = crearComparadorIndice(cfgLibre());
    const entries = [entry("b.md", "guia"), entry("a.md", "guia")];
    const sorted = [...entries].sort(comparar);
    expect(sorted.map((e) => e.path)).toEqual(["a.md", "b.md"]);
  });

  it("under estricto with declared types, sorts by declared order then alphabetically by path", () => {
    const comparar = crearComparadorIndice(cfgEstricto({ types: ["guia", "adr"] }));
    const entries = [entry("z.md", "adr"), entry("b.md", "guia"), entry("a.md", "guia")];
    const sorted = [...entries].sort(comparar);
    expect(sorted.map((e) => e.path)).toEqual(["a.md", "b.md", "z.md"]);
  });

  it("falls back to alphabetical order when estricto has no declared types", () => {
    const comparar = crearComparadorIndice(cfgEstricto());
    const entries = [entry("b.md", "guia"), entry("a.md", "adr")];
    const sorted = [...entries].sort(comparar);
    expect(sorted.map((e) => e.path)).toEqual(["a.md", "b.md"]);
  });
});
