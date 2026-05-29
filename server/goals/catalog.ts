export const GOAL_TYPES = [
  "emergency_fund",
  "isa_max",
  "fire",
  "house_deposit",
  "debt_payoff",
  "retirement",
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const IMPLEMENTED_GOAL_TYPES = ["emergency_fund", "isa_max"] as const;
export type ImplementedGoalType = (typeof IMPLEMENTED_GOAL_TYPES)[number];

export function isImplemented(goalType: string): goalType is ImplementedGoalType {
  return (IMPLEMENTED_GOAL_TYPES as readonly string[]).includes(goalType);
}

export type Slot = { name: string; description: string; default: string | null };
export type NeedsSpec = {
  goal_type: GoalType;
  supported: boolean;
  slots: Slot[];
  summary: string;
};

const NEEDS_SPECS: Record<ImplementedGoalType, NeedsSpec> = {
  emergency_fund: {
    goal_type: "emergency_fund",
    supported: true,
    summary: "A safety net of accessible savings measured in months of outgoings.",
    slots: [
      {
        name: "target_months",
        description: "Months of essential outgoings to hold as a safety net.",
        default: "6",
      },
    ],
  },
  isa_max: {
    goal_type: "isa_max",
    supported: true,
    summary: "Use the annual ISA allowance before the tax year ends.",
    slots: [
      {
        name: "tax_year",
        description: "UK tax year to target, format YYYY/YY.",
        default: "current tax year",
      },
    ],
  },
};

export function needsSpec(goalType: GoalType): NeedsSpec {
  if (isImplemented(goalType)) return NEEDS_SPECS[goalType];
  return {
    goal_type: goalType,
    supported: false,
    summary: `Goal type "${goalType}" is recognised but not yet supported.`,
    slots: [],
  };
}

export type EmergencyFundParams = { target_months: number };
export type IsaMaxParams = { tax_year: string | null };

export function validateParams(
  goalType: ImplementedGoalType,
  raw: Record<string, unknown>,
): EmergencyFundParams | IsaMaxParams {
  if (goalType === "emergency_fund") {
    const months = raw.target_months ?? 6;
    if (typeof months !== "number" || !Number.isInteger(months) || months <= 0) {
      throw new Error("target_months must be a positive integer (months of cover).");
    }
    return { target_months: months };
  }

  const taxYear = raw.tax_year ?? null;
  if (taxYear !== null) {
    if (typeof taxYear !== "string" || !/^\d{4}\/\d{2}$/.test(taxYear)) {
      throw new Error('tax_year must be in the format YYYY/YY, e.g. "2025/26".');
    }
  }
  return { tax_year: taxYear };
}

export type Metric = "emergency_fund_months" | "isa_allowance_remaining";
export type SubGoalBinding = {
  key: string;
  metric: Metric;
  label: string;
  target_months?: number;
};

export function decompose(
  goalType: ImplementedGoalType,
  params: Record<string, unknown>,
): SubGoalBinding[] {
  if (goalType === "emergency_fund") {
    return [
      {
        key: "cover_progress",
        metric: "emergency_fund_months",
        label: "Months of cover",
        target_months: Number(params.target_months),
      },
    ];
  }
  return [
    {
      key: "allowance_progress",
      metric: "isa_allowance_remaining",
      label: "ISA allowance used",
    },
  ];
}
