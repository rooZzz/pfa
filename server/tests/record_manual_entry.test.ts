import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../core/db.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordAssetHolding } from "../tools/record_asset_holding.js";
import { recordAssetPrice } from "../tools/record_asset_price.js";
import { recordEquityGrant } from "../tools/record_equity_grant.js";
import { recordMortgage } from "../tools/record_mortgage.js";
import { recordMortgageBalance } from "../tools/record_mortgage_balance.js";
import { recordPensionValue } from "../tools/record_pension_value.js";
import { recordVestingEvent } from "../tools/record_vesting_event.js";

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

describe("recordAccountBalance", () => {
  it("creates an account and writes a balance linked to a document", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 50000,
      currency: "GBP",
      valid_from: "2026-05-01",
    });

    const db = getDb();
    const account = db.prepare("SELECT name, type FROM accounts LIMIT 1").get() as {
      name: string;
      type: string;
    };
    expect(account.name).toBe("Monzo");
    expect(account.type).toBe("current");

    const balance = db
      .prepare("SELECT balance_pence, source_id FROM account_balances LIMIT 1")
      .get() as { balance_pence: number; source_id: number };
    expect(balance.balance_pence).toBe(50000);
    expect(balance.source_id).toBeGreaterThan(0);
  });

  it("upserts the account on repeated calls", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 10000,
      currency: "GBP",
      valid_from: "2026-04-01",
    });
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 20000,
      currency: "GBP",
      valid_from: "2026-05-01",
    });

    const accountCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }
    ).n;
    expect(accountCount).toBe(1);
  });

  it("writes the audit JSON file to disk", async () => {
    await recordAccountBalance({
      account_name: "ISA",
      account_type: "isa",
      balance_pence: 200000,
      currency: "GBP",
      valid_from: "2026-05-01",
    });

    const doc = getDb().prepare("SELECT file_path FROM documents LIMIT 1").get() as {
      file_path: string;
    };
    expect(fs.existsSync(doc.file_path)).toBe(true);
    const content = JSON.parse(fs.readFileSync(doc.file_path, "utf-8")) as {
      entry_type: string;
    };
    expect(content.entry_type).toBe("account_balance");
  });
});

describe("recordPensionValue", () => {
  it("creates a pension account and writes a pension_values row", async () => {
    await recordPensionValue({
      account_name: "Nest",
      value_pence: 4200000,
      currency: "GBP",
      valid_from: "2026-04-01",
    });

    const db = getDb();
    const account = db.prepare("SELECT name, type FROM accounts LIMIT 1").get() as {
      name: string;
      type: string;
    };
    expect(account.type).toBe("pension");

    const row = db
      .prepare("SELECT value_pence, source_id FROM pension_values LIMIT 1")
      .get() as { value_pence: number; source_id: number };
    expect(row.value_pence).toBe(4200000);
    expect(row.source_id).toBeGreaterThan(0);
  });
});

describe("recordMortgage", () => {
  it("writes a mortgages row with the supplied original_amount_pence and returns a usable ID", async () => {
    const result = await recordMortgage({
      lender: "Nationwide",
      property: "1 Main St",
      original_amount_pence: 30000000,
      currency: "GBP",
    });

    expect(result).toMatch(/Mortgage ID: \d+/);

    const db = getDb();
    const mortgage = db
      .prepare(
        "SELECT lender, property, original_amount_pence, currency FROM mortgages LIMIT 1",
      )
      .get() as {
      lender: string;
      property: string;
      original_amount_pence: number;
      currency: string;
    };
    expect(mortgage.lender).toBe("Nationwide");
    expect(mortgage.property).toBe("1 Main St");
    expect(mortgage.original_amount_pence).toBe(30000000);
    expect(mortgage.currency).toBe("GBP");
  });
});

