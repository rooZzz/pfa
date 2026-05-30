import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getKysely, initDb } from "../db.js";
import { averageMonthlyOutgoings, isaAllowanceRemaining } from "../metrics/index.js";
import { resetDuck } from "../query.js";
import { recordTransaction } from "../tools/record_transaction.js";

const AS_OF = "2026-03-01";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM transactions;
    DELETE FROM account_balances;
    DELETE FROM accounts;
    DELETE FROM documents;
  `);
});

async function markInternalByDescription(description: string): Promise<void> {
  await getKysely()
    .updateTable("transactions")
    .set({ is_internal: 1 })
    .where("description", "=", description)
    .execute();
}

describe("is_internal exclusion", () => {
  it("excludes internal transfers from average monthly outgoings", async () => {
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -5000,
      category: "groceries",
      description: "real spend",
      occurred_at: "2026-02-10",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -100000,
      category: "transfers",
      description: "pot deposit",
      occurred_at: "2026-02-11",
      currency: "GBP",
    });
    await markInternalByDescription("pot deposit");

    const outgoings = await averageMonthlyOutgoings(AS_OF);
    expect(outgoings.resolved).toBe(true);
    expect(outgoings.value).toBe(5000);
  });

  it("excludes savings-category outflows from average monthly outgoings", async () => {
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -5000,
      category: "groceries",
      occurred_at: "2026-02-10",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Monzo",
      account_type: "current",
      amount_pence: -100000,
      category: "savings",
      description: "to investments",
      occurred_at: "2026-02-11",
      currency: "GBP",
    });

    const outgoings = await averageMonthlyOutgoings(AS_OF);
    expect(outgoings.resolved).toBe(true);
    expect(outgoings.value).toBe(5000);
  });

  it("still counts an internal transfer into an ISA as a contribution", async () => {
    await recordTransaction({
      account_name: "Monzo Cash ISA",
      account_type: "isa",
      amount_pence: 80000,
      category: "transfers",
      description: "isa top up",
      occurred_at: "2026-02-04",
      currency: "GBP",
    });
    await markInternalByDescription("isa top up");

    const result = await isaAllowanceRemaining(AS_OF, "2025/26");
    expect(result.resolved).toBe(true);
    expect(result.detail.contributions_pence).toBe(80000);
    expect(result.value).toBe((result.detail.allowance_pence as number) - 80000);
  });
});
