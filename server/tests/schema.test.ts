import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM equity_vesting_event;
    DELETE FROM equity_grant;
    DELETE FROM income_events;
    DELETE FROM account_balances;
    DELETE FROM transactions;
    DELETE FROM pension_values;
    DELETE FROM mortgage_balance;
    DELETE FROM asset_prices;
    DELETE FROM holdings;
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
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("accounts");
    expect(tables).toContain("assets");
    expect(tables).toContain("mortgages");
    expect(tables).toContain("tax_periods");
    expect(tables).toContain("equity_grant");
  });

  it("creates all event tables", () => {
    const db = getDb();
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("transactions");
    expect(tables).toContain("income_events");
    expect(tables).toContain("equity_vesting_event");
  });

  it("creates all snapshot tables", () => {
    const db = getDb();
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("account_balances");
    expect(tables).toContain("pension_values");
    expect(tables).toContain("mortgage_balance");
    expect(tables).toContain("holdings");
    expect(tables).toContain("asset_prices");
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

  it("has a nullable tax_code column", () => {
    const db = getDb();
    const col = (
      db.prepare("PRAGMA table_info(income_events)").all() as {
        name: string;
        notnull: number;
      }[]
    ).find((r) => r.name === "tax_code");
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(0);
  });
});

describe("equity_grant columns", () => {
  it("has the expected typed columns and payload", () => {
    const db = getDb();
    const cols = (
      db.prepare("PRAGMA table_info(equity_grant)").all() as { name: string }[]
    ).map((r) => r.name);
    expect(cols).toContain("scheme_type");
    expect(cols).toContain("units");
    expect(cols).toContain("strike_pence");
    expect(cols).toContain("grant_date");
    expect(cols).toContain("source_id");
    expect(cols).toContain("payload");
  });

  it("rejects an invalid scheme_type", () => {
    const db = getDb();
    const doc = db
      .prepare(
        "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('manual', '/tmp/x.json', 'abc')",
      )
      .run();
    expect(() => {
      db.prepare(
        "INSERT INTO equity_grant (scheme_type, units, grant_date, source_id) VALUES ('invalid', 100, '2026-01-01', ?)",
      ).run(doc.lastInsertRowid);
    }).toThrow();
  });

  it("accepts a valid RSU grant with payload", () => {
    const db = getDb();
    const doc = db
      .prepare(
        "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('manual', '/tmp/g.json', 'def')",
      )
      .run();
    expect(() => {
      db.prepare(
        `INSERT INTO equity_grant (scheme_type, units, grant_date, source_id, payload)
         VALUES ('rsu', 1000, '2026-01-01', ?, ?)`,
      ).run(doc.lastInsertRowid, JSON.stringify({ current_price_pence: 500 }));
    }).not.toThrow();
  });
});

describe("equity_vesting_event columns", () => {
  it("has the expected typed columns and payload", () => {
    const db = getDb();
    const cols = (
      db.prepare("PRAGMA table_info(equity_vesting_event)").all() as { name: string }[]
    ).map((r) => r.name);
    expect(cols).toContain("grant_id");
    expect(cols).toContain("vest_date");
    expect(cols).toContain("units_vested");
    expect(cols).toContain("market_price_pence");
    expect(cols).toContain("estimated_value_pence");
    expect(cols).toContain("source_id");
    expect(cols).toContain("payload");
  });

  it("enforces FK to equity_grant", () => {
    const db = getDb();
    const doc = db
      .prepare(
        "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('manual', '/tmp/v.json', 'ghi')",
      )
      .run();
    expect(() => {
      db.prepare(
        `INSERT INTO equity_vesting_event
           (grant_id, vest_date, units_vested, occurred_at, source_id)
         VALUES (9999, '2026-06-01', 100, '2026-06-01T00:00:00.000Z', ?)`,
      ).run(doc.lastInsertRowid);
    }).toThrow();
  });
});

describe("income_events constraints", () => {
  it("rejects an insert with no source_id at the constraint level", () => {
    const db = getDb();
    expect(() => {
      db.prepare(
        `
        INSERT INTO income_events (
          pay_date, gross_pence, net_pence, paye_pence,
          ni_employee_pence, pension_employee_pence, currency, occurred_at
        ) VALUES ('2026-05-22', 974521, 540832, 332767, 36240, 106016, 'GBP', '2026-05-22T00:00:00.000Z')
      `,
      ).run();
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
      db.prepare(
        `
        INSERT INTO income_events (
          pay_date, gross_pence, net_pence, paye_pence,
          ni_employee_pence, pension_employee_pence, currency, occurred_at, source_id
        ) VALUES ('2026-05-22', 974521, 540832, 332767, 36240, 106016, 'GBP', '2026-05-22T00:00:00.000Z', ?)
      `,
      ).run(docResult.lastInsertRowid);
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

    db.prepare(
      `
      INSERT INTO income_events (
        pay_date, tax_year, gross_pence, taxable_pence, net_pence, paye_pence,
        ni_employee_pence, pension_employee_pence, pension_employer_pence,
        currency, occurred_at, source_id
      ) VALUES (
        '2026-05-22', NULL, 974521, 988965, 540832, 332767,
        36240, 106016, 106015,
        'GBP', '2026-05-22T00:00:00.000Z', ?
      )
    `,
    ).run(docResult.lastInsertRowid);

    const row = db.prepare("SELECT * FROM income_events LIMIT 1").get() as Record<
      string,
      unknown
    >;

    expect(row.gross_pence).toBe(974521);
    expect(row.taxable_pence).toBe(988965);
    expect(row.net_pence).toBe(540832);
    expect(row.paye_pence).toBe(332767);
    expect(row.ni_employee_pence).toBe(36240);
    expect(row.pension_employee_pence).toBe(106016);
    expect(row.pension_employer_pence).toBe(106015);
  });
});
