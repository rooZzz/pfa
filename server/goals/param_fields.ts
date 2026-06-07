import { z } from "zod";

export const goalParamFields = {
  target_months: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("emergency_fund only: months of cover to hold as a safety net. Default 6."),
  tax_year: z
    .string()
    .regex(/^\d{4}\/\d{2}$/, "Expected YYYY/YY e.g. 2025/26")
    .optional()
    .describe(
      "isa_max only: UK tax year to target. Defaults to the year covering today.",
    ),
  target_amount_pence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("house_deposit only: deposit amount to reach, in pence."),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional()
    .describe("house_deposit only: date to have the deposit by."),
  target_annual_income_pence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("retirement only: annual retirement income wanted, in pence."),
  retirement_age: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("retirement only: age to retire at."),
  target_annual_spend_pence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("fire only: annual spending to support in retirement, in pence."),
  safe_withdrawal_rate_bps: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("fire only: safe withdrawal rate in basis points (400 = 4%). Default 400."),
  target_retirement_age: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("fire only: age to be financially independent by."),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional()
    .describe("retirement and fire only: date of birth, used to derive age."),
};
