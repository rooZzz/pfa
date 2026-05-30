import { runQuery } from "./query.js";
import { toNum, toStr } from "./sql_util.js";

export const TAX_CONSTANT_KEYS = [
  "isa_allowance",
  "cash_isa_allowance",
  "lisa_allowance",
  "lisa_bonus_rate",
  "lisa_withdrawal_charge_rate",
  "pension_annual_allowance",
  "pension_mpaa",
  "pension_taper_threshold",
  "pension_taper_floor",
  "pension_min_tapered_allowance",
  "pension_lump_sum_allowance",
  "pension_access_age",
  "state_pension_age",
  "personal_allowance",
  "personal_allowance_taper_threshold",
  "personal_allowance_zero_at",
  "basic_rate_limit",
  "higher_rate_threshold",
  "additional_rate_threshold",
  "income_tax_basic_rate",
  "income_tax_higher_rate",
  "income_tax_additional_rate",
  "ni_primary_threshold",
  "ni_upper_earnings_limit",
  "ni_employee_main_rate",
  "ni_employee_upper_rate",
  "ni_secondary_threshold",
  "ni_employer_rate",
  "cgt_annual_exempt_amount",
  "cgt_rate_lower",
  "cgt_rate_higher",
  "cgt_rate_residential_lower",
  "cgt_rate_residential_higher",
  "dividend_allowance",
  "dividend_rate_ordinary",
  "dividend_rate_upper",
  "dividend_rate_additional",
] as const;

export type TaxConstantKey = (typeof TAX_CONSTANT_KEYS)[number];

export type ResolvedConstant = {
  key: string;
  value: number;
  unit: "pence" | "years" | "bps";
  currency: string | null;
  status: "enacted" | "announced";
  source: string;
  valid_from: string;
};

function toResolved(row: Record<string, unknown>): ResolvedConstant {
  return {
    key: toStr(row.key),
    value: toNum(row.value),
    unit: toStr(row.unit) as ResolvedConstant["unit"],
    currency: row.currency === null ? null : toStr(row.currency),
    status: toStr(row.status) as ResolvedConstant["status"],
    source: toStr(row.source),
    valid_from: toStr(row.valid_from),
  };
}

export async function resolveConstant(
  key: TaxConstantKey,
  asOf: string,
): Promise<ResolvedConstant | null> {
  const rows = await runQuery(
    `SELECT key, value, unit, currency, status, source, valid_from
       FROM pfa.tax_constants
      WHERE key = ?
        AND valid_from <= CAST(? AS DATE)
        AND (valid_to IS NULL OR valid_to >= CAST(? AS DATE))
      ORDER BY valid_from DESC
      LIMIT 1`,
    [key, asOf, asOf],
  );
  if (rows.length === 0) return null;
  return toResolved(rows[0]!);
}

export async function upcomingChange(
  key: TaxConstantKey,
  asOf: string,
): Promise<ResolvedConstant | null> {
  const rows = await runQuery(
    `SELECT key, value, unit, currency, status, source, valid_from
       FROM pfa.tax_constants
      WHERE key = ?
        AND valid_from > CAST(? AS DATE)
      ORDER BY valid_from ASC
      LIMIT 1`,
    [key, asOf],
  );
  if (rows.length === 0) return null;
  return toResolved(rows[0]!);
}

export async function taxConstantsForDate(
  asOf: string,
): Promise<Record<string, ResolvedConstant>> {
  const resolved = await Promise.all(
    TAX_CONSTANT_KEYS.map((key) => resolveConstant(key, asOf)),
  );
  const bundle: Record<string, ResolvedConstant> = {};
  for (const constant of resolved) {
    if (constant) bundle[constant.key] = constant;
  }
  return bundle;
}
