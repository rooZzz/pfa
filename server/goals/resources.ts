import { LIVE_CONTEXT, type ReadContext, runQuery } from "../query.js";
import { latestRangeSnapshot } from "../snapshots.js";
import { toNum } from "../sql_util.js";
import type { ImplementedGoalType } from "./catalog.js";

const CLAIMED_ACCOUNT_TYPES: Record<ImplementedGoalType, readonly string[]> = {
  emergency_fund: ["current", "savings", "isa"],
  house_deposit: ["current", "savings", "isa"],
  isa_max: ["isa"],
};

export type ClaimedAccount = { account_id: number; balance_pence: number };

export async function claimedAccounts(
  goalType: ImplementedGoalType,
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<ClaimedAccount[]> {
  const types = CLAIMED_ACCOUNT_TYPES[goalType];
  const snap = latestRangeSnapshot(
    `${ctx.schema}.account_balances`,
    "account_id",
    ["account_id", "balance_pence"],
    asOf,
  );
  const placeholders = types.map(() => "?").join(", ");
  const rows = await runQuery(
    `SELECT a.id AS account_id, b.balance_pence AS balance_pence
       FROM (${snap.sql}) b
       JOIN ${ctx.schema}.accounts a ON a.id = b.account_id
       WHERE a.type IN (${placeholders})`,
    [...snap.params, ...types],
  );
  return rows.map((r) => ({
    account_id: toNum(r.account_id),
    balance_pence: toNum(r.balance_pence),
  }));
}
