import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PFA_DIR = process.env.PFA_DIR ?? path.join(os.homedir(), ".pfa");
const DOCUMENTS_DIR = path.join(PFA_DIR, "documents");
const DB_PATH = path.join(PFA_DIR, "data.sqlite");

const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY,
  source_type  TEXT NOT NULL CHECK (source_type IN ('upload', 'manual', 'connector')),
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ingested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL,
  occurred_at  TIMESTAMP NOT NULL,
  recorded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount_pence INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  description  TEXT,
  source_id    INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS account_balances (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL,
  balance_pence INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'GBP',
  valid_from    DATE NOT NULL,
  valid_to      DATE,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id     INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS tax_periods (
  tax_year  TEXT PRIMARY KEY,
  starts_on DATE NOT NULL,
  ends_on   DATE NOT NULL
);
`;

let db: Database.Database | null = null;

export function initDb(): void {
  if (db) {
    db.close();
    db = null;
  }

  fs.mkdirSync(PFA_DIR, { recursive: true });
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.exec(DDL);
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialised — call initDb() first");
  }
  return db;
}

export { DOCUMENTS_DIR, DB_PATH };
