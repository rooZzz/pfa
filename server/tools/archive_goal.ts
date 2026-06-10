import { z } from "zod";
import { getKysely } from "../core/db.js";
import { archiveGoalRow } from "../goals/lifecycle.js";
import { writeManualDocument } from "../core/references.js";

export const archiveGoalSchema = {
  goal_id: z
    .number()
    .int()
    .positive()
    .describe(
      "The id of the goal to archive, from get_briefing or query_natural_language.",
    ),
};

export async function archiveGoal(input: { goal_id: number }): Promise<string> {
  const sourceId = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const old = await archiveGoalRow(trx, input.goal_id);
      return writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "goal_archive",
        goal_id: input.goal_id,
        goal_type: old.goal_type,
      });
    });

  return [
    `Archived goal ${input.goal_id}.`,
    `It no longer appears in briefings; the record is retained on disk for history.`,
    `Audit document ID ${sourceId}.`,
  ].join(" ");
}
