import type Database from "better-sqlite3";

const UP = `
CREATE TABLE oauth_client (
  client_id                   TEXT PRIMARY KEY,
  client_name                 TEXT,
  redirect_uris               TEXT NOT NULL,
  token_endpoint_auth_method  TEXT,
  grant_types                 TEXT,
  response_types              TEXT,
  scope                       TEXT,
  created_at                  INTEGER NOT NULL,
  disabled                    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oauth_authorization_code (
  code_hash              TEXT PRIMARY KEY,
  client_id              TEXT NOT NULL,
  redirect_uri           TEXT NOT NULL,
  code_challenge         TEXT NOT NULL,
  code_challenge_method  TEXT NOT NULL,
  scope                  TEXT,
  resource               TEXT,
  subject                TEXT NOT NULL,
  expires_at             INTEGER NOT NULL,
  used                   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oauth_refresh_token (
  token_hash   TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  subject      TEXT NOT NULL,
  scope        TEXT,
  resource     TEXT,
  expires_at   INTEGER NOT NULL,
  rotated_to   TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE webauthn_credential (
  credential_id  TEXT PRIMARY KEY,
  public_key     TEXT NOT NULL,
  counter        INTEGER NOT NULL,
  transports     TEXT,
  label          TEXT,
  created_at     INTEGER NOT NULL,
  last_used_at   INTEGER
);

CREATE TABLE webauthn_challenge (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  challenge   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE enrollment_token (
  token_hash  TEXT PRIMARY KEY,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pending_authorization (
  id                     TEXT PRIMARY KEY,
  client_id              TEXT NOT NULL,
  redirect_uri           TEXT NOT NULL,
  code_challenge         TEXT NOT NULL,
  code_challenge_method  TEXT NOT NULL,
  scope                  TEXT,
  resource               TEXT,
  state                  TEXT,
  expires_at             INTEGER NOT NULL
);
`;

const DOWN = `
DROP TABLE pending_authorization;
DROP TABLE enrollment_token;
DROP TABLE webauthn_challenge;
DROP TABLE webauthn_credential;
DROP TABLE oauth_refresh_token;
DROP TABLE oauth_authorization_code;
DROP TABLE oauth_client;
`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
