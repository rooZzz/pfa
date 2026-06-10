import { runQuery } from "../../query/query.js";
import { inList, latestPriceTick } from "../../core/snapshots.js";
import { toNum, toStr, toStrOrNull } from "../../core/sql_util.js";
import type { ContingentLine, UnscheduledLine } from "../types.js";

type ContingentResult = {
  upcoming: ContingentLine[];
  unscheduled: UnscheduledLine[];
};

function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return Math.max((toYear! - fromYear!) * 12 + (toMonth! - fromMonth!), 0);
}

function projectedValuePence(
  schemeType: string,
  units: number,
  pricePerUnit: number | null,
  strikePence: number | null,
  savingsFloorPence: number | null,
): number | null {
  if (schemeType === "saye") {
    if (savingsFloorPence == null) {
      if (pricePerUnit == null) return null;
      return units * Math.max(pricePerUnit - (strikePence ?? 0), 0);
    }
    const intrinsic =
      pricePerUnit == null ? 0 : units * Math.max(pricePerUnit - (strikePence ?? 0), 0);
    return savingsFloorPence + intrinsic;
  }
  if (pricePerUnit == null) return null;
  if (strikePence == null) return units * pricePerUnit;
  return units * Math.max(pricePerUnit - strikePence, 0);
}

export async function queryContingentLines(asOf: string): Promise<ContingentResult> {
  const grants = await runQuery(
    `SELECT id, scheme_type, units, strike_pence, asset_id, grant_date, monthly_contribution_pence
     FROM pfa.equity_grant WHERE superseded_by IS NULL`,
  );
  if (grants.length === 0) return { upcoming: [], unscheduled: [] };

  const eventTotals = await runQuery(
    `SELECT grant_id, SUM(units_vested) AS total_units
     FROM pfa.equity_vesting_event
     WHERE superseded_by IS NULL
     GROUP BY grant_id`,
  );
  const eventUnitsByGrant = new Map<number, number>();
  for (const r of eventTotals) {
    eventUnitsByGrant.set(toNum(r.grant_id), toNum(r.total_units));
  }

  const assetIds = grants.map((g) => toNum(g.asset_id)).filter((id) => id > 0);

  const assetById = new Map<number, { name: string; ticker: string | null }>();
  const priceByAsset = new Map<number, { price: number; asOf: string; source: string }>();
  if (assetIds.length > 0) {
    const assetRows = await runQuery(
      `SELECT id, name, ticker FROM pfa.assets WHERE ${inList("id", assetIds).sql}`,
      assetIds,
    );
    for (const r of assetRows) {
      assetById.set(toNum(r.id), {
        name: toStr(r.name),
        ticker: toStrOrNull(r.ticker),
      });
    }

    const prices = latestPriceTick(
      ["ap.asset_id", "ap.unit_price_pence", "ap.as_of", "ap.source"],
      asOf,
      inList("ap.asset_id", assetIds),
    );
    const priceRows = await runQuery(prices.sql, prices.params);
    for (const r of priceRows) {
      priceByAsset.set(toNum(r.asset_id), {
        price: toNum(r.unit_price_pence),
        asOf: toStr(r.as_of),
        source: toStr(r.source),
      });
    }
  }

  const events = await runQuery(
    `SELECT grant_id, vest_date, units_vested
     FROM pfa.equity_vesting_event
     WHERE vest_date > CAST(? AS DATE)
       AND superseded_by IS NULL
     ORDER BY vest_date ASC, grant_id ASC`,
    [asOf],
  );

  const grantById = new Map<number, (typeof grants)[number]>();
  for (const g of grants) grantById.set(toNum(g.id), g);

  const upcoming: ContingentLine[] = [];
  for (const e of events) {
    const grantId = toNum(e.grant_id);
    const grant = grantById.get(grantId);
    if (!grant) continue;
    const assetId = toNum(grant.asset_id);
    const asset = assetId > 0 ? assetById.get(assetId) : undefined;
    const priceEntry = assetId > 0 ? priceByAsset.get(assetId) : undefined;
    const pricePerUnit = priceEntry?.price ?? null;
    const strikePence = grant.strike_pence != null ? toNum(grant.strike_pence) : null;
    const units = toNum(e.units_vested);
    const schemeType = toStr(grant.scheme_type);
    const vestDate = toStr(e.vest_date);
    const monthly =
      grant.monthly_contribution_pence != null
        ? toNum(grant.monthly_contribution_pence)
        : null;
    const savingsFloor =
      schemeType === "saye" && monthly != null
        ? monthly * monthsBetween(toStr(grant.grant_date), vestDate)
        : null;

    upcoming.push({
      grant_id: grantId,
      vest_date: vestDate,
      scheme_type: schemeType,
      units,
      ticker: asset?.ticker ?? null,
      asset_name: asset?.name ?? null,
      price_per_unit_pence: pricePerUnit,
      price_as_of: priceEntry?.asOf ?? null,
      price_source: priceEntry?.source ?? null,
      strike_pence: strikePence,
      monthly_contribution_pence: monthly,
      savings_floor_pence: savingsFloor,
      projected_value_pence: projectedValuePence(
        schemeType,
        units,
        pricePerUnit,
        strikePence,
        savingsFloor,
      ),
      not_owned: true,
    });
  }

  const unscheduled: UnscheduledLine[] = [];
  for (const g of grants) {
    const grantId = toNum(g.id);
    const totalUnits = toNum(g.units);
    const scheduledUnits = eventUnitsByGrant.get(grantId) ?? 0;
    const remaining = totalUnits - scheduledUnits;
    if (remaining <= 0) continue;
    const assetId = toNum(g.asset_id);
    const asset = assetId > 0 ? assetById.get(assetId) : undefined;
    unscheduled.push({
      grant_id: grantId,
      scheme_type: toStr(g.scheme_type),
      units: remaining,
      ticker: asset?.ticker ?? null,
      asset_name: asset?.name ?? null,
    });
  }

  return { upcoming, unscheduled };
}
