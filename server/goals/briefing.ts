import { getKysely } from "../db.js";
import {
  bridgeFund,
  cashSavings,
  contributionRate,
  currentPensionPot,
  emergencyFundMonths,
  houseDepositProgress,
  investedAssets,
  isaAllowanceRemaining,
  type MetricValue,
  projectedInvestedAssets,
  projectedPensionPot,
} from "../metrics/index.js";
import { LIVE_CONTEXT, type ReadContext } from "../query.js";
import { type TaxPositionContext, taxPosition } from "../tax/engine.js";
import { type EarningsContext, earningsContext } from "./earnings.js";
import {
  type ResolvedConstant,
  resolveConstant,
  taxConstantsForDate,
  upcomingChange,
} from "../tax/constants.js";
import {
  PROJECTION_ASSUMPTIONS,
  REAL_RETURN_RATE_BPS,
  SAFE_WITHDRAWAL_RATE_BPS,
} from "./assumptions.js";
import {
  decompose,
  type ImplementedGoalType,
  isImplemented,
  type SubGoalBinding,
} from "./catalog.js";
import { claimedAccounts } from "./resources.js";

export type DirectiveKind = "progress" | "deadline" | "data_gap" | "contention";

export type Directive = {
  goal_id: number;
  goal_type: string;
  sub_goal: string;
  kind: DirectiveKind;
  message: string;
  data: Record<string, number | string>;
};

export type RetirementProjection = {
  resolved: boolean;
  invested_assets_pence: number | null;
  pension_pot_pence: number | null;
  cash_pence: number | null;
  total_drawable_pence: number | null;
  annual_contribution_pence: number | null;
  real_return_bps: number;
  safe_withdrawal_rate_bps: number;
  pension_access_age: number | null;
  assumptions: string[];
  gap_reason?: string;
};

export type Briefing = {
  as_of: string;
  directives: Directive[];
  earnings: EarningsContext;
  tax_position: TaxPositionContext;
  retirement_projection: RetirementProjection;
  tax_constants: Record<string, ResolvedConstant>;
  text: string;
};

