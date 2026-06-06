import { resolvePeriod } from "../cashflow/index.js";
import { queryIncome } from "../cashflow/income.js";
import { LIVE_CONTEXT, type ReadContext, runQuery } from "../query.js";
import { toNum } from "../sql_util.js";
import { taxConstantsForDate } from "../tax_constants.js";

export type TaxPositionContext = {
  resolved: boolean;
  tax_year: string;
  basis: "salary_profile" | "payslip_run_rate" | null;
  projected_annual_income_pence: number | null;
  equity_income_pence: number | null;
  adjusted_net_income_pence: number | null;
  marginal_rate_bps: number | null;
  personal_allowance_pence: number | null;
  estimated_income_tax_pence: number | null;
  estimated_employee_ni_pence: number | null;
  pension_annual_allowance_pence: number | null;
  in_personal_allowance_taper: boolean;
  pension_allowance_tapered: boolean;
  assumptions: string[];
  gap_reason?: string;
};

const REQUIRED_KEYS = [
  "personal_allowance",
  "personal_allowance_taper_threshold",
  "personal_allowance_zero_at",
  "basic_rate_limit",
  "additional_rate_threshold",
  "higher_rate_threshold",
  "income_tax_basic_rate",
  "income_tax_higher_rate",
  "income_tax_additional_rate",
  "ni_primary_threshold",
  "ni_upper_earnings_limit",
  "ni_employee_main_rate",
  "ni_employee_upper_rate",
  "pension_annual_allowance",
  "pension_taper_threshold",
  "pension_min_tapered_allowance",
];

function applyRate(amountPence: number, bps: number): number {
  return Math.round((amountPence * bps) / 10000);
}

function monthsElapsed(periodStart: string, asOf: string): number {
  const start = new Date(`${periodStart}T00:00:00Z`).getTime();
  const end = new Date(`${asOf}T00:00:00Z`).getTime();
  const months = Math.round((end - start) / (86_400_000 * 30.44));
  return Math.max(1, Math.min(12, months));
}

async function latestSalaryPence(asOf: string): Promise<number | null> {
  const rows = await runQuery(
    `SELECT salary_pence
       FROM pfa.person_profile
       WHERE valid_from <= CAST(? AS DATE)
         AND (valid_to IS NULL OR valid_to > CAST(? AS DATE))
         AND superseded_by IS NULL
       ORDER BY valid_from DESC, recorded_at DESC, id DESC
       LIMIT 1`,
    [asOf, asOf],
  );
  return rows.length > 0 ? toNum(rows[0]!.salary_pence) : null;
}

async function equityIncome(
  asOf: string,
  periodEnd: string,
): Promise<{ rsuValuePence: number; hasOtherSchemes: boolean }> {
  const rows = await runQuery(
    `SELECT
       v.units_vested AS units,
       g.scheme_type AS scheme,
       (SELECT ap.unit_price_pence
          FROM pfa.asset_prices ap
          WHERE ap.asset_id = g.asset_id
            AND ap.as_of <= CAST(? AS TIMESTAMP)
            AND ap.superseded_by IS NULL
          ORDER BY ap.as_of DESC, ap.recorded_at DESC, ap.id DESC
          LIMIT 1) AS price
     FROM pfa.equity_vesting_event v
     JOIN pfa.equity_grant g ON g.id = v.grant_id
     WHERE v.vest_date > CAST(? AS DATE)
       AND v.vest_date <= CAST(? AS DATE)
       AND v.superseded_by IS NULL
       AND g.superseded_by IS NULL`,
    [`${asOf} 23:59:59`, asOf, periodEnd],
  );

  let rsuValuePence = 0;
  let hasOtherSchemes = false;
  for (const row of rows) {
    if (row.scheme === "rsu") {
      const price = row.price == null ? null : toNum(row.price);
      if (price != null) rsuValuePence += toNum(row.units) * price;
    } else {
      hasOtherSchemes = true;
    }
  }
  return { rsuValuePence, hasOtherSchemes };
}

