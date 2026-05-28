import { runQuery } from "../../query.js";
import { inList, latestPriceTick } from "../../snapshots.js";
import { toNum, toStr } from "../../sql_util.js";
import type { ContingentLine } from "../types.js";

export async function queryContingentLines(asOf: string): Promise<ContingentLine[]> {
  const grants = await runQuery(
    `SELECT id, scheme_type, units, grant_date, asset_id FROM pfa.equity_grant`,
  );
  if (grants.length === 0) return [];

  const vestingRows = await runQuery(
    `SELECT
       grant_id,
       SUM(units_vested) AS total_vested
     FROM pfa.equity_vesting_event
     WHERE vest_date <= CAST(? AS DATE)
     GROUP BY grant_id`,
    [asOf],
  );

  const vestedByGrant = new Map<number, number>();
  for (const r of vestingRows) {
    vestedByGrant.set(toNum(r.grant_id), toNum(r.total_vested));
  }

  const assetIds = grants.map((g) => toNum(g.asset_id)).filter((id) => id > 0);

  const priceByAsset = new Map<number, { price: number; source: string }>();
  if (assetIds.length > 0) {
    const prices = latestPriceTick(
      ["ap.asset_id", "ap.unit_price_pence", "ap.source"],
      asOf,
      inList("ap.asset_id", assetIds),
    );
    const priceRows = await runQuery(prices.sql, prices.params);
    for (const r of priceRows) {
      priceByAsset.set(toNum(r.asset_id), {
        price: toNum(r.unit_price_pence),
        source: toStr(r.source),
      });
    }
  }

  const lines: ContingentLine[] = [];
  for (const g of grants) {
    const grantId = toNum(g.id);
    const totalUnits = toNum(g.units);
    const vestedUnits = vestedByGrant.get(grantId) ?? 0;
    const unvestedUnits = totalUnits - vestedUnits;

    if (unvestedUnits <= 0) continue;

    const assetId = toNum(g.asset_id);
    const priceEntry = assetId > 0 ? priceByAsset.get(assetId) : undefined;
    const pricePerUnit = priceEntry?.price ?? null;
    const source = priceEntry?.source ?? null;

    lines.push({
      grant_id: grantId,
      scheme_type: toStr(g.scheme_type),
      grant_date: toStr(g.grant_date),
      total_units: totalUnits,
      vested_units: vestedUnits,
      unvested_units: unvestedUnits,
      est_value_pence: pricePerUnit != null ? unvestedUnits * pricePerUnit : null,
      price_per_unit_pence: pricePerUnit,
      basis: source != null ? `${source} price` : "no price recorded",
      not_owned: true,
    });
  }
  return lines;
}
