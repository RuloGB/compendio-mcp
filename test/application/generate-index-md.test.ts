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
  estadosExcluidos: [],
  camposFrontmatter: { tipo: "tipo", modulo: "modulo", estado: "estado" },
};

function cfgEstricto(overrides: Partial<ConvencionConfig> = {}): ConvencionConfig {
  return {
    modo: "estricto",
    estadosExcluidos: [],
    camposFrontmatter: { tipo: "tipo", modulo: "modulo", estado: "estado" },
    ...overrides,
  };
}

class MemoryIndexWriter implements IndexFileWriter {
  contenido: string | null = null;
  async write(contenido: string): Promise<IndexWriteResult> {
    this.contenido = contenido;
    return { ruta: "docs/INDEX.md", cambiado: true };
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
  ruta: "guias/transversal-valida.md",
  contenido:
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
  it("lists a frontmatter-less document, ordered alphabetically by ruta", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        { ruta: "b.md", contenido: "# Documento B\n\nResumen B.\n" },
        { ruta: "a.md", contenido: "# Documento A\n\nResumen A.\n" },
      ]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(2);
    expect(report.omitidos).toEqual([]);
    const lineas = writer.contenido!.split("\n").filter((l) => l.startsWith("- "));
    expect(lineas).toEqual(["- a.md — Resumen A.", "- b.md — Resumen B."]);
  });

  it("never lists INDEX.md itself, even when the source yields it", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([{ ruta: "INDEX.md", contenido: "# Índice viejo\n" }, VALID_DOC]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toEqual([]);
    expect(writer.contenido).not.toContain("] INDEX.md");
  });

  it("renders only the header for an empty corpus", async () => {
    const { useCase, writer } = buildUseCase(new StaticSource([]));
    const report = await useCase.execute();

    expect(report.documentos).toBe(0);
    expect(writer.contenido).toContain("# Índice de la documentación");
    expect(writer.contenido!.split("\n").some((l) => l.startsWith("- "))).toBe(false);
  });

  it("falls back to the title for a document with no paragraph at all", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        {
          ruta: "guias/transversal-sin-resumen.md",
          contenido: "# Solo título\n\n## Pasos\n\n- paso uno\n- paso dos\n",
        },
      ]),
    );
    await useCase.execute();

    expect(writer.contenido).toContain("— Solo título");
  });
});

describe("GenerateIndexMd — estricto mode over inline fixtures", () => {
  it("orders entries by declared tipos, tie-broken alphabetically by ruta", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        { ruta: "z.md", contenido: "---\ntipo: adr\nmodulo: m\nestado: vigente\n---\n\n# Z\n\nr\n" },
        { ruta: "b.md", contenido: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# B\n\nr\n" },
        { ruta: "a.md", contenido: "---\ntipo: guia\nmodulo: m\nestado: vigente\n---\n\n# A\n\nr\n" },
      ]),
      cfgEstricto({ tipos: ["guia", "adr"] }),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(3);
    const rutas = writer.contenido!
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.split(" — ")[0]!.split("] ")[1]!);
    expect(rutas).toEqual(["a.md", "b.md", "z.md"]);
  });

  it("skips and reports a document missing a declared taxonomy value", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        {
          ruta: "guias/tipo-invalido.md",
          contenido: "---\ntipo: no-declarado\nmodulo: m\nestado: vigente\n---\n\n# X\n\nr\n",
        },
      ]),
      cfgEstricto({ tipos: ["guia"] }),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.ruta).toBe("guias/tipo-invalido.md");
    expect(writer.contenido).toContain("guias/transversal-valida.md");
  });
});

describe("GenerateIndexMd — resilience (mode-independent)", () => {
  it("skips and reports a document with malformed YAML frontmatter, and continues", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        { ruta: "guias/frontmatter-roto.md", contenido: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.ruta).toBe("guias/frontmatter-roto.md");
    expect(report.omitidos[0]!.errores[0]!.length).toBeGreaterThan(0);
    expect(writer.contenido).toContain("guias/transversal-valida.md");
  });

  it("skips and reports a document with malformed frontmatter under estricto too", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        { ruta: "guias/frontmatter-roto.md", contenido: "---\ntipo: [sin-cerrar\n---\n\n# X\n" },
      ]),
      cfgEstricto({ tipos: ["guia"] }),
    );
    const report = await useCase.execute();

    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.ruta).toBe("guias/frontmatter-roto.md");
    expect(writer.contenido).toContain("guias/transversal-valida.md");
  });

  it("folds an unreadable file (erroresLectura) into omitidos and continues", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([VALID_DOC], [{ ruta: "guias/ilegible.md", error: "permiso denegado" }]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toEqual([{ ruta: "guias/ilegible.md", errores: ["permiso denegado"] }]);
    expect(writer.contenido).toContain("guias/transversal-valida.md");
  });
});
