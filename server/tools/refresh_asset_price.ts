import { z } from "zod";
import { getDb } from "../db.js";

export const refreshAssetPriceSchema = {
  asset_id: z.number().int().positive().describe("The asset ID to refresh the price for."),
};

export async function refreshAssetPrice(input: { asset_id: number }): Promise<string> {
  const db = getDb();

  const asset = db
    .prepare("SELECT id, name, asset_type, price_source FROM assets WHERE id = ?")
    .get(input.asset_id) as
    | { id: number; name: string; asset_type: string; price_source: string }
    | undefined;

  if (!asset) {
    throw new Error(`No asset with ID ${input.asset_id}.`);
  }

  if (asset.price_source === "manual") {
    return [
      `${asset.name} uses manual price entry (price_source = 'manual').`,
      `To update the price, call record_asset_price with asset_name="${asset.name}", asset_type="${asset.asset_type}".`,
    ].join(" ");
  }

  return [
    `Price source '${asset.price_source}' for ${asset.name} is not yet implemented.`,
    `Connector integrations land in a follow-up. For now, use record_asset_price to update manually.`,
  ].join(" ");
}
