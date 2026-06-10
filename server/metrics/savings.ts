import { resolvePeriod } from "../cashflow/index.js";
import { latestRangeSnapshot } from "../core/snapshots.js";
import { toNum } from "../core/sql_util.js";
import { LIVE_CONTEXT, type ReadContext, runQuery } from "../query/query.js";
import { resolveConstant } from "../tax/constants.js";
import type { MetricValue } from "./types.js";

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().split("T")[0]!;
}

export async function accountBalanceSum(
  asOf: string,
  types: readonly string[],
  ctx: ReadContext,
): Promise<{ total: number; accounts: number }> {
  const snap = latestRangeSnapshot(
    `${ctx.schema}.account_balances`,
    "account_id",
    ["account_id", "balance_pence"],
    asOf,
  );
  const placeholders = types.map(() => "?").join(", ");
  const rows = await runQuery(
    `SELECT COALESCE(SUM(b.balance_pence), 0) AS total, COUNT(*) AS accounts
       FROM (${snap.sql}) b
       JOIN ${ctx.schema}.accounts a ON a.id = b.account_id
       WHERE a.type IN (${placeholders})`,
    [...snap.params, ...types],
  );
  const row = rows[0]!;
  return { total: toNum(row.total), accounts: toNum(row.accounts) };
}

export async function liquidSavings(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const { total, accounts } = await accountBalanceSum(
    asOf,
    ["current", "savings", "isa"],
    ctx,
  );
  if (accounts === 0) {
    return {
      metric: "liquid_savings",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "No current, savings, or ISA account balances recorded.",
    };
  }
  return {
    metric: "liquid_savings",
    resolved: true,
    value: total,
    unit: "pence",
    detail: { accounts },
  };
}

export async function averageMonthlyOutgoings(
  asOf: string,
  months = 12,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const start = monthsBefore(asOf, months);
  const rows = await runQuery(
    `WITH monthly AS (
       SELECT
         DATE_TRUNC('month', CAST(occurred_at AS DATE)) AS month,
         ABS(SUM(amount_pence) FILTER (WHERE amount_pence < 0)) AS outflow_pence
       FROM ${ctx.schema}.transactions
       WHERE CAST(occurred_at AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
         AND is_internal = 0
         AND superseded_by IS NULL
         AND category != 'savings'
       GROUP BY 1
       HAVING ABS(SUM(amount_pence) FILTER (WHERE amount_pence < 0)) > 0
     )
     SELECT COALESCE(AVG(outflow_pence), 0) AS avg_outflow, COUNT(*) AS months
       FROM monthly`,
    [start, asOf],
  );
  const row = rows[0]!;
  const monthsWithSpend = toNum(row.months);
  if (monthsWithSpend === 0) {
    return {
      metric: "average_monthly_outgoings",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "No spending transactions recorded to compute monthly outgoings.",
    };
  }
  return {
    metric: "average_monthly_outgoings",
    resolved: true,
    value: Math.round(toNum(row.avg_outflow)),
    unit: "pence",
    detail: { months: monthsWithSpend },
  };
}

export async function emergencyFundMonths(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const [liquid, outgoings] = await Promise.all([
    liquidSavings(asOf, ctx),
    averageMonthlyOutgoings(asOf, 12, ctx),
  ]);

  if (!liquid.resolved || !outgoings.resolved || outgoings.value === 0) {
    const reasons = [liquid.gap_reason, outgoings.gap_reason].filter(Boolean);
    return {
      metric: "emergency_fund_months",
      resolved: false,
      value: null,
      unit: "months",
      detail: {},
      gap_reason:
        reasons.length > 0
          ? reasons.join(" ")
          : "Cannot compute months of cover from the available data.",
    };
  }

  const liquidPence = liquid.value!;
  const avgOutflowPence = outgoings.value!;
  return {
    metric: "emergency_fund_months",
    resolved: true,
    value: liquidPence / avgOutflowPence,
    unit: "months",
    detail: { liquid_pence: liquidPence, avg_outflow_pence: avgOutflowPence },
  };
}

export async function houseDepositProgress(
  asOf: string,
  targetPence: number,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const liquid = await liquidSavings(asOf, ctx);
  if (!liquid.resolved) {
    return {
      metric: "house_deposit_progress",
      resolved: false,
      value: null,
      unit: "pence",
      detail: { target_pence: targetPence },
      gap_reason: liquid.gap_reason ?? "No liquid savings recorded to track a deposit.",
    };
  }
  const savedPence = liquid.value!;
  return {
    metric: "house_deposit_progress",
    resolved: true,
    value: savedPence,
    unit: "pence",
    detail: {
      saved_pence: savedPence,
      target_pence: targetPence,
      percent: Math.round((savedPence / targetPence) * 100),
    },
  };
}

export async function isaAllowanceRemaining(
  asOf: string,
  taxYear?: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const period = await resolvePeriod(taxYear, asOf);
  const allowanceConstant = await resolveConstant("isa_allowance", period.period_start);
  if (!allowanceConstant) {
    return {
      metric: "isa_allowance_remaining",
      resolved: false,
      value: null,
      unit: "pence",
      detail: { tax_year: period.tax_year, period_end: period.period_end },
      gap_reason: `ISA allowance constant not found for tax year ${period.tax_year}.`,
    };
  }
  const allowancePence = allowanceConstant.value;
  const rows = await runQuery(
    `SELECT
       COALESCE(SUM(t.amount_pence) FILTER (WHERE t.amount_pence > 0), 0) AS contributions,
       COUNT(DISTINCT a.id) AS isa_accounts
     FROM ${ctx.schema}.accounts a
     LEFT JOIN ${ctx.schema}.transactions t
       ON t.account_id = a.id
      AND CAST(t.occurred_at AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
      AND t.superseded_by IS NULL
     WHERE a.type = 'isa'`,
    [period.period_start, period.period_end],
  );
  const row = rows[0]!;
  const isaAccounts = toNum(row.isa_accounts);
  if (isaAccounts === 0) {
    return {
      metric: "isa_allowance_remaining",
      resolved: false,
      value: null,
      unit: "pence",
      detail: { tax_year: period.tax_year, period_end: period.period_end },
      gap_reason: "No ISA account found to track allowance against.",
    };
  }
  const contributions = toNum(row.contributions);
  return {
    metric: "isa_allowance_remaining",
    resolved: true,
    value: allowancePence - contributions,
    unit: "pence",
    detail: {
      allowance_pence: allowancePence,
      contributions_pence: contributions,
      tax_year: period.tax_year,
      period_end: period.period_end,
    },
  };
}

export async function cashSavings(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const { total, accounts } = await accountBalanceSum(asOf, ["current", "savings"], ctx);
  if (accounts === 0) {
    return {
      metric: "cash_savings",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "No current or savings balances recorded.",
    };
  }
  return {
    metric: "cash_savings",
    resolved: true,
    value: total,
    unit: "pence",
    detail: { accounts },
  };
}
