import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { getNetWorth } from "../net_worth.js";
import { resetDuck } from "../query.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordAssetValue } from "../tools/record_asset_value.js";
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
    DELETE FROM asset_values;
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
  await recordMortgageBalance({
    mortgage_id: mortgageId,
    outstanding_pence: 25000000,
    interest_rate_bps: 450,
    property_value_pence: 40000000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  await recordAssetValue({
    asset_name: "ETH",
    asset_type: "crypto",
    quantity: 100,
    original_currency: "ETH",
    gbp_equivalent_pence: 200000,
    valid_from: "2026-01-01",
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

    const expected =
      500000 +
      4200000 +
      40000000 +
      -25000000 +
      200000;
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
    expect(result.unknown).toContain("property / mortgage");
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
  it("unvested equity appears in contingent with not_owned: true, never in realised", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
      current_price_pence: 50000,
    });

    const grantId = (
      getDb().prepare("SELECT id FROM equity_grant LIMIT 1").get() as { id: number }
    ).id;

    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-01-01",
      units_vested: 250,
      market_price_pence: 52000,
    });

    const result = await getNetWorth("2026-05-01");

    expect(result.contingent).toHaveLength(1);
    const line = result.contingent[0]!;
    expect(line.not_owned).toBe(true);
    expect(line.total_units).toBe(1000);
    expect(line.vested_units).toBe(250);
    expect(line.unvested_units).toBe(750);

    const realisedKinds = result.realised.map((l) => l.kind);
    expect(realisedKinds).not.toContain("equity");
  });

  it("uses the latest vesting market price for valuation", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
      current_price_pence: 50000,
    });

    const grantId = (
      getDb().prepare("SELECT id FROM equity_grant LIMIT 1").get() as { id: number }
    ).id;

    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-01-01",
      units_vested: 250,
      market_price_pence: 52000,
    });

    const result = await getNetWorth("2026-05-01");
    const line = result.contingent[0]!;

    expect(line.price_per_unit_pence).toBe(52000);
    expect(line.est_value_pence).toBe(750 * 52000);
  });

  it("falls back to grant payload price when no vesting events exist yet", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
      current_price_pence: 48000,
    });

    const result = await getNetWorth("2026-05-01");
    const line = result.contingent[0]!;

    expect(line.price_per_unit_pence).toBe(48000);
    expect(line.est_value_pence).toBe(1000 * 48000);
  });

  it("contingent equity does not contribute to realised_total_pence", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
      current_price_pence: 50000,
    });

    const result = await getNetWorth("2026-05-01");
    expect(result.realised_total_pence).toBe(0);
    expect(result.contingent_total_pence).toBeGreaterThan(0);
  });

  it("fully vested grants do not appear in contingent", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 400,
      grant_date: "2024-01-01",
      currency: "GBP",
    });

    const grantId = (
      getDb().prepare("SELECT id FROM equity_grant LIMIT 1").get() as { id: number }
    ).id;

    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-01-01",
      units_vested: 400,
    });

    const result = await getNetWorth("2026-05-01");
    expect(result.contingent).toHaveLength(0);
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
