import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { getNetWorth } from "../net_worth/index.js";
import { resetDuck } from "../query.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordAssetHolding } from "../tools/record_asset_holding.js";
import { recordAssetPrice } from "../tools/record_asset_price.js";
import { recordEquityGrant } from "../tools/record_equity_grant.js";
import { recordMortgage } from "../tools/record_mortgage.js";
import { recordMortgageBalance } from "../tools/record_mortgage_balance.js";
import { recordPensionValue } from "../tools/record_pension_value.js";
import { recordVestingEvent } from "../tools/record_vesting_event.js";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM equity_vesting_event;
    DELETE FROM equity_grant;
    DELETE FROM pension_values;
    DELETE FROM mortgage_balance;
    DELETE FROM asset_prices;
    DELETE FROM holdings;
    DELETE FROM account_balances;
    DELETE FROM documents;
    DELETE FROM accounts;
    DELETE FROM assets;
    DELETE FROM mortgages;
  `);
});

async function seedFullPicture() {
  await recordAccountBalance({
    account_name: "Barclays",
    account_type: "current",
    balance_pence: 500000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  await recordPensionValue({
    account_name: "Nest",
    value_pence: 4200000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  const mortgageResult = await recordMortgage({
    lender: "Nationwide",
    property: "1 Main St",
    original_amount_pence: 30000000,
    currency: "GBP",
  });
  const mortgageIdMatch = mortgageResult.match(/Mortgage ID:\s*(\d+)/);
  const mortgageId = parseInt(mortgageIdMatch![1]!, 10);
  await recordAssetHolding({
    asset_name: "1 Main St",
    asset_type: "property",
    base_currency: "GBP",
    quantity: 1,
    valid_from: "2026-01-01",
  });
  await recordAssetPrice({
    asset_name: "1 Main St",
    asset_type: "property",
    base_currency: "GBP",
    unit_price_pence: 40000000,
    currency: "GBP",
    as_of: "2026-01-01",
    source: "manual",
  });
  await recordMortgageBalance({
    mortgage_id: mortgageId,
    outstanding_pence: 25000000,
    interest_rate_bps: 450,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  await recordAssetHolding({
    asset_name: "ETH",
    asset_type: "crypto",
    base_currency: "ETH",
    quantity: 100,
    valid_from: "2026-01-01",
  });
  await recordAssetPrice({
    asset_name: "ETH",
    asset_type: "crypto",
    base_currency: "ETH",
    unit_price_pence: 2000,
    currency: "GBP",
    as_of: "2026-01-01",
    source: "manual",
  });
}

describe("getNetWorth — realised", () => {
  it("includes accounts, pension, property, mortgage, and assets in realised", async () => {
    await seedFullPicture();
    const result = await getNetWorth("2026-05-01");

    const kinds = result.realised.map((l) => l.kind);
    expect(kinds).toContain("account");
    expect(kinds).toContain("pension");
    expect(kinds).toContain("property");
    expect(kinds).toContain("mortgage");
    expect(kinds).toContain("asset");
  });

  it("mortgage line has a negative value_pence", async () => {
    await seedFullPicture();
    const result = await getNetWorth("2026-05-01");

    const mortgageLine = result.realised.find((l) => l.kind === "mortgage");
    expect(mortgageLine).toBeDefined();
    expect(mortgageLine!.value_pence).toBeLessThan(0);
    expect(mortgageLine!.value_pence).toBe(-25000000);
  });

  it("realised_total_pence = sum of all realised lines including negative mortgage", async () => {
    await seedFullPicture();
    const result = await getNetWorth("2026-05-01");

    const manualSum = result.realised.reduce((acc, l) => acc + l.value_pence, 0);
    expect(result.realised_total_pence).toBe(manualSum);

    const expected = 500000 + 4200000 + 40000000 + -25000000 + 100 * 2000;
    expect(result.realised_total_pence).toBe(expected);
  });

  it("each realised line carries a source_id", async () => {
    await seedFullPicture();
    const result = await getNetWorth("2026-05-01");

    for (const line of result.realised) {
      expect(line.source_id).toBeGreaterThan(0);
    }
  });

  it("each realised line carries a valid_from date", async () => {
    await seedFullPicture();
    const result = await getNetWorth("2026-05-01");

    for (const line of result.realised) {
      expect(line.valid_from).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it("asset and property lines carry price_as_of and price_source", async () => {
    await seedFullPicture();
    const result = await getNetWorth("2026-05-01");

    const assetLine = result.realised.find((l) => l.kind === "asset");
    expect(assetLine?.price_as_of).toBeDefined();
    expect(assetLine?.price_source).toBe("manual");

    const propertyLine = result.realised.find((l) => l.kind === "property");
    expect(propertyLine?.price_as_of).toBeDefined();
    expect(propertyLine?.price_source).toBe("manual");
  });
});

describe("getNetWorth — LOCF", () => {
  it("picks the observation on or before asOf, not a later one", async () => {
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 200000,
      currency: "GBP",
      valid_from: "2026-04-01",
    });

    const result = await getNetWorth("2026-02-15");
    const accountLine = result.realised.find((l) => l.kind === "account");
    expect(accountLine?.value_pence).toBe(100000);
  });

  it("multiple observations for the same account do not double-count", async () => {
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 200000,
      currency: "GBP",
      valid_from: "2026-03-01",
    });

    const result = await getNetWorth("2026-05-01");
    const accountLines = result.realised.filter((l) => l.kind === "account");
    expect(accountLines).toHaveLength(1);
    expect(accountLines[0]!.value_pence).toBe(200000);
  });

  it("asset value reflects latest price tick, not holding date", async () => {
    await recordAssetHolding({
      asset_name: "ETH",
      asset_type: "crypto",
      base_currency: "ETH",
      quantity: 10,
      valid_from: "2026-01-01",
    });
    await recordAssetPrice({
      asset_name: "ETH",
      asset_type: "crypto",
      base_currency: "ETH",
      unit_price_pence: 100000,
      currency: "GBP",
      as_of: "2026-01-01",
      source: "manual",
    });
    await recordAssetPrice({
      asset_name: "ETH",
      asset_type: "crypto",
      base_currency: "ETH",
      unit_price_pence: 200000,
      currency: "GBP",
      as_of: "2026-03-01",
      source: "manual",
    });

    const result = await getNetWorth("2026-05-01");
    const assetLine = result.realised.find((l) => l.kind === "asset");
    expect(assetLine?.value_pence).toBe(10 * 200000);
  });
});

describe("getNetWorth — unknown series", () => {
  it("lists series with no observations as unknown rather than zero", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 10000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });

    const result = await getNetWorth("2026-05-01");
    expect(result.unknown).toContain("pension");
    expect(result.unknown).toContain("property");
    expect(result.unknown).toContain("assets");
    expect(result.unknown).not.toContain("accounts");
  });

  it("does not include series in the total when they are unknown", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 10000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });

    const result = await getNetWorth("2026-05-01");
    expect(result.realised_total_pence).toBe(10000);
  });
});

describe("getNetWorth — contingent equity", () => {
  async function seedGrantWithPrice(opts: {
    scheme_type: "rsu" | "emi" | "unapproved" | "saye";
    units: number;
    strike_pence?: number;
    unit_price_pence: number;
    ticker?: string;
  }): Promise<number> {
    await recordEquityGrant({
      scheme_type: opts.scheme_type,
      units: opts.units,
      strike_pence: opts.strike_pence,
      grant_date: "2025-01-01",
      currency: "GBP",
      underlying_asset_name: "ACME Corp",
      underlying_asset_type: "stock",
      ticker: opts.ticker,
    });
    await recordAssetPrice({
      asset_name: "ACME Corp",
      asset_type: "stock",
      base_currency: "GBP",
      unit_price_pence: opts.unit_price_pence,
      currency: "GBP",
      as_of: "2026-01-01",
      source: "manual",
    });
    return (getDb().prepare("SELECT id FROM equity_grant LIMIT 1").get() as { id: number })
      .id;
  }

  it("future vesting events appear in contingent with not_owned: true, never in realised", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "rsu",
      units: 1000,
      unit_price_pence: 50000,
    });
    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-09-01",
      units_vested: 500,
    });
    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2027-03-01",
      units_vested: 500,
    });

    const result = await getNetWorth("2026-05-01");

    expect(result.contingent).toHaveLength(2);
    const line = result.contingent[0]!;
    expect(line.not_owned).toBe(true);
    expect(line.vest_date).toBe("2026-09-01");
    expect(line.units).toBe(500);

    const realisedKinds = result.realised.map((l) => l.kind);
    expect(realisedKinds).not.toContain("equity");
  });

  it("orders upcoming vests soonest-first and carries the ticker", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "rsu",
      units: 1000,
      unit_price_pence: 50000,
      ticker: "ACME",
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2027-03-01", units_vested: 500 });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 500 });

    const result = await getNetWorth("2026-05-01");
    expect(result.contingent.map((l) => l.vest_date)).toEqual([
      "2026-09-01",
      "2027-03-01",
    ]);
    expect(result.contingent[0]!.ticker).toBe("ACME");
  });

  it("excludes past vests from contingent", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "rsu",
      units: 1000,
      unit_price_pence: 50000,
    });
    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-01-01",
      units_vested: 250,
      market_price_pence: 48000,
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 750 });

    const result = await getNetWorth("2026-05-01");
    expect(result.contingent).toHaveLength(1);
    expect(result.contingent[0]!.vest_date).toBe("2026-09-01");
    expect(result.contingent[0]!.units).toBe(750);
  });

  it("RSU projected value is units times current price", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "rsu",
      units: 1000,
      unit_price_pence: 52000,
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 500 });

    const result = await getNetWorth("2026-05-01");
    const line = result.contingent[0]!;
    expect(line.strike_pence).toBeNull();
    expect(line.price_per_unit_pence).toBe(52000);
    expect(line.projected_value_pence).toBe(500 * 52000);
  });

  it("option projected value is units times intrinsic (price minus strike), floored at zero", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "emi",
      units: 1000,
      strike_pence: 1200,
      unit_price_pence: 5000,
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 600 });

    const result = await getNetWorth("2026-05-01");
    const line = result.contingent[0]!;
    expect(line.strike_pence).toBe(1200);
    expect(line.projected_value_pence).toBe(600 * (5000 - 1200));
  });

  it("underwater option projects zero, never negative", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "unapproved",
      units: 1000,
      strike_pence: 1200,
      unit_price_pence: 1000,
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 400 });

    const result = await getNetWorth("2026-05-01");
    expect(result.contingent[0]!.projected_value_pence).toBe(0);
  });

  it("shows no projected value when grant has no underlying asset linked", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
    });
    const grantId = (
      getDb().prepare("SELECT id FROM equity_grant LIMIT 1").get() as { id: number }
    ).id;
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 500 });

    const result = await getNetWorth("2026-05-01");
    const line = result.contingent[0]!;
    expect(line.price_per_unit_pence).toBeNull();
    expect(line.projected_value_pence).toBeNull();
  });

  it("surfaces unscheduled units (total minus all recorded tranches)", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "rsu",
      units: 1000,
      unit_price_pence: 50000,
    });
    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-01-01",
      units_vested: 250,
      market_price_pence: 48000,
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 250 });

    const result = await getNetWorth("2026-05-01");
    expect(result.contingent_unscheduled).toHaveLength(1);
    expect(result.contingent_unscheduled[0]!.units).toBe(500);
  });

  it("fully scheduled grants produce no unscheduled line", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "rsu",
      units: 1000,
      unit_price_pence: 50000,
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 1000 });

    const result = await getNetWorth("2026-05-01");
    expect(result.contingent_unscheduled).toHaveLength(0);
  });

  it("contingent_total_pence sums projected values and does not touch realised_total_pence", async () => {
    const grantId = await seedGrantWithPrice({
      scheme_type: "rsu",
      units: 1000,
      unit_price_pence: 50000,
    });
    await recordVestingEvent({ grant_id: grantId, vest_date: "2026-09-01", units_vested: 1000 });

    const result = await getNetWorth("2026-05-01");
    expect(result.realised_total_pence).toBe(0);
    expect(result.contingent_total_pence).toBe(1000 * 50000);
  });
});

describe("getNetWorth — trend", () => {
  it("returns 12 trend points in ascending date order", async () => {
    const result = await getNetWorth("2026-05-01");
    expect(result.trend).toHaveLength(12);
    for (let i = 1; i < result.trend.length; i++) {
      expect(result.trend[i]!.date > result.trend[i - 1]!.date).toBe(true);
    }
  });

  it("trend dates are all on the 1st of the month", async () => {
    const result = await getNetWorth("2026-05-01");
    for (const pt of result.trend) {
      expect(pt.date).toMatch(/-01$/);
    }
  });
});
