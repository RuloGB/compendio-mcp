import { describe, expect, it } from "vitest";
import {
  createIndexComparator,
  createConventionPolicy,
  humanizeFileName,
  inferModule,
  type ConventionConfig,
} from "../../src/domain/convention";
import type { IndexEntry } from "../../src/domain/index-markdown";

const IDENTIDAD = { type: "type", module: "module", status: "status" };

function cfgLoose(overrides: Partial<ConventionConfig> = {}): ConventionConfig {
  return {
    mode: "loose",
    excludedStatuses: [],
    frontmatterFields: IDENTIDAD,
    ...overrides,
  };
}

function cfgStrict(overrides: Partial<ConventionConfig> = {}): ConventionConfig {
  return {
    mode: "strict",
    excludedStatuses: [],
    frontmatterFields: IDENTIDAD,
    ...overrides,
  };
}

const BASE_INPUT = {
  path: "auth/login.md",
  title: "Iniciar sesion",
  summary: "Como iniciar sesion.",
  hash: "abc123",
};

describe("humanizeFileName", () => {
  it("strips .md, replaces separators, collapses whitespace, sentence-cases the first letter", () => {
    expect(humanizeFileName("docs/mi-guia_de-uso.md")).toBe("Mi guia de uso");
  });

  it("handles a root-level filename with no directory segment", () => {
    expect(humanizeFileName("readme.md")).toBe("Readme");
  });
});

describe("inferModule", () => {
  it("returns the first POSIX segment when path contains a slash", () => {
    expect(inferModule("auth/login.md")).toBe("auth");
  });

  it("returns undefined for a root-level path with no slash", () => {
    expect(inferModule("readme.md")).toBeUndefined();
  });
});

describe("createConventionPolicy — loose", () => {
  it("uses the H1 title when present", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.title).toBe("Iniciar sesion");
  });

  it("falls back to the humanized filename when there is no H1", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, title: "", data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.title).toBe("Login");
  });

  it("infers module from the first path segment under docsDir", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBe("auth");
  });

  it("leaves module absent for a root-level file", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, path: "readme.md", data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBeUndefined();
  });

  it("prefers frontmatter over folder inference for module", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, data: { module: "identity" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBe("identity");
  });

  it("never invents type or status when there is no signal", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, data: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBeUndefined();
    expect(result.meta.status).toBeUndefined();
  });

  it("treats empty-string module as absent and falls through to folder inference", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, data: { module: "" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.module).toBe("auth");
  });

  it("treats empty-string type and null status as absent, not as literal values", () => {
    const policy = createConventionPolicy(cfgLoose());
    const result = policy.resolver({ ...BASE_INPUT, data: { type: "", status: null } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBeUndefined();
    expect(result.meta.status).toBeUndefined();
  });
});

describe("createConventionPolicy — strict", () => {
  it("rejects a type value outside the declared taxonomy", () => {
    const policy = createConventionPolicy(cfgStrict({ types: ["guia"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { type: "adr", module: "auth", status: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("invalid 'type'");
  });

  it("validates type and status independently when only one taxonomy is declared", () => {
    const policy = createConventionPolicy(cfgStrict({ types: ["guia"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { type: "guia", module: "auth", status: "anything-non-empty" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("guia");
    expect(result.meta.status).toBe("anything-non-empty");
  });

  it("accepts any non-empty type when no taxonomy is declared", () => {
    const policy = createConventionPolicy(cfgStrict());
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { type: "anything", module: "auth", status: "vigente" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("anything");
  });

  it("rejects a missing/empty type even when no taxonomy is declared", () => {
    const policy = createConventionPolicy(cfgStrict());
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { type: "", module: "auth", status: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("required field 'type'");
  });

  it("always validates module by presence only, regardless of type/status declarations", () => {
    const policy = createConventionPolicy(cfgStrict({ types: ["guia"], statuses: ["vigente"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      data: { type: "guia", status: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("required field 'module'");
  });

  it("skips a document with no H1 and does not fall back to filename humanization", () => {
    const policy = createConventionPolicy(cfgStrict({ types: ["guia"], statuses: ["vigente"] }));
    const result = policy.resolver({
      ...BASE_INPUT,
      title: "",
      data: { type: "guia", module: "auth", status: "vigente" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("no H1 title");
  });
});

describe("createConventionPolicy — frontmatterFields", () => {
  it("resolves type from a custom mapped field name", () => {
    const policy = createConventionPolicy(
      cfgLoose({ frontmatterFields: { type: "type", module: "modulo", status: "estado" } }),
    );
    const result = policy.resolver({ ...BASE_INPUT, data: { type: "guide" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("guide");
  });

  it("leaves module/status at their identity mapping when only type is remapped", () => {
    const policy = createConventionPolicy(
      cfgLoose({ frontmatterFields: { type: "type", module: "modulo", status: "estado" } }),
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
    const policy = createConventionPolicy(
      cfgLoose({
        frontmatterFields: { type: "clasificacion", module: "modulo", status: "clasificacion" },
      }),
    );
    const result = policy.resolver({ ...BASE_INPUT, data: { clasificacion: "guia-vigente" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.type).toBe("guia-vigente");
    expect(result.meta.status).toBe("guia-vigente");
  });
});

describe("createIndexComparator", () => {
  function entry(path: string, type: string): IndexEntry {
    return { path, title: "t", summary: "r", type: type as never, status: "vigente" as never };
  }

  it("defaults to alphabetical order by path", () => {
    const compare = createIndexComparator(cfgLoose());
    const entries = [entry("b.md", "guia"), entry("a.md", "guia")];
    const sorted = [...entries].sort(compare);
    expect(sorted.map((e) => e.path)).toEqual(["a.md", "b.md"]);
  });

  it("under strict with declared types, sorts by declared order then alphabetically by path", () => {
    const compare = createIndexComparator(cfgStrict({ types: ["guia", "adr"] }));
    const entries = [entry("z.md", "adr"), entry("b.md", "guia"), entry("a.md", "guia")];
    const sorted = [...entries].sort(compare);
    expect(sorted.map((e) => e.path)).toEqual(["a.md", "b.md", "z.md"]);
  });

  it("falls back to alphabetical order when strict has no declared types", () => {
    const compare = createIndexComparator(cfgStrict());
    const entries = [entry("b.md", "guia"), entry("a.md", "adr")];
    const sorted = [...entries].sort(compare);
    expect(sorted.map((e) => e.path)).toEqual(["a.md", "b.md"]);
  });
});
