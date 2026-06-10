import { runQuery } from "../../query/query.js";
import { latestRangeSnapshot } from "../../core/snapshots.js";
import { toNum, toStr } from "../../core/sql_util.js";
import type { RealisedLine } from "../types.js";

export async function queryPensionLines(asOf: string): Promise<RealisedLine[]> {
  const snap = latestRangeSnapshot(
    "pfa.pension_values",
    "account_id",
    ["account_id", "value_pence", "valid_from", "recorded_at", "source_id", "currency"],
    asOf,
  );
  const rows = await runQuery(
    `SELECT
       COALESCE(a.name, 'Pension #' || CAST(p.account_id AS TEXT)) AS name,
       a.provider,
       p.value_pence,
       p.valid_from,
       p.recorded_at,
       p.source_id,
       p.currency
     FROM (${snap.sql}) p
     LEFT JOIN pfa.accounts a ON a.id = p.account_id`,
    snap.params,
  );
  return rows.map((r) => ({
    kind: "pension" as const,
    name: toStr(r.name),
    institution: r.provider == null ? null : toStr(r.provider),
    value_pence: toNum(r.value_pence),
    valid_from: toStr(r.valid_from),
    recorded_at: toStr(r.recorded_at),
    source_id: toNum(r.source_id),
    currency: toStr(r.currency),
  }));
}
