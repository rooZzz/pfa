import { resolvePeriod } from "../cashflow/index.js";
import { queryIncome } from "../cashflow/income.js";
import { LIVE_CONTEXT, type ReadContext } from "../query.js";

export type EarningsContext = {
  resolved: boolean;
  tax_year: string;
  tax_code: string | null;
  ytd_gross_pence: number | null;
  ytd_paye_pence: number | null;
  ytd_ni_pence: number | null;
  ytd_net_pence: number | null;
  payslip_count: number;
  gap_reason?: string;
};

export async function earningsContext(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<EarningsContext> {
  const period = await resolvePeriod(undefined, asOf);
  const income = await queryIncome(period.period_start, asOf, ctx.schema);

  if (income.payslip_count === 0) {
    return {
      resolved: false,
      tax_year: period.tax_year,
      tax_code: null,
      ytd_gross_pence: null,
      ytd_paye_pence: null,
      ytd_ni_pence: null,
      ytd_net_pence: null,
      payslip_count: 0,
      gap_reason:
        "No payslip data captured for this tax year; income and tax position are ungrounded.",
    };
  }

  return {
    resolved: true,
    tax_year: period.tax_year,
    tax_code: income.tax_code,
    ytd_gross_pence: income.gross_pence,
    ytd_paye_pence: income.paye_pence,
    ytd_ni_pence: income.ni_employee_pence,
    ytd_net_pence: income.net_pence,
    payslip_count: income.payslip_count,
  };
}
