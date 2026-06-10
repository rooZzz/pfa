import { z } from "zod";
import type { CorrectableSeries } from "../core/corrections.js";
import { correctableSeriesNames, correctRecord } from "../core/corrections.js";

export const correctRecordSchema = {
  series: z
    .enum(correctableSeriesNames)
    .describe(
      "Which committed series the wrong row belongs to. account_balance, pension_value, mortgage_balance, holding, person_profile, transaction, income_event, vesting_event, asset_price.",
    ),
  row_id: z
    .number()
    .int()
    .describe(
      "The id of the exact row to correct. Locate it first with query_natural_language and confirm it with the user.",
    ),
  corrected_fields: z
    .record(z.string(), z.union([z.number().int(), z.string()]))
    .describe(
      "Only the fields that were recorded wrong, keyed by column name. Correctable fields per series: account_balance {balance_pence, currency, valid_from}; pension_value {value_pence, currency, valid_from}; mortgage_balance {outstanding_pence, interest_rate_bps, currency, valid_from}; holding {quantity, valid_from}; person_profile {employer_name, tax_code, salary_pence, currency, valid_from}; transaction {amount_pence, category, description, occurred_at, currency}; income_event {gross_pence, taxable_pence, net_pence, paye_pence, ni_employee_pence, pension_employee_pence, pension_employer_pence, tax_code, tax_year, pay_date, currency}; vesting_event {units_vested, market_price_pence, estimated_value_pence, vest_date}; asset_price {unit_price_pence, currency, as_of, source}. Correcting the effective date (valid_from/occurred_at/pay_date/as_of/vest_date) is allowed when the date itself was wrong.",
    ),
  reason: z
    .string()
    .describe(
      "Why the original was wrong, in the user's own words. Stored as audit provenance.",
    ),
};

export async function correctRecordTool(input: {
  series: CorrectableSeries;
  row_id: number;
  corrected_fields: Record<string, number | string>;
  reason: string;
}): Promise<string> {
  return correctRecord(input);
}
