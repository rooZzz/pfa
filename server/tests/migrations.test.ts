import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb, resetDb } from "../db.js";
import { rollbackAll, runMigrations } from "../migrations/index.js";

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
    expect(appliedMigrations()).toEqual([
      "0001_initial",
      "0002_transaction_category",
      "0003_seed_tax_periods",
      "0004_goals",
      "0005_connector",
      "0006_tax_constants",
      "0007_payslip_tax_code",
      "0008_asset_ticker",
      "0009_superseded_by",
      "0010_saye_monthly_contribution",
      "0011_asset_quantity_scale_contract",
    ]);
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
    expect(appliedMigrations()).toEqual([
      "0001_initial",
      "0002_transaction_category",
      "0003_seed_tax_periods",
      "0004_goals",
      "0005_connector",
      "0006_tax_constants",
      "0007_payslip_tax_code",
      "0008_asset_ticker",
      "0009_superseded_by",
      "0010_saye_monthly_contribution",
      "0011_asset_quantity_scale_contract",
    ]);
  });

  it("does not recreate the dead asset_values table", () => {
    expect(tableNames()).not.toContain("asset_values");
  });

  it("populates tax_periods on fresh init", () => {
    const count = (
      getDb().prepare("SELECT COUNT(*) AS n FROM tax_periods").get() as { n: number }
    ).n;
    expect(count).toBeGreaterThanOrEqual(11);
    const current = getDb()
      .prepare("SELECT tax_year FROM tax_periods WHERE starts_on = '2025-04-06'")
      .get() as { tax_year: string } | undefined;
    expect(current?.tax_year).toBe("2025/26");
  });

  it("seeds tax_constants on fresh init", () => {
    const count = (
      getDb().prepare("SELECT COUNT(*) AS n FROM tax_constants").get() as { n: number }
    ).n;
    expect(count).toBeGreaterThanOrEqual(40);
    const isa = getDb()
      .prepare(
        "SELECT value FROM tax_constants WHERE key = 'isa_allowance' AND valid_to IS NULL",
      )
      .get() as { value: number } | undefined;
    expect(isa?.value).toBe(2000000);
  });

  it("drops tax_constants when 0006 rolls back", () => {
    expect(tableNames()).toContain("tax_constants");
    rollbackAll(getDb());
    expect(tableNames()).not.toContain("tax_constants");
    runMigrations(getDb());
    expect(tableNames()).toContain("tax_constants");
  });

  it("resets cleanly when foreign-key-linked data is present", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('connector', '/tmp/run.json', 'h')",
    ).run();
    db.prepare(
      "INSERT INTO accounts (name, type, currency, provider, external_id) VALUES ('Monzo Current', 'current', 'GBP', 'monzo', 'acc_1')",
    ).run();
    db.prepare(
      "INSERT INTO transactions (account_id, occurred_at, amount_pence, currency, category, external_id, is_internal, source_id) VALUES (1, '2026-05-01', -100, 'GBP', 'general', 'tx_1', 0, 1)",
    ).run();

    expect(() => resetDb()).not.toThrow();

    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number })
        .n,
    ).toBe(0);
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n,
    ).toBe(0);
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

    expect(appliedMigrations()).toEqual([
      "0001_initial",
      "0002_transaction_category",
      "0003_seed_tax_periods",
      "0004_goals",
      "0005_connector",
      "0006_tax_constants",
      "0007_payslip_tax_code",
      "0008_asset_ticker",
      "0009_superseded_by",
      "0010_saye_monthly_contribution",
      "0011_asset_quantity_scale_contract",
    ]);
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n,
    ).toBe(0);
  });
});
