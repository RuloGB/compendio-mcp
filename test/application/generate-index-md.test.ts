import { describe, expect, it } from "vitest";
import { GenerateIndexMd } from "../../src/application/generate-index-md";
import type {
  DocumentFile,
  DocumentSource,
  IndexFileWriter,
  IndexWriteResult,
} from "../../src/domain/ports";
import { FileDocumentSource } from "../../src/infrastructure/fs/file-document-source";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";
import { EJEMPLOS_DOCS } from "../helpers/build";

class MemoryIndexWriter implements IndexFileWriter {
  contenido: string | null = null;
  async write(contenido: string): Promise<IndexWriteResult> {
    this.contenido = contenido;
    return { ruta: "docs/INDEX.md", cambiado: true };
  }
}

class StaticSource implements DocumentSource {
  constructor(private readonly files: DocumentFile[]) {}
  async discover(): Promise<DocumentFile[]> {
    return this.files;
  }
}

const VALID_DOC: DocumentFile = {
  ruta: "guias/transversal-valida.md",
  contenido:
    "---\ntipo: guia\nmodulo: transversal\nestado: vigente\n---\n\n# Guía válida\n\nResumen de la guía.\n",
};

function buildUseCase(source: DocumentSource): { useCase: GenerateIndexMd; writer: MemoryIndexWriter } {
  const writer = new MemoryIndexWriter();
  return { useCase: new GenerateIndexMd(source, new RemarkMarkdownParser(), writer), writer };
}

describe("GenerateIndexMd over the ejemplos corpus", () => {
  it("lists every valid document, glossary first", async () => {
    const { useCase, writer } = buildUseCase(new FileDocumentSource(EJEMPLOS_DOCS, ["INDEX.md"]));
    const report = await useCase.execute();

    expect(report.documentos).toBe(11);
    expect(report.omitidos).toEqual([]);
    expect(report.cambiado).toBe(true);

    const lineas = writer.contenido!.split("\n").filter((l) => l.startsWith("- ["));
    expect(lineas).toHaveLength(11);
    expect(lineas[0]).toContain("[guia] glosario.md");
    expect(writer.contenido).not.toContain("] INDEX.md");
  });
});

describe("GenerateIndexMd with problem documents", () => {
  it("skips and reports documents with invalid frontmatter", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        VALID_DOC,
        { ruta: "guias/sin-frontmatter.md", contenido: "# Sin frontmatter\n\nTexto suelto.\n" },
      ]),
    );
    const report = await useCase.execute();

    expect(report.documentos).toBe(1);
    expect(report.omitidos).toHaveLength(1);
    expect(report.omitidos[0]!.ruta).toBe("guias/sin-frontmatter.md");
    expect(writer.contenido).toContain("guias/transversal-valida.md");
    expect(writer.contenido).not.toContain("sin-frontmatter");
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
    expect(writer.contenido).not.toContain("- [");
  });

  it("falls back to the title for a document with no paragraph at all", async () => {
    const { useCase, writer } = buildUseCase(
      new StaticSource([
        {
          ruta: "guias/transversal-sin-resumen.md",
          contenido:
            "---\ntipo: guia\nmodulo: transversal\nestado: vigente\n---\n\n# Solo título\n\n## Pasos\n\n- paso uno\n- paso dos\n",
        },
      ]),
    );
    await useCase.execute();

    expect(writer.contenido).toContain("— Solo título (vigente)");
  });
});
