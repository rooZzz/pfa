import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { recordAssetHolding } from "../tools/record_asset_holding.js";
import { recordEquityGrant } from "../tools/record_equity_grant.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM equity_vesting_event;
    DELETE FROM equity_grant;
    DELETE FROM holdings;
    DELETE FROM asset_prices;
    DELETE FROM documents;
    DELETE FROM assets;
  `);
});

function assetRows() {
  return getDb()
    .prepare("SELECT id, name, ticker, price_source FROM assets ORDER BY id")
    .all() as { id: number; name: string; ticker: string | null; price_source: string }[];
}

describe("ticker as asset identity", () => {
  it("collapses the same ticker captured under different names into one asset", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 100,
      grant_date: "2024-01-01",
      currency: "GBP",
      underlying_asset_name: "Experian",
      underlying_asset_type: "stock",
      ticker: "EXPN",
    });
    await recordEquityGrant({
      scheme_type: "saye",
      units: 200,
      strike_pence: 800,
      grant_date: "2024-01-01",
      currency: "GBP",
      underlying_asset_name: "Experian plc",
      underlying_asset_type: "stock",
      ticker: "EXPN.L",
      monthly_contribution_pence: 25000,
    });

    const assets = assetRows();
    expect(assets).toHaveLength(1);
    expect(assets[0]!.ticker).toBe("EXPN");
    expect(assets[0]!.price_source).toBe("yahoo");

    const grants = getDb()
      .prepare("SELECT asset_id FROM equity_grant ORDER BY id")
      .all() as { asset_id: number }[];
    expect(grants).toHaveLength(2);
    expect(grants[0]!.asset_id).toBe(grants[1]!.asset_id);
    expect(grants[0]!.asset_id).toBe(assets[0]!.id);
  });

  it("sets the automated price source by asset type", async () => {
    await recordAssetHolding({
      asset_name: "Bitcoin",
      asset_type: "crypto",
      base_currency: "BTC",
      ticker: "BTC",
      quantity: 1,
      valid_from: "2024-01-01",
    });
    expect(assetRows()[0]!.price_source).toBe("coingecko");
  });

  it("rejects a tickerable asset captured without a ticker", async () => {
    await expect(
      recordAssetHolding({
        asset_name: "Experian",
        asset_type: "stock",
        base_currency: "GBP",
        quantity: 10,
        valid_from: "2024-01-01",
      }),
    ).rejects.toThrow(/ticker is required/i);
  });
});
