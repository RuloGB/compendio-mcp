import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type {
  Chunk,
  DocumentMeta,
  IndexedChunk,
  IndexedDocument,
  SearchFilters,
} from "../../domain/model.js";
import type { ChunkEmbedding, ChunkMissingVector, IndexStore, SavedDocument } from "../../domain/ports.js";

interface DocumentRow {
  id: number;
  ruta: string;
  titulo: string;
  resumen: string;
  tipo: string | null;
  modulo: string | null;
  estado: string | null;
  propietario: string | null;
  etiquetas: string | null;
  actualizado: string | null;
  hash: string;
}

interface ChunkRow {
  id: number;
  document_id: number;
  encabezado: string;
  contenido: string;
  orden: number;
}

/**
 * Base schema DDL (nullable tipo/modulo/estado — Optional Persisted
 * Metadata). Used both by `migrate()` (non-destructive `CREATE TABLE IF NOT
 * EXISTS`, guaranteeing the schema exists on brand-new database files) and
 * by `reset()` (destructive drop-and-recreate, guaranteeing the *current*
 * schema on every `compendio index` run, including upgrading a pre-existing
 * database created with the old `NOT NULL` columns).
 */
const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    ruta TEXT UNIQUE NOT NULL,
    titulo TEXT NOT NULL,
    resumen TEXT NOT NULL,
    tipo TEXT,
    modulo TEXT,
    estado TEXT,
    propietario TEXT,
    etiquetas TEXT,
    actualizado TEXT,
    hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    encabezado TEXT NOT NULL,
    contenido TEXT NOT NULL,
    orden INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    contenido, encabezado, content=chunks, content_rowid=id,
    tokenize='unicode61 remove_diacritics 2'
  );
