import { resolvePeriod } from "../cashflow/index.js";
import { queryIncome } from "../cashflow/income.js";
import { latestRangeSnapshot } from "../core/snapshots.js";
import { toNum } from "../core/sql_util.js";
import { LIVE_CONTEXT, type ReadContext, runQuery } from "../query/query.js";
import type { MetricValue } from "./types.js";

export async function currentPensionPot(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const snap = latestRangeSnapshot(
    `${ctx.schema}.pension_values`,
    "account_id",
    ["account_id", "value_pence"],
    asOf,
  );
  const rows = await runQuery(
    `SELECT COALESCE(SUM(p.value_pence), 0) AS total, COUNT(*) AS accounts
       FROM (${snap.sql}) p
       JOIN ${ctx.schema}.accounts a ON a.id = p.account_id
       WHERE a.type = 'pension'`,
    snap.params,
  );
  const row = rows[0]!;
  const accounts = toNum(row.accounts);
  if (accounts === 0) {
    return {
      metric: "current_pension_pot",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "No pension pot value recorded.",
    };
  }
  return {
    metric: "current_pension_pot",
    resolved: true,
    value: toNum(row.total),
    unit: "pence",
    detail: { accounts },
  };
}

export async function contributionRate(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const period = await resolvePeriod(undefined, asOf);
  const income = await queryIncome(period.period_start, asOf, ctx.schema);
  if (income.payslip_count === 0) {
    return {
      metric: "contribution_rate",
      resolved: false,
      value: null,
      unit: "pence",
      detail: { tax_year: period.tax_year },
      gap_reason:
        "No payslip data captured this tax year; pension contributions are ungrounded.",
    };
  }
  const employeeAnnual = Math.round(
    (income.pension_employee_pence * 12) / income.payslip_count,
  );
  const employerAnnual = Math.round(
    (income.pension_employer_pence * 12) / income.payslip_count,
  );
  return {
    metric: "contribution_rate",
    resolved: true,
    value: employeeAnnual + employerAnnual,
    unit: "pence",
    detail: {
      employee_annual_pence: employeeAnnual,
      employer_annual_pence: employerAnnual,
      payslip_count: income.payslip_count,
      tax_year: period.tax_year,
    },
  };
}
