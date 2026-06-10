import { z } from "zod";
import { getKysely } from "../core/db.js";
import { ensureAsset, requiresTicker, writeManualDocument } from "../core/references.js";

export const recordAssetPriceSchema = {
  asset_name: z.string().describe("Asset name, e.g. 'ETH', 'Vanguard FTSE All-World'."),
  asset_type: z
    .string()
    .describe("Asset type, e.g. 'crypto', 'etf', 'stock', 'property', 'other'."),
  base_currency: z
    .string()
    .describe("Native currency of the asset, e.g. 'ETH', 'USD', 'GBP'."),
  ticker: z
    .string()
    .optional()
    .describe(
      "Trading symbol, REQUIRED for stock, etf, and crypto: it is the asset's identity, so the price lands on the same asset as its holding and grants. Use the canonical symbol ('EXPN', 'BTC'), not the exchange-suffixed form. Map confidently or ask the user before calling. Omit only for property and other.",
    ),
  unit_price_pence: z
    .number()
    .int()
    .describe(
      "Price per unit as an integer number of pence. " +
        "UK stocks and ETFs are quoted in pence (GBX) on exchanges and brokers — e.g. a price shown as '2,675p' or '2675p' should be recorded as 2675 directly, do NOT multiply by 100. " +
        "Only convert if the price was given in pounds sterling: £26.75 → 2675. " +
        "For non-GBP assets (crypto, USD stocks) record the GBP-equivalent pence at the time of observation.",
    ),
  currency: z
    .string()
    .default("GBP")
    .describe(
      "Currency of the unit price. Must match the asset's base_currency for GBP assets.",
    ),
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date this price was observed."),
  source: z
    .string()
    .default("manual")
    .describe("Price source. Use 'manual' for hand-entered prices."),
};

export async function recordAssetPrice(input: {
  asset_name: string;
  asset_type: string;
  base_currency: string;
  ticker?: string;
  unit_price_pence: number;
  currency: string;
  as_of: string;
  source: string;
}): Promise<string> {
  if (requiresTicker(input.asset_type) && !input.ticker?.trim()) {
    throw new Error(
      `A ticker is required for ${input.asset_type} assets — it is the asset's identity. Supply the trading symbol (e.g. 'EXPN' for Experian) so the price links to one canonical asset.`,
    );
  }

  const { sourceId, assetId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "asset_price",
        asset_name: input.asset_name,
        asset_type: input.asset_type,
        ticker: input.ticker ?? null,
        unit_price_pence: input.unit_price_pence,
        currency: input.currency,
        as_of: input.as_of,
        source: input.source,
      });

      const assetId = await ensureAsset(
        trx,
        input.asset_name,
        input.asset_type,
        input.base_currency,
        input.ticker,
      );

      await trx
        .insertInto("asset_prices")
        .values({
          asset_id: assetId,
          unit_price_pence: input.unit_price_pence,
          currency: input.currency,
          as_of: input.as_of,
          source: input.source,
          source_id: sourceId,
        })
        .execute();

      return { sourceId, assetId };
    });

  return [
    `Recorded price for ${input.asset_name}: ${input.unit_price_pence} ${input.currency} per unit as of ${input.as_of}.`,
    `Asset ID: ${assetId}, document ID: ${sourceId}.`,
  ].join(" ");
}
