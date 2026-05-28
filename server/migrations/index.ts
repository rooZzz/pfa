import type Database from "better-sqlite3";
import * as m0001 from "./0001_initial.js";
import * as m0002 from "./0002_transaction_category.js";
import * as m0003 from "./0003_seed_tax_periods.js";

type Migration = {
  name: string;
  up: (db: Database.Database) => void;
  down: (db: Database.Database) => void;
};

const MIGRATIONS: Migration[] = [
  { name: "0001_initial", ...m0001 },
  { name: "0002_transaction_category", ...m0002 },
  { name: "0003_seed_tax_periods", ...m0003 },
];

function ensureMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function appliedNames(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT name FROM schema_migrations").all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

export function runMigrations(db: Database.Database): void {
  ensureMigrationTable(db);
  const applied = appliedNames(db);
  const insert = db.prepare("INSERT INTO schema_migrations (name) VALUES (?)");
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      insert.run(migration.name);
    });
    apply();
  }
}

export function rollbackAll(db: Database.Database): void {
  ensureMigrationTable(db);
  const applied = appliedNames(db);
  const remove = db.prepare("DELETE FROM schema_migrations WHERE name = ?");
  for (const migration of [...MIGRATIONS].reverse()) {
    if (!applied.has(migration.name)) continue;
    const revert = db.transaction(() => {
      migration.down(db);
      remove.run(migration.name);
    });
    revert();
  }
}
