import type { Transaction } from "kysely";
import { writeManualDocument } from "../core/references.js";
import type { DatabaseSchema } from "../core/schema.js";

export type ArchivedGoal = {
  goal_type: string;
  raw_utterance: string;
  params: Record<string, unknown>;
};

export async function archiveGoalRow(
  trx: Transaction<DatabaseSchema>,
  goalId: number,
): Promise<ArchivedGoal> {
  const row = await trx
    .selectFrom("goals")
    .select(["goal_type", "params", "raw_utterance", "status"])
    .where("id", "=", goalId)
    .executeTakeFirst();
  if (!row) {
    throw new Error(`No goal with id ${goalId}. Locate the goal first, then retry.`);
  }
  if (row.status !== "active") {
    throw new Error(`Goal ${goalId} is already archived.`);
  }
  await trx
    .updateTable("goals")
    .set({ status: "archived" })
    .where("id", "=", goalId)
    .execute();
  return {
    goal_type: row.goal_type,
    raw_utterance: row.raw_utterance,
    params: JSON.parse(row.params) as Record<string, unknown>,
  };
}

export async function writeGoalRow(
  trx: Transaction<DatabaseSchema>,
  entry: {
    goalType: string;
    params: object;
    rawUtterance: string;
    entryType: string;
  },
): Promise<{ goalId: number; sourceId: number }> {
  const sourceId = await writeManualDocument(trx, {
    source_type: "manual",
    entry_type: entry.entryType,
    goal_type: entry.goalType,
    params: entry.params,
    raw_utterance: entry.rawUtterance,
  });
  const row = await trx
    .insertInto("goals")
    .values({
      goal_type: entry.goalType,
      params: JSON.stringify(entry.params),
      raw_utterance: entry.rawUtterance,
      source_id: sourceId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { goalId: Number(row.id), sourceId };
}
