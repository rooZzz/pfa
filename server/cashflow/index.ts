import { runQuery } from "../query.js";
import { toNum, toStr, validateDate } from "../sql_util.js";
import { queryIncome } from "./income.js";
import { queryTransactionsByCategory } from "./transactions.js";
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
    `WITH period(s, e) AS (
      SELECT CAST(? AS DATE), CAST(? AS DATE)
    ),
    tx_by_month AS (
      SELECT
        DATE_TRUNC('month', CAST(t.occurred_at AS DATE)) AS month,
        COALESCE(SUM(t.amount_pence) FILTER (WHERE t.amount_pence > 0), 0) AS inflow_pence,
        COALESCE(ABS(SUM(t.amount_pence) FILTER (WHERE t.amount_pence < 0)), 0) AS outflow_pence
      FROM pfa.transactions t
      CROSS JOIN period
      WHERE CAST(t.occurred_at AS DATE) BETWEEN period.s AND period.e
      GROUP BY 1
    ),
    inc_by_month AS (
      SELECT
        DATE_TRUNC('month', CAST(ie.pay_date AS DATE)) AS month,
        COALESCE(SUM(ie.net_pence), 0) AS net_pence
      FROM pfa.income_events ie
      CROSS JOIN period
      WHERE CAST(ie.pay_date AS DATE) BETWEEN period.s AND period.e
      GROUP BY 1
    ),
    months AS (
      SELECT month FROM tx_by_month
      UNION
      SELECT month FROM inc_by_month
    )
    SELECT
      m.month,
      COALESCE(i.net_pence, 0) AS income_net_pence,
      COALESCE(t.inflow_pence, 0) AS transaction_inflow_pence,
      COALESCE(t.outflow_pence, 0) AS transaction_outflow_pence,
      COALESCE(i.net_pence, 0) + COALESCE(t.inflow_pence, 0) - COALESCE(t.outflow_pence, 0) AS net_pence
    FROM months m
    LEFT JOIN tx_by_month t ON t.month = m.month
    LEFT JOIN inc_by_month i ON i.month = m.month
    ORDER BY m.month`,
    [start, end],
  );

  return rows.map((r) => ({
    month: toStr(r.month).slice(0, 7),
    income_net_pence: toNum(r.income_net_pence),
    transaction_inflow_pence: toNum(r.transaction_inflow_pence),
    transaction_outflow_pence: toNum(r.transaction_outflow_pence),
    net_pence: toNum(r.net_pence),
  }));
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

  const [income, byCategory, trend] = await Promise.all([
    queryIncome(period_start, as_of),
    queryTransactionsByCategory(period_start, as_of),
    queryMonthlyTrend(period_start, as_of),
  ]);

  const transaction_inflow_total_pence = byCategory.reduce(
    (sum, l) => sum + l.inflow_pence,
    0,
  );
  const transaction_outflow_total_pence = byCategory.reduce(
    (sum, l) => sum + l.outflow_pence,
    0,
  );
  const net_cashflow_pence =
    income.net_pence + transaction_inflow_total_pence - transaction_outflow_total_pence;

  return {
    tax_year,
    period_start,
    period_end,
    income,
    transactions_by_category: byCategory,
    transaction_inflow_total_pence,
    transaction_outflow_total_pence,
    net_cashflow_pence,
    trend,
  };
}
