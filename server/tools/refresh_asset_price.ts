import { z } from "zod";
import { getKysely } from "../core/db.js";
import { fetchAssetQuote, recordPriceTick } from "../connectors/prices/sync.js";

export const refreshAssetPriceSchema = {
  asset_id: z
    .number()
    .int()
    .positive()
    .describe("The asset ID to refresh the price for."),
};

export async function refreshAssetPrice(
  input: { asset_id: number },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const asset = await getKysely()
    .selectFrom("assets")
    .select(["id", "name", "asset_type", "ticker", "price_source", "contract_address"])
    .where("id", "=", input.asset_id)
    .executeTakeFirst();

  if (!asset) {
    throw new Error(`No asset with ID ${input.asset_id}.`);
  }

  if (asset.price_source === "manual") {
    return [
      `${asset.name} uses manual price entry (price_source = 'manual').`,
      `To update the price, call record_asset_price with asset_name="${asset.name}", asset_type="${asset.asset_type}".`,
    ].join(" ");
  }

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

  return [
    `Refreshed ${asset.name} (${asset.ticker}) from ${asset.price_source}: £${(quote.unit_price_pence / 100).toFixed(2)} as of ${quote.as_of} UTC.`,
    `Source instrument: ${quote.instrument_name} (${quote.source_symbol}) — confirm this is the security you hold.`,
  ].join(" ");
}
