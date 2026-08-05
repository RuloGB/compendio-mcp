import { createHash } from "node:crypto";
import { chunkOutline, type ChunkingOptions } from "../domain/chunking.js";
import type { ConventionPolicy } from "../domain/convention.js";
import type { Chunk, DocumentMeta } from "../domain/model.js";
import type { DocumentFile, MarkdownParser } from "../domain/ports.js";
import { splitToBound } from "../domain/split-text.js";

export interface PipelineOptions {
  chunking: ChunkingOptions;
  /** File names (relative path or basename) exempt from heading-based
   * chunking -- split by size only, via `splitToBound`, never by internal
   * headings. Still emits a single chunk when the body fits within
   * `maxTokens`; splits into several bounded chunks otherwise. The glossary
   * is the canonical case. */
  noChunking: string[];
}

export interface PipelineSuccess {
  ok: true;
  meta: DocumentMeta;
  chunks: Chunk[];
}

export interface PipelineFailure {
  ok: false;
  errors: string[];
}

export type PipelineResult = PipelineSuccess | PipelineFailure;

/** SHA-256 of raw file content — the sole change fingerprint shared by the
 * full-rebuild (`IndexDocuments`) and incremental-sync (`SyncIndex`) paths. */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shared per-file transform: parse -> policy.resolver -> chunk. Identical for
 * `IndexDocuments` (full rebuild) and `SyncIndex` (incremental diff) — only
 * the caller's hash computation and downstream persistence differ. The
 * caller supplies `hash` rather than this function computing it, so a diff
 * that already hashed the file for change detection (`SyncIndex`) never
 * hashes it twice.
 */
export function transformFile(
  parser: MarkdownParser,
  policy: ConventionPolicy,
  options: PipelineOptions,
  file: DocumentFile,
  hash: string,
): PipelineResult {
  let parsed;
  try {
    parsed = parser.parse(file.content);
  } catch (error) {
    return { ok: false, errors: [describeError(error)] };
  }

  const resolution = policy.resolver({
    data: parsed.data,
    path: file.path,
    title: parsed.outline.title,
    summary: parsed.outline.summary,
    hash,
  });

  if (!resolution.ok) {
    return { ok: false, errors: resolution.errors };
  }

  const chunks = isNoChunking(file.path, options.noChunking)
    ? wholeDocumentChunk(resolution.meta.title, parsed.body, options.chunking.maxTokens)
    : chunkOutline(parsed.outline, options.chunking);

  if (chunks.length === 0) {
    return { ok: false, errors: ["the document has no indexable content"] };
  }

  return { ok: true, meta: resolution.meta, chunks };
}

function isNoChunking(path: string, noChunking: string[]): boolean {
  const basename = path.split("/").pop() ?? path;
  return noChunking.some((entry) => entry === path || entry === basename);
}

function wholeDocumentChunk(title: string, body: string, maxTokens: number): Chunk[] {
  const content = body.trim();
  if (content.length === 0) return [];
  return splitToBound(content, maxTokens).map((text, position) => ({
    heading: title,
    content: text,
    position,
  }));
}