function formatPence(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

async function evaluateMetric(
  binding: SubGoalBinding,
  asOf: string,
  params: Record<string, unknown>,
  ctx: ReadContext,
): Promise<MetricValue> {
  if (binding.metric === "emergency_fund_months") {
    return emergencyFundMonths(asOf, ctx);
  }
  if (binding.metric === "house_deposit_progress") {
    return houseDepositProgress(asOf, binding.target_amount_pence!, ctx);
  }
  if (binding.metric === "projected_pension_pot") {
    return projectedPensionPot(asOf, binding.target_age!, binding.date_of_birth!, ctx);
  }
  if (binding.metric === "projected_invested_assets") {
    return projectedInvestedAssets(
      asOf,
      binding.target_age!,
      binding.date_of_birth!,
      ctx,
    );
  }
  if (binding.metric === "contribution_rate") {
    return contributionRate(asOf, ctx);
  }
  if (binding.metric === "bridge_fund") {
    return bridgeFund(
      asOf,
      binding.target_annual_income_pence!,
      binding.target_age!,
      ctx,
    );
  }
  const taxYear = typeof params.tax_year === "string" ? params.tax_year : undefined;
  return isaAllowanceRemaining(asOf, taxYear, ctx);
}

async function directivesFor(
  goal: { id: number; goal_type: string },
  binding: SubGoalBinding,
  metric: MetricValue,
  asOf: string,
): Promise<Directive[]> {
  const base = { goal_id: goal.id, goal_type: goal.goal_type, sub_goal: binding.key };

  if (!metric.resolved) {
    return [
      {
        ...base,
        kind: "data_gap",
        message: `${goal.goal_type} goal set, but cannot track progress yet: ${metric.gap_reason}`,
        data: {},
      },
    ];
  }

  if (binding.metric === "emergency_fund_months") {
    const months = metric.value!;
    const target = binding.target_months!;
    const percent = Math.round((months / target) * 100);
    return [
      {
        ...base,
        kind: "progress",
        message: `Emergency fund: ${months.toFixed(1)} months of cover against a ${target}-month target (${percent}% funded).`,
        data: {
          months: Number(months.toFixed(2)),
          target_months: target,
          percent,
          liquid_pence: metric.detail.liquid_pence as number,
          avg_outflow_pence: metric.detail.avg_outflow_pence as number,
        },
      },
    ];
  }

  if (binding.metric === "house_deposit_progress") {
    const saved = metric.detail.saved_pence as number;
    const target = metric.detail.target_pence as number;
    const percent = metric.detail.percent as number;
    const targetDate = binding.target_date!;
    const daysLeft = daysBetween(asOf, targetDate);
    return [
      {
        ...base,
        kind: "progress",
        message: `House deposit: ${formatPence(saved)} of ${formatPence(target)} saved (${percent}%).`,
        data: { saved_pence: saved, target_pence: target, percent },
      },
      {
        ...base,
        kind: "deadline",
        message: `House deposit: ${daysLeft} days until ${targetDate}.`,
        data: { days_left: daysLeft, target_date: targetDate },
      },
    ];
  }

  if (
    binding.metric === "projected_pension_pot" ||
    binding.metric === "projected_invested_assets"
  ) {
    const isFire = binding.metric === "projected_invested_assets";
    const label = isFire ? "Financial independence" : "Retirement";
    const potWord = isFire ? "projected investable wealth" : "projected pot";
    const projected = metric.value!;
    const income = binding.target_annual_income_pence!;
    const swrBps = binding.safe_withdrawal_rate_bps ?? SAFE_WITHDRAWAL_RATE_BPS;
    const potNeeded = Math.round((income * 10000) / swrBps);
    const percent = Math.round((projected / potNeeded) * 100);
    const shortfall = Math.max(0, potNeeded - projected);
    const targetAge = binding.target_age!;
    const years = metric.detail.years as number;
    const retirementDate = metric.detail.retirement_date as string;
    return [
      {
        ...base,
        kind: "progress",
        message: `${label}: ${potWord} ${formatPence(projected)} in today's money by age ${targetAge}, against ${formatPence(potNeeded)} needed for ${formatPence(income)}/yr (${percent}% funded).`,
        data: {
          projected_pot_pence: projected,
          pot_needed_pence: potNeeded,
          shortfall_pence: shortfall,
          percent,
          target_age: targetAge,
          target_annual_income_pence: income,
          years,
          real_return_bps: metric.detail.real_return_bps as number,
        },
      },
      {
        ...base,
        kind: "deadline",
        message: `${label}: ${years} years until age ${targetAge} (${retirementDate}).`,
        data: { years, target_age: targetAge, retirement_date: retirementDate },
      },
    ];
  }

  if (binding.metric === "contribution_rate") {
    const annual = metric.value!;
    const employee = metric.detail.employee_annual_pence as number;
    const employer = metric.detail.employer_annual_pence as number;
    return [
      {
        ...base,
        kind: "progress",
        message: `Pension contributions: ${formatPence(annual)}/yr going in (employee ${formatPence(employee)} + employer ${formatPence(employer)}).`,
        data: {
          annual_contribution_pence: annual,
          employee_annual_pence: employee,
          employer_annual_pence: employer,
        },
      },
    ];
  }

  if (binding.metric === "bridge_fund") {
    const bridgeYears = metric.detail.bridge_years as number;
    const accessAge = metric.detail.pension_access_age as number;
    if (bridgeYears === 0) {
      const targetAge = metric.detail.target_retirement_age as number;
      return [
        {
          ...base,
          kind: "progress",
          message: `Bridge fund: retiring at age ${targetAge} at or after pension-access age ${accessAge}, so no bridge is required.`,
          data: {
            bridge_years: 0,
            pension_access_age: accessAge,
            bridge_shortfall_pence: 0,
          },
        },
      ];
    }
    const accessible = metric.detail.accessible_pence as number;
    const need = metric.detail.bridge_need_pence as number;
    const shortfall = metric.value!;
    return [
      {
        ...base,
        kind: "progress",
        message: `Bridge fund: ${formatPence(accessible)} accessible against ${formatPence(need)} needed to span ${bridgeYears} years to pension access at age ${accessAge} (${formatPence(shortfall)} short).`,
        data: {
          accessible_pence: accessible,
          bridge_need_pence: need,
          bridge_shortfall_pence: shortfall,
          bridge_years: bridgeYears,
          pension_access_age: accessAge,
        },
      },
    ];
  }

  const allowance = metric.detail.allowance_pence as number;
  const contributions = metric.detail.contributions_pence as number;
  const remaining = metric.value!;
  const taxYear = metric.detail.tax_year as string;
  const periodEnd = metric.detail.period_end as string;
  const usedPercent = Math.round((contributions / allowance) * 100);
  const daysLeft = daysBetween(asOf, periodEnd);

  const directives: Directive[] = [
    {
      ...base,
      kind: "progress",
      message: `ISA allowance ${taxYear}: ${formatPence(contributions)} of ${formatPence(allowance)} used (${usedPercent}%), ${formatPence(remaining)} remaining.`,
      data: {
        allowance_pence: allowance,
        contributions_pence: contributions,
        remaining_pence: remaining,
        percent_used: usedPercent,
        tax_year: taxYear,
      },
    },
    {
      ...base,
      kind: "deadline",
      message: `ISA allowance ${taxYear}: ${daysLeft} days left in the tax year.`,
      data: { days_left: daysLeft, period_end: periodEnd, tax_year: taxYear },
    },
  ];

  const cashIsaChange = await upcomingChange("cash_isa_allowance", asOf);
  if (cashIsaChange) {
    const daysAway = daysBetween(asOf, cashIsaChange.valid_from);
    const caveat =
      cashIsaChange.status === "announced" ? " (proposed, subject to legislation)" : "";
    directives.push({
      ...base,
      kind: "deadline",
      message: `Cash-ISA sub-limit of ${formatPence(cashIsaChange.value)} takes effect ${cashIsaChange.valid_from}, ${daysAway} days away${caveat}.`,
      data: {
        effective_from: cashIsaChange.valid_from,
        days_away: daysAway,
        cash_isa_allowance_pence: cashIsaChange.value,
      },
    });
  }

  return directives;
}

type ActiveGoal = { id: number; goal_type: ImplementedGoalType };

async function contentionDirectives(
  goals: ActiveGoal[],
  asOf: string,
  ctx: ReadContext,
): Promise<Directive[]> {
  const claims = await Promise.all(
    goals.map(async (goal) => ({
      goal,
      accounts: await claimedAccounts(goal.goal_type, asOf, ctx),
    })),
  );

  const directives: Directive[] = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i]!;
      const b = claims[j]!;
      const bIds = new Set(b.accounts.map((x) => x.account_id));
      const shared = a.accounts.filter((x) => bIds.has(x.account_id));
      if (shared.length === 0) continue;
      const sharedBalance = shared.reduce((sum, x) => sum + x.balance_pence, 0);
      const accountWord = shared.length === 1 ? "account" : "accounts";
      directives.push({
        goal_id: a.goal.id,
        goal_type: a.goal.goal_type,
        sub_goal: "contention",
        kind: "contention",
        message: `Shared pool: ${a.goal.goal_type} and ${b.goal.goal_type} both draw on the same ${formatPence(sharedBalance)} across ${shared.length} ${accountWord}; it cannot back both in full.`,
        data: {
          other_goal_id: b.goal.id,
          other_goal_type: b.goal.goal_type,
          shared_account_ids: shared.map((x) => x.account_id).join(","),
          shared_account_count: shared.length,
          shared_balance_pence: sharedBalance,
        },
      });
    }
  }
  return directives;
}

