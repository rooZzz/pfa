import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(
    "ALTER TABLE secrets.webauthn_credential ADD COLUMN scope TEXT NOT NULL DEFAULT 'pfa:write'",
  );
  db.exec(
    "ALTER TABLE secrets.enrollment_token ADD COLUMN scope TEXT NOT NULL DEFAULT 'pfa:write'",
  );
}

export function down(db: Database.Database): void {
  db.exec("ALTER TABLE secrets.webauthn_credential DROP COLUMN scope");
  db.exec("ALTER TABLE secrets.enrollment_token DROP COLUMN scope");
}