`;

/**
 * SQLite adapter: documents + chunks, FTS5 (BM25, diacritics-insensitive) for
 * the lexical leg and sqlite-vec for the vector leg. If the sqlite-vec
 * extension cannot be loaded the store still works in lexical-only mode.
 */
export class SqliteIndexStore implements IndexStore {
  private readonly db: Database.Database;
  private vectorsEnabled: boolean;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.vectorsEnabled = this.loadVectorExtension();
    this.migrate();
  }

  private loadVectorExtension(): boolean {
    try {
      sqliteVec.load(this.db);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Non-destructive schema guarantee: runs on every container construction
   * (`search`, `overview`, `eval`, `index-md`, `serve`, `index`). Must never
   * drop/recreate — that would wipe the index on every non-index command.
   * A pre-existing database keeps whatever schema it already has; the
   * current-schema guarantee (including nullable columns) is enforced by
   * `reset()` instead, which only runs at the start of an `index` run.
   */
  private migrate(): void {
    this.db.exec(SCHEMA_DDL);
  }

  /**
   * Index-run-scoped schema guarantee: drops and recreates the full schema
   * (nullable columns) inside a single transaction, so a database created by
   * a prior version with `NOT NULL` tipo/modulo/estado columns is upgraded
   * in place, with no manual deletion of `.compendio/` required. The single
   * transaction shrinks (does not eliminate) the window in which a
   * concurrent reader could observe a missing table.
   */
  reset(): void {
    const run = this.db.transaction((): void => {
      this.db.exec(`
        DROP TABLE IF EXISTS chunks_vec;
        DROP TABLE IF EXISTS chunks_fts;
        DROP TABLE IF EXISTS chunks;
        DROP TABLE IF EXISTS documents;
      `);
      this.db.exec(SCHEMA_DDL);
    });
    run();
  }

  saveDocument(meta: DocumentMeta, chunks: Chunk[]): SavedDocument {
    const run = this.db.transaction((): SavedDocument =>
      this.insertDocumentAndChunks(meta, chunks, null, null),
    );
    return run();
  }

  /**
   * Shared insert path for `saveDocument` and `upsertDocument`: `documents` +
   * `chunks` + `chunks_fts`, plus a `chunks_vec` row per chunk when both
   * `embeddings` and `insertVec` are provided. Caller wraps this in a
   * transaction; it issues no transaction of its own.
   */
  private insertDocumentAndChunks(
    meta: DocumentMeta,
    chunks: Chunk[],
    embeddings: Float32Array[] | null,
    insertVec: Database.Statement | null,
  ): SavedDocument {
    const insertDocument = this.db.prepare(`
      INSERT INTO documents (ruta, titulo, resumen, tipo, modulo, estado, propietario, etiquetas, actualizado, hash)
      VALUES (@ruta, @titulo, @resumen, @tipo, @modulo, @estado, @propietario, @etiquetas, @actualizado, @hash)
    `);
    const insertChunk = this.db.prepare(`
      INSERT INTO chunks (document_id, encabezado, contenido, orden)
      VALUES (?, ?, ?, ?)
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO chunks_fts(rowid, contenido, encabezado) VALUES (?, ?, ?)
    `);

    const documentId = Number(
      insertDocument.run({
        ruta: meta.path,
        titulo: meta.titulo,
        resumen: meta.resumen,
        tipo: meta.type ?? null,
        modulo: meta.module ?? null,
        estado: meta.status ?? null,
        propietario: meta.owner ?? null,
        etiquetas: JSON.stringify(meta.tags),
        actualizado: meta.updated ?? null,
        hash: meta.hash,
      }).lastInsertRowid,
    );
    const chunkIds = chunks.map((chunk, index) => {
      const chunkId = Number(
        insertChunk.run(documentId, chunk.heading, chunk.contenido, chunk.orden)
          .lastInsertRowid,
      );
      insertFts.run(chunkId, chunk.contenido, chunk.heading);
      if (insertVec !== null && embeddings !== null) {
        insertVec.run(BigInt(chunkId), toBlob(embeddings[index]!));
      }
      return chunkId;
    });
    return { documentId, chunkIds };
  }

  /**
   * Removes a document's `chunks` rows (using the FTS5 external-content
   * `'delete'` command form, since a plain DELETE on `chunks` would desync
   * `chunks_fts`), its `chunks_vec` rows (guarded by `vectorsEnabled &&
   * tableExists("chunks_vec")` — the extension can fail to load in a
   * process while the table still exists in the DB file), then the `chunks`
   * and `documents` rows themselves. Caller is responsible for wrapping this
   * in a transaction; it issues no transaction of its own so it can be
   * composed inside `deleteDocument` and `upsertDocument` alike.
   */
  private deleteDocumentRows(documentId: number): void {
    const chunks = this.db
      .prepare(`SELECT id, contenido, encabezado FROM chunks WHERE document_id = ?`)
      .all(documentId) as { id: number; contenido: string; encabezado: string }[];
    const vecGuarded = this.vectorsEnabled && this.tableExists("chunks_vec");
    const deleteFts = this.db.prepare(
      `INSERT INTO chunks_fts(chunks_fts, rowid, contenido, encabezado) VALUES ('delete', ?, ?, ?)`,
    );
    const deleteVec = vecGuarded
      ? this.db.prepare(`DELETE FROM chunks_vec WHERE chunk_id = ?`)
      : null;
    for (const chunk of chunks) {
      deleteFts.run(chunk.id, chunk.contenido, chunk.encabezado);
      if (deleteVec !== null) deleteVec.run(BigInt(chunk.id));
    }
    this.db.prepare(`DELETE FROM chunks WHERE document_id = ?`).run(documentId);
    this.db.prepare(`DELETE FROM documents WHERE id = ?`).run(documentId);
  }

  deleteDocument(path: string): void {
    const run = this.db.transaction((): void => {
      const doc = this.db.prepare(`SELECT id FROM documents WHERE ruta = ?`).get(path) as
        | { id: number }
        | undefined;
      if (doc === undefined) return;
      this.deleteDocumentRows(doc.id);
    });
    run();
  }

  upsertDocument(
    meta: DocumentMeta,
    chunks: Chunk[],
    embeddings: Float32Array[] | null,
  ): SavedDocument {
    // Write-side guard: vectorsEnabled alone (NOT deleteDocumentRows' extra
    // tableExists guard) — a brand-new project's very first upsertDocument
    // call must still create chunks_vec lazily and persist the embedding.
    if (embeddings !== null && embeddings.length > 0) {
      this.ensureVectorTable(embeddings[0]!.length);
    }
    const findExisting = this.db.prepare(`SELECT id FROM documents WHERE ruta = ?`);
    // Prepared only when the table is actually present (either created just
    // now above, or by a prior upsertDocument/saveEmbeddings call) — the
    // vectorsEnabled-alone guard governs WHETHER embeddings get written, not
    // whether it is safe to prepare a statement against a table that may not
    // exist yet (e.g. embeddings is null and chunks_vec was never created).
    const insertVec =
      this.vectorsEnabled && this.tableExists("chunks_vec")
        ? this.db.prepare(`INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`)
        : null;

    const run = this.db.transaction((): SavedDocument => {
      const existing = findExisting.get(meta.path) as { id: number } | undefined;
      if (existing !== undefined) {
        this.deleteDocumentRows(existing.id);
      }
      return this.insertDocumentAndChunks(meta, chunks, embeddings, insertVec);
    });
    return run();
  }

  listChunksMissingVectors(): ChunkMissingVector[] {
    if (!this.vectorsEnabled || !this.tableExists("chunks_vec")) return [];
    return this.db
      .prepare(
        `SELECT c.id AS chunkId, d.ruta AS path, c.encabezado AS heading, c.contenido AS contenido
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE c.id NOT IN (SELECT chunk_id FROM chunks_vec)
         ORDER BY c.id`,
      )
      .all() as ChunkMissingVector[];
  }

  replaceEmbeddings(items: ChunkEmbedding[]): void {
    if (items.length === 0) return;
    if (!this.vectorsEnabled) {
      throw new Error("la extension sqlite-vec no esta disponible en esta instalacion");
    }
    const dimension = items[0]!.embedding.length;
    this.ensureVectorTable(dimension);
    const del = this.db.prepare(`DELETE FROM chunks_vec WHERE chunk_id = ?`);
    const insert = this.db.prepare(`INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`);
    const run = this.db.transaction(() => {
      for (const item of items) {
        del.run(BigInt(item.chunkId));
        insert.run(BigInt(item.chunkId), toBlob(item.embedding));
      }
    });
    run();
  }

  saveEmbeddings(items: ChunkEmbedding[]): void {
    if (items.length === 0) return;
    if (!this.vectorsEnabled) {
      throw new Error("la extension sqlite-vec no esta disponible en esta instalacion");
    }
    const dimension = items[0]!.embedding.length;
    this.ensureVectorTable(dimension);
    const insert = this.db.prepare(`INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`);
    const run = this.db.transaction(() => {
      for (const item of items) {
        // vec0 requires a strictly typed INTEGER key: bind as BigInt.
        insert.run(BigInt(item.chunkId), toBlob(item.embedding));
      }
    });
    run();
  }

  /** Created lazily so the dimension always matches the active provider. */
  private ensureVectorTable(dimension: number): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[${dimension}]
      );
    `);
  }

  hasVectors(): boolean {
    if (!this.vectorsEnabled || !this.tableExists("chunks_vec")) return false;
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM chunks_vec`).get() as { n: number };
    return row.n > 0;
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
      .get(name) as { n: number };
    return row.n > 0;
  }

  searchLexical(query: string, filters: SearchFilters, limit: number): number[] {
    const match = toFtsQuery(query);
    if (match === null) return [];
    const { sql, params } = buildFilterSql(filters);
    const rows = this.db
      .prepare(
        `SELECT c.id FROM chunks_fts f
         JOIN chunks c ON c.id = f.rowid
         JOIN documents d ON d.id = c.document_id
         WHERE chunks_fts MATCH ? ${sql}
         ORDER BY f.rank
         LIMIT ?`,
      )
      .all(match, ...params, limit) as { id: number }[];
    return rows.map((row) => row.id);
  }

  searchVector(embedding: Float32Array, filters: SearchFilters, limit: number): number[] {
    if (!this.vectorsEnabled || !this.tableExists("chunks_vec")) return [];
    // Over-fetch from the KNN index, then keep only chunks passing the
    // metadata filters (vec0 KNN cannot join against other tables).
    const candidates = this.db
      .prepare(
        `SELECT chunk_id FROM chunks_vec
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(toBlob(embedding), limit * 4) as { chunk_id: number }[];
    if (candidates.length === 0) return [];

    const ids = candidates.map((c) => c.chunk_id);
    const { sql, params } = buildFilterSql(filters);
    const allowedRows = this.db
      .prepare(
        `SELECT c.id FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE c.id IN (${ids.map(() => "?").join(",")}) ${sql}`,
      )
      .all(...ids, ...params) as { id: number }[];
    const allowed = new Set(allowedRows.map((row) => row.id));
    return ids.filter((id) => allowed.has(id)).slice(0, limit);
  }

  listDocuments(): IndexedDocument[] {
    const rows = this.db
      .prepare(`SELECT * FROM documents ORDER BY ruta`)
      .all() as DocumentRow[];
    return rows.map(toDocument);
  }

  getDocumentByPath(path: string): IndexedDocument | null {
    const row = this.db.prepare(`SELECT * FROM documents WHERE ruta = ?`).get(path) as
      | DocumentRow
      | undefined;
    return row === undefined ? null : toDocument(row);
  }

  getChunksByDocument(documentId: number): IndexedChunk[] {
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE document_id = ? ORDER BY orden`)
      .all(documentId) as ChunkRow[];
    return rows.map(toChunk);
  }

  getChunksByIds(ids: number[]): IndexedChunk[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as ChunkRow[];
    const byId = new Map(rows.map((row) => [row.id, toChunk(row)]));
    return ids.flatMap((id) => {
      const chunk = byId.get(id);
      return chunk === undefined ? [] : [chunk];
    });
  }

  getDocumentsByIds(ids: number[]): Map<number, IndexedDocument> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = this.db
      .prepare(`SELECT * FROM documents WHERE id IN (${unique.map(() => "?").join(",")})`)
      .all(...unique) as DocumentRow[];
    return new Map(rows.map((row) => [row.id, toDocument(row)]));
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Converts free text into a safe FTS5 query: bare terms joined with OR so
 * natural-language questions never break MATCH syntax, and BM25 does the
 * ranking. Returns null when no searchable token remains.
 */
function toFtsQuery(query: string): string | null {
  const tokens = query
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

function buildFilterSql(filters: SearchFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.type !== undefined) {
    clauses.push("d.tipo = ?");
    params.push(filters.type);
  }
  if (filters.module !== undefined) {
    clauses.push("d.modulo = ?");
    params.push(filters.module);
  }
  if (filters.excludedStatuses !== undefined && filters.excludedStatuses.length > 0) {
    // NULL-aware deny-list: a document with no status is never excluded.
    clauses.push(
      `(d.estado IS NULL OR d.estado NOT IN (${filters.excludedStatuses.map(() => "?").join(",")}))`,
    );
    params.push(...filters.excludedStatuses);
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(d.etiquetas) je
        WHERE je.value IN (${filters.tags.map(() => "?").join(",")}))`,
    );
    params.push(...filters.tags);
  }
  return {
    sql: clauses.length === 0 ? "" : `AND ${clauses.join(" AND ")}`,
    params,
  };
}

function toBlob(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

function toDocument(row: DocumentRow): IndexedDocument {
  const doc: IndexedDocument = {
    id: row.id,
    path: row.ruta,
    titulo: row.titulo,
    resumen: row.resumen,
    tags: row.etiquetas === null ? [] : (JSON.parse(row.etiquetas) as string[]),
    hash: row.hash,
  };
  if (row.tipo !== null) doc.type = row.tipo;
  if (row.modulo !== null) doc.module = row.modulo;
  if (row.estado !== null) doc.status = row.estado;
  if (row.propietario !== null) doc.owner = row.propietario;
  if (row.actualizado !== null) doc.updated = row.actualizado;
  return doc;
}

function toChunk(row: ChunkRow): IndexedChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    heading: row.encabezado,
    contenido: row.contenido,
    orden: row.orden,
  };
}
