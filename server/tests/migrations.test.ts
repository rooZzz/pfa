import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb, resetDb } from "../db.js";

function tableNames(): string[] {
  return (
    getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function appliedMigrations(): string[] {
  return (
    getDb().prepare("SELECT name FROM schema_migrations ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

beforeEach(() => {
  initDb();
  resetDb();
});

describe("migration runner", () => {
  it("records applied migrations in schema_migrations", () => {
    expect(appliedMigrations()).toEqual(["0001_initial"]);
  });

  it("creates the full schema on initial migration", () => {
    const tables = tableNames();
    expect(tables).toContain("documents");
    expect(tables).toContain("account_balances");
    expect(tables).toContain("equity_grant");
  });

  it("is idempotent — a second initDb does not re-run or duplicate", () => {
    initDb();
    initDb();
    expect(appliedMigrations()).toEqual(["0001_initial"]);
  });

  it("does not recreate the dead asset_values table", () => {
    expect(tableNames()).not.toContain("asset_values");
  });

  it("resetDb rolls all migrations down and back up", () => {
    getDb()
      .prepare(
        "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('manual', '/tmp/x.json', 'abc')",
      )
      .run();
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n,
    ).toBe(1);

    resetDb();

    expect(appliedMigrations()).toEqual(["0001_initial"]);
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n,
    ).toBe(0);
  });
});
