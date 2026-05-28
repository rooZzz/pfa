import { runQuery } from "../query.js";
import { toNum, toStr } from "../sql_util.js";
import type { CategoryLine } from "./types.js";

export async function queryTransactionsByCategory(
  start: string,
  end: string,
): Promise<CategoryLine[]> {
  const rows = await runQuery(
    `SELECT
      category,
      COALESCE(SUM(amount_pence) FILTER (WHERE amount_pence > 0), 0) AS inflow_pence,
      COALESCE(ABS(SUM(amount_pence) FILTER (WHERE amount_pence < 0)), 0) AS outflow_pence,
      COUNT(*) AS count
    FROM pfa.transactions
    WHERE CAST(occurred_at AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
    GROUP BY category
    ORDER BY outflow_pence DESC`,
    [start, end],
  );

  return rows.map((r) => ({
    category: toStr(r.category),
    inflow_pence: toNum(r.inflow_pence),
    outflow_pence: toNum(r.outflow_pence),
    count: toNum(r.count),
  }));
}
