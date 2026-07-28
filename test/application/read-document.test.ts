import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatFrontmatter } from "../../src/application/read-document";
import type { DocumentMeta } from "../../src/domain/model";
import { buildHarness, type TestHarness } from "../helpers/build";
import { FakeEmbeddings } from "../helpers/fake-embeddings";

// es-frozen: cites the real `ejemplos/` corpus name, not a leftover translation.
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
    const result = harness.read.execute({ path: "leadsviewer/validacion-formulario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.content.startsWith("# Validación del formulario de alta de leads")).toBe(true);
    expect(result.content).toContain("## Reglas de negocio");
    // Zero-config document (no frontmatter): module comes from folder inference.
    expect(result.meta.module).toBe("leadsviewer");
  });

  // es-frozen: "glosario.md"/"Glosario" are the real frozen `ejemplos/` corpus
  // filename and its real H1, not a leftover translation.
  it("does not duplicate the H1 of documents indexed as a single chunk", () => {
    const result = harness.read.execute({ path: "glosario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.content.match(/^# Glosario/gm)).toHaveLength(1);
  });

  it("finds a section by partial, accent-insensitive heading", () => {
    const result = harness.read.execute({
      path: "leadsviewer/validacion-formulario.md",
      section: "reglas de duplicidad",
    });
    expect(result.type).toBe("section");
    if (result.type !== "section") return;
    expect(result.content).toContain("Un lead se considera duplicado");
  });

  it("tolerates a leading docs-dir segment on the path", () => {
    // A caller that just saw the file on disk holds "docs/leadsviewer/x.md",
    // while indexed paths are docs-relative. Both name one document, and
    // rejecting the first costs a failed call per read.
    const result = harness.read.execute({ path: "docs/leadsviewer/validacion-formulario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.meta.path).toBe("leadsviewer/validacion-formulario.md");
  });

  it("prefers a real document over stripping a segment off the request", () => {
    // Stripping must never shadow an exact hit: only a miss triggers the retry.
    const result = harness.read.execute({ path: "leadsviewer/validacion-formulario.md" });
    expect(result.type).toBe("document");
    if (result.type !== "document") return;
    expect(result.meta.path).toBe("leadsviewer/validacion-formulario.md");
  });

  it("still reports a genuinely unknown path after the prefix retry", () => {
    const result = harness.read.execute({ path: "docs/no/existe.md" });
    expect(result.type).toBe("path-not-found");
  });

  it("suggests the 3 closest paths when the path does not exist", () => {
    const result = harness.read.execute({ path: "leadsviewer/validacion-formulari.md" });
    expect(result.type).toBe("path-not-found");
    if (result.type !== "path-not-found") return;
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toBe("leadsviewer/validacion-formulario.md");
  });

  it("lists available sections when the requested one does not exist", () => {
    const result = harness.read.execute({
      path: "leadsviewer/validacion-formulario.md",
      section: "made-up section",
    });
    expect(result.type).toBe("section-not-found");
    if (result.type !== "section-not-found") return;
    expect(result.availableSections.length).toBeGreaterThan(0);
  });
});

describe("formatFrontmatter — conditional rendering of absent fields", () => {
  function baseMeta(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
    return { path: "a.md", title: "A", summary: "r", tags: [], hash: "h", ...overrides };
  }

  it("renders all three lines when type/module/status are present", () => {
    const salida = formatFrontmatter(baseMeta({ type: "guia", module: "auth", status: "vigente" }));
    expect(salida).toContain("type: guia");
    expect(salida).toContain("module: auth");
    expect(salida).toContain("status: vigente");
  });

  it("omits only the module line when module is absent", () => {
    const salida = formatFrontmatter(baseMeta({ type: "guia", status: "vigente" }));
    expect(salida).toContain("type: guia");
    expect(salida).not.toContain("module:");
    expect(salida).toContain("status: vigente");
  });

  it("omits type and status when only module is present", () => {
    const salida = formatFrontmatter(baseMeta({ module: "auth" }));
    expect(salida).not.toContain("type:");
    expect(salida).toContain("module: auth");
    expect(salida).not.toContain("status:");
  });

  it("omits all three lines when none of type/module/status are present", () => {
    const salida = formatFrontmatter(baseMeta());
    expect(salida).not.toContain("type:");
    expect(salida).not.toContain("module:");
    expect(salida).not.toContain("status:");
  });
});
