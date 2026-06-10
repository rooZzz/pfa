import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../core/db.js";
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

async function createAsset(name: string, type: string, ticker?: string): Promise<number> {
  await recordAssetHolding({
    asset_name: name,
    asset_type: type,
    base_currency: "GBP",
    ticker,
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
    const assetId = await createAsset("Premium Bonds", "other");

    const message = await refreshAssetPrice({ asset_id: assetId });

    expect(message).toContain("manual price entry");
    expect(message).toContain("record_asset_price");
    expect(message).toContain('asset_name="Premium Bonds"');
  });

  it("fetches and stores a price for a connector-sourced asset", async () => {
    const assetId = await createAsset("Bitcoin", "crypto", "BTC");

    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ bitcoin: { gbp: 50000, last_updated_at: 1700000000 } }),
      }) as Response) as typeof fetch;

    const message = await refreshAssetPrice({ asset_id: assetId }, fetchImpl);

    expect(message).toContain("coingecko");
    expect(message).toContain("£50000.00");
    expect(message).toContain("bitcoin");

    const tick = getDb()
      .prepare(
        "SELECT unit_price_pence, source FROM asset_prices WHERE asset_id = ? AND source = 'coingecko'",
      )
      .get(assetId) as { unit_price_pence: number; source: string } | undefined;
    expect(tick?.unit_price_pence).toBe(5000000);
  });
});
