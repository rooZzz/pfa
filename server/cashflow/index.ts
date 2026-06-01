import { queryPayslipCoverage } from "../net_worth/coverage.js";
import { runQuery } from "../query.js";
import { toNum, toStr, validateDate } from "../sql_util.js";
import { queryIncome } from "./income.js";
import {
  queryIncomeBySource,
  queryPotSavingNetPence,
  queryTransactionsByCategory,
} from "./transactions.js";
import type { CashflowResult, TrendPoint } from "./types.js";

export type { CashflowResult } from "./types.js";

export async function resolvePeriod(
  taxYear?: string,
  asOf?: string,
): Promise<{ tax_year: string; period_start: string; period_end: string }> {
  const date = asOf ?? new Date().toISOString().split("T")[0]!;

  if (taxYear) {
    const rows = await runQuery(
      `SELECT tax_year, starts_on, ends_on FROM pfa.tax_periods WHERE tax_year = ?`,
      [taxYear],
    );
    if (rows.length === 0) {
      throw new Error(
        `Tax year "${taxYear}" not found in tax_periods. Expected format: YYYY/YY e.g. 2025/26.`,
      );
    }
    const row = rows[0]!;
    return {
      tax_year: toStr(row.tax_year),
      period_start: toStr(row.starts_on),
      period_end: toStr(row.ends_on),
    };
  }

  const rows = await runQuery(
    `SELECT tax_year, starts_on, ends_on FROM pfa.tax_periods WHERE CAST(? AS DATE) BETWEEN starts_on AND ends_on`,
    [date],
  );
  if (rows.length === 0) {
    throw new Error(
      `No tax period found covering ${date}. Ensure tax_periods is seeded or supply a tax_year argument.`,
    );
  }
  const row = rows[0]!;
  return {
    tax_year: toStr(row.tax_year),
    period_start: toStr(row.starts_on),
    period_end: toStr(row.ends_on),
  };
}

async function queryMonthlyTrend(start: string, end: string): Promise<TrendPoint[]> {
  const rows = await runQuery(
    `SELECT
       DATE_TRUNC('month', CAST(t.occurred_at AS DATE)) AS month,
       COALESCE(SUM(t.amount_pence) FILTER (WHERE t.amount_pence > 0), 0) AS inflow_pence,
       COALESCE(ABS(SUM(t.amount_pence) FILTER (WHERE t.amount_pence < 0)), 0) AS outflow_pence
     FROM pfa.transactions t
     WHERE CAST(t.occurred_at AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
       AND t.is_internal = 0
       AND t.superseded_by IS NULL
     GROUP BY 1
     ORDER BY 1`,
    [start, end],
  );

  return rows.map((r) => {
    const inflow = toNum(r.inflow_pence);
    const outflow = toNum(r.outflow_pence);
    return {
      month: toStr(r.month).slice(0, 7),
      transaction_inflow_pence: inflow,
      transaction_outflow_pence: outflow,
      net_pence: inflow - outflow,
    };
  });
}

export async function getCashflow(params: {
  tax_year?: string;
  as_of?: string;
}): Promise<CashflowResult> {
  if (params.as_of) validateDate(params.as_of);

  const { tax_year, period_start, period_end } = await resolvePeriod(
    params.tax_year,
    params.as_of,
  );

  const today = new Date().toISOString().split("T")[0]!;
  const as_of = params.as_of ?? (today < period_end ? today : period_end);

  const [income, byCategory, incomeBySource, trend, pot_savings_net_pence, coverage] =
    await Promise.all([
      queryIncome(period_start, as_of),
      queryTransactionsByCategory(period_start, as_of),
      queryIncomeBySource(period_start, as_of),
      queryMonthlyTrend(period_start, as_of),
      queryPotSavingNetPence(period_start, as_of),
      queryPayslipCoverage(as_of, period_start),
    ]);

  const transaction_inflow_total_pence = byCategory.reduce(
    (sum, l) => sum + l.inflow_pence,
    0,
  );
  const transaction_outflow_total_pence = byCategory.reduce(
    (sum, l) => sum + l.outflow_pence,
    0,
  );

  const spending_total_pence = transaction_outflow_total_pence;
  const income_total_pence = transaction_inflow_total_pence;
  const net_cashflow_pence = income_total_pence - spending_total_pence;

  return {
    tax_year,
    period_start,
    period_end,
    income,
    transactions_by_category: byCategory,
    income_by_source: incomeBySource,
    transaction_inflow_total_pence,
    transaction_outflow_total_pence,
    income_total_pence,
    spending_total_pence,
    pot_savings_net_pence,
    net_cashflow_pence,
    trend,
    coverage,
  };
}
