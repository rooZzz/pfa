import type Database from "better-sqlite3";

const TABLES: { name: string; body: string }[] = [
  {
    name: "connector_state",
    body: `
      id              INTEGER PRIMARY KEY,
      provider        TEXT NOT NULL UNIQUE,
      client_id       TEXT NOT NULL,
      client_secret   TEXT NOT NULL,
      access_token    TEXT NOT NULL,
      refresh_token   TEXT NOT NULL,
      expires_at      TIMESTAMP,
      cursors_json    TEXT NOT NULL DEFAULT '{}',
      last_synced_at  TIMESTAMP,
      updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  },
  {
    name: "oauth_client",
    body: `
      client_id                   TEXT PRIMARY KEY,
      client_name                 TEXT,
      redirect_uris               TEXT NOT NULL,
      token_endpoint_auth_method  TEXT,
      grant_types                 TEXT,
      response_types              TEXT,
      scope                       TEXT,
      created_at                  INTEGER NOT NULL,
      disabled                    INTEGER NOT NULL DEFAULT 0`,
  },
  {
    name: "oauth_authorization_code",
    body: `
      code_hash              TEXT PRIMARY KEY,
      client_id              TEXT NOT NULL,
      redirect_uri           TEXT NOT NULL,
      code_challenge         TEXT NOT NULL,
      code_challenge_method  TEXT NOT NULL,
      scope                  TEXT,
      resource               TEXT,
      subject                TEXT NOT NULL,
      expires_at             INTEGER NOT NULL,
      used                   INTEGER NOT NULL DEFAULT 0`,
  },
  {
    name: "oauth_refresh_token",
    body: `
      token_hash   TEXT PRIMARY KEY,
      client_id    TEXT NOT NULL,
      subject      TEXT NOT NULL,
      scope        TEXT,
      resource     TEXT,
      expires_at   INTEGER NOT NULL,
      rotated_to   TEXT,
      revoked      INTEGER NOT NULL DEFAULT 0`,
  },
  {
    name: "webauthn_credential",
    body: `
      credential_id  TEXT PRIMARY KEY,
      public_key     TEXT NOT NULL,
      counter        INTEGER NOT NULL,
      transports     TEXT,
      label          TEXT,
      created_at     INTEGER NOT NULL,
      last_used_at   INTEGER`,
  },
  {
    name: "webauthn_challenge",
    body: `
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      challenge   TEXT NOT NULL,
      expires_at  INTEGER NOT NULL`,
  },
  {
    name: "enrollment_token",
    body: `
      token_hash  TEXT PRIMARY KEY,
      expires_at  INTEGER NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0`,
  },
  {
    name: "pending_authorization",
    body: `
      id                     TEXT PRIMARY KEY,
      client_id              TEXT NOT NULL,
      redirect_uri           TEXT NOT NULL,
      code_challenge         TEXT NOT NULL,
      code_challenge_method  TEXT NOT NULL,
      scope                  TEXT,
      resource               TEXT,
      state                  TEXT,
      expires_at             INTEGER NOT NULL`,
  },
];

function move(db: Database.Database, fromSchema: string, toSchema: string): void {
  for (const { name, body } of TABLES) {
    db.exec(`CREATE TABLE ${toSchema}.${name} (${body});`);
    db.exec(`INSERT INTO ${toSchema}.${name} SELECT * FROM ${fromSchema}.${name};`);
    db.exec(`DROP TABLE ${fromSchema}.${name};`);
  }
}

export function up(db: Database.Database): void {
  move(db, "main", "secrets");
}

export function down(db: Database.Database): void {
  move(db, "secrets", "main");
}
