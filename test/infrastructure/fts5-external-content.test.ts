import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_DDL } from "../../src/infrastructure/sqlite/sqlite-index-store";

/**
 * Decision D (design.md): does `fts5(content, heading, content=chunks,
 * content_rowid=id, tokenize='unicode61 remove_diacritics 2')` work when a
 * bare column is literally named `content` alongside the `content=`
 * external-content option? SQLite's grammar distinguishes bare columns from
 * `key=value` options by the `=`, so it is *probably* fine — but the current
 * DDL is the highest-blast-radius line in the project and "probably" is not
 * a basis for renaming it.
 *
 * The probe answered yes, so the production DDL uses bare `content` and the
 * `body` fallback was never needed.
 *
 * It executes `SCHEMA_DDL` — the production constant — rather than a local
 * copy, so the probe can never drift into validating a schema the code no
 * longer uses. `better-sqlite3` is driven directly on `:memory:` with no
 * `sqlite-vec` and no `SqliteIndexStore` instance, so what is under test is
 * the DDL itself, not the store wrapping it.
 */

const SCHEMA = SCHEMA_DDL;

describe("FTS5 external-content probe: bare `content` column vs `content=` option", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    // `chunks.document_id` is a real foreign key in the production DDL and
    // better-sqlite3 enforces foreign keys by default, so the parent rows have
    // to exist. The earlier local copy of the schema had no `documents` table
    // at all, which is precisely the drift this probe now cannot have.
    const insertDoc = db.prepare(
      `INSERT INTO documents (id, path, title, summary, hash) VALUES (?, ?, ?, ?, ?)`,
    );
    insertDoc.run(100, "a.md", "A", "resumen", "h1");
    insertDoc.run(200, "b.md", "B", "resumen", "h2");
  });

  afterEach(() => {
    db.close();
  });

  it("A0: both CREATE statements execute without throwing", () => {
    const fresh = new Database(":memory:");
    expect(() => fresh.exec(SCHEMA)).not.toThrow();
    fresh.close();
  });

  it("A1: inserts through the production statement shapes, with accented Spanish content", () => {
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
