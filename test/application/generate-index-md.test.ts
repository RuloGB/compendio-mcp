import { describe, expect, it } from "vitest";
import { GenerateIndexMd } from "../../src/application/generate-index-md";
import { crearComparadorIndice, crearConvencionPolicy, type ConvencionConfig } from "../../src/domain/convencion";
import type {
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  IndexFileWriter,
  IndexWriteResult,
  ReadError,
} from "../../src/domain/ports";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";

const LIBRE: ConvencionConfig = {
  modo: "libre",
  excludedStatuses: [],
  camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
};

function cfgEstricto(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "estricto",
    excludedStatuses: [],
    camposFrontmatter: { type: "tipo", module: "modulo", status: "estado" },
    ...overrides,
  };
}

class MemoryIndexWriter implements IndexFileWriter {
  content: string | null = null;
  async write(content: string): Promise<IndexWriteResult> {
    this.content = content;
    return { path: "docs/INDEX.md", cambiado: true };
  }
}

class StaticSource implements DocumentSource {
  constructor(
    private readonly files: DocumentFile[],
    private readonly erroresLectura: ReadError[] = [],
  ) {}
  async discover(): Promise<DiscoverResult> {
    return { files: this.files, erroresLectura: this.erroresLectura };
  }
}

const VALID_DOC: DocumentFile = {
  path: "guias/transversal-valida.md",
  content:
    "---\ntipo: guia\nmodulo: transversal\nestado: vigente\n---\n\n# Guía válida\n\nResumen de la guía.\n",
};

function buildUseCase(
  source: DocumentSource,
  convencion: ConvencionConfig = LIBRE,
): { useCase: GenerateIndexMd; writer: MemoryIndexWriter } {
  const writer = new MemoryIndexWriter();
  const policy = crearConvencionPolicy(convencion);
  const comparar = crearComparadorIndice(convencion);
  return {
    useCase: new GenerateIndexMd(source, new RemarkMarkdownParser(), writer, policy, comparar),
    writer,
  };
}

describe("GenerateIndexMd — libre mode over inline fixtures", () => {
  it("lists a frontmatter-less document, ordered alphabetically by path", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        { path: "b.md", content: "# Documento B\n\nResumen B.\n" },
        { path: "a.md", content: "# Documento A\n\nResumen A.\n" },
      ]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(2);
    expect(report.omitidos).toEqual([]);
    const lineas = writer.content!.split("\n").filter((l) => l.startsWith("- "));
    expect(lineas).toEqual(["- a.md — Resumen A.", "- b.md — Resumen B."]);
  });

  it("never lists INDEX.md itself, even when the source yields it", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([{ path: "INDEX.md", content: "# Índice viejo\n" }, VALID_DOC]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toEqual([]);
    expect(writer.content).not.toContain("] INDEX.md");
  });

  it("renders only the header for an empty corpus", async () => {
    const { useCase, writer } = buildUseCase(new StaticSource([]));
    const report = await useCase.execute();

    expect(report.documentos).toBe(0);
    expect(writer.content).toContain("# Índice de la documentación");
    expect(writer.content!.split("\n").some((l) => l.startsWith("- "))).toBe(false);
  });

  it("falls back to the title for a document with no paragraph at all", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        {
          path: "guias/transversal-sin-resumen.md",
          content: "# Solo título\n\n## Pasos\n\n- paso uno\n- paso dos\n",
        },
      ]),
    );
    await useCase.execute();

    expect(writer.content).toContain("— Solo título");
  });
});

describe("GenerateIndexMd — estricto mode over inline fixtures", () => {
  it("orders entries by declared types, tie-broken alphabetically by path", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        { path: "z.md", content: "---\ntipo: adr\nmodulo: m\nestado: vigente\n---\n\n# Z\n\nr\n" },
        { path: "b.md", content: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# B\n\nr\n" },
        { path: "a.md", content: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# A\n\nr\n" },
      ]),
      cfgEstricto({ types: ["guia", "adr"] }),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(3);
    const paths = writer.content!
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.split(" — ")[0]!.split("] ")[1]!);
    expect(paths).toEqual(["a.md", "b.md", "z.md"]);
  });

  it("skips and reports a document missing a declared taxonomy value", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        {
          path: "guias/type-invalido.md",
          content: "---\ntipo: no-declarado\nmodulo: m\nestado: vigente\n---\n\n# X\n\nr\n",
        },
      ]),
      cfgEstricto({ types: ["guia"] }),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.path).toBe("guias/type-invalido.md");
    expect(writer.content).toContain("guias/transversal-valida.md");
  });
});

describe("GenerateIndexMd — resilience (mode-independent)", () => {
  it("skips and reports a document with malformed YAML frontmatter, and continues", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        { path: "guias/frontmatter-roto.md", content: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.path).toBe("guias/frontmatter-roto.md");
    expect(report.omitidos[0]!.errores[0]!.length).toBeGreaterThan(0);
    expect(writer.content).toContain("guias/transversal-valida.md");
  });

  it("skips and reports a document with malformed frontmatter under estricto too", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        { path: "guias/frontmatter-roto.md", content: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
      cfgEstricto({ types: ["guia"] }),
    );
    const report = await useCase.execute();

    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.path).toBe("guias/frontmatter-roto.md");
    expect(writer.content).toContain("guias/transversal-valida.md");
  });

  it("folds an unreadable file (erroresLectura) into omitidos and continues", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([VALID_DOC], [{ path: "guias/ilegible.md", error: "permiso denegado" }]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toEqual([{ path: "guias/ilegible.md", errores: ["permiso denegado"] }]);
    expect(writer.content).toContain("guias/transversal-valida.md");
  });
});
