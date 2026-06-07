import { z } from "zod";
import { getKysely } from "../db.js";
import {
  IMPLEMENTED_GOAL_TYPES,
  type ImplementedGoalType,
  decompose,
  isImplemented,
  validateParams,
} from "../goals/catalog.js";
import { archiveGoalRow, writeGoalRow } from "../goals/lifecycle.js";
import { goalParamFields } from "../goals/param_fields.js";

const PARAM_KEYS = [
  "target_months",
  "tax_year",
  "target_amount_pence",
  "target_date",
  "target_annual_income_pence",
  "retirement_age",
  "target_annual_spend_pence",
  "safe_withdrawal_rate_bps",
  "target_retirement_age",
  "date_of_birth",
] as const;

export const updateGoalSchema = {
  goal_id: z
    .number()
    .int()
    .positive()
    .describe(
      "The id of the goal to update, from get_briefing or query_natural_language.",
    ),
  goal_type: z
    .enum(IMPLEMENTED_GOAL_TYPES)
    .optional()
    .describe(
      "Only to reclassify the goal to a different type; omit to keep the existing type.",
    ),
  raw_utterance: z
    .string()
    .optional()
    .describe(
      "The user's instruction for this change, stored as provenance. Omit to keep the original.",
    ),
  ...goalParamFields,
};

export async function updateGoal(input: {
  goal_id: number;
  goal_type?: ImplementedGoalType;
  raw_utterance?: string;
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
  const result = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const old = await archiveGoalRow(trx, input.goal_id);
      const goalType = input.goal_type ?? old.goal_type;
      if (!isImplemented(goalType)) {
        throw new Error(`Goal type "${goalType}" is not yet supported.`);
      }

      const provided: Record<string, unknown> = {};
      for (const key of PARAM_KEYS) {
        const value = (input as Record<string, unknown>)[key];
        if (value !== undefined) provided[key] = value;
      }
      const merged = { ...old.params, ...provided };
      const params = validateParams(goalType, merged);
      const rawUtterance = input.raw_utterance ?? old.raw_utterance;

      const { goalId, sourceId } = await writeGoalRow(trx, {
        goalType,
        params,
        rawUtterance,
        entryType: "goal_update",
      });
      return { goalId, sourceId, goalType, params };
    });

  const tracking = decompose(result.goalType, result.params)
    .map((b) => `${b.key} via ${b.metric}`)
    .join("; ");

  return [
    `Updated goal ${input.goal_id}: archived it and recorded a new version as goal ID ${result.goalId} (${result.goalType}).`,
    `Tracking: ${tracking}.`,
    `Audit document ID ${result.sourceId}.`,
  ].join(" ");
}
