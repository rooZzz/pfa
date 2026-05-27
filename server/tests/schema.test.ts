import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM income_events;
    DELETE FROM account_balances;
    DELETE FROM transactions;
    DELETE FROM pension_values;
    DELETE FROM mortgage_balance;
    DELETE FROM asset_values;
    DELETE FROM person_profile;
    DELETE FROM documents;
    DELETE FROM accounts;
    DELETE FROM assets;
    DELETE FROM mortgages;
  `);
});

describe("full schema", () => {
  it("creates all reference tables", () => {
    const db = getDb();
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("accounts");
    expect(tables).toContain("assets");
    expect(tables).toContain("mortgages");
    expect(tables).toContain("tax_periods");
  });

  it("creates all event tables", () => {
    const db = getDb();
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("transactions");
    expect(tables).toContain("income_events");
  });

  it("creates all snapshot tables", () => {
    const db = getDb();
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("account_balances");
    expect(tables).toContain("pension_values");
    expect(tables).toContain("mortgage_balance");
    expect(tables).toContain("asset_values");
    expect(tables).toContain("person_profile");
  });
});

describe("income_events columns", () => {
  it("has a payload column", () => {
    const db = getDb();
    const cols = (
      db.prepare("PRAGMA table_info(income_events)").all() as { name: string }[]
    ).map((r) => r.name);
    expect(cols).toContain("payload");
  });
});

describe("income_events constraints", () => {
  it("rejects an insert with no source_id at the constraint level", () => {
    const db = getDb();
    expect(() => {
      db.prepare(`
        INSERT INTO income_events (
          pay_date, gross_pence, net_pence, paye_pence,
          ni_employee_pence, pension_employee_pence, currency, occurred_at
        ) VALUES ('2026-05-22', 974521, 540832, 332767, 36240, 106016, 'GBP', '2026-05-22T00:00:00.000Z')
      `).run();
    }).toThrow();
  });

  it("accepts an insert with nullable fields absent", () => {
    const db = getDb();
    const docResult = db
      .prepare(
        "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('upload', '/tmp/test.pdf', 'abc123')",
      )
      .run();

    expect(() => {
      db.prepare(`
        INSERT INTO income_events (
          pay_date, gross_pence, net_pence, paye_pence,
          ni_employee_pence, pension_employee_pence, currency, occurred_at, source_id
        ) VALUES ('2026-05-22', 974521, 540832, 332767, 36240, 106016, 'GBP', '2026-05-22T00:00:00.000Z', ?)
      `).run(docResult.lastInsertRowid);
    }).not.toThrow();

    const row = db
      .prepare("SELECT taxable_pence, pension_employer_pence FROM income_events LIMIT 1")
      .get() as { taxable_pence: null; pension_employer_pence: null };

    expect(row.taxable_pence).toBeNull();
    expect(row.pension_employer_pence).toBeNull();
  });

  it("stores and retrieves all numeric fields as exact integers", () => {
    const db = getDb();
    const docResult = db
      .prepare(
        "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('upload', '/tmp/test2.pdf', 'def456')",
      )
      .run();

    db.prepare(`
      INSERT INTO income_events (
        pay_date, tax_year, gross_pence, taxable_pence, net_pence, paye_pence,
        ni_employee_pence, pension_employee_pence, pension_employer_pence,
        currency, occurred_at, source_id
      ) VALUES (
        '2026-05-22', NULL, 974521, 988965, 540832, 332767,
        36240, 106016, 106015,
        'GBP', '2026-05-22T00:00:00.000Z', ?
      )
    `).run(docResult.lastInsertRowid);

    const row = db
      .prepare("SELECT * FROM income_events LIMIT 1")
      .get() as Record<string, unknown>;

    expect(row.gross_pence).toBe(974521);
    expect(row.taxable_pence).toBe(988965);
    expect(row.net_pence).toBe(540832);
    expect(row.paye_pence).toBe(332767);
    expect(row.ni_employee_pence).toBe(36240);
    expect(row.pension_employee_pence).toBe(106016);
    expect(row.pension_employer_pence).toBe(106015);
  });
});
