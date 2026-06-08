export type DataClass = "monzo" | "prices" | "ethereum";

export const FRESHNESS_TTL_SECONDS: Record<DataClass, number> = {
  monzo: 86_400,
  prices: 3_600,
  ethereum: 86_400,
};

export type ClassFreshness = {
  class: DataClass;
  connected: boolean;
  last_at: string | null;
  age_seconds: number | null;
  ttl_seconds: number;
  is_stale: boolean;
};

export type ClassAction = "refreshed" | "failed" | "skipped_fresh" | "not_connected";

export type ClassOutcome = {
  class: DataClass;
  was_stale: boolean;
  action: ClassAction;
  error?: string;
};
