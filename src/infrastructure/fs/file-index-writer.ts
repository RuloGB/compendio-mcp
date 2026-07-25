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

  async write(content: string): Promise<IndexWriteResult> {
    const path = join(this.docsDir, this.fileName);
    let existing: string | null = null;
    try {
      existing = await readFile(path, "utf8");
    } catch {
      // First generation: the file does not exist yet.
    }
    // git may materialize the file with CRLF (core.autocrlf on Windows); the
    // same content modulo EOL means up to date — rewriting would only churn
    // mtimes and report a phantom change.
    if (existing !== null && normalizeEol(existing) === content) {
      return { path, changed: false };
    }
    await writeFile(path, content, "utf8");
    return { path, changed: true };
  }
}

function normalizeEol(text: string): string {
  return text.replaceAll("\r\n", "\n");
}
