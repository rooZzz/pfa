import type { Generated } from "kysely";

export type SourceType = "upload" | "manual" | "connector";
export type AccountType = "current" | "savings" | "isa" | "pension" | "mortgage";
export type SchemeType = "rsu" | "emi" | "unapproved" | "saye";

export interface DocumentsTable {
  id: Generated<number>;
  source_type: SourceType;
  file_path: string;
  content_hash: string;
  ingested_at: Generated<string>;
  notes: string | null;
}

export interface TaxPeriodsTable {
  tax_year: string;
  starts_on: string;
  ends_on: string;
}

export interface AccountsTable {
  id: Generated<number>;
  name: string;
  type: AccountType;
  currency: Generated<string>;
  provider: string | null;
  external_id: string | null;
}

export interface AssetsTable {
  id: Generated<number>;
  name: string;
  asset_type: string;
  base_currency: string;
  price_source: Generated<string>;
  ticker: string | null;
}

export interface MortgagesTable {
  id: Generated<number>;
  lender: string;
  property: string;
  original_amount_pence: number;
  currency: Generated<string>;
}

export interface EquityGrantTable {
  id: Generated<number>;
  scheme_type: SchemeType;
  units: number;
  strike_pence: number | null;
  grant_date: string;
  currency: Generated<string>;
  asset_id: number | null;
  monthly_contribution_pence: number | null;
  source_id: number;
  payload: string | null;
  superseded_by: number | null;
}

export interface TransactionsTable {
  id: Generated<number>;
  account_id: number;
  occurred_at: string;
  recorded_at: Generated<string>;
  amount_pence: number;
  currency: Generated<string>;
  description: string | null;
  category: Generated<string>;
  external_id: string | null;
  is_internal: Generated<number>;
  source_id: number;
  superseded_by: number | null;
}

export interface EquityVestingEventTable {
  id: Generated<number>;
  grant_id: number;
  vest_date: string;
  units_vested: number;
  market_price_pence: number | null;
  estimated_value_pence: number | null;
  occurred_at: string;
  recorded_at: Generated<string>;
  source_id: number;
  payload: string | null;
  superseded_by: number | null;
}

export interface IncomeEventsTable {
  id: Generated<number>;
  pay_date: string;
  tax_year: string | null;
  gross_pence: number;
  taxable_pence: number | null;
  net_pence: number;
  paye_pence: number;
  ni_employee_pence: number;
  pension_employee_pence: number;
  pension_employer_pence: number | null;
  tax_code: string | null;
  currency: Generated<string>;
  occurred_at: string;
  recorded_at: Generated<string>;
  source_id: number;
  payload: string | null;
  superseded_by: number | null;
}

export interface AccountBalancesTable {
  id: Generated<number>;
  account_id: number;
  balance_pence: number;
  currency: Generated<string>;
  valid_from: string;
  valid_to: string | null;
  recorded_at: Generated<string>;
  source_id: number;
  superseded_by: number | null;
}

export interface PensionValuesTable {
  id: Generated<number>;
  account_id: number;
  value_pence: number;
  currency: Generated<string>;
  valid_from: string;
  valid_to: string | null;
  recorded_at: Generated<string>;
  source_id: number;
  superseded_by: number | null;
}

export interface MortgageBalanceTable {
  id: Generated<number>;
  mortgage_id: number;
  outstanding_pence: number;
  interest_rate_bps: number;
  currency: Generated<string>;
  valid_from: string;
  valid_to: string | null;
  recorded_at: Generated<string>;
  source_id: number;
  superseded_by: number | null;
}

export interface HoldingsTable {
  id: Generated<number>;
  asset_id: number;
  quantity: number;
  valid_from: string;
  valid_to: string | null;
  recorded_at: Generated<string>;
  source_id: number;
  superseded_by: number | null;
}

export interface AssetPricesTable {
  id: Generated<number>;
  asset_id: number;
  unit_price_pence: number;
  currency: string;
  as_of: string;
  source: string;
  recorded_at: Generated<string>;
  source_id: number | null;
  superseded_by: number | null;
}

export interface PersonProfileTable {
  id: Generated<number>;
  employer_name: string;
  tax_code: string;
  salary_pence: number;
  currency: Generated<string>;
  valid_from: string;
  valid_to: string | null;
  recorded_at: Generated<string>;
  source_id: number;
  superseded_by: number | null;
}

export interface GoalsTable {
  id: Generated<number>;
  goal_type: string;
  params: string;
  raw_utterance: string;
  status: Generated<string>;
  source_id: number;
  recorded_at: Generated<string>;
}

export interface TaxConstantsTable {
  id: Generated<number>;
  key: string;
  value: number;
  unit: "pence" | "years" | "bps";
  currency: string | null;
  valid_from: string;
  valid_to: string | null;
  status: "enacted" | "announced";
  source: string;
  note: string | null;
  recorded_at: Generated<string>;
}

export interface ConnectorStateTable {
  id: Generated<number>;
  provider: string;
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
  cursors_json: Generated<string>;
  last_synced_at: string | null;
  updated_at: Generated<string>;
}

export interface DatabaseSchema {
  documents: DocumentsTable;
  tax_periods: TaxPeriodsTable;
  accounts: AccountsTable;
  assets: AssetsTable;
  mortgages: MortgagesTable;
  equity_grant: EquityGrantTable;
  transactions: TransactionsTable;
  equity_vesting_event: EquityVestingEventTable;
  income_events: IncomeEventsTable;
  account_balances: AccountBalancesTable;
  pension_values: PensionValuesTable;
  mortgage_balance: MortgageBalanceTable;
  holdings: HoldingsTable;
  asset_prices: AssetPricesTable;
  person_profile: PersonProfileTable;
  goals: GoalsTable;
  connector_state: ConnectorStateTable;
  tax_constants: TaxConstantsTable;
}
