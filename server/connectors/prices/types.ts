export type PriceQuote = {
  unit_price_pence: number;
  currency: "GBP";
  as_of: string;
  instrument_name: string;
  source_symbol: string;
};

export function formatUtcTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
