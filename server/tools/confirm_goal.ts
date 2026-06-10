import { z } from "zod";
import { getKysely } from "../core/db.js";
import {
  IMPLEMENTED_GOAL_TYPES,
  type ImplementedGoalType,
  decompose,
  isImplemented,
  validateParams,
} from "../goals/catalog.js";
import { writeGoalRow } from "../goals/lifecycle.js";
import { goalParamFields } from "../goals/param_fields.js";

export const confirmGoalSchema = {
  goal_type: z
    .enum(IMPLEMENTED_GOAL_TYPES)
    .describe("The implemented goal type to record, from propose_goal."),
  raw_utterance: z
    .string()
    .describe("The user's original goal statement, stored verbatim as provenance."),
  ...goalParamFields,
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
    .execute((trx) =>
      writeGoalRow(trx, {
        goalType: input.goal_type,
        params,
        rawUtterance: input.raw_utterance,
        entryType: "goal",
      }),
    );

  const tracking = decompose(input.goal_type, params)
    .map((b) => `${b.key} via ${b.metric}`)
    .join("; ");

  return [
    `Goal set: ${input.goal_type} (goal ID ${goalId}, document ID ${sourceId}).`,
    `Tracking: ${tracking}.`,
    `Run get_briefing to see current progress.`,
  ].join(" ");
}
