import { createHash } from "node:crypto";
import { validateFrontmatter } from "../domain/frontmatter.js";
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
 * so the result never lags behind the docs on disk. Documents with invalid
 * frontmatter are reported and skipped, mirroring the indexer.
 */
export class GenerateIndexMd {
  constructor(
    private readonly source: DocumentSource,
    private readonly parser: MarkdownParser,
    private readonly writer: IndexFileWriter,
  ) {}

  async execute(): Promise<IndexMdReport> {
    const files = await this.source.discover();
    const entries: IndexEntry[] = [];
    const omitidos: SkippedFileReport[] = [];

    for (const file of files) {
      // The index never lists itself, even if the config exclude was overridden.
      if (file.ruta === INDEX_FILE) continue;
      const parsed = this.parser.parse(file.contenido);
      const validation = validateFrontmatter({
        data: parsed.data,
        ruta: file.ruta,
        titulo: parsed.outline.titulo,
        resumen: parsed.outline.resumen,
        hash: createHash("sha256").update(file.contenido, "utf8").digest("hex"),
      });
      if (!validation.ok) {
        omitidos.push({ ruta: file.ruta, errores: validation.errores });
        continue;
      }
      entries.push(validation.meta);
    }

    const escrito = await this.writer.write(renderIndexMd(entries));
    return {
      ruta: escrito.ruta,
      cambiado: escrito.cambiado,
      documentos: entries.length,
      omitidos,
    };
  }
}
