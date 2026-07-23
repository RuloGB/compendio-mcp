import { createHash } from "node:crypto";
import type { ConvencionPolicy } from "../domain/convencion.js";
import { INDEX_FILE, renderIndexMd, type IndexEntry } from "../domain/index-markdown.js";
import type { DocumentSource, IndexFileWriter, MarkdownParser } from "../domain/ports.js";
import type { SkippedFileReport } from "./index-documents.js";

export interface IndexMdReport {
  /** Path of the index file, as resolved by the writer. */
  ruta: string;
  /** False when INDEX.md already had the generated content. */
  cambiado: boolean;
  /** Documents listed in the index. */
  documentos: number;
  omitidos: SkippedFileReport[];
}

/**
 * Generates (or updates) the corpus INDEX.md from each document's frontmatter
 * and summary, reading the filesystem directly: no database index required,
 * so the result never lags behind the docs on disk. Applies the same
 * skip-and-report resilience guarantees as `IndexDocuments` (unreadable /
 * unparseable files), mirroring the indexer.
 */
export class GenerateIndexMd {
  constructor(
    private readonly source: DocumentSource,
    private readonly parser: MarkdownParser,
    private readonly writer: IndexFileWriter,
    private readonly policy: ConvencionPolicy,
    private readonly comparar: (a: IndexEntry, b: IndexEntry) => number,
  ) {}

  async execute(): Promise<IndexMdReport> {
    const { files, erroresLectura } = await this.source.discover();
    const entries: IndexEntry[] = [];
    const omitidos: SkippedFileReport[] = erroresLectura
      .filter((e) => e.ruta !== INDEX_FILE)
      .map((e) => ({ ruta: e.ruta, errores: [e.error] }));

    for (const file of files) {
      // The index never lists itself, even if the config exclude was overridden.
      if (file.ruta === INDEX_FILE) continue;

      let parsed;
      try {
        parsed = this.parser.parse(file.contenido);
      } catch (error) {
        omitidos.push({ ruta: file.ruta, errores: [describeError(error)] });
        continue;
      }

      const resolution = this.policy.resolver({
        data: parsed.data,
        ruta: file.ruta,
        titulo: parsed.outline.titulo,
        resumen: parsed.outline.resumen,
        hash: createHash("sha256").update(file.contenido, "utf8").digest("hex"),
      });
      if (!resolution.ok) {
        omitidos.push({ ruta: file.ruta, errores: resolution.errores });
        continue;
      }
      entries.push(resolution.meta);
    }

    const escrito = await this.writer.write(renderIndexMd(entries, this.comparar));
    return {
      ruta: escrito.ruta,
      cambiado: escrito.cambiado,
      documentos: entries.length,
      omitidos,
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
