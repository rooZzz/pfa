export type RealisedLine = {
  kind: "account" | "pension" | "asset" | "property" | "mortgage";
  name: string;
  value_pence: number;
  valid_from: string;
  recorded_at: string;
  source_id: number;
  currency: string;
  ticker?: string | null;
  institution?: string | null;
  quantity?: number;
  quantity_scale?: number;
  unit_price_pence?: number;
  price_as_of?: string;
  price_source?: string;
};

export type ContingentLine = {
  grant_id: number;
  vest_date: string;
  scheme_type: string;
  units: number;
  ticker: string | null;
  asset_name: string | null;
  price_per_unit_pence: number | null;
  price_as_of: string | null;
  price_source: string | null;
  strike_pence: number | null;
  monthly_contribution_pence: number | null;
  savings_floor_pence: number | null;
  projected_value_pence: number | null;
  not_owned: true;
};

export type UnscheduledLine = {
  grant_id: number;
  scheme_type: string;
  units: number;
  ticker: string | null;
  asset_name: string | null;
};

export type TrendPoint = {
  date: string;
  realised_total_pence: number;
};

export type { MonthCoverage, SeriesStatus } from "./coverage.js";
import type { MonthCoverage } from "./coverage.js";
import type { ClassFreshness } from "../core/freshness.js";

export type NetWorthResult = {
  as_of: string;
  realised: RealisedLine[];
  realised_total_pence: number;
  contingent: ContingentLine[];
  contingent_total_pence: number;
  contingent_unscheduled: UnscheduledLine[];
  unknown: string[];
  trend: TrendPoint[];
  coverage: MonthCoverage[];
  freshness: ClassFreshness[];
};
