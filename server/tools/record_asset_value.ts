import { z } from "zod";
import { getDb } from "../db.js";
import { ensureAsset, writeManualDocument } from "../references.js";

export const recordAssetValueSchema = {
  asset_name: z
    .string()
    .describe("Asset name, e.g. 'ETH', 'Vanguard FTSE All-World'."),
  asset_type: z
    .string()
    .describe("Asset type, e.g. 'crypto', 'etf', 'stock', 'other'."),
  quantity: z
    .number()
    .int()
    .describe(
      "Quantity in the asset's smallest unit. For shares use units × 10000 for fractional; for whole shares use units directly.",
    ),
  original_currency: z
    .string()
    .describe("Native currency of the asset, e.g. 'ETH', 'USD', 'GBP'."),
  gbp_equivalent_pence: z
    .number()
    .int()
    .describe("GBP value in pence at observation time. Frozen at ingestion."),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Observation date."),
};

export async function recordAssetValue(input: {
  asset_name: string;
  asset_type: string;
  quantity: number;
  original_currency: string;
  gbp_equivalent_pence: number;
  valid_from: string;
}): Promise<string> {
  const db = getDb();

  const doInsert = db.transaction(() => {
    const sourceId = writeManualDocument(db, {
      source_type: "manual",
      entry_type: "asset_value",
      asset_name: input.asset_name,
      asset_type: input.asset_type,
      quantity: input.quantity,
      original_currency: input.original_currency,
      gbp_equivalent_pence: input.gbp_equivalent_pence,
      valid_from: input.valid_from,
    });

    const assetId = ensureAsset(db, input.asset_name, input.asset_type, input.original_currency);

    db.prepare(
      `INSERT INTO asset_values
         (asset_id, quantity, original_currency, gbp_equivalent_pence, valid_from, source_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      assetId,
      input.quantity,
      input.original_currency,
      input.gbp_equivalent_pence,
      input.valid_from,
      sourceId,
    );

    return { sourceId, assetId };
  });

  const { sourceId, assetId } = doInsert();

  return [
    `Recorded asset value for ${input.asset_name} (${input.asset_type}).`,
    `GBP value: ${input.gbp_equivalent_pence} pence as of ${input.valid_from}.`,
    `Asset ID: ${assetId}, document ID: ${sourceId}.`,
  ].join(" ");
}
