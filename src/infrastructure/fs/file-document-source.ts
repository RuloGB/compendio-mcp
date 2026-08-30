import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type {
  DiscoverResult,
  DocumentFile,
  DocumentSource,
  EncodingNotice,
  ReadError,
} from "../../domain/ports.js";
import { decodeText } from "./decode-text.js";
import { isDiscoveryIgnoredDirectory } from "./discover-markdown-roots.js";
import { isSameOrInsideRealPath, sameRealPath } from "./path-containment.js";

/**
 * Discovers .md files under the docs directory (recursively). An `exclude`
 * entry matches the relative POSIX path, the basename, or a directory
 * prefix of the path (not glob syntax — no wildcard matching). Hidden
 * directories are skipped. A file that fails to read (I/O error), or whose
 * bytes are genuinely undecodable, is collected into `readErrors` instead of
 * aborting the whole walk. A file successfully decoded under a non-UTF-8
 * encoding is still indexed, and is additionally collected into
 * `encodingNotices` so the transcode is reported rather than silent.
 */
export interface FileDocumentSourceOptions {
  discoveryMode?: boolean;
  trustedRootRealPath?: string;
}

export class FileDocumentSource implements DocumentSource {
  constructor(
    private readonly docsDir: string,
    private readonly exclude: string[],
    private readonly pathPrefix: string = "",
    private readonly options: FileDocumentSourceOptions = {},
  ) {}

  async discover(): Promise<DiscoverResult> {
    const files: DocumentFile[] = [];
    const readErrors: ReadError[] = [];
    const encodingNotices: EncodingNotice[] = [];
    const rootRealPath = this.options.discoveryMode === true ? await validateDiscoveryRoot(this.docsDir, this.options.trustedRootRealPath) : undefined;
    await this.walk(this.docsDir, this.pathPrefix, true, files, readErrors, encodingNotices, rootRealPath);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, readErrors, encodingNotices };
  }

  private async walk(
    dir: string,
    prefix: string,
    isRoot: boolean,
    out: DocumentFile[],
    readErrors: ReadError[],
    encodingNotices: EncodingNotice[],
    rootRealPath?: string,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (isRoot) {
        // A missing root (ENOENT) is zero files, not an error: the project
        // may not have a docs folder yet. Genuine I/O failures (EACCES, etc.)
        // still throw, preserving the all-fail semantics at the composite
        // level.
        if (this.options.discoveryMode !== true && reason.includes("ENOENT")) return;
        throw new Error(`cannot read the documentation directory "${this.docsDir}": ${reason}`);
      }
      if (this.options.discoveryMode === true) {
        throw new Error(`cannot read discovered documentation path "${prefix}": ${reason}`);
      }
      readErrors.push({ path: prefix, error: reason });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = join(dir, entry.name);
      const inspected = rootRealPath === undefined ? undefined : await inspectDiscoveryEntry(absolute, rootRealPath);
      if (inspected?.skip === true) continue;
      const isDirectory = inspected?.isDirectory ?? entry.isDirectory();
      const isFile = inspected?.isFile ?? true;
      if (this.options.discoveryMode === true && isDirectory && isDiscoveryIgnoredDirectory(entry.name)) continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (isDirectory) {
        await this.walk(absolute, path, false, out, readErrors, encodingNotices, rootRealPath);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      if (!isFile) continue;
      if (this.isExcluded(path, entry.name)) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(absolute);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (this.options.discoveryMode === true) {
          throw new Error(`cannot read discovered markdown file "${path}": ${reason}`);
        }
        readErrors.push({ path, error: reason });
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
    return this.exclude.some((raw) => {
      const entry = raw.replace(/\/+$/, "");
      return entry === path || entry === basename || path.startsWith(`${entry}/`);
    });
  }
}

async function inspectDiscoveryEntry(
  absolute: string,
  rootRealPath: string,
): Promise<{ skip: true } | { skip: false; isDirectory: boolean; isFile: boolean }> {
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) return { skip: true };
  const entryRealPath = await realpath(absolute);
  if (!isSameOrInsideRealPath(rootRealPath, entryRealPath)) return { skip: true };
  return { skip: false, isDirectory: stat.isDirectory(), isFile: stat.isFile() };
}

async function validateDiscoveryRoot(docsDir: string, trustedRootRealPath: string | undefined): Promise<string> {
  const stat = await lstat(docsDir);
  if (stat.isSymbolicLink()) {
    throw new Error(`discovered documentation root "${docsDir}" is now a symlink or junction`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`discovered documentation root "${docsDir}" is not a directory`);
  }
  const currentRootRealPath = await realpath(docsDir);
  if (trustedRootRealPath !== undefined && !sameRealPath(trustedRootRealPath, currentRootRealPath)) {
    throw new Error(
      `discovered documentation root "${docsDir}" changed realpath after root selection (trusted: ${trustedRootRealPath}; current: ${currentRootRealPath})`,
    );
  }
  return currentRootRealPath;
}
