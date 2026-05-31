import type Database from "better-sqlite3";

const UP = `
ALTER TABLE assets ADD COLUMN ticker TEXT;
`;

const DOWN = `
ALTER TABLE assets DROP COLUMN ticker;
`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
