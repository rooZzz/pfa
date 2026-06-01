import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { recordAssetHolding } from "../tools/record_asset_holding.js";
import { recordEquityGrant } from "../tools/record_equity_grant.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM equity_grant;
    DELETE FROM holdings;
    DELETE FROM asset_prices;
    DELETE FROM documents;
    DELETE FROM assets;
  `);
});

const coingeckoFetch = (async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ bitcoin: { gbp: 50000, last_updated_at: 1700000000 } }),
  }) as Response) as typeof fetch;

function priceTicks(assetName: string): { unit_price_pence: number; source: string }[] {
  return getDb()
    .prepare(
      `SELECT ap.unit_price_pence, ap.source
       FROM asset_prices ap JOIN assets a ON a.id = ap.asset_id
       WHERE a.name = ?`,
    )
    .all(assetName) as { unit_price_pence: number; source: string }[];
}

describe("best-effort price on capture", () => {
  it("pulls a price when a fetchImpl is provided for an automated asset", async () => {
    const message = await recordAssetHolding(
      {
        asset_name: "Bitcoin",
        asset_type: "crypto",
        base_currency: "BTC",
        ticker: "BTC",
        quantity: 1,
        valid_from: "2026-01-01",
      },
      coingeckoFetch,
    );
    expect(message).toContain("Fetched a fresh price");
    const ticks = priceTicks("Bitcoin");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toEqual({ unit_price_pence: 5000000, source: "coingecko" });
  });

  it("leaves the asset unpriced when no fetchImpl is provided", async () => {
    await recordAssetHolding({
      asset_name: "Bitcoin",
      asset_type: "crypto",
      base_currency: "BTC",
      ticker: "BTC",
      quantity: 1,
      valid_from: "2026-01-01",
    });
    expect(priceTicks("Bitcoin")).toHaveLength(0);
  });

  it("never throws when the fetch fails — the write still succeeds", async () => {
    const failingFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const message = await recordAssetHolding(
      {
        asset_name: "Bitcoin",
        asset_type: "crypto",
        base_currency: "BTC",
        ticker: "BTC",
        quantity: 1,
        valid_from: "2026-01-01",
      },
      failingFetch,
    );
    expect(message).toContain("unpriced until the next sync_prices");
    expect(priceTicks("Bitcoin")).toHaveLength(0);
    const holdings = getDb().prepare("SELECT COUNT(*) AS n FROM holdings").get() as {
      n: number;
    };
    expect(holdings.n).toBe(1);
  });

  it("pulls a price for an equity grant's underlying share on capture", async () => {
    const message = await recordEquityGrant(
      {
        scheme_type: "rsu",
        units: 100,
        grant_date: "2025-01-01",
        currency: "GBP",
        underlying_asset_name: "Bitcoin",
        underlying_asset_type: "crypto",
        ticker: "BTC",
      },
      coingeckoFetch,
    );
    expect(message).toContain("Fetched a fresh price");
    expect(priceTicks("Bitcoin")).toHaveLength(1);
  });
});
