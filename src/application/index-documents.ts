import { createHash } from "node:crypto";
import { chunkOutline, type ChunkingOptions } from "../domain/chunking.js";
import type { ConvencionPolicy } from "../domain/convencion.js";
import type { Chunk, SearchMode } from "../domain/model.js";
import type {
  DocumentSource,
  EmbeddingsProvider,
  IndexStore,
  MarkdownParser,
} from "../domain/ports.js";

export interface IndexedFileReport {
  ruta: string;
  titulo: string;
  chunks: number;
}

export interface SkippedFileReport {
  ruta: string;
  errores: string[];
}

export interface IndexReport {
  modo: SearchMode;
  indexados: IndexedFileReport[];
  omitidos: SkippedFileReport[];
  totalChunks: number;
  duracionMs: number;
  /** Present when embeddings were requested but unavailable (degraded mode). */
  avisoEmbeddings?: string;
}

export interface IndexDocumentsOptions {
  chunking: ChunkingOptions;
  /** File names (relative path or basename) indexed as a single chunk,
   * without heading-based chunking. The glossary is the canonical case. */
  sinChunking: string[];
  embeddingBatchSize?: number;
}

const DEFAULT_BATCH_SIZE = 16;

/**
 * Full reindex pipeline: discover -> parse & resolve -> chunk -> embed ->
 * persist. A file is skipped and reported in `omitidos` for any resilience
 * reason (unreadable, unparseable, no indexable content) or, under the
 * injected `ConvencionPolicy`, for a metadata reason. If the embeddings
 * provider is missing or fails, indexing completes in lexical-only mode
 * instead of crashing (graceful degradation).
 */
export class IndexDocuments {
  constructor(
    private readonly source: DocumentSource,
    private readonly parser: MarkdownParser,
    private readonly store: IndexStore,
    private readonly embeddings: EmbeddingsProvider | null,
    private readonly policy: ConvencionPolicy,
    private readonly options: IndexDocumentsOptions,
  ) {}

  async execute(): Promise<IndexReport> {
    const start = Date.now();
    const { files, erroresLectura } = await this.source.discover();

    const indexados: IndexedFileReport[] = [];
    const omitidos: SkippedFileReport[] = erroresLectura.map((e) => ({
      ruta: e.ruta,
      errores: [e.error],
    }));
    const pending: { chunkId: number; texto: string }[] = [];

    this.store.reset();

    for (const file of files) {
      let parsed;
      try {
        parsed = this.parser.parse(file.contenido);
      } catch (error) {
        omitidos.push({ ruta: file.ruta, errores: [describeError(error)] });
        continue;
      }

      const resolution = this.policy.resolver({
        data: parsed.data,
        ruta: file.ruta,
        titulo: parsed.outline.titulo,
        resumen: parsed.outline.resumen,
        hash: createHash("sha256").update(file.contenido, "utf8").digest("hex"),
      });

      if (!resolution.ok) {
        omitidos.push({ ruta: file.ruta, errores: resolution.errores });
        continue;
      }

      const chunks = this.isSinChunking(file.ruta)
        ? this.wholeDocumentChunk(resolution.meta.titulo, parsed.body)
        : chunkOutline(parsed.outline, this.options.chunking);

      if (chunks.length === 0) {
        omitidos.push({ ruta: file.ruta, errores: ["el documento no tiene contenido indexable"] });
        continue;
      }

      const saved = this.store.saveDocument(resolution.meta, chunks);
      chunks.forEach((chunk, i) => {
        pending.push({
          chunkId: saved.chunkIds[i]!,
          texto: `${chunk.encabezado}\n${chunk.contenido}`,
        });
      });
      indexados.push({ ruta: file.ruta, titulo: resolution.meta.titulo, chunks: chunks.length });
    }

    const aviso = await this.embedPending(pending);

    const report: IndexReport = {
      modo: aviso === null && this.embeddings !== null ? "hibrido" : "lexico",
      indexados,
      omitidos,
      totalChunks: pending.length,
      duracionMs: Date.now() - start,
    };
    if (aviso !== null) report.avisoEmbeddings = aviso;
    return report;
  }

  /** Returns a warning message when embeddings could not be generated. */
  private async embedPending(pending: { chunkId: number; texto: string }[]): Promise<string | null> {
    if (this.embeddings === null) {
      return "indexado sin embeddings (proveedor no disponible): busqueda en modo lexico";
    }
    const batchSize = this.options.embeddingBatchSize ?? DEFAULT_BATCH_SIZE;
    try {
      for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        // "passage: " prefix is required by the E5 embedding family.
        const vectors = await this.embeddings.embed(batch.map((p) => `passage: ${p.texto}`));
        this.store.saveEmbeddings(
          batch.map((p, j) => ({ chunkId: p.chunkId, embedding: vectors[j]! })),
        );
      }
      return null;
    } catch (error) {
      return `embeddings no disponibles (${describeError(error)}): busqueda en modo lexico`;
    }
  }

  private isSinChunking(ruta: string): boolean {
    const basename = ruta.split("/").pop() ?? ruta;
    return this.options.sinChunking.some((entry) => entry === ruta || entry === basename);
  }

  private wholeDocumentChunk(titulo: string, body: string): Chunk[] {
    const contenido = body.trim();
    if (contenido.length === 0) return [];
    return [{ encabezado: titulo, contenido, orden: 0 }];
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
