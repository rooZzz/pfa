import { runQuery } from "../../query.js";
import { latestPriceTick, latestRangeSnapshot } from "../../snapshots.js";
import { toNum, toStr } from "../../sql_util.js";
import type { RealisedLine } from "../types.js";

export async function queryMortgageLines(asOf: string): Promise<RealisedLine[]> {
  const snap = latestRangeSnapshot(
    "pfa.mortgage_balance",
    "mortgage_id",
    [
      "mortgage_id",
      "outstanding_pence",
      "valid_from",
      "recorded_at",
      "source_id",
      "currency",
    ],
    asOf,
  );
  const mortgageRows = await runQuery(
    `SELECT
       m.id AS mortgage_id,
       m.property,
       (m.lender || ' — ' || m.property) AS name,
       mb.outstanding_pence,
       mb.valid_from,
       mb.recorded_at,
       mb.source_id,
       mb.currency
     FROM (${snap.sql}) mb
     JOIN pfa.mortgages m ON m.id = mb.mortgage_id`,
    snap.params,
  );

  const propertyPrices = latestPriceTick(
    [
      "ap.asset_id",
      "a.name AS property_name",
      "ap.unit_price_pence",
      "ap.currency",
      "ap.as_of",
      "ap.source",
    ],
    asOf,
    { sql: "a.asset_type = 'property'", params: [] },
  );
  const priceRows = await runQuery(propertyPrices.sql, propertyPrices.params);
  const priceByProperty = new Map<string, Record<string, unknown>>();
  for (const pr of priceRows) {
    priceByProperty.set(toStr(pr.property_name), pr);
  }

  const lines: RealisedLine[] = [];
  for (const r of mortgageRows) {
    const pr = priceByProperty.get(toStr(r.property));
    if (pr) {
      lines.push({
        kind: "property" as const,
        name: toStr(r.name),
        value_pence: toNum(pr.unit_price_pence),
        valid_from: toStr(r.valid_from),
        recorded_at: toStr(r.recorded_at),
        source_id: toNum(r.source_id),
        currency: toStr(pr.currency),
        price_as_of: toStr(pr.as_of).split("T")[0] ?? toStr(pr.as_of),
        price_source: toStr(pr.source),
      });
    }

    lines.push({
      kind: "mortgage" as const,
      name: toStr(r.name),
      value_pence: -toNum(r.outstanding_pence),
      valid_from: toStr(r.valid_from),
      recorded_at: toStr(r.recorded_at),
      source_id: toNum(r.source_id),
      currency: toStr(r.currency),
    });
  }
  return lines;
}
