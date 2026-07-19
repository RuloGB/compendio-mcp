import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentFile, DocumentSource } from "../../domain/ports.js";

/**
 * Discovers .md files under the docs directory (recursively). Entries in
 * `exclude` match either the relative POSIX path or the basename. Hidden
 * directories are skipped.
 */
export class FileDocumentSource implements DocumentSource {
  constructor(
    private readonly docsDir: string,
    private readonly exclude: string[],
  ) {}

  async discover(): Promise<DocumentFile[]> {
    const files: DocumentFile[] = [];
    await this.walk(this.docsDir, "", files);
    files.sort((a, b) => a.ruta.localeCompare(b.ruta));
    return files;
  }

  private async walk(dir: string, prefix: string, out: DocumentFile[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (prefix === "") {
        throw new Error(
          `no se puede leer el directorio de documentacion "${this.docsDir}": ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const ruta = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await this.walk(join(dir, entry.name), ruta, out);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      if (this.isExcluded(ruta, entry.name)) continue;
      out.push({ ruta, contenido: await readFile(join(dir, entry.name), "utf8") });
    }
  }

  private isExcluded(ruta: string, basename: string): boolean {
    return this.exclude.some((entry) => entry === ruta || entry === basename);
  }
}
