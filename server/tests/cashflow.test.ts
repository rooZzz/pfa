import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getKysely, initDb } from "../db.js";
import { writeManualDocument } from "../references.js";
import { resetDuck } from "../query.js";
import { getCashflow } from "../cashflow/index.js";
import { recordTransaction } from "../tools/record_transaction.js";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM transactions;
    DELETE FROM income_events;
    DELETE FROM account_balances;
    DELETE FROM documents;
    DELETE FROM accounts;
    DELETE FROM tax_periods;
  `);
  getDb().exec(`
    INSERT INTO tax_periods (tax_year, starts_on, ends_on) VALUES
      ('2025/26', '2025-04-06', '2026-04-05'),
      ('2026/27', '2026-04-06', '2027-04-05')
  `);
});

async function insertIncome(
  payDate: string,
  gross: number,
  net: number,
  paye: number,
  ni: number,
  pension: number,
): Promise<void> {
  await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "income_event_seed",
        pay_date: payDate,
        gross_pence: gross,
        net_pence: net,
      });
      await trx
        .insertInto("income_events")
        .values({
          pay_date: payDate,
          gross_pence: gross,
          net_pence: net,
          paye_pence: paye,
          ni_employee_pence: ni,
          pension_employee_pence: pension,
          occurred_at: `${payDate}T00:00:00.000Z`,
          source_id: sourceId,
        })
        .execute();
    });
}

describe("getCashflow", () => {
  it("throws when no tax period covers the date", async () => {
    getDb().exec("DELETE FROM tax_periods");
    await expect(getCashflow({})).rejects.toThrow(/No tax period found/);
  });

  it("throws when an explicit tax_year is not found", async () => {
    await expect(getCashflow({ tax_year: "1999/00" })).rejects.toThrow(
      /not found in tax_periods/,
    );
  });

  it("resolves period from as_of when no tax_year supplied", async () => {
    const result = await getCashflow({ as_of: "2025-12-01" });
    expect(result.tax_year).toBe("2025/26");
    expect(result.period_start).toBe("2025-04-06");
    expect(result.period_end).toBe("2026-04-05");
  });

  it("resolves period from explicit tax_year", async () => {
    const result = await getCashflow({ tax_year: "2026/27" });
    expect(result.tax_year).toBe("2026/27");
    expect(result.period_start).toBe("2026-04-06");
  });

  it("returns zero income and empty categories when no data", async () => {
    const result = await getCashflow({ tax_year: "2025/26" });
    expect(result.income.payslip_count).toBe(0);
    expect(result.income.net_pence).toBe(0);
    expect(result.transactions_by_category).toHaveLength(0);
    expect(result.net_cashflow_pence).toBe(0);
  });

  it("aggregates income from income_events in the period", async () => {
    await insertIncome("2025-06-25", 600000, 450000, 120000, 20000, 10000);
    await insertIncome("2025-07-25", 600000, 451000, 119500, 20000, 10000);

    const result = await getCashflow({ tax_year: "2025/26" });
    expect(result.income.payslip_count).toBe(2);
    expect(result.income.gross_pence).toBe(1200000);
    expect(result.income.net_pence).toBe(901000);
    expect(result.income.paye_pence).toBe(239500);
  });

  it("excludes income_events outside the period", async () => {
    await insertIncome("2025-04-05", 600000, 450000, 120000, 20000, 10000);
    await insertIncome("2025-04-06", 600000, 451000, 119500, 20000, 10000);
    await insertIncome("2026-04-06", 600000, 450000, 120000, 20000, 10000);

    const result = await getCashflow({ tax_year: "2025/26" });
    expect(result.income.payslip_count).toBe(1);
    expect(result.income.net_pence).toBe(451000);
  });

  it("aggregates transactions by category", async () => {
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -5000,
      category: "groceries",
      occurred_at: "2025-06-10",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -3000,
      category: "groceries",
      occurred_at: "2025-07-10",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -8000,
      category: "bills",
      occurred_at: "2025-08-01",
      currency: "GBP",
    });

    const result = await getCashflow({ tax_year: "2025/26" });
    const groceries = result.transactions_by_category.find((l) => l.category === "groceries");
    const bills = result.transactions_by_category.find((l) => l.category === "bills");

    expect(groceries?.outflow_pence).toBe(8000);
    expect(groceries?.count).toBe(2);
    expect(bills?.outflow_pence).toBe(8000);
  });

  it("separates inflows and outflows correctly", async () => {
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -4000,
      category: "shopping",
      occurred_at: "2025-05-10",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: 15000,
      category: "income",
      occurred_at: "2025-05-15",
      currency: "GBP",
    });

    const result = await getCashflow({ tax_year: "2025/26" });
    expect(result.transaction_outflow_total_pence).toBe(4000);
    expect(result.transaction_inflow_total_pence).toBe(15000);
  });

  it("computes net_cashflow_pence = income.net + tx_inflows - tx_outflows", async () => {
    await insertIncome("2025-06-25", 600000, 450000, 120000, 20000, 10000);
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -30000,
      category: "bills",
      occurred_at: "2025-06-01",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: 10000,
      category: "income",
      occurred_at: "2025-06-15",
      currency: "GBP",
    });

    const result = await getCashflow({ tax_year: "2025/26" });
    expect(result.net_cashflow_pence).toBe(450000 + 10000 - 30000);
  });

  it("excludes transactions outside the period (tax year boundary)", async () => {
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -5000,
      category: "bills",
      occurred_at: "2025-04-05",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -6000,
      category: "bills",
      occurred_at: "2025-04-06",
      currency: "GBP",
    });
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -7000,
      category: "bills",
      occurred_at: "2026-04-06",
      currency: "GBP",
    });

    const result = await getCashflow({ tax_year: "2025/26" });
    const bills = result.transactions_by_category.find((l) => l.category === "bills");
    expect(bills?.outflow_pence).toBe(6000);
    expect(bills?.count).toBe(1);
  });

  it("includes a monthly trend when data exists", async () => {
    await insertIncome("2025-06-25", 600000, 450000, 120000, 20000, 10000);
    await recordTransaction({
      account_name: "Barclays",
      account_type: "current",
      amount_pence: -5000,
      category: "groceries",
      occurred_at: "2025-06-10",
      currency: "GBP",
    });

    const result = await getCashflow({ tax_year: "2025/26" });
    expect(result.trend.length).toBeGreaterThan(0);
    const june = result.trend.find((pt) => pt.month === "2025-06");
    expect(june).toBeDefined();
    expect(june?.income_net_pence).toBe(450000);
    expect(june?.transaction_outflow_pence).toBe(5000);
    expect(june?.net_pence).toBe(445000);
  });
});