async function buildRetirementProjection(
  asOf: string,
  active: boolean,
  ctx: ReadContext,
): Promise<RetirementProjection> {
  if (!active) {
    return {
      resolved: false,
      invested_assets_pence: null,
      pension_pot_pence: null,
      cash_pence: null,
      total_drawable_pence: null,
      annual_contribution_pence: null,
      real_return_bps: REAL_RETURN_RATE_BPS,
      safe_withdrawal_rate_bps: SAFE_WITHDRAWAL_RATE_BPS,
      pension_access_age: null,
      assumptions: [],
      gap_reason: "No retirement or FIRE goal set.",
    };
  }
  const invested = await investedAssets(asOf, ctx);
  const pension = await currentPensionPot(asOf, ctx);
  const cash = await cashSavings(asOf, ctx);
  const contribution = await contributionRate(asOf, ctx);
  const accessAge = await resolveConstant("pension_access_age", asOf);
  const assumptions = [...PROJECTION_ASSUMPTIONS];
  if (!contribution.resolved) {
    assumptions.push(
      "Pension contributions are unknown (no payslips captured); wealth is projected with no further contributions.",
    );
  }
  const investedPence = invested.resolved ? invested.value! : null;
  const cashPence = cash.resolved ? cash.value! : 0;
  return {
    resolved: invested.resolved,
    invested_assets_pence: investedPence,
    pension_pot_pence: pension.resolved ? pension.value! : null,
    cash_pence: cash.resolved ? cash.value! : null,
    total_drawable_pence: investedPence != null ? investedPence + cashPence : null,
    annual_contribution_pence: contribution.resolved ? contribution.value! : null,
    real_return_bps: REAL_RETURN_RATE_BPS,
    safe_withdrawal_rate_bps: SAFE_WITHDRAWAL_RATE_BPS,
    pension_access_age: accessAge ? accessAge.value : null,
    assumptions,
    gap_reason: invested.resolved
      ? undefined
      : (invested.gap_reason ?? "No invested assets recorded."),
  };
}

