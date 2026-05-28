export type RealisedLine = {
  kind: "account" | "pension" | "asset" | "property" | "mortgage";
  name: string;
  value_pence: number;
  valid_from: string;
  recorded_at: string;
  source_id: number;
  currency: string;
  price_as_of?: string;
  price_source?: string;
};

export type ContingentLine = {
  grant_id: number;
  scheme_type: string;
  grant_date: string;
  total_units: number;
  vested_units: number;
  unvested_units: number;
  est_value_pence: number | null;
  price_per_unit_pence: number | null;
  basis: string;
  not_owned: true;
};

export type TrendPoint = {
  date: string;
  realised_total_pence: number;
};

export type NetWorthResult = {
  as_of: string;
  realised: RealisedLine[];
  realised_total_pence: number;
  contingent: ContingentLine[];
  contingent_total_pence: number;
  unknown: string[];
  trend: TrendPoint[];
};
