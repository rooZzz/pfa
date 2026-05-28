import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PFA_DIR = process.env.PFA_DIR ?? path.join(os.homedir(), ".pfa");
const DOCUMENTS_DIR = path.join(PFA_DIR, "documents");
const DB_PATH = path.join(PFA_DIR, "data.sqlite");

const DROP_DDL = `
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS equity_vesting_event;
DROP TABLE IF EXISTS equity_grant;
DROP TABLE IF EXISTS income_events;
DROP TABLE IF EXISTS account_balances;
DROP TABLE IF EXISTS pension_values;
DROP TABLE IF EXISTS mortgage_balance;
DROP TABLE IF EXISTS asset_values;
DROP TABLE IF EXISTS person_profile;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS mortgages;
DROP TABLE IF EXISTS tax_periods;
DROP TABLE IF EXISTS documents;
`;

const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  source_type  TEXT NOT NULL CHECK (source_type IN ('upload', 'manual', 'connector')),
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ingested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes        TEXT
);

CREATE TABLE tax_periods (
  tax_year  TEXT PRIMARY KEY,
  starts_on DATE NOT NULL,
  ends_on   DATE NOT NULL
);

CREATE TABLE accounts (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('current', 'savings', 'isa', 'pension', 'mortgage')),
  currency TEXT NOT NULL DEFAULT 'GBP'
);

CREATE TABLE assets (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  asset_type    TEXT NOT NULL,
  base_currency TEXT NOT NULL
);

CREATE TABLE mortgages (
  id                    INTEGER PRIMARY KEY,
  lender                TEXT NOT NULL,
  property              TEXT NOT NULL,
  original_amount_pence INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'GBP'
);

CREATE TABLE equity_grant (
  id          INTEGER PRIMARY KEY,
  scheme_type TEXT NOT NULL CHECK (scheme_type IN ('rsu', 'emi', 'unapproved', 'saye')),
  units       INTEGER NOT NULL,
  strike_pence INTEGER,
  grant_date  DATE NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'GBP',
  source_id   INTEGER NOT NULL REFERENCES documents(id),
  payload     TEXT
);

CREATE TABLE transactions (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL,
  occurred_at  TIMESTAMP NOT NULL,
  recorded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount_pence INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  description  TEXT,
  source_id    INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE equity_vesting_event (
  id                    INTEGER PRIMARY KEY,
  grant_id              INTEGER NOT NULL REFERENCES equity_grant(id),
  vest_date             DATE NOT NULL,
  units_vested          INTEGER NOT NULL,
  market_price_pence    INTEGER,
  estimated_value_pence INTEGER,
  occurred_at           TIMESTAMP NOT NULL,
  recorded_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id             INTEGER NOT NULL REFERENCES documents(id),
  payload               TEXT
);

CREATE TABLE income_events (
  id                     INTEGER PRIMARY KEY,
  pay_date               DATE NOT NULL,
  tax_year               TEXT REFERENCES tax_periods(tax_year),
  gross_pence            INTEGER NOT NULL,
  taxable_pence          INTEGER,
  net_pence              INTEGER NOT NULL,
  paye_pence             INTEGER NOT NULL,
  ni_employee_pence      INTEGER NOT NULL,
  pension_employee_pence INTEGER NOT NULL,
  pension_employer_pence INTEGER,
  currency               TEXT NOT NULL DEFAULT 'GBP',
  occurred_at            TIMESTAMP NOT NULL,
  recorded_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id              INTEGER NOT NULL REFERENCES documents(id),
  payload                TEXT
);

CREATE TABLE account_balances (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL,
  balance_pence INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'GBP',
  valid_from    DATE NOT NULL,
  valid_to      DATE,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id     INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE pension_values (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  value_pence INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'GBP',
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id   INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE mortgage_balance (
  id                   INTEGER PRIMARY KEY,
  mortgage_id          INTEGER NOT NULL REFERENCES mortgages(id),
  outstanding_pence    INTEGER NOT NULL,
  interest_rate_bps    INTEGER NOT NULL,
  property_value_pence INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'GBP',
  valid_from           DATE NOT NULL,
  valid_to             DATE,
  recorded_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id            INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE asset_values (
  id                   INTEGER PRIMARY KEY,
  asset_id             INTEGER NOT NULL REFERENCES assets(id),
  quantity             INTEGER NOT NULL,
  original_currency    TEXT NOT NULL,
  gbp_equivalent_pence INTEGER NOT NULL,
  valid_from           DATE NOT NULL,
  valid_to             DATE,
  recorded_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id            INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE person_profile (
  id            INTEGER PRIMARY KEY,
  employer_name TEXT NOT NULL,
  tax_code      TEXT NOT NULL,
  salary_pence  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'GBP',
  valid_from    DATE NOT NULL,
  valid_to      DATE,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id     INTEGER NOT NULL REFERENCES documents(id)
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
  db.exec(DROP_DDL);
  db.exec(DDL);
  db.pragma("foreign_keys = ON");
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialised — call initDb() first");
  }
  return db;
}

export { DOCUMENTS_DIR, DB_PATH };
