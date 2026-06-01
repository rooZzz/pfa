import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { liquidSavings } from "../metrics/index.js";
import { resetDuck } from "../query.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordPensionValue } from "../tools/record_pension_value.js";
import { recordAssetHolding } from "../tools/record_asset_holding.js";
import { recordAssetPrice } from "../tools/record_asset_price.js";
import { getNetWorth } from "../net_worth/index.js";

const AS_OF = "2026-05-30";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM account_balances;
    DELETE FROM pension_values;
    DELETE FROM asset_prices;
    DELETE FROM holdings;
    DELETE FROM assets;
    DELETE FROM accounts;
    DELETE FROM documents;
  `);
});

describe("same-day snapshot resolution", () => {
  it("honors the latest same-day account balance", async () => {
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 100000,
      currency: "GBP",
      valid_from: AS_OF,
    });
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 999000,
      currency: "GBP",
      valid_from: AS_OF,
    });
    const result = await liquidSavings(AS_OF);
    expect(result.value).toBe(999000);
  });

  it("honors the latest same-day pension value in net worth", async () => {
    await recordPensionValue({
      account_name: "Nest",
      value_pence: 4200000,
      currency: "GBP",
      valid_from: AS_OF,
    });
    await recordPensionValue({
      account_name: "Nest",
      value_pence: 4250000,
      currency: "GBP",
      valid_from: AS_OF,
    });
    const net_worth = await getNetWorth(AS_OF);
    const pension = net_worth.realised.find((line) => line.name === "Nest");
    expect(pension?.value_pence).toBe(4250000);
  });

  it("honors the latest same-day asset price in net worth", async () => {
    await recordAssetHolding({
      asset_name: "Vanguard FTSE All-World",
      asset_type: "etf",
      base_currency: "GBP",
      ticker: "VWRL",
      quantity: 1,
      valid_from: AS_OF,
    });
    await recordAssetPrice({
      asset_name: "Vanguard FTSE All-World",
      asset_type: "etf",
      base_currency: "GBP",
      ticker: "VWRL",
      unit_price_pence: 10000,
      currency: "GBP",
      as_of: AS_OF,
      source: "manual",
    });
    await recordAssetPrice({
      asset_name: "Vanguard FTSE All-World",
      asset_type: "etf",
      base_currency: "GBP",
      ticker: "VWRL",
      unit_price_pence: 12500,
      currency: "GBP",
      as_of: AS_OF,
      source: "manual",
    });
    const net_worth = await getNetWorth(AS_OF);
    const asset = net_worth.realised.find(
      (line) => line.name === "Vanguard FTSE All-World",
    );
    expect(asset?.value_pence).toBe(12500);
  });
});
