import { resolvePeriod } from "../cashflow/index.js";
import { queryIncome } from "../cashflow/income.js";
import { REAL_RETURN_RATE_BPS } from "../goals/assumptions.js";
import { LIVE_CONTEXT, type ReadContext, runQuery } from "../query.js";
import { latestPriceTick, latestRangeSnapshot } from "../snapshots.js";
import { toNum } from "../sql_util.js";
import { resolveConstant } from "../tax_constants.js";

export type MetricValue = {
  metric: string;
  resolved: boolean;
  value: number | null;
  unit: "pence" | "months";
  detail: Record<string, number | string>;
  gap_reason?: string;
};

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().split("T")[0]!;
}

export async function liquidSavings(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const snap = latestRangeSnapshot(
    `${ctx.schema}.account_balances`,
    "account_id",
    ["account_id", "balance_pence"],
    asOf,
  );
  const rows = await runQuery(
    `SELECT COALESCE(SUM(b.balance_pence), 0) AS total, COUNT(*) AS accounts
       FROM (${snap.sql}) b
       JOIN ${ctx.schema}.accounts a ON a.id = b.account_id
       WHERE a.type IN ('current', 'savings', 'isa')`,
    snap.params,
  );
  const row = rows[0]!;
  const accounts = toNum(row.accounts);
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
    value: toNum(row.total),
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

function addYearsToDate(date: string, years: number): string {
  const [y, m, d] = date.split("-");
  return `${Number(y) + years}-${m}-${d}`;
}

function wholeYearsBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  let years = toYear! - fromYear!;
  if (toMonth! < fromMonth! || (toMonth === fromMonth && toDay! < fromDay!)) {
    years -= 1;
  }
  return Math.max(0, years);
}

function projectPotPence(
  potPence: number,
  annualContributionPence: number,
  years: number,
  rateBps: number,
): number {
  let pot = potPence;
  for (let year = 0; year < years; year++) {
    const growth = Math.round((pot * rateBps) / 10000);
    pot = pot + growth + annualContributionPence;
  }
  return pot;
}

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

async function accountBalanceSum(
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

async function holdingsExcludingPropertyPence(asOf: string): Promise<number> {
  const holdings = latestRangeSnapshot(
    "pfa.holdings",
    "asset_id",
    ["asset_id", "quantity"],
    asOf,
  );
  const prices = latestPriceTick(["ap.asset_id", "ap.unit_price_pence"], asOf);
  const rows = await runQuery(
    `SELECT COALESCE(SUM(CAST(h.quantity AS BIGINT) * p.unit_price_pence), 0) AS total
       FROM (${holdings.sql}) h
       JOIN pfa.assets a ON a.id = h.asset_id
       JOIN (${prices.sql}) p ON p.asset_id = h.asset_id
       WHERE a.asset_type != 'property'`,
    [...holdings.params, ...prices.params],
  );
  return toNum(rows[0]!.total);
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

export async function investedAssets(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const pension = await currentPensionPot(asOf, ctx);
  const isa = await accountBalanceSum(asOf, ["isa"], ctx);
  const holdingsPence = await holdingsExcludingPropertyPence(asOf);
  const pensionPence = pension.resolved ? pension.value! : 0;
  if (!pension.resolved && isa.accounts === 0 && holdingsPence === 0) {
    return {
      metric: "invested_assets",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "No pension, ISA, or investment holdings recorded.",
    };
  }
  return {
    metric: "invested_assets",
    resolved: true,
    value: pensionPence + isa.total + holdingsPence,
    unit: "pence",
    detail: {
      pension_pence: pensionPence,
      isa_pence: isa.total,
      holdings_pence: holdingsPence,
    },
  };
}

function projectFrom(
  metricName: string,
  base: MetricValue,
  contribution: MetricValue,
  asOf: string,
  targetAge: number,
  dateOfBirth: string,
): MetricValue {
  if (!base.resolved) {
    return {
      metric: metricName,
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: base.gap_reason ?? "Nothing recorded to project from.",
    };
  }
  const annualContribution = contribution.resolved ? contribution.value! : 0;
  const retirementDate = addYearsToDate(dateOfBirth, targetAge);
  const years = wholeYearsBetween(asOf, retirementDate);
  const projected = projectPotPence(
    base.value!,
    annualContribution,
    years,
    REAL_RETURN_RATE_BPS,
  );
  return {
    metric: metricName,
    resolved: true,
    value: projected,
    unit: "pence",
    detail: {
      current_pot_pence: base.value!,
      annual_contribution_pence: annualContribution,
      contribution_grounded: contribution.resolved ? 1 : 0,
      years,
      target_age: targetAge,
      retirement_date: retirementDate,
      real_return_bps: REAL_RETURN_RATE_BPS,
    },
  };
}

export async function projectedPensionPot(
  asOf: string,
  targetAge: number,
  dateOfBirth: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const base = await currentPensionPot(asOf, ctx);
  const contribution = await contributionRate(asOf, ctx);
  return projectFrom(
    "projected_pension_pot",
    base,
    contribution,
    asOf,
    targetAge,
    dateOfBirth,
  );
}

export async function projectedInvestedAssets(
  asOf: string,
  targetAge: number,
  dateOfBirth: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const base = await investedAssets(asOf, ctx);
  const contribution = await contributionRate(asOf, ctx);
  return projectFrom(
    "projected_invested_assets",
    base,
    contribution,
    asOf,
    targetAge,
    dateOfBirth,
  );
}

export async function bridgeFund(
  asOf: string,
  annualSpendPence: number,
  targetRetirementAge: number,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const accessAgeConstant = await resolveConstant("pension_access_age", asOf);
  if (!accessAgeConstant) {
    return {
      metric: "bridge_fund",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "Pension access age constant not found.",
    };
  }
  const accessAge = accessAgeConstant.value;
  const bridgeYears = Math.max(0, accessAge - targetRetirementAge);
  const bridgeNeed = annualSpendPence * bridgeYears;

  const liquid = await liquidSavings(asOf, ctx);
  const holdingsPence = await holdingsExcludingPropertyPence(asOf);
  const hasAccessible = liquid.resolved || holdingsPence > 0;
  if (bridgeYears > 0 && !hasAccessible) {
    return {
      metric: "bridge_fund",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {
        bridge_years: bridgeYears,
        pension_access_age: accessAge,
        target_retirement_age: targetRetirementAge,
      },
      gap_reason: "No accessible savings or holdings recorded to assess the bridge.",
    };
  }
  const accessible = (liquid.resolved ? liquid.value! : 0) + holdingsPence;
  return {
    metric: "bridge_fund",
    resolved: true,
    value: Math.max(0, bridgeNeed - accessible),
    unit: "pence",
    detail: {
      accessible_pence: accessible,
      bridge_need_pence: bridgeNeed,
      bridge_years: bridgeYears,
      pension_access_age: accessAge,
      annual_spend_pence: annualSpendPence,
      target_retirement_age: targetRetirementAge,
    },
  };
}
