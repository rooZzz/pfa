import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec("ALTER TABLE secrets.webauthn_challenge ADD COLUMN req TEXT;");
}

export function down(db: Database.Database): void {
  db.exec("ALTER TABLE secrets.webauthn_challenge DROP COLUMN req;");
}
