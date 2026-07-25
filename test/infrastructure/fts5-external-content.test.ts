import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Decision D (design.md): does `fts5(content, heading, content=chunks,
 * content_rowid=id, tokenize='unicode61 remove_diacritics 2')` work when a
 * bare column is literally named `content` alongside the `content=`
 * external-content option? SQLite's grammar distinguishes bare columns from
 * `key=value` options by the `=`, so it is *probably* fine — but the current
 * DDL is the highest-blast-radius line in the project and "probably" is not
 * a basis for renaming it.
 *
 * This file uses `better-sqlite3` directly on `:memory:`, with no
 * `sqlite-vec` and no `SqliteIndexStore` import, so it can land as commit 1
 * against the still-Spanish tree and answer the question before anything
 * downstream depends on the answer.
 *
 * If ANY assertion below fails, the fallback (design.md Decision D) is:
 * physical column `body` instead of `content`, `Chunk.content` stays
 * `content` in the domain, and `toChunk` absorbs the asymmetry.
 */

const SCHEMA = `
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL,
    heading TEXT NOT NULL,
    content TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content, heading, content=chunks, content_rowid=id,
    tokenize='unicode61 remove_diacritics 2'
  );
`;

describe("FTS5 external-content probe: bare `content` column vs `content=` option", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("A0: both CREATE statements execute without throwing", () => {
    expect(() => db.exec(SCHEMA)).not.toThrow();
  });

  it("A1: inserts through the production statement shapes, with accented Spanish content", () => {
    db.exec(SCHEMA);
    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, document_id, heading, content, position) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertFts = db.prepare(`INSERT INTO chunks_fts(rowid, content, heading) VALUES (?, ?, ?)`);

    expect(() => {
      insertChunk.run(1, 100, "Duplicados", "gestión de duplicados", 0);
      insertFts.run(1, "gestión de duplicados", "Duplicados");
      insertChunk.run(2, 200, "Otro", "un segundo fragmento distinto", 0);
      insertFts.run(2, "un segundo fragmento distinto", "Otro");
    }).not.toThrow();
  });

  it("A2: an unaccented MATCH finds the accented row via the join-by-rowid shape", () => {
    db.exec(SCHEMA);
    db.prepare(
      `INSERT INTO chunks (id, document_id, heading, content, position) VALUES (?, ?, ?, ?, ?)`,
    ).run(1, 100, "Duplicados", "gestión de duplicados", 0);
    db.prepare(`INSERT INTO chunks_fts(rowid, content, heading) VALUES (?, ?, ?)`).run(
      1,
      "gestión de duplicados",
      "Duplicados",
    );

    const rows = db
      .prepare(
        `SELECT c.id FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH '"gestion"' ORDER BY f.rank`,
      )
      .all() as { id: number }[];

    expect(rows).toEqual([{ id: 1 }]);
  });

  it("A3: a column-scoped match (`content : gestion`) still returns the row", () => {
    db.exec(SCHEMA);
    db.prepare(
      `INSERT INTO chunks (id, document_id, heading, content, position) VALUES (?, ?, ?, ?, ?)`,
    ).run(1, 100, "Duplicados", "gestión de duplicados", 0);
    db.prepare(`INSERT INTO chunks_fts(rowid, content, heading) VALUES (?, ?, ?)`).run(
      1,
      "gestión de duplicados",
      "Duplicados",
    );

    const rows = db
      .prepare(
        `SELECT c.id FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH 'content : gestion' ORDER BY f.rank`,
      )
      .all() as { id: number }[];

    expect(rows).toEqual([{ id: 1 }]);
  });

  it("A4-A7: the 'delete' command form removes exactly one row's terms with no collateral damage, and integrity-check passes", () => {
    db.exec(SCHEMA);
    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, document_id, heading, content, position) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertFts = db.prepare(`INSERT INTO chunks_fts(rowid, content, heading) VALUES (?, ?, ?)`);
    insertChunk.run(1, 100, "Duplicados", "gestión de duplicados", 0);
    insertFts.run(1, "gestión de duplicados", "Duplicados");
    insertChunk.run(2, 200, "Otro", "un segundo fragmento distinto", 0);
    insertFts.run(2, "un segundo fragmento distinto", "Otro");

    // A4: the fragile part — the 'delete' command form with a column list
    // containing `content`, original values in declared column order.
    expect(() => {
      db.prepare(
        `INSERT INTO chunks_fts(chunks_fts, rowid, content, heading) VALUES ('delete', ?, ?, ?)`,
      ).run(1, "gestión de duplicados", "Duplicados");
      db.prepare(`DELETE FROM chunks WHERE id = ?`).run(1);
    }).not.toThrow();

    // A5: no stale lexical hit for the deleted row's terms.
    const afterDelete = db
      .prepare(`SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH '"gestion"'`)
      .get() as { n: number };
    expect(afterDelete.n).toBe(0);

    // A6: FTS5's own consistency check between the index and chunks.
    expect(() => db.prepare(`INSERT INTO chunks_fts(chunks_fts) VALUES('integrity-check')`).run()).not.toThrow();

    // A7: the second document's chunk still matches its own term — no
    // collateral damage from the targeted delete.
    const survivor = db
      .prepare(
        `SELECT c.id FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH '"fragmento"' ORDER BY f.rank`,
      )
      .all() as { id: number }[];
    expect(survivor).toEqual([{ id: 2 }]);
  });
});
