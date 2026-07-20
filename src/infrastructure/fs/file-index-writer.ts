import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndexFileWriter, IndexWriteResult } from "../../domain/ports.js";

/**
 * Writes the generated index into the docs directory, skipping the write when
 * the file already has exactly the generated content (keeps mtimes and VCS
 * status clean on no-op runs).
 */
export class FileIndexWriter implements IndexFileWriter {
  constructor(
    private readonly docsDir: string,
    private readonly fileName: string,
  ) {}

  async write(contenido: string): Promise<IndexWriteResult> {
    const ruta = join(this.docsDir, this.fileName);
    let existente: string | null = null;
    try {
      existente = await readFile(ruta, "utf8");
    } catch {
      // First generation: the file does not exist yet.
    }
    // git may materialize the file with CRLF (core.autocrlf on Windows); the
    // same content modulo EOL means up to date — rewriting would only churn
    // mtimes and report a phantom change.
    if (existente !== null && normalizeEol(existente) === contenido) {
      return { ruta, cambiado: false };
    }
    await writeFile(ruta, contenido, "utf8");
    return { ruta, cambiado: true };
  }
}

function normalizeEol(text: string): string {
  return text.replaceAll("\r\n", "\n");
}
