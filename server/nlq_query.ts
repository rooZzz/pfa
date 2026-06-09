import duckdb from "duckdb";
import { DB_PATH, getDb } from "./db.js";
import { NLQ_TABLES } from "./nlq_allowlist.js";

type Row = Record<string, unknown>;

function run(db: duckdb.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function all(db: duckdb.Database, sql: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: Row[]) => (err ? reject(err) : resolve(rows)));
  });
}

export async function runProductQuery(sql: string): Promise<Row[]> {
  const db = new duckdb.Database(":memory:");
  try {
    await run(db, "INSTALL sqlite");
    await run(db, "LOAD sqlite");
    await run(
      db,
      `ATTACH '${DB_PATH.replace(/'/g, "''")}' AS src (TYPE sqlite, READ_ONLY)`,
    );
    await run(db, "CREATE SCHEMA pfa");
    for (const table of NLQ_TABLES) {
      await run(db, `CREATE TABLE pfa.${table} AS SELECT * FROM src.${table}`);
    }
    await run(db, "DETACH src");
    const readOnly = `SELECT * FROM (\n${sql.trim().replace(/;\s*$/, "")}\n) AS _pfa_q`;
    return await all(db, readOnly);
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()));
  }
}

export function getProductSchemaSql(): string {
  const placeholders = NLQ_TABLES.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE type = 'table' AND name IN (${placeholders})
       ORDER BY name`,
    )
    .all(...NLQ_TABLES) as { sql: string | null }[];
  return rows
    .map((r) => r.sql)
    .filter((sql): sql is string => Boolean(sql))
    .map((sql) => `${sql};`)
    .join("\n\n");
}
