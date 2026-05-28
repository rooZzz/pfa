import { runQuery } from "./query.js";

function toNum(val: unknown): number {
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "number") return val;
  return 0;
}

function toStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString().split("T")[0]!;
  return String(val);
}

function validateDate(s: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Invalid date format: "${s}". Expected YYYY-MM-DD.`);
  }
}

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

export type RealisedLine = {
  kind: "account" | "pension" | "asset" | "property" | "mortgage";
  name: string;
  value_pence: number;
  valid_from: string;
  recorded_at: string;
  source_id: number;
  currency: string;
};

export type ContingentLine = {
  grant_id: number;
  scheme_type: string;
  grant_date: string;
  total_units: number;
  vested_units: number;
  unvested_units: number;
  est_value_pence: number | null;
  price_per_unit_pence: number | null;
  basis: string;
  not_owned: true;
};

export type TrendPoint = {
  date: string;
  realised_total_pence: number;
};

export type NetWorthResult = {
  as_of: string;
  realised: RealisedLine[];
  realised_total_pence: number;
  contingent: ContingentLine[];
  contingent_total_pence: number;
  unknown: string[];
  trend: TrendPoint[];
};

async function queryAccountLines(asOf: string): Promise<RealisedLine[]> {
  const rows = await runQuery(`
    SELECT DISTINCT ON (ab.account_id)
      COALESCE(a.name, 'Account #' || CAST(ab.account_id AS TEXT)) AS name,
      ab.balance_pence,
      ab.valid_from,
      ab.recorded_at,
      ab.source_id,
      ab.currency
    FROM pfa.account_balances ab
    LEFT JOIN pfa.accounts a ON a.id = ab.account_id
    WHERE ab.valid_from <= DATE '${asOf}'
      AND (ab.valid_to IS NULL OR ab.valid_to > DATE '${asOf}')
    ORDER BY ab.account_id, ab.valid_from DESC
  `);
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

async function queryPensionLines(asOf: string): Promise<RealisedLine[]> {
  const rows = await runQuery(`
    SELECT DISTINCT ON (pv.account_id)
      COALESCE(a.name, 'Pension #' || CAST(pv.account_id AS TEXT)) AS name,
      pv.value_pence,
      pv.valid_from,
      pv.recorded_at,
      pv.source_id,
      pv.currency
    FROM pfa.pension_values pv
    LEFT JOIN pfa.accounts a ON a.id = pv.account_id
    WHERE pv.valid_from <= DATE '${asOf}'
      AND (pv.valid_to IS NULL OR pv.valid_to > DATE '${asOf}')
    ORDER BY pv.account_id, pv.valid_from DESC
  `);
  return rows.map((r) => ({
    kind: "pension" as const,
    name: toStr(r.name),
    value_pence: toNum(r.value_pence),
    valid_from: toStr(r.valid_from),
    recorded_at: toStr(r.recorded_at),
    source_id: toNum(r.source_id),
    currency: toStr(r.currency),
  }));
}

async function queryMortgageLines(asOf: string): Promise<RealisedLine[]> {
  const rows = await runQuery(`
    SELECT DISTINCT ON (mb.mortgage_id)
      (m.lender || ' — ' || m.property) AS name,
      mb.outstanding_pence,
      mb.property_value_pence,
      mb.valid_from,
      mb.recorded_at,
      mb.source_id,
      mb.currency
    FROM pfa.mortgage_balance mb
    JOIN pfa.mortgages m ON m.id = mb.mortgage_id
    WHERE mb.valid_from <= DATE '${asOf}'
      AND (mb.valid_to IS NULL OR mb.valid_to > DATE '${asOf}')
    ORDER BY mb.mortgage_id, mb.valid_from DESC
  `);
  const lines: RealisedLine[] = [];
  for (const r of rows) {
    lines.push({
      kind: "property" as const,
      name: toStr(r.name),
      value_pence: toNum(r.property_value_pence),
      valid_from: toStr(r.valid_from),
      recorded_at: toStr(r.recorded_at),
      source_id: toNum(r.source_id),
      currency: toStr(r.currency),
    });
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

async function queryAssetLines(asOf: string): Promise<RealisedLine[]> {
  const rows = await runQuery(`
    SELECT DISTINCT ON (av.asset_id)
      COALESCE(a.name, 'Asset #' || CAST(av.asset_id AS TEXT)) AS name,
      av.gbp_equivalent_pence,
      av.valid_from,
      av.recorded_at,
      av.source_id,
      av.original_currency
    FROM pfa.asset_values av
    LEFT JOIN pfa.assets a ON a.id = av.asset_id
    WHERE av.valid_from <= DATE '${asOf}'
      AND (av.valid_to IS NULL OR av.valid_to > DATE '${asOf}')
    ORDER BY av.asset_id, av.valid_from DESC
  `);
  return rows.map((r) => ({
    kind: "asset" as const,
    name: toStr(r.name),
    value_pence: toNum(r.gbp_equivalent_pence),
    valid_from: toStr(r.valid_from),
    recorded_at: toStr(r.recorded_at),
    source_id: toNum(r.source_id),
    currency: toStr(r.original_currency) || "GBP",
  }));
}

async function queryContingentLines(asOf: string): Promise<ContingentLine[]> {
  const grants = await runQuery(
    `SELECT id, scheme_type, units, grant_date, payload FROM pfa.equity_grant`,
  );
  if (grants.length === 0) return [];

  const vestingRows = await runQuery(`
    SELECT
      grant_id,
      SUM(units_vested) AS total_vested
    FROM pfa.equity_vesting_event
    WHERE vest_date <= DATE '${asOf}'
    GROUP BY grant_id
  `);

  const latestPriceRows = await runQuery(`
    SELECT DISTINCT ON (grant_id)
      grant_id,
      market_price_pence
    FROM pfa.equity_vesting_event
    WHERE vest_date <= DATE '${asOf}'
      AND market_price_pence IS NOT NULL
    ORDER BY grant_id, vest_date DESC
  `);

  const vestedByGrant = new Map<number, number>();
  for (const r of vestingRows) {
    vestedByGrant.set(toNum(r.grant_id), toNum(r.total_vested));
  }

  const latestPriceByGrant = new Map<number, number>();
  for (const r of latestPriceRows) {
    latestPriceByGrant.set(toNum(r.grant_id), toNum(r.market_price_pence));
  }

  const lines: ContingentLine[] = [];
  for (const g of grants) {
    const grantId = toNum(g.id);
    const totalUnits = toNum(g.units);
    const vestedUnits = vestedByGrant.get(grantId) ?? 0;
    const unvestedUnits = totalUnits - vestedUnits;

    if (unvestedUnits <= 0) continue;

    let pricePerUnit: number | null = latestPriceByGrant.get(grantId) ?? null;
    if (pricePerUnit == null && g.payload != null) {
      try {
        const parsed = JSON.parse(toStr(g.payload)) as {
          current_price_pence?: number;
        };
        pricePerUnit = parsed.current_price_pence ?? null;
      } catch {
        pricePerUnit = null;
      }
    }

    lines.push({
      grant_id: grantId,
      scheme_type: toStr(g.scheme_type),
      grant_date: toStr(g.grant_date),
      total_units: totalUnits,
      vested_units: vestedUnits,
      unvested_units: unvestedUnits,
      est_value_pence: pricePerUnit != null ? unvestedUnits * pricePerUnit : null,
      price_per_unit_pence: pricePerUnit,
      basis: "intrinsic estimate — valuation method pending",
      not_owned: true,
    });
  }
  return lines;
}

async function getRealisedTotalPenceAtDate(asOf: string): Promise<number> {
  const rows = await runQuery(`
    WITH
      account_total AS (
        SELECT COALESCE(SUM(b.balance_pence), 0) AS total
        FROM (
          SELECT DISTINCT ON (account_id) balance_pence
          FROM pfa.account_balances
          WHERE valid_from <= DATE '${asOf}'
            AND (valid_to IS NULL OR valid_to > DATE '${asOf}')
          ORDER BY account_id, valid_from DESC
        ) AS b
      ),
      pension_total AS (
        SELECT COALESCE(SUM(p.value_pence), 0) AS total
        FROM (
          SELECT DISTINCT ON (account_id) value_pence
          FROM pfa.pension_values
          WHERE valid_from <= DATE '${asOf}'
            AND (valid_to IS NULL OR valid_to > DATE '${asOf}')
          ORDER BY account_id, valid_from DESC
        ) AS p
      ),
      mortgage_equity AS (
        SELECT
          COALESCE(SUM(mb.property_value_pence), 0) - COALESCE(SUM(mb.outstanding_pence), 0) AS total
        FROM (
          SELECT DISTINCT ON (mortgage_id) property_value_pence, outstanding_pence
          FROM pfa.mortgage_balance
          WHERE valid_from <= DATE '${asOf}'
            AND (valid_to IS NULL OR valid_to > DATE '${asOf}')
          ORDER BY mortgage_id, valid_from DESC
        ) AS mb
      ),
      asset_total AS (
        SELECT COALESCE(SUM(av.gbp_equivalent_pence), 0) AS total
        FROM (
          SELECT DISTINCT ON (asset_id) gbp_equivalent_pence
          FROM pfa.asset_values
          WHERE valid_from <= DATE '${asOf}'
            AND (valid_to IS NULL OR valid_to > DATE '${asOf}')
          ORDER BY asset_id, valid_from DESC
        ) AS av
      )
    SELECT
      account_total.total + pension_total.total + mortgage_equity.total + asset_total.total AS realised_total
    FROM account_total, pension_total, mortgage_equity, asset_total
  `);
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
  if (mortgageLines.length === 0) unknown.push("property / mortgage");
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
