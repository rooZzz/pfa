import { runQuery } from "../query.js";
import { latestPriceTick, latestRangeSnapshot } from "../snapshots.js";
import { toNum, validateDate } from "../sql_util.js";
import { queryAccountLines } from "./lines/accounts.js";
import { queryAssetLines } from "./lines/assets.js";
import { queryContingentLines } from "./lines/contingent.js";
import { queryMortgageLines } from "./lines/mortgage.js";
import { queryPensionLines } from "./lines/pensions.js";
import type { NetWorthResult, TrendPoint } from "./types.js";

export type {
  ContingentLine,
  NetWorthResult,
  RealisedLine,
  TrendPoint,
} from "./types.js";

function monthStartDatesUpTo(asOf: string, count: number): string[] {
  const parts = asOf.split("-");
  const year = parseInt(parts[0]!, 10);
  const month = parseInt(parts[1]!, 10) - 1;
  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    let m = month - i;
    let y = year;
    while (m < 0) {
      m += 12;
      y--;
    }
    dates.push(`${y}-${String(m + 1).padStart(2, "0")}-01`);
  }
  return dates;
}

async function getRealisedTotalPenceAtDate(asOf: string): Promise<number> {
  const accounts = latestRangeSnapshot(
    "pfa.account_balances",
    "account_id",
    ["balance_pence"],
    asOf,
  );
  const pensions = latestRangeSnapshot(
    "pfa.pension_values",
    "account_id",
    ["value_pence"],
    asOf,
  );
  const mortgages = latestRangeSnapshot(
    "pfa.mortgage_balance",
    "mortgage_id",
    ["outstanding_pence"],
    asOf,
  );
  const propertyPrices = latestPriceTick(["ap.unit_price_pence"], asOf, {
    sql: "a.asset_type = 'property'",
    params: [],
  });
  const holdings = latestRangeSnapshot(
    "pfa.holdings",
    "asset_id",
    ["asset_id", "quantity"],
    asOf,
  );
  const assetPrices = latestPriceTick(["ap.asset_id", "ap.unit_price_pence"], asOf);

  const rows = await runQuery(
    `WITH
      account_total AS (SELECT COALESCE(SUM(balance_pence), 0) AS total FROM (${accounts.sql})),
      pension_total AS (SELECT COALESCE(SUM(value_pence), 0) AS total FROM (${pensions.sql})),
      mortgage_total AS (SELECT COALESCE(SUM(outstanding_pence), 0) AS total FROM (${mortgages.sql})),
      property_total AS (SELECT COALESCE(SUM(unit_price_pence), 0) AS total FROM (${propertyPrices.sql})),
      asset_total AS (
        SELECT COALESCE(SUM(CAST(h.quantity AS BIGINT) * p.unit_price_pence), 0) AS total
        FROM (${holdings.sql}) h
        JOIN (${assetPrices.sql}) p ON p.asset_id = h.asset_id
        JOIN pfa.assets a ON a.id = h.asset_id
        WHERE a.asset_type != 'property'
      )
    SELECT
      account_total.total + pension_total.total
        + property_total.total - mortgage_total.total
        + asset_total.total AS realised_total
    FROM account_total, pension_total, mortgage_total, property_total, asset_total`,
    [
      ...accounts.params,
      ...pensions.params,
      ...mortgages.params,
      ...propertyPrices.params,
      ...holdings.params,
      ...assetPrices.params,
    ],
  );
  if (rows.length === 0) return 0;
  return toNum(rows[0]!.realised_total);
}

export async function getNetWorth(asOf: string): Promise<NetWorthResult> {
  validateDate(asOf);

  const [accountLines, pensionLines, mortgageLines, assetLines, contingentLines] =
    await Promise.all([
      queryAccountLines(asOf),
      queryPensionLines(asOf),
      queryMortgageLines(asOf),
      queryAssetLines(asOf),
      queryContingentLines(asOf),
    ]);

  const realised = [...accountLines, ...pensionLines, ...mortgageLines, ...assetLines];
  const realisedTotal = realised.reduce((sum, l) => sum + l.value_pence, 0);
  const contingentTotal = contingentLines.reduce(
    (sum, l) => sum + (l.est_value_pence ?? 0),
    0,
  );

  const unknown: string[] = [];
  if (accountLines.length === 0) unknown.push("accounts");
  if (pensionLines.length === 0) unknown.push("pension");
  if (mortgageLines.filter((l) => l.kind === "property").length === 0)
    unknown.push("property");
  if (assetLines.length === 0) unknown.push("assets");

  const trendDates = monthStartDatesUpTo(asOf, 12);
  const trendTotals = await Promise.all(trendDates.map(getRealisedTotalPenceAtDate));
  const trend: TrendPoint[] = trendDates.map((date, i) => ({
    date,
    realised_total_pence: trendTotals[i]!,
  }));

  return {
    as_of: asOf,
    realised,
    realised_total_pence: realisedTotal,
    contingent: contingentLines,
    contingent_total_pence: contingentTotal,
    unknown,
    trend,
  };
}
