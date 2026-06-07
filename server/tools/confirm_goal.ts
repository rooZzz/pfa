import { z } from "zod";
import { getKysely } from "../db.js";
import {
  IMPLEMENTED_GOAL_TYPES,
  type ImplementedGoalType,
  decompose,
  isImplemented,
  validateParams,
} from "../goals/catalog.js";
import { writeManualDocument } from "../references.js";

export const confirmGoalSchema = {
  goal_type: z
    .enum(IMPLEMENTED_GOAL_TYPES)
    .describe("The implemented goal type to record, from propose_goal."),
  raw_utterance: z
    .string()
    .describe("The user's original goal statement, stored verbatim as provenance."),
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

export async function confirmGoal(input: {
  goal_type: ImplementedGoalType;
  raw_utterance: string;
  target_months?: number;
  tax_year?: string;
  target_amount_pence?: number;
  target_date?: string;
  target_annual_income_pence?: number;
  retirement_age?: number;
  target_annual_spend_pence?: number;
  safe_withdrawal_rate_bps?: number;
  target_retirement_age?: number;
  date_of_birth?: string;
}): Promise<string> {
  if (!isImplemented(input.goal_type)) {
    throw new Error(`Goal type "${input.goal_type}" is not yet supported.`);
  }

  const params = validateParams(input.goal_type, {
    target_months: input.target_months,
    tax_year: input.tax_year,
    target_amount_pence: input.target_amount_pence,
    target_date: input.target_date,
    target_annual_income_pence: input.target_annual_income_pence,
    retirement_age: input.retirement_age,
    target_annual_spend_pence: input.target_annual_spend_pence,
    safe_withdrawal_rate_bps: input.safe_withdrawal_rate_bps,
    target_retirement_age: input.target_retirement_age,
    date_of_birth: input.date_of_birth,
  });

  const { sourceId, goalId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "goal",
        goal_type: input.goal_type,
        params,
        raw_utterance: input.raw_utterance,
      });

      const row = await trx
        .insertInto("goals")
        .values({
          goal_type: input.goal_type,
          params: JSON.stringify(params),
          raw_utterance: input.raw_utterance,
          source_id: sourceId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return { sourceId, goalId: Number(row.id) };
    });

  const tracking = decompose(input.goal_type, params)
    .map((b) => `${b.key} via ${b.metric}`)
    .join("; ");

  return [
    `Goal set: ${input.goal_type} (goal ID ${goalId}, document ID ${sourceId}).`,
    `Tracking: ${tracking}.`,
    `Run get_briefing to see current progress.`,
  ].join(" ");
}
