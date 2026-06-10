import { getKysely } from "../../core/db.js";
import { fetchCoinGeckoQuote, fetchCoinGeckoTokenQuote } from "./coingecko.js";
import { fetchYahooQuote } from "./yahoo.js";
import type { PriceQuote } from "./types.js";

export type PriceAsset = {
  id: number;
  name: string;
  asset_type: string;
  ticker: string | null;
  price_source: string;
  contract_address: string | null;
};

export async function fetchAssetQuote(
  asset: PriceAsset,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceQuote> {
  if (asset.price_source === "coingecko" && asset.contract_address) {
    return fetchCoinGeckoTokenQuote(asset.contract_address, fetchImpl);
  }
  if (!asset.ticker) {
    throw new Error(`${asset.name} has no ticker; cannot fetch an automated price.`);
  }
  if (asset.price_source === "yahoo") {
    return fetchYahooQuote(asset.ticker, asset.asset_type, fetchImpl);
  }
  if (asset.price_source === "coingecko") {
    return fetchCoinGeckoQuote(asset.ticker, fetchImpl);
  }
  throw new Error(
    `${asset.name} uses price_source '${asset.price_source}', which has no automated fetcher.`,
  );
}

export async function tryPriceOnCapture(
  assetId: number,
  fetchImpl: typeof fetch,
): Promise<{ priced: boolean; note: string }> {
  const asset = await getKysely()
    .selectFrom("assets")
    .select(["id", "name", "asset_type", "ticker", "price_source", "contract_address"])
    .where("id", "=", assetId)
    .executeTakeFirst();
  if (!asset || asset.price_source === "manual") {
    return { priced: false, note: "" };
  }
  try {
    const quote = await fetchAssetQuote(
      {
        id: Number(asset.id),
        name: asset.name,
        asset_type: asset.asset_type,
        ticker: asset.ticker,
        price_source: asset.price_source,
        contract_address: asset.contract_address,
      },
      fetchImpl,
    );
    await recordPriceTick(Number(asset.id), quote, asset.price_source);
    return {
      priced: true,
      note: `Fetched a fresh price from ${asset.price_source}: £${(quote.unit_price_pence / 100).toFixed(2)} (${quote.instrument_name}). Confirm this matches the security you hold.`,
    };
  } catch (error) {
    return {
      priced: false,
      note: `Could not fetch an automated price (${error instanceof Error ? error.message : String(error)}); the asset is unpriced until the next sync_prices.`,
    };
  }
}

export async function recordPriceTick(
  assetId: number,
  quote: PriceQuote,
  source: string,
): Promise<void> {
  await getKysely()
    .insertInto("asset_prices")
    .values({
      asset_id: assetId,
      unit_price_pence: quote.unit_price_pence,
      currency: quote.currency,
      as_of: quote.as_of,
      source,
      source_id: null,
    })
    .execute();
}

export type PriceSyncRow = {
  asset_id: number;
  name: string;
  ticker: string | null;
  status: "ok" | "error";
  price_pence?: number;
  as_of?: string;
  instrument_name?: string;
  message?: string;
};

async function loadAutomatedAssets(): Promise<PriceAsset[]> {
  const rows = await getKysely()
    .selectFrom("assets")
    .select(["id", "name", "asset_type", "ticker", "price_source", "contract_address"])
    .where("price_source", "!=", "manual")
    .execute();
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    asset_type: r.asset_type,
    ticker: r.ticker,
    price_source: r.price_source,
    contract_address: r.contract_address,
  }));
}

export async function runPriceSync(
  fetchImpl: typeof fetch = fetch,
): Promise<PriceSyncRow[]> {
  const assets = await loadAutomatedAssets();
  const results: PriceSyncRow[] = [];
  for (const asset of assets) {
    try {
      const quote = await fetchAssetQuote(asset, fetchImpl);
      await recordPriceTick(asset.id, quote, asset.price_source);
      results.push({
        asset_id: asset.id,
        name: asset.name,
        ticker: asset.ticker,
        status: "ok",
        price_pence: quote.unit_price_pence,
        as_of: quote.as_of,
        instrument_name: quote.instrument_name,
      });
    } catch (error) {
      results.push({
        asset_id: asset.id,
        name: asset.name,
        ticker: asset.ticker,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
