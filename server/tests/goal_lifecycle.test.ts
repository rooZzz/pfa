import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../core/db.js";
import { getBriefing } from "../goals/briefing.js";
import { resetDuck } from "../query/query.js";
import { archiveGoal } from "../tools/archive_goal.js";
import { confirmGoal } from "../tools/confirm_goal.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { updateGoal } from "../tools/update_goal.js";

const AS_OF = "2026-03-01";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM goals;
    DELETE FROM transactions;
    DELETE FROM account_balances;
    DELETE FROM accounts;
    DELETE FROM documents;
  `);
});

function activeGoalId(): number {
  return (
    getDb()
      .prepare("SELECT id FROM goals WHERE status = 'active' ORDER BY id DESC LIMIT 1")
      .get() as { id: number }
  ).id;
}

function goalStatus(id: number): string {
  return (
    getDb().prepare("SELECT status FROM goals WHERE id = ?").get(id) as {
      status: string;
    }
  ).status;
}

describe("archive_goal", () => {
  it("archives a goal and drops it from the briefing while retaining the row", async () => {
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });
    const id = activeGoalId();

    await archiveGoal({ goal_id: id });

    expect(goalStatus(id)).toBe("archived");
    const briefing = await getBriefing(AS_OF);
    expect(briefing.directives.filter((d) => d.goal_id === id)).toHaveLength(0);
  });

  it("refuses to archive an already-archived goal", async () => {
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });
    const id = activeGoalId();
    await archiveGoal({ goal_id: id });

    await expect(archiveGoal({ goal_id: id })).rejects.toThrow(/already archived/);
  });

  it("refuses to archive a goal that does not exist", async () => {
    await expect(archiveGoal({ goal_id: 99999 })).rejects.toThrow(/No goal with id/);
  });
});

describe("update_goal", () => {
  it("archives the old goal and records a new version with merged params", async () => {
    await confirmGoal({
      goal_type: "house_deposit",
      raw_utterance: "save a deposit",
      target_amount_pence: 5000000,
      target_date: "2027-01-01",
    });
    const oldId = activeGoalId();

    await updateGoal({ goal_id: oldId, target_amount_pence: 8000000 });

    expect(goalStatus(oldId)).toBe("archived");
    const fresh = getDb()
      .prepare("SELECT id, params FROM goals WHERE status = 'active'")
      .get() as { id: number; params: string };
    expect(fresh.id).not.toBe(oldId);
    const params = JSON.parse(fresh.params) as Record<string, unknown>;
    expect(params.target_amount_pence).toBe(8000000);
    expect(params.target_date).toBe("2027-01-01");
  });

  it("reflects the new target in the briefing", async () => {
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 5000000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await confirmGoal({
      goal_type: "house_deposit",
      raw_utterance: "save a deposit",
      target_amount_pence: 5000000,
      target_date: "2027-01-01",
    });
    const oldId = activeGoalId();

    await updateGoal({ goal_id: oldId, target_amount_pence: 8000000 });

    const briefing = await getBriefing(AS_OF);
    const progress = briefing.directives.find(
      (d) => d.sub_goal === "deposit_progress" && d.kind === "progress",
    );
    expect(progress?.data.target_pence).toBe(8000000);
  });

  it("refuses to update a goal that does not exist", async () => {
    await expect(updateGoal({ goal_id: 99999, target_months: 6 })).rejects.toThrow(
      /No goal with id/,
    );
  });
});
