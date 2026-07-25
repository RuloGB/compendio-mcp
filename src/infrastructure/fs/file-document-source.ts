import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoverResult, DocumentFile, DocumentSource, ReadError } from "../../domain/ports.js";

/**
 * Discovers .md files under the docs directory (recursively). Entries in
 * `exclude` match either the relative POSIX path or the basename. Hidden
 * directories are skipped. A file that fails to read (I/O error) is
 * collected into `readErrors` instead of aborting the whole walk.
 */
export class FileDocumentSource implements DocumentSource {
  constructor(
    private readonly docsDir: string,
    private readonly exclude: string[],
  ) {}

  async discover(): Promise<DiscoverResult> {
    const files: DocumentFile[] = [];
    const readErrors: ReadError[] = [];
    await this.walk(this.docsDir, "", files, readErrors);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, readErrors };
  }

  private async walk(
    dir: string,
    prefix: string,
    out: DocumentFile[],
    readErrors: ReadError[],
  ): Promise<void> {
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
      readErrors.push({ path: prefix, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await this.walk(join(dir, entry.name), path, out, readErrors);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      if (this.isExcluded(path, entry.name)) continue;
      try {
        out.push({ path, content: await readFile(join(dir, entry.name), "utf8") });
      } catch (error) {
        readErrors.push({ path, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private isExcluded(path: string, basename: string): boolean {
    return this.exclude.some((entry) => entry === path || entry === basename);
  }
}
