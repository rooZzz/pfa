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
  price_as_of?: string;
  price_source?: string;
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
  const mortgageRows = await runQuery(`
    SELECT DISTINCT ON (mb.mortgage_id)
      m.id AS mortgage_id,
      m.property,
      (m.lender || ' — ' || m.property) AS name,
      mb.outstanding_pence,
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
  for (const r of mortgageRows) {
    const propertyName = toStr(r.property);
    const priceRows = await runQuery(`
      SELECT DISTINCT ON (ap.asset_id)
        ap.unit_price_pence,
        ap.currency,
        ap.as_of,
        ap.source
      FROM pfa.asset_prices ap
      JOIN pfa.assets a ON a.id = ap.asset_id
      WHERE a.name = '${propertyName.replace(/'/g, "''")}'
        AND a.asset_type = 'property'
        AND ap.as_of <= TIMESTAMP '${asOf} 23:59:59'
      ORDER BY ap.asset_id, ap.as_of DESC
    `);

    if (priceRows.length > 0) {
      const pr = priceRows[0]!;
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

async function queryAssetLines(asOf: string): Promise<RealisedLine[]> {
  const rows = await runQuery(`
    WITH latest_holdings AS (
      SELECT DISTINCT ON (asset_id)
        asset_id,
        quantity,
        valid_from,
        recorded_at,
        source_id
      FROM pfa.holdings
      WHERE valid_from <= DATE '${asOf}'
        AND (valid_to IS NULL OR valid_to > DATE '${asOf}')
      ORDER BY asset_id, valid_from DESC
    ),
    latest_prices AS (
      SELECT DISTINCT ON (asset_id)
        asset_id,
        unit_price_pence,
        currency,
        as_of,
        source
      FROM pfa.asset_prices
      WHERE as_of <= TIMESTAMP '${asOf} 23:59:59'
      ORDER BY asset_id, as_of DESC
    )
    SELECT
      COALESCE(a.name, 'Asset #' || CAST(h.asset_id AS TEXT)) AS name,
      a.asset_type,
      h.quantity,
      h.valid_from,
      h.recorded_at,
      h.source_id,
      p.unit_price_pence,
      p.currency,
      p.as_of AS price_as_of,
      p.source AS price_source,
      CAST(h.quantity AS BIGINT) * p.unit_price_pence AS gbp_equivalent_pence
    FROM latest_holdings h
    JOIN pfa.assets a ON a.id = h.asset_id
    LEFT JOIN latest_prices p ON p.asset_id = h.asset_id
    WHERE a.asset_type != 'property'
  `);

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
      price_as_of: toStr(r.price_as_of).split("T")[0] ?? toStr(r.price_as_of),
      price_source: toStr(r.price_source),
    });
  }
  return lines;
}

async function queryContingentLines(asOf: string): Promise<ContingentLine[]> {
  const grants = await runQuery(
    `SELECT id, scheme_type, units, grant_date, asset_id FROM pfa.equity_grant`,
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

  const vestedByGrant = new Map<number, number>();
  for (const r of vestingRows) {
    vestedByGrant.set(toNum(r.grant_id), toNum(r.total_vested));
  }

  const assetIds = grants
    .map((g) => toNum(g.asset_id))
    .filter((id) => id > 0);

  const priceByAsset = new Map<number, { price: number; source: string }>();
  if (assetIds.length > 0) {
    const priceRows = await runQuery(`
      SELECT DISTINCT ON (asset_id)
        asset_id,
        unit_price_pence,
        source
      FROM pfa.asset_prices
      WHERE asset_id IN (${assetIds.join(",")})
        AND as_of <= TIMESTAMP '${asOf} 23:59:59'
      ORDER BY asset_id, as_of DESC
    `);
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
        SELECT COALESCE(SUM(mb.outstanding_pence), 0) AS total_outstanding
        FROM (
          SELECT DISTINCT ON (mortgage_id) outstanding_pence
          FROM pfa.mortgage_balance
          WHERE valid_from <= DATE '${asOf}'
            AND (valid_to IS NULL OR valid_to > DATE '${asOf}')
          ORDER BY mortgage_id, valid_from DESC
        ) AS mb
      ),
      property_total AS (
        SELECT COALESCE(SUM(latest.unit_price_pence), 0) AS total
        FROM (
          SELECT DISTINCT ON (ap.asset_id)
            ap.unit_price_pence
          FROM pfa.asset_prices ap
          JOIN pfa.assets a ON a.id = ap.asset_id
          WHERE a.asset_type = 'property'
            AND ap.as_of <= TIMESTAMP '${asOf} 23:59:59'
          ORDER BY ap.asset_id, ap.as_of DESC
        ) AS latest
      ),
      asset_total AS (
        SELECT COALESCE(SUM(CAST(h.quantity AS BIGINT) * p.unit_price_pence), 0) AS total
        FROM (
          SELECT DISTINCT ON (asset_id) asset_id, quantity
          FROM pfa.holdings
          WHERE valid_from <= DATE '${asOf}'
            AND (valid_to IS NULL OR valid_to > DATE '${asOf}')
          ORDER BY asset_id, valid_from DESC
        ) AS h
        JOIN (
          SELECT DISTINCT ON (asset_id) asset_id, unit_price_pence
          FROM pfa.asset_prices
          WHERE as_of <= TIMESTAMP '${asOf} 23:59:59'
          ORDER BY asset_id, as_of DESC
        ) AS p ON p.asset_id = h.asset_id
        JOIN pfa.assets a ON a.id = h.asset_id
        WHERE a.asset_type != 'property'
      )
    SELECT
      account_total.total + pension_total.total
        + property_total.total - mortgage_equity.total_outstanding
        + asset_total.total AS realised_total
    FROM account_total, pension_total, mortgage_equity, property_total, asset_total
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
  if (mortgageLines.filter((l) => l.kind === "property").length === 0) unknown.push("property");
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
