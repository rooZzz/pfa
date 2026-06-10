import { runQuery } from "../../query/query.js";
import { latestPriceTick, latestRangeSnapshot } from "../../core/snapshots.js";
import { toNum, toStr, toStrOrNull } from "../../core/sql_util.js";
import type { RealisedLine } from "../types.js";

export async function queryAssetLines(asOf: string): Promise<RealisedLine[]> {
  const holdings = latestRangeSnapshot(
    "pfa.holdings",
    "asset_id",
    ["asset_id", "quantity", "valid_from", "recorded_at", "source_id"],
    asOf,
  );
  const prices = latestPriceTick(
    ["ap.asset_id", "ap.unit_price_pence", "ap.currency", "ap.as_of", "ap.source"],
    asOf,
  );
  const rows = await runQuery(
    `SELECT
       COALESCE(a.name, 'Asset #' || CAST(h.asset_id AS TEXT)) AS name,
       a.asset_type,
       a.ticker,
       h.quantity,
       a.quantity_scale,
       h.valid_from,
       h.recorded_at,
       h.source_id,
       p.unit_price_pence,
       p.currency,
       p.as_of AS price_as_of,
       p.source AS price_source,
       CAST(h.quantity AS BIGINT) * p.unit_price_pence // a.quantity_scale AS gbp_equivalent_pence
     FROM (${holdings.sql}) h
     JOIN pfa.assets a ON a.id = h.asset_id
     LEFT JOIN (${prices.sql}) p ON p.asset_id = h.asset_id
     WHERE a.asset_type != 'property'`,
    [...holdings.params, ...prices.params],
  );

  const lines: RealisedLine[] = [];
  for (const r of rows) {
    if (toNum(r.unit_price_pence) === 0 && r.unit_price_pence == null) {
      continue;
    }
    lines.push({
      kind: "asset" as const,
      name: toStr(r.name),
      value_pence: toNum(r.gbp_equivalent_pence),
      valid_from: toStr(r.valid_from),
      recorded_at: toStr(r.recorded_at),
      source_id: toNum(r.source_id),
      currency: toStr(r.currency) || "GBP",
      ticker: toStrOrNull(r.ticker),
      quantity: toNum(r.quantity),
      quantity_scale: toNum(r.quantity_scale),
      unit_price_pence: toNum(r.unit_price_pence),
      price_as_of: toStr(r.price_as_of).split("T")[0] ?? toStr(r.price_as_of),
      price_source: toStr(r.price_source),
    });
  }
  return lines;
}
