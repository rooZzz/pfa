export type CategoryLine = {
  category: string;
  inflow_pence: number;
  outflow_pence: number;
  count: number;
  samples: string[];
};

export type SourceLine = {
  source: string;
  inflow_pence: number;
  count: number;
};

export type IncomeTotal = {
  net_pence: number;
  gross_pence: number;
  paye_pence: number;
  ni_employee_pence: number;
  pension_employee_pence: number;
  pension_employer_pence: number;
  other_deductions_pence: number;
  tax_code: string | null;
  payslip_count: number;
};

export type TrendPoint = {
  month: string;
  transaction_inflow_pence: number;
  transaction_outflow_pence: number;
  net_pence: number;
};

export type CashflowResult = {
  tax_year: string;
  period_start: string;
  period_end: string;
  income: IncomeTotal;
  transactions_by_category: CategoryLine[];
  income_by_source: SourceLine[];
  transaction_inflow_total_pence: number;
  transaction_outflow_total_pence: number;
  income_total_pence: number;
  spending_total_pence: number;
  pot_savings_net_pence: number;
  net_cashflow_pence: number;
  trend: TrendPoint[];
};
