export const GOAL_TYPES = [
  "emergency_fund",
  "isa_max",
  "fire",
  "house_deposit",
  "debt_payoff",
  "retirement",
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const IMPLEMENTED_GOAL_TYPES = [
  "emergency_fund",
  "isa_max",
  "house_deposit",
] as const;
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
  house_deposit: {
    goal_type: "house_deposit",
    supported: true,
    summary: "Accumulate a property deposit by a target date.",
    slots: [
      {
        name: "target_amount_pence",
        description: "Deposit amount to reach, in pence.",
        default: null,
      },
      {
        name: "target_date",
        description: "Date to have the deposit by, format YYYY-MM-DD.",
        default: null,
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
export type HouseDepositParams = { target_amount_pence: number; target_date: string };
export type GoalParams = EmergencyFundParams | IsaMaxParams | HouseDepositParams;

export function validateParams(
  goalType: ImplementedGoalType,
  raw: Record<string, unknown>,
): GoalParams {
  if (goalType === "emergency_fund") {
    const months = raw.target_months ?? 6;
    if (typeof months !== "number" || !Number.isInteger(months) || months <= 0) {
      throw new Error("target_months must be a positive integer (months of cover).");
    }
    return { target_months: months };
  }

  if (goalType === "house_deposit") {
    const amount = raw.target_amount_pence;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      throw new Error(
        "target_amount_pence must be a positive integer (deposit in pence).",
      );
    }
    const date = raw.target_date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("target_date must be in the format YYYY-MM-DD.");
    }
    return { target_amount_pence: amount, target_date: date };
  }

  const taxYear = raw.tax_year ?? null;
  if (taxYear !== null) {
    if (typeof taxYear !== "string" || !/^\d{4}\/\d{2}$/.test(taxYear)) {
      throw new Error('tax_year must be in the format YYYY/YY, e.g. "2025/26".');
    }
  }
  return { tax_year: taxYear };
}

export type Metric =
  | "emergency_fund_months"
  | "isa_allowance_remaining"
  | "house_deposit_progress";
export type SubGoalBinding = {
  key: string;
  metric: Metric;
  label: string;
  target_months?: number;
  target_amount_pence?: number;
  target_date?: string;
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

  if (goalType === "house_deposit") {
    return [
      {
        key: "deposit_progress",
        metric: "house_deposit_progress",
        label: "Deposit saved",
        target_amount_pence: Number(params.target_amount_pence),
        target_date: String(params.target_date),
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
