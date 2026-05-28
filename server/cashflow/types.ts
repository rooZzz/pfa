export type CategoryLine = {
  category: string;
  inflow_pence: number;
  outflow_pence: number;
  count: number;
};

export type IncomeTotal = {
  net_pence: number;
  gross_pence: number;
  paye_pence: number;
  ni_employee_pence: number;
  pension_employee_pence: number;
  pension_employer_pence: number;
  payslip_count: number;
};

export type TrendPoint = {
  month: string;
  income_net_pence: number;
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
  transaction_inflow_total_pence: number;
  transaction_outflow_total_pence: number;
  net_cashflow_pence: number;
  trend: TrendPoint[];
};
