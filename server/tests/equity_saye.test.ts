import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../core/db.js";
import { getNetWorth } from "../net_worth/index.js";
import { resetDuck } from "../query/query.js";
import { recordAssetPrice } from "../tools/record_asset_price.js";
import { recordEquityGrant } from "../tools/record_equity_grant.js";
import { recordVestingEvent } from "../tools/record_vesting_event.js";

afterEach(() => {
  resetDuck();
});

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

async function seedSaye(pricePerUnitPence: number): Promise<void> {
  const message = await recordEquityGrant({
    scheme_type: "saye",
    units: 100,
    strike_pence: 5000,
    grant_date: "2025-01-01",
    currency: "GBP",
    underlying_asset_name: "Experian",
    underlying_asset_type: "stock",
    ticker: "EXPN",
    monthly_contribution_pence: 10000,
  });
  const grantId = Number(/Grant ID: (\d+)/.exec(message)![1]);
  await recordVestingEvent({
    grant_id: grantId,
    vest_date: "2026-07-01",
    units_vested: 100,
  });
  await recordAssetPrice({
    asset_name: "Experian",
    asset_type: "stock",
    base_currency: "GBP",
    ticker: "EXPN",
    unit_price_pence: pricePerUnitPence,
    currency: "GBP",
    as_of: "2026-06-01",
    source: "manual",
  });
}

const SAVINGS_FLOOR = 10000 * 18;

describe("SAYE valuation", () => {
  it("values an underwater SAYE at the savings floor, not zero", async () => {
    await seedSaye(3000);
    const result = await getNetWorth("2026-06-01");
    const line = result.contingent.find((l) => l.scheme_type === "saye")!;
    expect(line.savings_floor_pence).toBe(SAVINGS_FLOOR);
    expect(line.projected_value_pence).toBe(SAVINGS_FLOOR);
  });

  it("adds intrinsic option value to the floor when in the money", async () => {
    await seedSaye(7000);
    const result = await getNetWorth("2026-06-01");
    const line = result.contingent.find((l) => l.scheme_type === "saye")!;
    const intrinsic = 100 * (7000 - 5000);
    expect(line.projected_value_pence).toBe(SAVINGS_FLOOR + intrinsic);
  });
});
