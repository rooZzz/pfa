import { formatUtcTimestamp, type PriceQuote } from "./types.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  LTC: "litecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  USDT: "tether",
  USDC: "usd-coin",
};

export function coinId(ticker: string): string {
  const id = COIN_IDS[ticker.trim().toUpperCase()];
  if (!id) {
    throw new Error(
      `No CoinGecko mapping for ticker '${ticker}'. Add it to COIN_IDS or record the price manually with record_asset_price.`,
    );
  }
  return id;
}

export async function fetchCoinGeckoQuote(
  ticker: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceQuote> {
  const id = coinId(ticker);
  const url = `${COINGECKO_BASE}/simple/price?ids=${id}&vs_currencies=gbp&include_last_updated_at=true`;
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`CoinGecko request for ${id} failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as Record<
    string,
    { gbp?: number; last_updated_at?: number }
  >;
  const entry = json[id];
  if (!entry || typeof entry.gbp !== "number") {
    throw new Error(`CoinGecko returned no GBP price for ${id}.`);
  }
  const ms = entry.last_updated_at ? entry.last_updated_at * 1000 : Date.now();
  return {
    unit_price_pence: Math.round(entry.gbp * 100),
    currency: "GBP",
    as_of: formatUtcTimestamp(ms),
    instrument_name: id,
    source_symbol: id,
  };
}
