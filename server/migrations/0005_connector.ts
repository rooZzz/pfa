import type Database from "better-sqlite3";

const UP = `
ALTER TABLE transactions ADD COLUMN external_id TEXT;
ALTER TABLE transactions ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_transactions_external_id ON transactions(external_id);

ALTER TABLE accounts ADD COLUMN provider TEXT;
ALTER TABLE accounts ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_accounts_provider_external_id ON accounts(provider, external_id);

CREATE TABLE connector_state (
  id              INTEGER PRIMARY KEY,
  provider        TEXT NOT NULL UNIQUE,
  client_id       TEXT NOT NULL,
  client_secret   TEXT NOT NULL,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  expires_at      TIMESTAMP,
  cursors_json    TEXT NOT NULL DEFAULT '{}',
  last_synced_at  TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const DOWN = `
DROP TABLE IF EXISTS connector_state;
DROP INDEX IF EXISTS idx_accounts_provider_external_id;
ALTER TABLE accounts DROP COLUMN external_id;
ALTER TABLE accounts DROP COLUMN provider;
DROP INDEX IF EXISTS idx_transactions_external_id;
ALTER TABLE transactions DROP COLUMN is_internal;
ALTER TABLE transactions DROP COLUMN external_id;
`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
