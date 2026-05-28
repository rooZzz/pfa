import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { recordAssetHolding } from "../tools/record_asset_holding.js";
import { refreshAssetPrice } from "../tools/refresh_asset_price.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM holdings;
    DELETE FROM documents;
    DELETE FROM assets;
  `);
});

async function createAsset(name: string, type: string): Promise<number> {
  await recordAssetHolding({
    asset_name: name,
    asset_type: type,
    base_currency: "GBP",
    quantity: 1,
    valid_from: "2026-01-01",
  });
  const row = getDb().prepare("SELECT id FROM assets WHERE name = ?").get(name) as {
    id: number;
  };
  return row.id;
}

describe("refreshAssetPrice", () => {
  it("throws when the asset does not exist", async () => {
    await expect(refreshAssetPrice({ asset_id: 9999 })).rejects.toThrow(
      /No asset with ID 9999/,
    );
  });

  it("directs manual-source assets to record_asset_price", async () => {
    const assetId = await createAsset("ETH", "crypto");

    const message = await refreshAssetPrice({ asset_id: assetId });

    expect(message).toContain("manual price entry");
    expect(message).toContain("record_asset_price");
    expect(message).toContain('asset_name="ETH"');
  });

  it("reports connector sources as not yet implemented", async () => {
    const assetId = await createAsset("BTC", "crypto");
    getDb()
      .prepare("UPDATE assets SET price_source = 'coingecko' WHERE id = ?")
      .run(assetId);

    const message = await refreshAssetPrice({ asset_id: assetId });

    expect(message).toContain("not yet implemented");
    expect(message).toContain("record_asset_price");
  });
});
