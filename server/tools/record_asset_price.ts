import { z } from "zod";
import { getDb } from "../db.js";
import { ensureAsset, writeManualDocument } from "../references.js";

export const recordAssetPriceSchema = {
  asset_name: z.string().describe("Asset name, e.g. 'ETH', 'Vanguard FTSE All-World'."),
  asset_type: z.string().describe("Asset type, e.g. 'crypto', 'etf', 'stock', 'property', 'other'."),
  base_currency: z.string().describe("Native currency of the asset, e.g. 'ETH', 'USD', 'GBP'."),
  unit_price_pence: z
    .number()
    .int()
    .describe("Price per unit in pence (in the asset's native currency). For GBP assets: £1.00 = 100."),
  currency: z.string().default("GBP").describe("Currency of the unit price. Must match the asset's base_currency for GBP assets."),
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date this price was observed."),
  source: z.string().default("manual").describe("Price source. Use 'manual' for hand-entered prices."),
};

export async function recordAssetPrice(input: {
  asset_name: string;
  asset_type: string;
  base_currency: string;
  unit_price_pence: number;
  currency: string;
  as_of: string;
  source: string;
}): Promise<string> {
  const db = getDb();

  const doInsert = db.transaction(() => {
    const sourceId = writeManualDocument(db, {
      source_type: "manual",
      entry_type: "asset_price",
      asset_name: input.asset_name,
      asset_type: input.asset_type,
      unit_price_pence: input.unit_price_pence,
      currency: input.currency,
      as_of: input.as_of,
      source: input.source,
    });

    const assetId = ensureAsset(db, input.asset_name, input.asset_type, input.base_currency);

    db.prepare(
      `INSERT INTO asset_prices (asset_id, unit_price_pence, currency, as_of, source, source_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(assetId, input.unit_price_pence, input.currency, input.as_of, input.source, sourceId);

    return { sourceId, assetId };
  });

  const { sourceId, assetId } = doInsert();

  return [
    `Recorded price for ${input.asset_name}: ${input.unit_price_pence} ${input.currency} per unit as of ${input.as_of}.`,
    `Asset ID: ${assetId}, document ID: ${sourceId}.`,
  ].join(" ");
}
