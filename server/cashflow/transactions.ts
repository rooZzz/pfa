import { runQuery } from "../query.js";
import { toNum, toStr } from "../sql_util.js";
import type { CategoryLine, SourceLine } from "./types.js";

export async function queryTransactionsByCategory(
  start: string,
  end: string,
): Promise<CategoryLine[]> {
  const rows = await runQuery(
    `SELECT
      category,
      COALESCE(SUM(amount_pence) FILTER (WHERE amount_pence > 0), 0) AS inflow_pence,
      COALESCE(ABS(SUM(amount_pence) FILTER (WHERE amount_pence < 0)), 0) AS outflow_pence,
      COUNT(*) AS count,
      list_slice(list(DISTINCT description) FILTER (WHERE description IS NOT NULL), 1, 6) AS samples
    FROM pfa.transactions
    WHERE CAST(occurred_at AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
      AND is_internal = 0
    GROUP BY category
    ORDER BY outflow_pence DESC`,
    [start, end],
  );

  return rows.map((r) => ({
    category: toStr(r.category),
    inflow_pence: toNum(r.inflow_pence),
    outflow_pence: toNum(r.outflow_pence),
    count: toNum(r.count),
    samples: Array.isArray(r.samples) ? r.samples.map((s) => String(s)) : [],
  }));
}

export async function queryIncomeBySource(
  start: string,
  end: string,
): Promise<SourceLine[]> {
  const rows = await runQuery(
    `SELECT
      COALESCE(description, 'Unattributed') AS source,
      COALESCE(SUM(amount_pence), 0) AS inflow_pence,
      COUNT(*) AS count
    FROM pfa.transactions
    WHERE CAST(occurred_at AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
      AND is_internal = 0
      AND amount_pence > 0
    GROUP BY COALESCE(description, 'Unattributed')
    ORDER BY inflow_pence DESC`,
    [start, end],
  );

  return rows.map((r) => ({
    source: toStr(r.source),
    inflow_pence: toNum(r.inflow_pence),
    count: toNum(r.count),
  }));
}

export async function queryPotSavingNetPence(
  start: string,
  end: string,
): Promise<number> {
  const rows = await runQuery(
    `SELECT COALESCE(-SUM(t.amount_pence), 0) AS net_into_pots
     FROM pfa.transactions t
     JOIN pfa.accounts p
       ON p.external_id = t.description
      AND p.provider = 'monzo'
      AND p.type IN ('savings', 'isa')
     WHERE CAST(t.occurred_at AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
       AND t.is_internal = 1`,
    [start, end],
  );
  return toNum(rows[0]?.net_into_pots ?? 0);
}
