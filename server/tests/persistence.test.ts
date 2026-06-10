import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../core/db.js";
import { resetDuck, runQuery } from "../query/query.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  const db = getDb();
  db.exec(
    "DELETE FROM account_balances; DELETE FROM transactions; DELETE FROM accounts; DELETE FROM documents;",
  );
});

describe("record_account_balance", () => {
  it("writes a documents row with source_type='manual'", async () => {
    await recordAccountBalance({
      account_name: "Barclays Current",
      account_type: "current",
      balance_pence: 250000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });

    const row = getDb().prepare("SELECT source_type FROM documents LIMIT 1").get() as {
      source_type: string;
    };

    expect(row.source_type).toBe("manual");
  });

  it("writes an account_balances row linked to the document via source_id", async () => {
    await recordAccountBalance({
      account_name: "Barclays Current",
      account_type: "current",
      balance_pence: 250000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });

    const row = getDb()
      .prepare(
        "SELECT ab.balance_pence, ab.source_id, d.id FROM account_balances ab JOIN documents d ON d.id = ab.source_id LIMIT 1",
      )
      .get() as { balance_pence: number; source_id: number; id: number };

    expect(row.balance_pence).toBe(250000);
    expect(row.source_id).toBe(row.id);
  });

  it("upserts the account — calling twice returns the same account_id", async () => {
    await recordAccountBalance({
      account_name: "Barclays Current",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordAccountBalance({
      account_name: "Barclays Current",
      account_type: "current",
      balance_pence: 200000,
      currency: "GBP",
      valid_from: "2026-02-01",
    });

    const accountCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }
    ).n;
    expect(accountCount).toBe(1);

    const balanceCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM account_balances").get() as { n: number }
    ).n;
    expect(balanceCount).toBe(2);
  });

  it("rejects an account_balances insert with no source_id at the constraint level", () => {
    expect(() => {
      getDb()
        .prepare(
          "INSERT INTO account_balances (account_id, balance_pence, valid_from) VALUES (1, 1000, '2026-01-01')",
        )
        .run();
    }).toThrow();
  });
});

describe("DuckDB round-trip", () => {
  it("reads rows written by better-sqlite3", async () => {
    await recordAccountBalance({
      account_name: "Nationwide Savings",
      account_type: "savings",
      balance_pence: 250000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });

    const rows = await runQuery("SELECT balance_pence FROM pfa.account_balances LIMIT 1");

    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as { balance_pence: bigint }).balance_pence)).toBe(250000);
  });
});

describe("LOCF gap-fill", () => {
  beforeEach(async () => {
    await recordAccountBalance({
      account_name: "Nationwide Savings",
      account_type: "savings",
      balance_pence: 250000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordAccountBalance({
      account_name: "Nationwide Savings",
      account_type: "savings",
      balance_pence: 300000,
      currency: "GBP",
      valid_from: "2026-03-01",
    });
  });

  it("returns the last known value for a date in a gap between observations", async () => {
    const rows = await runQuery(`
      SELECT balance_pence
      FROM pfa.account_balances
      WHERE valid_from <= DATE '2026-02-01'
        AND (valid_to IS NULL OR valid_to > DATE '2026-02-01')
      ORDER BY valid_from DESC
      LIMIT 1
    `);

    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as { balance_pence: bigint }).balance_pence)).toBe(250000);
  });

  it("does not return the later observation for a date before it", async () => {
    const rows = await runQuery(`
      SELECT balance_pence
      FROM pfa.account_balances
      WHERE valid_from <= DATE '2026-02-15'
        AND (valid_to IS NULL OR valid_to > DATE '2026-02-15')
      ORDER BY valid_from DESC
      LIMIT 1
    `);

    expect(Number((rows[0] as { balance_pence: bigint }).balance_pence)).not.toBe(300000);
  });
});
