import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import type { DatabaseSchema } from "./schema.js";
import { runMigrations, rollbackAll } from "./migrations/index.js";

const PFA_DIR = process.env.PFA_DIR ?? path.join(os.homedir(), ".pfa");
const DOCUMENTS_DIR = path.join(PFA_DIR, "documents");
const DB_PATH = path.join(PFA_DIR, "data.sqlite");

let db: Database.Database | null = null;
let kysely: Kysely<DatabaseSchema> | null = null;

export function initDb(): void {
  if (db) {
    db.close();
    db = null;
    kysely = null;
  }

  fs.mkdirSync(PFA_DIR, { recursive: true });
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  runMigrations(db);
}

export function resetDb(): void {
  const current = db;
  if (!current) {
    throw new Error("Database not initialised — call initDb() first");
  }
  rollbackAll(current);
  runMigrations(current);
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialised — call initDb() first");
  }
  return db;
}

export function getSchemaSql(): string {
  const rows = getDb()
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name != 'schema_migrations'
         AND name != 'connector_state'
       ORDER BY name`,
    )
    .all() as { sql: string | null }[];
  return rows
    .map((r) => r.sql)
    .filter((sql): sql is string => Boolean(sql))
    .map((sql) => `${sql};`)
    .join("\n\n");
}

export function getKysely(): Kysely<DatabaseSchema> {
  if (!db) {
    throw new Error("Database not initialised — call initDb() first");
  }
  if (!kysely) {
    kysely = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: db }),
    });
  }
  return kysely;
}

export { DOCUMENTS_DIR, DB_PATH };
