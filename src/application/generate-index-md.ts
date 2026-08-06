import { createHash } from "node:crypto";
import type { ConventionPolicy } from "../domain/convention.js";
import { INDEX_FILE, renderIndexMd, type IndexEntry } from "../domain/index-markdown.js";
import type { DocumentSource, EncodingNotice, IndexFileWriter, MarkdownParser } from "../domain/ports.js";
import type { SkippedFileReport } from "./index-documents.js";

export interface IndexMdReport {
  /** Path of the index file, as resolved by the writer. */
  path: string;
  /** False when INDEX.md already had the generated content. */
  changed: boolean;
  /** Documents listed in the index. */
  documents: number;
  skipped: SkippedFileReport[];
  /** Present, and non-empty, when at least one listed document decodes under
   * a non-UTF-8 encoding. `INDEX.md` itself is filtered out, exactly as
   * `skipped` already is. */
  encodingNotices?: EncodingNotice[];
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
    private readonly policy: ConventionPolicy,
    private readonly compare: (a: IndexEntry, b: IndexEntry) => number,
  ) {}

  async execute(): Promise<IndexMdReport> {
    const { files, readErrors, encodingNotices } = await this.source.discover();
    const entries: IndexEntry[] = [];
    const skipped: SkippedFileReport[] = readErrors
      .filter((e) => e.path !== INDEX_FILE)
      .map((e) => ({ path: e.path, errors: [e.error] }));

    for (const file of files) {
      // The index never lists itself, even if the config exclude was overridden.
      if (file.path === INDEX_FILE) continue;

      let parsed;
      try {
        parsed = this.parser.parse(file.content);
      } catch (error) {
        skipped.push({ path: file.path, errors: [describeError(error)] });
        continue;
      }

      const resolution = this.policy.resolver({
        data: parsed.data,
        path: file.path,
        title: parsed.outline.title,
        summary: parsed.outline.summary,
        hash: createHash("sha256").update(file.content, "utf8").digest("hex"),
      });
      if (!resolution.ok) {
        skipped.push({ path: file.path, errors: resolution.errors });
        continue;
      }
      entries.push(resolution.meta);
    }

    const written = await this.writer.write(renderIndexMd(entries, this.compare));
    const report: IndexMdReport = {
      path: written.path,
      changed: written.changed,
      documents: entries.length,
      skipped,
    };
    const notices = (encodingNotices ?? []).filter((n) => n.path !== INDEX_FILE);
    if (notices.length > 0) report.encodingNotices = notices;
    return report;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
