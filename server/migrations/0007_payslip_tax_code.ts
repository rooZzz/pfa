import type Database from "better-sqlite3";

const UP = `
ALTER TABLE income_events ADD COLUMN tax_code TEXT;
`;

const DOWN = `
ALTER TABLE income_events DROP COLUMN tax_code;
`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
