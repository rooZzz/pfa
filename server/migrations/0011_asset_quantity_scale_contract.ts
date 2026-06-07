import type Database from "better-sqlite3";

const UP = `
ALTER TABLE assets ADD COLUMN quantity_scale INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assets ADD COLUMN contract_address TEXT;
`;

const DOWN = `
ALTER TABLE assets DROP COLUMN contract_address;
ALTER TABLE assets DROP COLUMN quantity_scale;
`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
