import { createHash } from "node:crypto";
import { chunkOutline, type ChunkingOptions } from "../domain/chunking.js";
import type { ConvencionPolicy } from "../domain/convencion.js";
import type { Chunk, DocumentMeta } from "../domain/model.js";
import type { DocumentFile, MarkdownParser } from "../domain/ports.js";

export interface PipelineOptions {
  chunking: ChunkingOptions;
  /** File names (relative path or basename) indexed as a single chunk,
   * without heading-based chunking. The glossary is the canonical case. */
  sinChunking: string[];
}

export interface PipelineSuccess {
  ok: true;
  meta: DocumentMeta;
  chunks: Chunk[];
}

export interface PipelineFailure {
  ok: false;
  errores: string[];
}

export type PipelineResult = PipelineSuccess | PipelineFailure;

/** SHA-256 of raw file content — the sole change fingerprint shared by the
 * full-rebuild (`IndexDocuments`) and incremental-sync (`SyncIndex`) paths. */
export function computeHash(contenido: string): string {
  return createHash("sha256").update(contenido, "utf8").digest("hex");
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
  policy: ConvencionPolicy,
  options: PipelineOptions,
  file: DocumentFile,
  hash: string,
): PipelineResult {
  let parsed;
  try {
    parsed = parser.parse(file.contenido);
  } catch (error) {
    return { ok: false, errores: [describeError(error)] };
  }

  const resolution = policy.resolver({
    data: parsed.data,
    path: file.path,
    titulo: parsed.outline.titulo,
    resumen: parsed.outline.resumen,
    hash,
  });

  if (!resolution.ok) {
    return { ok: false, errores: resolution.errores };
  }

  const chunks = isSinChunking(file.path, options.sinChunking)
    ? wholeDocumentChunk(resolution.meta.titulo, parsed.body)
    : chunkOutline(parsed.outline, options.chunking);

  if (chunks.length === 0) {
    return { ok: false, errores: ["el documento no tiene contenido indexable"] };
  }

  return { ok: true, meta: resolution.meta, chunks };
}

function isSinChunking(path: string, sinChunking: string[]): boolean {
  const basename = path.split("/").pop() ?? path;
  return sinChunking.some((entry) => entry === path || entry === basename);
}

function wholeDocumentChunk(titulo: string, body: string): Chunk[] {
  const contenido = body.trim();
  if (contenido.length === 0) return [];
  return [{ heading: titulo, contenido, orden: 0 }];
}
