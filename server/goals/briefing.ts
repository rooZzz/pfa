import { getKysely } from "../db.js";
import {
  emergencyFundMonths,
  isaAllowanceRemaining,
  type MetricValue,
} from "../metrics/index.js";
import { decompose, isImplemented, type SubGoalBinding } from "./catalog.js";

export type DirectiveKind = "progress" | "deadline" | "data_gap";

export type Directive = {
  goal_id: number;
  goal_type: string;
  sub_goal: string;
  kind: DirectiveKind;
  message: string;
  data: Record<string, number | string>;
};

export type Briefing = {
  as_of: string;
  directives: Directive[];
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
): Promise<MetricValue> {
  if (binding.metric === "emergency_fund_months") {
    return emergencyFundMonths(asOf);
  }
  const taxYear = typeof params.tax_year === "string" ? params.tax_year : undefined;
  return isaAllowanceRemaining(asOf, taxYear);
}

function directivesFor(
  goal: { id: number; goal_type: string },
  binding: SubGoalBinding,
  metric: MetricValue,
  asOf: string,
): Directive[] {
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

  const allowance = metric.detail.allowance_pence as number;
  const contributions = metric.detail.contributions_pence as number;
  const remaining = metric.value!;
  const taxYear = metric.detail.tax_year as string;
  const periodEnd = metric.detail.period_end as string;
  const usedPercent = Math.round((contributions / allowance) * 100);
  const daysLeft = daysBetween(asOf, periodEnd);

  return [
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
}

export async function getBriefing(asOf: string): Promise<Briefing> {
  const goals = await getKysely()
    .selectFrom("goals")
    .select(["id", "goal_type", "params"])
    .where("status", "=", "active")
    .execute();

  const directives: Directive[] = [];

  for (const goal of goals) {
    if (!isImplemented(goal.goal_type)) continue;
    const params = JSON.parse(goal.params) as Record<string, unknown>;
    for (const binding of decompose(goal.goal_type, params)) {
      const metric = await evaluateMetric(binding, asOf, params);
      directives.push(
        ...directivesFor(
          { id: Number(goal.id), goal_type: goal.goal_type },
          binding,
          metric,
          asOf,
        ),
      );
    }
  }

  const text =
    directives.length === 0
      ? "No active goals. Capture one with propose_goal then confirm_goal."
      : [`Briefing as of ${asOf}:`, ...directives.map((d) => `- ${d.message}`)].join(
          "\n",
        );

  return { as_of: asOf, directives, text };
}
