import { z } from "zod";
import { getDb } from "../db.js";
import { ensureAsset, writeManualDocument } from "../references.js";

export const recordAssetHoldingSchema = {
  asset_name: z.string().describe("Asset name, e.g. 'ETH', 'Vanguard FTSE All-World'."),
  asset_type: z.string().describe("Asset type, e.g. 'crypto', 'etf', 'stock', 'property', 'other'."),
  base_currency: z.string().describe("Native currency of the asset, e.g. 'ETH', 'USD', 'GBP'."),
  quantity: z
    .number()
    .int()
    .describe(
      "Quantity in the asset's smallest unit. For whole shares use units directly. For fractional shares use units × 10000. For property use 1.",
    ),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date the holding became effective."),
};

export async function recordAssetHolding(input: {
  asset_name: string;
  asset_type: string;
  base_currency: string;
  quantity: number;
  valid_from: string;
}): Promise<string> {
  const db = getDb();

  const doInsert = db.transaction(() => {
    const sourceId = writeManualDocument(db, {
      source_type: "manual",
      entry_type: "asset_holding",
      asset_name: input.asset_name,
      asset_type: input.asset_type,
      base_currency: input.base_currency,
      quantity: input.quantity,
      valid_from: input.valid_from,
    });

    const assetId = ensureAsset(db, input.asset_name, input.asset_type, input.base_currency);

    db.prepare(
      `INSERT INTO holdings (asset_id, quantity, valid_from, source_id) VALUES (?, ?, ?, ?)`,
    ).run(assetId, input.quantity, input.valid_from, sourceId);

    return { sourceId, assetId };
  });

  const { sourceId, assetId } = doInsert();

  return [
    `Recorded holding for ${input.asset_name} (${input.asset_type}): quantity ${input.quantity} as of ${input.valid_from}.`,
    `Asset ID: ${assetId}, document ID: ${sourceId}.`,
    `Use record_asset_price to record the per-unit price for valuation.`,
  ].join(" ");
}