describe("recordMortgageBalance", () => {
  it("writes a mortgage_balance row linked to a registered mortgage", async () => {
    const registerResult = await recordMortgage({
      lender: "Nationwide",
      property: "1 Main St",
      original_amount_pence: 30000000,
      currency: "GBP",
    });
    const mortgageId = parseMortgageId(registerResult);

    await recordMortgageBalance({
      mortgage_id: mortgageId,
      outstanding_pence: 25000000,
      interest_rate_bps: 450,
      currency: "GBP",
      valid_from: "2026-05-01",
    });

    const db = getDb();
    const row = db
      .prepare(
        "SELECT outstanding_pence, interest_rate_bps, source_id FROM mortgage_balance LIMIT 1",
      )
      .get() as {
      outstanding_pence: number;
      interest_rate_bps: number;
      source_id: number;
    };
    expect(row.outstanding_pence).toBe(25000000);
    expect(row.interest_rate_bps).toBe(450);
    expect(row.source_id).toBeGreaterThan(0);
  });

  it("throws when mortgage_id does not exist", async () => {
    await expect(
      recordMortgageBalance({
        mortgage_id: 9999,
        outstanding_pence: 25000000,
        interest_rate_bps: 450,
        currency: "GBP",
        valid_from: "2026-05-01",
      }),
    ).rejects.toThrow(/No mortgage with ID 9999/);
  });

  it("two balance snapshots against the same mortgage leave exactly one mortgages row", async () => {
    const registerResult = await recordMortgage({
      lender: "Nationwide",
      property: "1 Main St",
      original_amount_pence: 30000000,
      currency: "GBP",
    });
    const mortgageId = parseMortgageId(registerResult);

    await recordMortgageBalance({
      mortgage_id: mortgageId,
      outstanding_pence: 25000000,
      interest_rate_bps: 450,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordMortgageBalance({
      mortgage_id: mortgageId,
      outstanding_pence: 24500000,
      interest_rate_bps: 450,
      currency: "GBP",
      valid_from: "2026-05-01",
    });

    const db = getDb();
    const mortgageCount = (
      db.prepare("SELECT COUNT(*) AS n FROM mortgages").get() as { n: number }
    ).n;
    expect(mortgageCount).toBe(1);

    const balanceCount = (
      db.prepare("SELECT COUNT(*) AS n FROM mortgage_balance").get() as { n: number }
    ).n;
    expect(balanceCount).toBe(2);

    const mortgage = db
      .prepare("SELECT original_amount_pence FROM mortgages WHERE id = ?")
      .get(mortgageId) as { original_amount_pence: number };
    expect(mortgage.original_amount_pence).toBe(30000000);
  });
});

describe("recordAssetHolding", () => {
  it("creates an asset and writes a holdings row linked to a document", async () => {
    await recordAssetHolding({
      asset_name: "ETH",
      asset_type: "crypto",
      base_currency: "ETH",
      ticker: "ETH",
      quantity: 15,
      valid_from: "2026-05-01",
    });

    const db = getDb();
    const asset = db.prepare("SELECT name, asset_type FROM assets LIMIT 1").get() as {
      name: string;
      asset_type: string;
    };
    expect(asset.name).toBe("ETH");
    expect(asset.asset_type).toBe("crypto");

    const row = db.prepare("SELECT quantity, source_id FROM holdings LIMIT 1").get() as {
      quantity: number;
      source_id: number;
    };
    expect(row.quantity).toBe(1500000000);
    expect(row.source_id).toBeGreaterThan(0);
  });

  it("scales a fractional crypto quantity to 1e8 sub-units", async () => {
    await recordAssetHolding({
      asset_name: "BTC",
      asset_type: "crypto",
      base_currency: "BTC",
      ticker: "BTC",
      quantity: 0.125,
      valid_from: "2026-05-01",
    });

    const row = getDb().prepare("SELECT quantity FROM holdings LIMIT 1").get() as {
      quantity: number;
    };
    expect(row.quantity).toBe(12500000);
  });

  it("stores non-crypto quantities unscaled as whole units", async () => {
    await recordAssetHolding({
      asset_name: "Vanguard FTSE All-World",
      asset_type: "etf",
      base_currency: "GBP",
      ticker: "VWRL",
      quantity: 320,
      valid_from: "2026-05-01",
    });

    const row = getDb().prepare("SELECT quantity FROM holdings LIMIT 1").get() as {
      quantity: number;
    };
    expect(row.quantity).toBe(320);
  });

  it("rejects a fractional quantity for a non-crypto holding", async () => {
    await expect(
      recordAssetHolding({
        asset_name: "Vanguard FTSE All-World",
        asset_type: "etf",
        base_currency: "GBP",
        ticker: "VWRL",
        quantity: 10.5,
        valid_from: "2026-05-01",
      }),
    ).rejects.toThrow(/fractional/i);
  });

  it("upserts the asset on repeated calls", async () => {
    await recordAssetHolding({
      asset_name: "ETH",
      asset_type: "crypto",
      base_currency: "ETH",
      ticker: "ETH",
      quantity: 100,
      valid_from: "2026-01-01",
    });
    await recordAssetHolding({
      asset_name: "ETH",
      asset_type: "crypto",
      base_currency: "ETH",
      ticker: "ETH",
      quantity: 200,
      valid_from: "2026-05-01",
    });

    const assetCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM assets").get() as { n: number }
    ).n;
    expect(assetCount).toBe(1);

    const holdingCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM holdings").get() as { n: number }
    ).n;
    expect(holdingCount).toBe(2);
  });
});

