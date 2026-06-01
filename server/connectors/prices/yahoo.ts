import { formatUtcTimestamp, type PriceQuote } from "./types.js";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

type ChartMeta = {
  regularMarketPrice?: number;
  currency?: string;
  symbol?: string;
  longName?: string;
  shortName?: string;
  exchangeName?: string;
  regularMarketTime?: number;
};

export function yahooSymbol(ticker: string, assetType: string): string {
  const upper = ticker.trim().toUpperCase();
  if (assetType === "crypto") return `${upper}-GBP`;
  return `${upper}.L`;
}

async function fetchChartMeta(
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<ChartMeta> {
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Yahoo request for ${symbol} failed (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as {
    chart?: { result?: { meta?: ChartMeta }[]; error?: { description?: string } | null };
  };
  if (json.chart?.error) {
    throw new Error(
      `Yahoo returned an error for ${symbol}: ${json.chart.error.description ?? "unknown"}.`,
    );
  }
  const meta = json.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    throw new Error(`Yahoo returned no price for ${symbol}.`);
  }
  return meta;
}

async function gbpRate(currency: string, fetchImpl: typeof fetch): Promise<number> {
  const meta = await fetchChartMeta(`${currency.toUpperCase()}GBP=X`, fetchImpl);
  if (typeof meta.regularMarketPrice !== "number" || meta.regularMarketPrice <= 0) {
    throw new Error(`Could not resolve a GBP exchange rate for ${currency}.`);
  }
  return meta.regularMarketPrice;
}

export async function toGbpPence(
  price: number,
  currency: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const raw = currency.trim();
  const code = raw.toUpperCase();
  if (raw === "GBp" || code === "GBX") return Math.round(price);
  if (code === "GBP") return Math.round(price * 100);
  const rate = await gbpRate(code, fetchImpl);
  return Math.round(price * rate * 100);
}

export async function fetchYahooQuote(
  ticker: string,
  assetType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceQuote> {
  const symbol = yahooSymbol(ticker, assetType);
  const meta = await fetchChartMeta(symbol, fetchImpl);
  const pence = await toGbpPence(
    meta.regularMarketPrice!,
    meta.currency ?? "GBP",
    fetchImpl,
  );
  const ms = meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now();
  const name =
    meta.longName ??
    meta.shortName ??
    `${symbol}${meta.exchangeName ? ` (${meta.exchangeName})` : ""}`;
  return {
    unit_price_pence: pence,
    currency: "GBP",
    as_of: formatUtcTimestamp(ms),
    instrument_name: name,
    source_symbol: symbol,
  };
}
