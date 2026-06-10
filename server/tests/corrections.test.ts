import { beforeEach, describe, expect, it } from "vitest";
import { correctRecord, retractRecord } from "../core/corrections.js";
import { getDb, initDb } from "../core/db.js";
import { queryTransactionsByCategory } from "../cashflow/transactions.js";
import { liquidSavings } from "../metrics/index.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordEquityGrant } from "../tools/record_equity_grant.js";
import { recordTransaction } from "../tools/record_transaction.js";
import { recordVestingEvent } from "../tools/record_vesting_event.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM equity_vesting_event;
    DELETE FROM equity_grant;
    DELETE FROM account_balances;
    DELETE FROM transactions;
    DELETE FROM documents;
    DELETE FROM accounts;
    DELETE FROM assets;
  `);
});

function balanceIds(): number[] {
  return (
    getDb().prepare("SELECT id FROM account_balances ORDER BY id").all() as {
      id: number;
    }[]
  ).map((r) => r.id);
}

describe("correctRecord", () => {
  it("supersedes the wrong row and the corrected value becomes current truth", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    const [originalId] = balanceIds();

    await correctRecord({
      series: "account_balance",
      row_id: originalId!,
      corrected_fields: { balance_pence: 110000 },
      reason: "Typed the balance wrong.",
    });

    const liquid = await liquidSavings("2026-06-01");
    expect(liquid.value).toBe(110000);

    const original = getDb()
      .prepare(
        "SELECT balance_pence, valid_from, superseded_by FROM account_balances WHERE id = ?",
      )
      .get(originalId) as {
      balance_pence: number;
      valid_from: string;
      superseded_by: number | null;
    };
    expect(original.balance_pence).toBe(100000);
    expect(original.superseded_by).not.toBeNull();

    const corrected = getDb()
      .prepare(
        "SELECT balance_pence, valid_from, superseded_by FROM account_balances WHERE id = ?",
      )
      .get(original.superseded_by) as {
      balance_pence: number;
      valid_from: string;
      superseded_by: number | null;
    };
    expect(corrected.balance_pence).toBe(110000);
    expect(corrected.valid_from).toBe("2026-01-01");
    expect(corrected.superseded_by).toBeNull();
  });

  it("rejects a field that is not correctable for the series", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    const [id] = balanceIds();

    await expect(
      correctRecord({
        series: "account_balance",
        row_id: id!,
        corrected_fields: { account_id: 5 },
        reason: "nope",
      }),
    ).rejects.toThrow(/Cannot correct account_id/);
  });

  it("refuses to edit a connector-sourced row", async () => {
    const docId = Number(
      getDb()
        .prepare(
          "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('connector', 'monzo', 'hash')",
        )
        .run().lastInsertRowid,
    );
    const rowId = Number(
      getDb()
        .prepare(
          "INSERT INTO account_balances (account_id, balance_pence, valid_from, source_id) VALUES (999, 50000, '2026-01-01', ?)",
        )
        .run(docId).lastInsertRowid,
    );

    await expect(
      correctRecord({
        series: "account_balance",
        row_id: rowId,
        corrected_fields: { balance_pence: 60000 },
        reason: "x",
      }),
    ).rejects.toThrow(/connector/);
  });
});

describe("retractRecord", () => {
  it("re-exposes the previous observation when a later one is retracted", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 110000,
      currency: "GBP",
      valid_from: "2026-02-01",
    });
    const ids = balanceIds();

    await retractRecord({
      series: "account_balance",
      row_id: ids[1]!,
      reason: "That observation never happened.",
    });

    const liquid = await liquidSavings("2026-03-01");
    expect(liquid.value).toBe(100000);
  });

  it("retracting the only observation leaves the series untracked", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    const [id] = balanceIds();

    await retractRecord({
      series: "account_balance",
      row_id: id!,
      reason: "Duplicate.",
    });

    const liquid = await liquidSavings("2026-06-01");
    expect(liquid.resolved).toBe(false);
    expect(liquid.value).toBeNull();
  });

  it("excludes a retracted transaction from cashflow by category", async () => {
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -5000,
      category: "groceries",
      description: "Tesco",
      occurred_at: "2026-05-10",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -3000,
      category: "groceries",
      description: "Duplicate Tesco",
      occurred_at: "2026-05-11",
      currency: "GBP",
    });
    const txIds = (
      getDb().prepare("SELECT id FROM transactions ORDER BY id").all() as { id: number }[]
    ).map((r) => r.id);

    await retractRecord({
      series: "transaction",
      row_id: txIds[1]!,
      reason: "Entered twice.",
    });

    const byCategory = await queryTransactionsByCategory("2026-04-06", "2026-06-01");
    const groceries = byCategory.find((c) => c.category === "groceries");
    expect(groceries?.outflow_pence).toBe(5000);
    expect(groceries?.count).toBe(1);
  });

  it("retracting an equity grant cascades to its vesting events", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
    });
    const grantId = (
      getDb().prepare("SELECT id FROM equity_grant LIMIT 1").get() as { id: number }
    ).id;
    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-01-01",
      units_vested: 250,
      market_price_pence: 55000,
    });

    await retractRecord({
      series: "equity_grant",
      row_id: grantId,
      reason: "Recorded against the wrong scheme.",
    });

    const grant = getDb()
      .prepare("SELECT superseded_by FROM equity_grant WHERE id = ?")
      .get(grantId) as { superseded_by: number | null };
    expect(grant.superseded_by).not.toBeNull();

    const vest = getDb()
      .prepare("SELECT superseded_by FROM equity_vesting_event WHERE grant_id = ?")
      .get(grantId) as { superseded_by: number | null };
    expect(vest.superseded_by).not.toBeNull();
  });

  it("refuses to retract an already-superseded row", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    const [id] = balanceIds();
    await retractRecord({ series: "account_balance", row_id: id!, reason: "first" });

    await expect(
      retractRecord({ series: "account_balance", row_id: id!, reason: "again" }),
    ).rejects.toThrow(/already been superseded/);
  });
});
