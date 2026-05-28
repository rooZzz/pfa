import { runQuery } from "../../query.js";
import { latestRangeSnapshot } from "../../snapshots.js";
import { toNum, toStr } from "../../sql_util.js";
import type { RealisedLine } from "../types.js";

export async function queryAccountLines(asOf: string): Promise<RealisedLine[]> {
  const snap = latestRangeSnapshot(
    "pfa.account_balances",
    "account_id",
    ["account_id", "balance_pence", "valid_from", "recorded_at", "source_id", "currency"],
    asOf,
  );
  const rows = await runQuery(
    `SELECT
       COALESCE(a.name, 'Account #' || CAST(b.account_id AS TEXT)) AS name,
       b.balance_pence,
       b.valid_from,
       b.recorded_at,
       b.source_id,
       b.currency
     FROM (${snap.sql}) b
     LEFT JOIN pfa.accounts a ON a.id = b.account_id`,
    snap.params,
  );
  return rows.map((r) => ({
    kind: "account" as const,
    name: toStr(r.name),
    value_pence: toNum(r.balance_pence),
    valid_from: toStr(r.valid_from),
    recorded_at: toStr(r.recorded_at),
    source_id: toNum(r.source_id),
    currency: toStr(r.currency),
  }));
}
