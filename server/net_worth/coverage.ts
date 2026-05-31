import { runQuery } from "../query.js";
import { toStr } from "../sql_util.js";

export type SeriesStatus = {
  label: string;
  state: "fresh" | "stale" | "missing";
  age_days: number | null;
};

export type MonthCoverage = {
  month: number;
  year: number;
  initial: string;
  state: "complete" | "current" | "incomplete" | "future";
  fraction_fresh: number;
  series: SeriesStatus[];
};

export type CoverageSeries = {
  label: string;
  cadence: "snapshot" | "recurring";
  window_days: number;
  entities: string[][];
};

const MONTH_INITIALS = "JFMAMJJASOND";

const NET_WORTH_WINDOWS = {
  accounts: 31,
  investments: 35,
  pension: 100,
  property: 185,
  mortgage: 100,
} as const;

function dateOnly(value: unknown): string {
  return toStr(value).slice(0, 10);
}

function parseYmd(value: string): [number, number, number] {
  const parts = value.split("-");
  return [parseInt(parts[0]!, 10), parseInt(parts[1]!, 10), parseInt(parts[2]!, 10)];
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = parseYmd(from);
  const [by, bm, bd] = parseYmd(to);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function latestOnOrBefore(dates: string[], ref: string): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (d <= ref && (best === null || d > best)) best = d;
  }
  return best;
}

function classifySeries(
  series: CoverageSeries,
  monthStart: string,
  refDate: string,
): SeriesStatus {
  if (series.cadence === "recurring") {
    let latest: string | null = null;
    for (const entity of series.entities) {
      for (const d of entity) {
        if (d >= monthStart && d <= refDate && (latest === null || d > latest)) {
          latest = d;
        }
      }
    }
    if (latest === null) return { label: series.label, state: "missing", age_days: null };
    return {
      label: series.label,
      state: "fresh",
      age_days: daysBetween(latest, refDate),
    };
  }

  let maxAge = -1;
  let anyExisting = false;
  for (const entity of series.entities) {
    const latest = latestOnOrBefore(entity, refDate);
    if (latest === null) continue;
    anyExisting = true;
    const age = daysBetween(latest, refDate);
    if (age > maxAge) maxAge = age;
  }
  if (!anyExisting) return { label: series.label, state: "missing", age_days: null };
  return {
    label: series.label,
    state: maxAge <= series.window_days ? "fresh" : "stale",
    age_days: maxAge,
  };
}

export function buildYearCoverage(
  asOf: string,
  periodStart: string,
  series: CoverageSeries[],
): MonthCoverage[] {
  const [startYear, startMonth] = parseYmd(periodStart);
  const months: MonthCoverage[] = [];

  for (let i = 0; i < 12; i++) {
    const offset = startMonth - 1 + i;
    const year = startYear + Math.floor(offset / 12);
    const month = (offset % 12) + 1;
    const initial = MONTH_INITIALS[month - 1]!;
    const monthStart = ymd(year, month, 1);
    const monthEnd = ymd(year, month, lastDayOfMonth(year, month));

    if (monthStart > asOf) {
      months.push({
        month,
        year,
        initial,
        state: "future",
        fraction_fresh: 0,
        series: [],
      });
      continue;
    }

    const refDate = monthEnd <= asOf ? monthEnd : asOf;
    const statuses = series.map((s) => classifySeries(s, monthStart, refDate));
    const freshCount = statuses.filter((s) => s.state === "fresh").length;
    const fraction = statuses.length > 0 ? freshCount / statuses.length : 0;
    const isCurrent = asOf >= monthStart && asOf <= monthEnd;
    const state = isCurrent
      ? "current"
      : statuses.length > 0 && freshCount === statuses.length
        ? "complete"
        : "incomplete";

    months.push({
      month,
      year,
      initial,
      state,
      fraction_fresh: fraction,
      series: statuses,
    });
  }

  return months;
}

async function resolveFinancialYearStart(asOf: string): Promise<string> {
  const rows = await runQuery(
    `SELECT starts_on FROM pfa.tax_periods
       WHERE CAST(? AS DATE) BETWEEN CAST(starts_on AS DATE) AND CAST(ends_on AS DATE)`,
    [asOf],
  );
  if (rows.length === 0) {
    throw new Error(
      `No tax period covering ${asOf}. Ensure tax_periods is seeded before computing coverage.`,
    );
  }
  return dateOnly(rows[0]!.starts_on);
}

function groupDates(rows: Record<string, unknown>[], key: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const id = toStr(row[key]);
    const bucket = groups.get(id);
    const date = dateOnly(row.observed_on);
    if (bucket) bucket.push(date);
    else groups.set(id, [date]);
  }
  return groups;
}

async function payslipEntities(asOf: string): Promise<string[][]> {
  const rows = await runQuery(
    `SELECT pay_date AS observed_on FROM pfa.income_events WHERE CAST(pay_date AS DATE) <= CAST(? AS DATE)`,
    [asOf],
  );
  return [rows.map((r) => dateOnly(r.observed_on))];
}

