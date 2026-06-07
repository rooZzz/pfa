import { SAFE_WITHDRAWAL_RATE_BPS } from "./assumptions.js";

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
  "retirement",
  "fire",
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
  retirement: {
    goal_type: "retirement",
    supported: true,
    summary:
      "Project the pension pot to a target retirement age against the income wanted.",
    slots: [
      {
        name: "target_annual_income_pence",
        description: "Annual retirement income wanted, in pence.",
        default: null,
      },
      {
        name: "retirement_age",
        description: "Age to retire at.",
        default: null,
      },
      {
        name: "date_of_birth",
        description: "Date of birth, format YYYY-MM-DD, used to derive age.",
        default: null,
      },
    ],
  },
  fire: {
    goal_type: "fire",
    supported: true,
    summary:
      "Financial independence: a pot that funds annual spend at a safe withdrawal rate, plus a bridge to pension-access age if retiring early.",
    slots: [
      {
        name: "target_annual_spend_pence",
        description: "Annual spending to support in retirement, in pence.",
        default: null,
      },
      {
        name: "safe_withdrawal_rate_bps",
        description:
          "Safe withdrawal rate in basis points (400 = 4%), sets the pot multiple.",
        default: "400",
      },
      {
        name: "target_retirement_age",
        description: "Age to be financially independent by.",
        default: null,
      },
      {
        name: "date_of_birth",
        description: "Date of birth, format YYYY-MM-DD, used to derive age.",
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
export type RetirementParams = {
  target_annual_income_pence: number;
  retirement_age: number;
  date_of_birth: string;
};
export type FireParams = {
  target_annual_spend_pence: number;
  safe_withdrawal_rate_bps: number;
  target_retirement_age: number;
  date_of_birth: string;
};
export type GoalParams =
  | EmergencyFundParams
  | IsaMaxParams
  | HouseDepositParams
  | RetirementParams
  | FireParams;

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

  if (goalType === "retirement") {
    const income = raw.target_annual_income_pence;
    if (typeof income !== "number" || !Number.isInteger(income) || income <= 0) {
      throw new Error(
        "target_annual_income_pence must be a positive integer (annual income in pence).",
      );
    }
    const age = raw.retirement_age;
    if (typeof age !== "number" || !Number.isInteger(age) || age <= 0 || age > 120) {
      throw new Error("retirement_age must be a positive integer age up to 120.");
    }
    const dob = raw.date_of_birth;
    if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      throw new Error("date_of_birth must be in the format YYYY-MM-DD.");
    }
    return {
      target_annual_income_pence: income,
      retirement_age: age,
      date_of_birth: dob,
    };
  }

  if (goalType === "fire") {
    const spend = raw.target_annual_spend_pence;
    if (typeof spend !== "number" || !Number.isInteger(spend) || spend <= 0) {
      throw new Error(
        "target_annual_spend_pence must be a positive integer (annual spend in pence).",
      );
    }
    const rawRate = raw.safe_withdrawal_rate_bps ?? SAFE_WITHDRAWAL_RATE_BPS;
    const rate = typeof rawRate === "string" ? Number(rawRate) : rawRate;
    if (
      typeof rate !== "number" ||
      !Number.isInteger(rate) ||
      rate < 100 ||
      rate > 1000
    ) {
      throw new Error(
        "safe_withdrawal_rate_bps must be an integer between 100 and 1000 (1% to 10%).",
      );
    }
    const age = raw.target_retirement_age;
    if (typeof age !== "number" || !Number.isInteger(age) || age <= 0 || age > 120) {
      throw new Error("target_retirement_age must be a positive integer age up to 120.");
    }
    const dob = raw.date_of_birth;
    if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      throw new Error("date_of_birth must be in the format YYYY-MM-DD.");
    }
    return {
      target_annual_spend_pence: spend,
      safe_withdrawal_rate_bps: rate,
      target_retirement_age: age,
      date_of_birth: dob,
    };
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
  | "house_deposit_progress"
  | "projected_pension_pot"
  | "projected_invested_assets"
  | "contribution_rate"
  | "bridge_fund";
export type SubGoalBinding = {
  key: string;
  metric: Metric;
  label: string;
  target_months?: number;
  target_amount_pence?: number;
  target_date?: string;
  target_annual_income_pence?: number;
  target_age?: number;
  date_of_birth?: string;
  safe_withdrawal_rate_bps?: number;
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

  if (goalType === "retirement") {
    return [
      {
        key: "pot_progress",
        metric: "projected_pension_pot",
        label: "Projected pot vs needed",
        target_annual_income_pence: Number(params.target_annual_income_pence),
        target_age: Number(params.retirement_age),
        date_of_birth: String(params.date_of_birth),
        safe_withdrawal_rate_bps: SAFE_WITHDRAWAL_RATE_BPS,
      },
      {
        key: "contribution_gap",
        metric: "contribution_rate",
        label: "Pension contributions",
      },
    ];
  }

  if (goalType === "fire") {
    return [
      {
        key: "pot_progress",
        metric: "projected_invested_assets",
        label: "Projected investable wealth vs FIRE number",
        target_annual_income_pence: Number(params.target_annual_spend_pence),
        target_age: Number(params.target_retirement_age),
        date_of_birth: String(params.date_of_birth),
        safe_withdrawal_rate_bps: Number(params.safe_withdrawal_rate_bps),
      },
      {
        key: "contribution_gap",
        metric: "contribution_rate",
        label: "Pension contributions",
      },
      {
        key: "bridge_fund",
        metric: "bridge_fund",
        label: "Bridge to pension access",
        target_annual_income_pence: Number(params.target_annual_spend_pence),
        target_age: Number(params.target_retirement_age),
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
