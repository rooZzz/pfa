import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { recordTransaction } from "../tools/record_transaction.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM transactions;
    DELETE FROM account_balances;
    DELETE FROM documents;
    DELETE FROM accounts;
  `);
});

describe("recordTransaction", () => {
  it("creates an account and writes a transaction linked to a document", async () => {
    await recordTransaction({
      account_name: "Barclays Current",
      account_type: "current",
      amount_pence: -4500,
      category: "groceries",
      description: "Tesco",
      occurred_at: "2026-04-10",
      currency: "GBP",
    });

    const db = getDb();
    const account = db
      .prepare("SELECT name, type FROM accounts WHERE type = 'current' LIMIT 1")
      .get() as { name: string; type: string };
    expect(account.name).toBe("Barclays Current");
    expect(account.type).toBe("current");

    const tx = db
      .prepare(
        "SELECT amount_pence, category, description, currency, source_id FROM transactions LIMIT 1",
      )
      .get() as {
      amount_pence: number;
      category: string;
      description: string;
      currency: string;
      source_id: number;
    };
    expect(tx.amount_pence).toBe(-4500);
    expect(tx.category).toBe("groceries");
    expect(tx.description).toBe("Tesco");
    expect(tx.currency).toBe("GBP");
    expect(tx.source_id).toBeGreaterThan(0);
  });

  it("writes the audit JSON file to disk", async () => {
    await recordTransaction({
      account_name: "Barclays Current",
      account_type: "current",
      amount_pence: -4500,
      category: "transport",
      occurred_at: "2026-04-10",
      currency: "GBP",
    });

    const doc = getDb().prepare("SELECT file_path FROM documents LIMIT 1").get() as {
      file_path: string;
    };
    expect(fs.existsSync(doc.file_path)).toBe(true);
    const content = JSON.parse(fs.readFileSync(doc.file_path, "utf-8")) as {
      entry_type: string;
      category: string;
    };
    expect(content.entry_type).toBe("transaction");
    expect(content.category).toBe("transport");
  });

  it("records a positive inflow transaction", async () => {
    await recordTransaction({
      account_name: "Barclays Current",
      account_type: "current",
      amount_pence: 25000,
      category: "income",
      description: "Freelance payment",
      occurred_at: "2026-04-20",
      currency: "GBP",
    });

    const tx = getDb()
      .prepare("SELECT amount_pence, category FROM transactions LIMIT 1")
      .get() as { amount_pence: number; category: string };
    expect(tx.amount_pence).toBe(25000);
    expect(tx.category).toBe("income");
  });

  it("reuses an existing account without creating a duplicate", async () => {
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -1000,
      category: "eating_out",
      occurred_at: "2026-04-10",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -2000,
      category: "transport",
      occurred_at: "2026-04-15",
      currency: "GBP",
    });

    const db = getDb();
    const accountCount = (
      db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE name = 'Monzo'").get() as { c: number }
    ).c;
    expect(accountCount).toBe(1);

    const txCount = (db.prepare("SELECT COUNT(*) AS c FROM transactions").get() as { c: number })
      .c;
    expect(txCount).toBe(2);
  });

  it("defaults category to general when omitted", async () => {
    await recordTransaction({
      account_name: "Barclays Current",
      account_type: "current",
      amount_pence: -500,
      category: "general",
      occurred_at: "2026-04-10",
      currency: "GBP",
    });

    const tx = getDb()
      .prepare("SELECT category FROM transactions LIMIT 1")
      .get() as { category: string };
    expect(tx.category).toBe("general");
  });
});
