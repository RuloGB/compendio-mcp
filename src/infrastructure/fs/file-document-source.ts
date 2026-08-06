import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  EncodingNotice,
  ReadError,
} from "../../domain/ports.js";
import { decodeText } from "./decode-text.js";

/**
 * Discovers .md files under the docs directory (recursively). Entries in
 * `exclude` match either the relative POSIX path or the basename. Hidden
 * directories are skipped. A file that fails to read (I/O error), or whose
 * bytes are genuinely undecodable, is collected into `readErrors` instead of
 * aborting the whole walk. A file successfully decoded under a non-UTF-8
 * encoding is still indexed, and is additionally collected into
 * `encodingNotices` so the transcode is reported rather than silent.
 */
export class FileDocumentSource implements DocumentSource {
  constructor(
    private readonly docsDir: string,
    private readonly exclude: string[],
  ) {}

  async discover(): Promise<DiscoverResult> {
    const files: DocumentFile[] = [];
    const readErrors: ReadError[] = [];
    const encodingNotices: EncodingNotice[] = [];
    await this.walk(this.docsDir, "", files, readErrors, encodingNotices);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, readErrors, encodingNotices };
  }

  private async walk(
    dir: string,
    prefix: string,
    out: DocumentFile[],
    readErrors: ReadError[],
    encodingNotices: EncodingNotice[],
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
        await this.walk(join(dir, entry.name), path, out, readErrors, encodingNotices);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      if (this.isExcluded(path, entry.name)) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(join(dir, entry.name));
      } catch (error) {
        readErrors.push({ path, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const decoded = decodeText(bytes);
      if (!decoded.ok) {
        readErrors.push({ path, error: decoded.reason });
        continue;
      }
      if (decoded.encoding !== "utf-8") {
        encodingNotices.push({ path, encoding: decoded.encoding });
      }
      out.push({ path, content: decoded.content });
    }
  }

  private isExcluded(path: string, basename: string): boolean {
    return this.exclude.some((entry) => entry === path || entry === basename);
  }
}
