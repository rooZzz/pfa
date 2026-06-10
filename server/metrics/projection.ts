import { REAL_RETURN_RATE_BPS } from "../goals/assumptions.js";
import { latestPriceTick, latestRangeSnapshot } from "../core/snapshots.js";
import { toNum } from "../core/sql_util.js";
import { LIVE_CONTEXT, type ReadContext, runQuery } from "../query/query.js";
import { resolveConstant } from "../tax/constants.js";
import { currentPensionPot, contributionRate } from "./pension.js";
import { accountBalanceSum, liquidSavings } from "./savings.js";
import type { MetricValue } from "./types.js";

function addYearsToDate(date: string, years: number): string {
  const [y, m, d] = date.split("-");
  return `${Number(y) + years}-${m}-${d}`;
}

function wholeYearsBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  let years = toYear! - fromYear!;
  if (toMonth! < fromMonth! || (toMonth === fromMonth && toDay! < fromDay!)) {
    years -= 1;
  }
  return Math.max(0, years);
}

function projectPotPence(
  potPence: number,
  annualContributionPence: number,
  years: number,
  rateBps: number,
): number {
  let pot = potPence;
  for (let year = 0; year < years; year++) {
    const growth = Math.round((pot * rateBps) / 10000);
    pot = pot + growth + annualContributionPence;
  }
  return pot;
}

async function holdingsExcludingPropertyPence(asOf: string): Promise<number> {
  const holdings = latestRangeSnapshot(
    "pfa.holdings",
    "asset_id",
    ["asset_id", "quantity"],
    asOf,
  );
  const prices = latestPriceTick(["ap.asset_id", "ap.unit_price_pence"], asOf);
  const rows = await runQuery(
    `SELECT COALESCE(SUM(CAST(h.quantity AS BIGINT) * p.unit_price_pence // a.quantity_scale), 0) AS total
       FROM (${holdings.sql}) h
       JOIN pfa.assets a ON a.id = h.asset_id
       JOIN (${prices.sql}) p ON p.asset_id = h.asset_id
       WHERE a.asset_type != 'property'`,
    [...holdings.params, ...prices.params],
  );
  return toNum(rows[0]!.total);
}

export async function investedAssets(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const pension = await currentPensionPot(asOf, ctx);
  const isa = await accountBalanceSum(asOf, ["isa"], ctx);
  const holdingsPence = await holdingsExcludingPropertyPence(asOf);
  const pensionPence = pension.resolved ? pension.value! : 0;
  if (!pension.resolved && isa.accounts === 0 && holdingsPence === 0) {
    return {
      metric: "invested_assets",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "No pension, ISA, or investment holdings recorded.",
    };
  }
  return {
    metric: "invested_assets",
    resolved: true,
    value: pensionPence + isa.total + holdingsPence,
    unit: "pence",
    detail: {
      pension_pence: pensionPence,
      isa_pence: isa.total,
      holdings_pence: holdingsPence,
    },
  };
}

function projectFrom(
  metricName: string,
  base: MetricValue,
  contribution: MetricValue,
  asOf: string,
  targetAge: number,
  dateOfBirth: string,
): MetricValue {
  if (!base.resolved) {
    return {
      metric: metricName,
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: base.gap_reason ?? "Nothing recorded to project from.",
    };
  }
  const annualContribution = contribution.resolved ? contribution.value! : 0;
  const retirementDate = addYearsToDate(dateOfBirth, targetAge);
  const years = wholeYearsBetween(asOf, retirementDate);
  const projected = projectPotPence(
    base.value!,
    annualContribution,
    years,
    REAL_RETURN_RATE_BPS,
  );
  return {
    metric: metricName,
    resolved: true,
    value: projected,
    unit: "pence",
    detail: {
      current_pot_pence: base.value!,
      annual_contribution_pence: annualContribution,
      contribution_grounded: contribution.resolved ? 1 : 0,
      years,
      target_age: targetAge,
      retirement_date: retirementDate,
      real_return_bps: REAL_RETURN_RATE_BPS,
    },
  };
}

export async function projectedPensionPot(
  asOf: string,
  targetAge: number,
  dateOfBirth: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const base = await currentPensionPot(asOf, ctx);
  const contribution = await contributionRate(asOf, ctx);
  return projectFrom(
    "projected_pension_pot",
    base,
    contribution,
    asOf,
    targetAge,
    dateOfBirth,
  );
}

export async function projectedInvestedAssets(
  asOf: string,
  targetAge: number,
  dateOfBirth: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const base = await investedAssets(asOf, ctx);
  const contribution = await contributionRate(asOf, ctx);
  return projectFrom(
    "projected_invested_assets",
    base,
    contribution,
    asOf,
    targetAge,
    dateOfBirth,
  );
}

export async function bridgeFund(
  asOf: string,
  annualSpendPence: number,
  targetRetirementAge: number,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<MetricValue> {
  const accessAgeConstant = await resolveConstant("pension_access_age", asOf);
  if (!accessAgeConstant) {
    return {
      metric: "bridge_fund",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {},
      gap_reason: "Pension access age constant not found.",
    };
  }
  const accessAge = accessAgeConstant.value;
  const bridgeYears = Math.max(0, accessAge - targetRetirementAge);
  const bridgeNeed = annualSpendPence * bridgeYears;

  const liquid = await liquidSavings(asOf, ctx);
  const holdingsPence = await holdingsExcludingPropertyPence(asOf);
  const hasAccessible = liquid.resolved || holdingsPence > 0;
  if (bridgeYears > 0 && !hasAccessible) {
    return {
      metric: "bridge_fund",
      resolved: false,
      value: null,
      unit: "pence",
      detail: {
        bridge_years: bridgeYears,
        pension_access_age: accessAge,
        target_retirement_age: targetRetirementAge,
      },
      gap_reason: "No accessible savings or holdings recorded to assess the bridge.",
    };
  }
  const accessible = (liquid.resolved ? liquid.value! : 0) + holdingsPence;
  return {
    metric: "bridge_fund",
    resolved: true,
    value: Math.max(0, bridgeNeed - accessible),
    unit: "pence",
    detail: {
      accessible_pence: accessible,
      bridge_need_pence: bridgeNeed,
      bridge_years: bridgeYears,
      pension_access_age: accessAge,
      annual_spend_pence: annualSpendPence,
      target_retirement_age: targetRetirementAge,
    },
  };
}
