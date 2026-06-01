import type Database from "better-sqlite3";

const UP = `
ALTER TABLE equity_grant ADD COLUMN monthly_contribution_pence INTEGER;
`;

const DOWN = `
ALTER TABLE equity_grant DROP COLUMN monthly_contribution_pence;
`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
