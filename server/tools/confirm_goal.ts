import { z } from "zod";
import { getKysely } from "../db.js";
import {
  IMPLEMENTED_GOAL_TYPES,
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
};

export async function confirmGoal(input: {
  goal_type: "emergency_fund" | "isa_max";
  raw_utterance: string;
  target_months?: number;
  tax_year?: string;
}): Promise<string> {
  if (!isImplemented(input.goal_type)) {
    throw new Error(`Goal type "${input.goal_type}" is not yet supported.`);
  }

  const params = validateParams(input.goal_type, {
    target_months: input.target_months,
    tax_year: input.tax_year,
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