export async function getBriefing(
  asOf: string,
  ctx: ReadContext = LIVE_CONTEXT,
): Promise<Briefing> {
  const goals = await getKysely()
    .selectFrom("goals")
    .select(["id", "goal_type", "params"])
    .where("status", "=", "active")
    .execute();

  const directives: Directive[] = [];
  const activeGoals: ActiveGoal[] = [];

  for (const goal of goals) {
    if (!isImplemented(goal.goal_type)) continue;
    activeGoals.push({ id: Number(goal.id), goal_type: goal.goal_type });
    const params = JSON.parse(goal.params) as Record<string, unknown>;
    for (const binding of decompose(goal.goal_type, params)) {
      const metric = await evaluateMetric(binding, asOf, params, ctx);
      directives.push(
        ...(await directivesFor(
          { id: Number(goal.id), goal_type: goal.goal_type },
          binding,
          metric,
          asOf,
        )),
      );
    }
  }

  directives.push(...(await contentionDirectives(activeGoals, asOf, ctx)));

  const earnings = await earningsContext(asOf, ctx);
  const tax_position = await taxPosition(asOf, ctx);
  const tax_constants = await taxConstantsForDate(asOf);
  const hasRetirementGoal = activeGoals.some(
    (g) => g.goal_type === "retirement" || g.goal_type === "fire",
  );
  const retirement_projection = await buildRetirementProjection(
    asOf,
    hasRetirementGoal,
    ctx,
  );

  const lines =
    directives.length === 0
      ? ["No active goals. Capture one with propose_goal then confirm_goal."]
      : [`Briefing as of ${asOf}:`, ...directives.map((d) => `- ${d.message}`)];
  if (earnings.resolved) {
    lines.push(
      `Earnings (${earnings.tax_year} to date): gross ${formatPence(
        earnings.ytd_gross_pence!,
      )}, tax code ${earnings.tax_code ?? "unknown"}.`,
    );
  } else {
    lines.push(`Earnings: ${earnings.gap_reason}`);
  }
  if (tax_position.resolved) {
    lines.push(
      `Tax position (${tax_position.tax_year}, projected): income ${formatPence(
        tax_position.projected_annual_income_pence!,
      )}, marginal rate ${tax_position.marginal_rate_bps! / 100}%.`,
    );
    if (tax_position.in_personal_allowance_taper) {
      lines.push(
        `Personal allowance tapering: income is in the £100k–£125,140 band, so the next £ is taxed at about 60%.`,
      );
    }
    if (tax_position.pension_allowance_tapered) {
      lines.push(
        `Pension annual allowance tapered to ${formatPence(
          tax_position.pension_annual_allowance_pence!,
        )} (adjusted income above the taper threshold); contributions above this trigger a charge.`,
      );
    }
  } else {
    lines.push(`Tax position: ${tax_position.gap_reason}`);
  }
  if (hasRetirementGoal) {
    if (retirement_projection.resolved) {
      const cashText =
        retirement_projection.cash_pence != null
          ? formatPence(retirement_projection.cash_pence)
          : "none";
      lines.push(
        `Retirement projection (today's money): invested assets ${formatPence(
          retirement_projection.invested_assets_pence!,
        )}, cash ${cashText} (bridge only), ${(REAL_RETURN_RATE_BPS / 100).toFixed(1)}% real return assumed.`,
      );
    } else {
      lines.push(`Retirement projection: ${retirement_projection.gap_reason}`);
    }
  }
  const text = lines.join("\n");

  return {
    as_of: asOf,
    directives,
    earnings,
    tax_position,
    retirement_projection,
    tax_constants,
    text,
  };
}
