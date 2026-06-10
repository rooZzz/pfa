import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../core/db.js";
import {
  averageMonthlyOutgoings,
  emergencyFundMonths,
  isaAllowanceRemaining,
  liquidSavings,
} from "../metrics/index.js";
import { resetDuck } from "../query/query.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
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

async function seedLiquid() {
  await recordAccountBalance({
    account_name: "Barclays",
    account_type: "current",
    balance_pence: 500000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  await recordAccountBalance({
    account_name: "Nationwide",
    account_type: "savings",
    balance_pence: 1000000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  await recordAccountBalance({
    account_name: "Vanguard",
    account_type: "isa",
    balance_pence: 2000000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
}

async function seedOutgoings() {
  await recordTransaction({
    account_name: "Barclays",
    account_type: "current",
    amount_pence: -100000,
    category: "groceries",
    occurred_at: "2026-01-15",
    currency: "GBP",
  });
  await recordTransaction({
    account_name: "Barclays",
    account_type: "current",
    amount_pence: -300000,
    category: "bills",
    occurred_at: "2026-02-15",
    currency: "GBP",
  });
}

describe("liquidSavings", () => {
  it("sums the latest balance across current, savings, and ISA accounts", async () => {
    await seedLiquid();
    const result = await liquidSavings(AS_OF);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(3500000);
    expect(result.detail.accounts).toBe(3);
  });

  it("is unresolved when no liquid balances exist", async () => {
    const result = await liquidSavings(AS_OF);
    expect(result.resolved).toBe(false);
    expect(result.value).toBeNull();
    expect(result.gap_reason).toBeTruthy();
  });
});

describe("averageMonthlyOutgoings", () => {
  it("averages monthly outflow across months that had spending", async () => {
    await seedOutgoings();
    const result = await averageMonthlyOutgoings(AS_OF);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(200000);
    expect(result.detail.months).toBe(2);
  });

  it("is unresolved when there are no spending transactions", async () => {
    const result = await averageMonthlyOutgoings(AS_OF);
    expect(result.resolved).toBe(false);
    expect(result.value).toBeNull();
  });
});

describe("emergencyFundMonths", () => {
  it("divides liquid savings by average monthly outgoings", async () => {
    await seedLiquid();
    await seedOutgoings();
    const result = await emergencyFundMonths(AS_OF);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(17.5);
  });

  it("is unresolved (data gap) when outgoings cannot be computed", async () => {
    await seedLiquid();
    const result = await emergencyFundMonths(AS_OF);
    expect(result.resolved).toBe(false);
    expect(result.gap_reason).toBeTruthy();
  });
});

describe("isaAllowanceRemaining", () => {
  it("subtracts ISA inflow contributions in the tax year from the allowance", async () => {
    await recordAccountBalance({
      account_name: "Vanguard",
      account_type: "isa",
      balance_pence: 2000000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordTransaction({
      account_name: "Vanguard",
      account_type: "isa",
      amount_pence: 500000,
      category: "general",
      occurred_at: "2026-01-10",
      currency: "GBP",
    });
    const result = await isaAllowanceRemaining(AS_OF);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(1500000);
    expect(result.detail.allowance_pence).toBe(2000000);
    expect(result.detail.contributions_pence).toBe(500000);
    expect(result.detail.tax_year).toBe("2025/26");
  });

  it("is unresolved (data gap) when no ISA account exists", async () => {
    const result = await isaAllowanceRemaining(AS_OF);
    expect(result.resolved).toBe(false);
    expect(result.value).toBeNull();
  });
});