describe("recordAssetPrice", () => {
  it("creates an asset and writes an asset_prices row", async () => {
    await recordAssetPrice({
      asset_name: "ETH",
      asset_type: "crypto",
      base_currency: "ETH",
      ticker: "ETH",
      unit_price_pence: 350000,
      currency: "GBP",
      as_of: "2026-05-01",
      source: "manual",
    });

    const db = getDb();
    const row = db
      .prepare(
        "SELECT unit_price_pence, currency, source, source_id FROM asset_prices LIMIT 1",
      )
      .get() as {
      unit_price_pence: number;
      currency: string;
      source: string;
      source_id: number;
    };
    expect(row.unit_price_pence).toBe(350000);
    expect(row.currency).toBe("GBP");
    expect(row.source).toBe("manual");
    expect(row.source_id).toBeGreaterThan(0);
  });
});

describe("recordEquityGrant", () => {
  it("writes an equity_grant row and returns the grant ID", async () => {
    const result = await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
    });

    expect(result).toMatch(/Grant ID: \d+/);

    const db = getDb();
    const grant = db
      .prepare("SELECT scheme_type, units, asset_id FROM equity_grant LIMIT 1")
      .get() as { scheme_type: string; units: number; asset_id: number | null };
    expect(grant.scheme_type).toBe("rsu");
    expect(grant.units).toBe(1000);
    expect(grant.asset_id).toBeNull();
  });

  it("links the grant to an underlying asset when underlying_asset_name is supplied", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
      underlying_asset_name: "ACME Corp",
      underlying_asset_type: "stock",
      ticker: "ACME",
    });

    const db = getDb();
    const grant = db.prepare("SELECT asset_id FROM equity_grant LIMIT 1").get() as {
      asset_id: number;
    };
    expect(grant.asset_id).toBeGreaterThan(0);

    const asset = db
      .prepare("SELECT name FROM assets WHERE id = ?")
      .get(grant.asset_id) as { name: string };
    expect(asset.name).toBe("ACME Corp");
  });
});

describe("recordVestingEvent", () => {
  it("writes an equity_vesting_event row linked to the grant", async () => {
    await recordEquityGrant({
      scheme_type: "rsu",
      units: 1000,
      grant_date: "2025-01-01",
      currency: "GBP",
    });

    const grantId = (
      getDb().prepare("SELECT id FROM equity_grant LIMIT 1").get() as { id: number }
    ).id;

    await recordVestingEvent({
      grant_id: grantId,
      vest_date: "2026-01-01",
      units_vested: 250,
      market_price_pence: 55000,
    });

    const row = getDb()
      .prepare(
        "SELECT grant_id, units_vested, market_price_pence, estimated_value_pence, source_id FROM equity_vesting_event LIMIT 1",
      )
      .get() as {
      grant_id: number;
      units_vested: number;
      market_price_pence: number;
      estimated_value_pence: number;
      source_id: number;
    };

    expect(row.grant_id).toBe(grantId);
    expect(row.units_vested).toBe(250);
    expect(row.market_price_pence).toBe(55000);
    expect(row.estimated_value_pence).toBe(250 * 55000);
    expect(row.source_id).toBeGreaterThan(0);
  });

  it("throws when the grant does not exist", async () => {
    await expect(
      recordVestingEvent({
        grant_id: 9999,
        vest_date: "2026-01-01",
        units_vested: 100,
      }),
    ).rejects.toThrow(/No equity grant found/);
  });
});

function parseMortgageId(message: string): number {
  const match = message.match(/Mortgage ID:\s*(\d+)/);
  if (!match) {
    throw new Error(`Could not parse mortgage ID from message: ${message}`);
  }
  return parseInt(match[1]!, 10);
}
