import type Database from "better-sqlite3";

const UP = `ALTER TABLE transactions ADD COLUMN category TEXT NOT NULL DEFAULT 'general'`;
const DOWN = `ALTER TABLE transactions DROP COLUMN category`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