function incomeTaxPence(
  income: number,
  paAfter: number,
  basicRateLimit: number,
  additionalRateThreshold: number,
  basicBps: number,
  higherBps: number,
  additionalBps: number,
): number {
  const taxable = Math.max(0, income - paAfter);
  const higherWidth = Math.max(0, additionalRateThreshold - paAfter - basicRateLimit);
  const band1 = Math.min(taxable, basicRateLimit);
  const band2 = Math.min(Math.max(0, taxable - basicRateLimit), higherWidth);
  const band3 = Math.max(0, taxable - basicRateLimit - higherWidth);
  return (
    applyRate(band1, basicBps) +
    applyRate(band2, higherBps) +
    applyRate(band3, additionalBps)
  );
}

function employeeNiPence(
  earnings: number,
  primaryThreshold: number,
  upperEarningsLimit: number,
  mainBps: number,
  upperBps: number,
): number {
  const mainBand = Math.max(0, Math.min(earnings, upperEarningsLimit) - primaryThreshold);
  const upperBand = Math.max(0, earnings - upperEarningsLimit);
  return applyRate(mainBand, mainBps) + applyRate(upperBand, upperBps);
}

export async function taxPosition(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<TaxPositionContext> {
  const period = await resolvePeriod(undefined, asOf);
  const base: TaxPositionContext = {
    resolved: false,
    tax_year: period.tax_year,
    basis: null,
    projected_annual_income_pence: null,
    equity_income_pence: null,
    adjusted_net_income_pence: null,
    marginal_rate_bps: null,
    personal_allowance_pence: null,
    estimated_income_tax_pence: null,
    estimated_employee_ni_pence: null,
    pension_annual_allowance_pence: null,
    in_personal_allowance_taper: false,
    pension_allowance_tapered: false,
    assumptions: [],
  };

  const bundle = await taxConstantsForDate(asOf);
  const missing = REQUIRED_KEYS.filter((key) => bundle[key] == null);
  if (missing.length > 0) {
    return {
      ...base,
      gap_reason: `Tax constants missing for ${period.tax_year}: ${missing.join(", ")}.`,
    };
  }
  const constant = (key: string): number => bundle[key]!.value;

  const salaryPence = await latestSalaryPence(asOf);
  const income = await queryIncome(period.period_start, asOf, ctx.schema);

  let regularAnnualPence: number;
  let basis: "salary_profile" | "payslip_run_rate";
  if (salaryPence != null) {
    regularAnnualPence = salaryPence;
    basis = "salary_profile";
  } else if (income.payslip_count > 0) {
    regularAnnualPence = Math.round((income.gross_pence * 12) / income.payslip_count);
    basis = "payslip_run_rate";
  } else {
    return {
      ...base,
      gap_reason:
        "No salary profile or payslips captured; cannot project an annual tax position.",
    };
  }

  const assumptions: string[] = ["England/Wales/NI rates; Scottish rates not modelled."];
  if (basis === "payslip_run_rate") {
    assumptions.push("Annual income annualised from payslips, assuming monthly pay.");
  }

  const elapsed = monthsElapsed(period.period_start, asOf);
  const regularYtdPence = Math.round((regularAnnualPence * elapsed) / 12);
  const extraIncomePence = Math.max(0, income.gross_pence - regularYtdPence);
  if (extraIncomePence > 0) {
    assumptions.push(
      "Income above the regular run-rate (bonus or one-off) added to the annual projection.",
    );
  }

  const { rsuValuePence, hasOtherSchemes } = await equityIncome(asOf, period.period_end);
  if (rsuValuePence > 0) {
    assumptions.push(
      "Upcoming RSU vesting (after today, this tax year) added as income at latest price; past vests assumed already in payslips.",
    );
  }
  if (hasOtherSchemes) {
    assumptions.push(
      "Non-RSU equity vesting (EMI/SAYE/unapproved) excluded from income; tax treatment differs.",
    );
  }

  const annualPensionContributions = Math.round(
    income.payslip_count > 0
      ? (income.pension_employee_pence * 12) / income.payslip_count
      : 0,
  );

  const earningsPence = regularAnnualPence + extraIncomePence;
  const projectedIncome = earningsPence + rsuValuePence;
  const adjustedNetIncome = Math.max(0, projectedIncome - annualPensionContributions);

  const personalAllowance = constant("personal_allowance");
  const paTaperThreshold = constant("personal_allowance_taper_threshold");
  const paZeroAt = constant("personal_allowance_zero_at");
  const paReduction = Math.max(0, Math.floor((adjustedNetIncome - paTaperThreshold) / 2));
  const paAfter = Math.max(0, personalAllowance - paReduction);
  const inPaTaper = adjustedNetIncome > paTaperThreshold && adjustedNetIncome < paZeroAt;

  const basicRateLimit = constant("basic_rate_limit");
  const additionalRateThreshold = constant("additional_rate_threshold");
  const higherRateThreshold = constant("higher_rate_threshold");
  const basicBps = constant("income_tax_basic_rate");
  const higherBps = constant("income_tax_higher_rate");
  const additionalBps = constant("income_tax_additional_rate");

  const incomeTax = incomeTaxPence(
    adjustedNetIncome,
    paAfter,
    basicRateLimit,
    additionalRateThreshold,
    basicBps,
    higherBps,
    additionalBps,
  );
  if (annualPensionContributions > 0) {
    assumptions.push(
      "Pension treated as net-pay (reduces taxable income for tax, not for NI).",
    );
  }

  const niPrimary = constant("ni_primary_threshold");
  const niUel = constant("ni_upper_earnings_limit");
  const niMainBps = constant("ni_employee_main_rate");
  const niUpperBps = constant("ni_employee_upper_rate");
  const employeeNi = employeeNiPence(
    earningsPence,
    niPrimary,
    niUel,
    niMainBps,
    niUpperBps,
  );
  assumptions.push("NI estimated on cash earnings only; equity NI handled by payroll.");

  let marginalRateBps: number;
  if (inPaTaper) {
    marginalRateBps = higherBps + Math.round((higherBps * 1) / 2);
  } else if (adjustedNetIncome >= additionalRateThreshold) {
    marginalRateBps = additionalBps;
  } else if (adjustedNetIncome > higherRateThreshold) {
    marginalRateBps = higherBps;
  } else if (adjustedNetIncome > paAfter) {
    marginalRateBps = basicBps;
  } else {
    marginalRateBps = 0;
  }

  const pensionAllowance = constant("pension_annual_allowance");
  const pensionTaperThreshold = constant("pension_taper_threshold");
  const pensionMinAllowance = constant("pension_min_tapered_allowance");
  let pensionAllowanceAfter = pensionAllowance;
  let pensionTapered = false;
  if (adjustedNetIncome > pensionTaperThreshold) {
    const reduction = Math.floor((adjustedNetIncome - pensionTaperThreshold) / 2);
    pensionAllowanceAfter = Math.max(pensionMinAllowance, pensionAllowance - reduction);
    pensionTapered = pensionAllowanceAfter < pensionAllowance;
    assumptions.push(
      "Pension allowance taper applied on adjusted income; threshold-income test not modelled.",
    );
  }

  return {
    resolved: true,
    tax_year: period.tax_year,
    basis,
    projected_annual_income_pence: projectedIncome,
    equity_income_pence: rsuValuePence,
    adjusted_net_income_pence: adjustedNetIncome,
    marginal_rate_bps: marginalRateBps,
    personal_allowance_pence: paAfter,
    estimated_income_tax_pence: incomeTax,
    estimated_employee_ni_pence: employeeNi,
    pension_annual_allowance_pence: pensionAllowanceAfter,
    in_personal_allowance_taper: inPaTaper,
    pension_allowance_tapered: pensionTapered,
    assumptions,
  };
}