async function buildNetWorthSeries(asOf: string): Promise<CoverageSeries[]> {
  const [
    accountRows,
    pensionRows,
    mortgageRows,
    ownedAssetRows,
    assetPriceRows,
    payslips,
  ] = await Promise.all([
    runQuery(
      `SELECT account_id, valid_from AS observed_on, balance_pence
         FROM pfa.account_balances
         WHERE valid_from <= CAST(? AS DATE)
         ORDER BY account_id, valid_from, recorded_at`,
      [asOf],
    ),
    runQuery(
      `SELECT account_id, valid_from AS observed_on
         FROM pfa.pension_values
         WHERE valid_from <= CAST(? AS DATE)`,
      [asOf],
    ),
    runQuery(
      `SELECT mortgage_id, valid_from AS observed_on
         FROM pfa.mortgage_balance
         WHERE valid_from <= CAST(? AS DATE)`,
      [asOf],
    ),
    runQuery(
      `SELECT DISTINCT h.asset_id, a.asset_type
         FROM pfa.holdings h
         JOIN pfa.assets a ON a.id = h.asset_id
         WHERE h.valid_from <= CAST(? AS DATE)`,
      [asOf],
    ),
    runQuery(
      `SELECT ap.asset_id, ap.as_of AS observed_on
         FROM pfa.asset_prices ap
         WHERE ap.as_of <= CAST(? AS TIMESTAMP)`,
      [`${asOf} 23:59:59`],
    ),
    payslipEntities(asOf),
  ]);

  const series: CoverageSeries[] = [];

  const accountBalances = new Map<string, { dates: string[]; latestBalance: number }>();
  for (const row of accountRows) {
    const id = toStr(row.account_id);
    const date = dateOnly(row.observed_on);
    const balance =
      typeof row.balance_pence === "bigint"
        ? Number(row.balance_pence)
        : Number(row.balance_pence ?? 0);
    const bucket = accountBalances.get(id);
    if (bucket) {
      bucket.dates.push(date);
      bucket.latestBalance = balance;
    } else {
      accountBalances.set(id, { dates: [date], latestBalance: balance });
    }
  }
  const accountEntities = [...accountBalances.values()]
    .filter((a) => a.latestBalance !== 0)
    .map((a) => a.dates);
  if (accountEntities.length > 0) {
    series.push({
      label: "Accounts",
      cadence: "snapshot",
      window_days: NET_WORTH_WINDOWS.accounts,
      entities: accountEntities,
    });
  }

  const pensionEntities = [...groupDates(pensionRows, "account_id").values()];
  if (pensionEntities.length > 0) {
    series.push({
      label: "Pension",
      cadence: "snapshot",
      window_days: NET_WORTH_WINDOWS.pension,
      entities: pensionEntities,
    });
  }

  const pricesByAsset = groupDates(assetPriceRows, "asset_id");
  const investmentEntities: string[][] = [];
  const propertyEntities: string[][] = [];
  for (const row of ownedAssetRows) {
    const id = toStr(row.asset_id);
    const dates = pricesByAsset.get(id) ?? [];
    if (toStr(row.asset_type) === "property") propertyEntities.push(dates);
    else investmentEntities.push(dates);
  }
  if (investmentEntities.length > 0) {
    series.push({
      label: "Investments",
      cadence: "snapshot",
      window_days: NET_WORTH_WINDOWS.investments,
      entities: investmentEntities,
    });
  }
  if (propertyEntities.length > 0) {
    series.push({
      label: "Property",
      cadence: "snapshot",
      window_days: NET_WORTH_WINDOWS.property,
      entities: propertyEntities,
    });
  }

  const mortgageEntities = [...groupDates(mortgageRows, "mortgage_id").values()];
  if (mortgageEntities.length > 0) {
    series.push({
      label: "Mortgage",
      cadence: "snapshot",
      window_days: NET_WORTH_WINDOWS.mortgage,
      entities: mortgageEntities,
    });
  }

  if (payslips[0]!.length > 0) {
    series.push({
      label: "Payslip",
      cadence: "recurring",
      window_days: 0,
      entities: payslips,
    });
  }

  return series;
}

export async function queryNetWorthCoverage(asOf: string): Promise<MonthCoverage[]> {
  const periodStart = await resolveFinancialYearStart(asOf);
  const series = await buildNetWorthSeries(asOf);
  return buildYearCoverage(asOf, periodStart, series);
}

export async function queryPayslipCoverage(
  asOf: string,
  periodStart: string,
): Promise<MonthCoverage[]> {
  const entities = await payslipEntities(asOf);
  const series: CoverageSeries[] = [
    { label: "Payslip", cadence: "recurring", window_days: 0, entities },
  ];
  return buildYearCoverage(asOf, periodStart, series);
}
