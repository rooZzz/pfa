import fs from "node:fs";
import path from "node:path";
import { DOCUMENTS_DIR, resetDb } from "../db.js";
import { recordAccountBalance } from "./record_account_balance.js";
import { recordAssetHolding } from "./record_asset_holding.js";
import { recordAssetPrice } from "./record_asset_price.js";
import { recordEquityGrant } from "./record_equity_grant.js";
import { recordMortgage } from "./record_mortgage.js";
import { recordMortgageBalance } from "./record_mortgage_balance.js";
import { recordPensionValue } from "./record_pension_value.js";
import { recordVestingEvent } from "./record_vesting_event.js";

const TODAY = "2026-05-28";

function monthsAgo(months: number, day: number = 1): string {
  const parts = TODAY.split("-");
  const year = parseInt(parts[0]!, 10);
  const month = parseInt(parts[1]!, 10) - 1;
  let m = month - months;
  let y = year;
  while (m < 0) {
    m += 12;
    y--;
  }
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function clearDocumentsDir(): void {
  if (!fs.existsSync(DOCUMENTS_DIR)) return;
  for (const name of fs.readdirSync(DOCUMENTS_DIR)) {
    fs.unlinkSync(path.join(DOCUMENTS_DIR, name));
  }
}

async function seedAccounts(): Promise<void> {
  const currentHistory: Array<[number, number]> = [
    [11, 312045],
    [10, 285900],
    [9, 410220],
    [8, -8540],
    [7, 195340],
    [6, 287100],
    [5, 322050],
    [4, 268900],
    [3, 301450],
    [2, 355200],
    [1, 412330],
    [0, 487650],
  ];
  for (const [ago, pence] of currentHistory) {
    await recordAccountBalance({
      account_name: "Barclays Current",
      account_type: "current",
      balance_pence: pence,
      currency: "GBP",
      valid_from: monthsAgo(ago, 1),
    });
  }

  const savingsHistory: Array<[number, number]> = [
    [11, 1500000],
    [9, 1750000],
    [7, 2000000],
    [5, 2250000],
    [3, 2500000],
    [1, 2750000],
    [0, 2800000],
  ];
  for (const [ago, pence] of savingsHistory) {
    await recordAccountBalance({
      account_name: "Nationwide Savings",
      account_type: "savings",
      balance_pence: pence,
      currency: "GBP",
      valid_from: monthsAgo(ago, 5),
    });
  }

  const isaHistory: Array<[number, number]> = [
    [11, 4200000],
    [8, 4550000],
    [5, 4980000],
    [2, 5310000],
    [0, 5495000],
  ];
  for (const [ago, pence] of isaHistory) {
    await recordAccountBalance({
      account_name: "Vanguard ISA",
      account_type: "isa",
      balance_pence: pence,
      currency: "GBP",
      valid_from: monthsAgo(ago, 10),
    });
  }

  await recordAccountBalance({
    account_name: "Monzo Joint",
    account_type: "current",
    balance_pence: 84500,
    currency: "GBP",
    valid_from: monthsAgo(8, 15),
  });
}

async function seedPensions(): Promise<void> {
  const workplaceHistory: Array<[number, number]> = [
    [11, 8200000],
    [8, 8650000],
    [5, 9120000],
    [2, 9580000],
    [0, 9810000],
  ];
  for (const [ago, pence] of workplaceHistory) {
    await recordPensionValue({
      account_name: "Aviva Workplace Pension",
      value_pence: pence,
      currency: "GBP",
      valid_from: monthsAgo(ago, 20),
    });
  }

  await recordPensionValue({
    account_name: "Old Employer SIPP",
    value_pence: 2340000,
    currency: "GBP",
    valid_from: monthsAgo(14, 1),
  });
}

async function seedMortgage(): Promise<void> {
  const mortgageMessage = await recordMortgage({
    lender: "Nationwide",
    property: "12 Acacia Avenue",
    original_amount_pence: 30000000,
    currency: "GBP",
  });
  const mortgageId = parseMortgageId(mortgageMessage);

  await recordAssetHolding({
    asset_name: "12 Acacia Avenue",
    asset_type: "property",
    base_currency: "GBP",
    quantity: 1,
    valid_from: monthsAgo(11, 1),
  });

  const propertyPriceHistory: Array<[number, number]> = [
    [11, 52000000],
    [8, 52500000],
    [5, 53000000],
    [2, 53500000],
    [0, 54000000],
  ];
  for (const [ago, price] of propertyPriceHistory) {
    await recordAssetPrice({
      asset_name: "12 Acacia Avenue",
      asset_type: "property",
      base_currency: "GBP",
      unit_price_pence: price,
      currency: "GBP",
      as_of: monthsAgo(ago, 1),
      source: "manual",
    });
  }

  const mortgageHistory: Array<[number, number, number]> = [
    [11, 28500000, 425],
    [8, 28200000, 425],
    [5, 27900000, 475],
    [2, 27600000, 475],
    [0, 27410000, 475],
  ];
  for (const [ago, outstanding, rateBps] of mortgageHistory) {
    await recordMortgageBalance({
      mortgage_id: mortgageId,
      outstanding_pence: outstanding,
      interest_rate_bps: rateBps,
      currency: "GBP",
      valid_from: monthsAgo(ago, 1),
    });
  }
}

async function seedAssets(): Promise<void> {
  await recordAssetHolding({
    asset_name: "ETH",
    asset_type: "crypto",
    base_currency: "ETH",
    quantity: 42500,
    valid_from: monthsAgo(0, 25),
  });
  await recordAssetPrice({
    asset_name: "ETH",
    asset_type: "crypto",
    base_currency: "ETH",
    unit_price_pence: 27765,
    currency: "GBP",
    as_of: monthsAgo(0, 25),
    source: "manual",
  });

  await recordAssetHolding({
    asset_name: "BTC",
    asset_type: "crypto",
    base_currency: "BTC",
    quantity: 1250,
    valid_from: monthsAgo(0, 25),
  });
  await recordAssetPrice({
    asset_name: "BTC",
    asset_type: "crypto",
    base_currency: "BTC",
    unit_price_pence: 676000,
    currency: "GBP",
    as_of: monthsAgo(0, 25),
    source: "manual",
  });

  await recordAssetHolding({
    asset_name: "Vanguard FTSE All-World",
    asset_type: "etf",
    base_currency: "GBP",
    quantity: 320,
    valid_from: monthsAgo(1, 12),
  });
  await recordAssetPrice({
    asset_name: "Vanguard FTSE All-World",
    asset_type: "etf",
    base_currency: "GBP",
    unit_price_pence: 1100000,
    currency: "GBP",
    as_of: monthsAgo(1, 12),
    source: "manual",
  });

  await recordAssetHolding({
    asset_name: "AAPL",
    asset_type: "stock",
    base_currency: "USD",
    quantity: 45,
    valid_from: monthsAgo(2, 8),
  });
  await recordAssetPrice({
    asset_name: "AAPL",
    asset_type: "stock",
    base_currency: "USD",
    unit_price_pence: 15222,
    currency: "GBP",
    as_of: monthsAgo(2, 8),
    source: "manual",
  });

  await recordAssetHolding({
    asset_name: "Series I Premium Bonds",
    asset_type: "other",
    base_currency: "GBP",
    quantity: 1,
    valid_from: monthsAgo(9, 1),
  });
  await recordAssetPrice({
    asset_name: "Series I Premium Bonds",
    asset_type: "other",
    base_currency: "GBP",
    unit_price_pence: 5000000,
    currency: "GBP",
    as_of: monthsAgo(9, 1),
    source: "manual",
  });
}

async function seedEquity(): Promise<void> {
  const rsuMessage = await recordEquityGrant({
    scheme_type: "rsu",
    units: 4000,
    grant_date: monthsAgo(24, 1),
    currency: "GBP",
    underlying_asset_name: "ACME Corp",
    underlying_asset_type: "stock",
  });
  const rsuId = parseGrantId(rsuMessage);
  await recordAssetPrice({
    asset_name: "ACME Corp",
    asset_type: "stock",
    base_currency: "GBP",
    unit_price_pence: 4250,
    currency: "GBP",
    as_of: TODAY,
    source: "manual",
  });
  await recordVestingEvent({
    grant_id: rsuId,
    vest_date: monthsAgo(18, 1),
    units_vested: 1000,
    market_price_pence: 3800,
  });
  await recordVestingEvent({
    grant_id: rsuId,
    vest_date: monthsAgo(6, 1),
    units_vested: 1000,
    market_price_pence: 4100,
  });

  const emiMessage = await recordEquityGrant({
    scheme_type: "emi",
    units: 10000,
    strike_pence: 50,
    grant_date: monthsAgo(36, 1),
    currency: "GBP",
    underlying_asset_name: "ACME Corp",
    underlying_asset_type: "stock",
  });
  const emiId = parseGrantId(emiMessage);
  await recordVestingEvent({
    grant_id: emiId,
    vest_date: monthsAgo(24, 1),
    units_vested: 2500,
    market_price_pence: 950,
  });
  await recordVestingEvent({
    grant_id: emiId,
    vest_date: monthsAgo(12, 1),
    units_vested: 2500,
    market_price_pence: 1650,
  });

  const unapprovedMessage = await recordEquityGrant({
    scheme_type: "unapproved",
    units: 2000,
    strike_pence: 1200,
    grant_date: monthsAgo(8, 1),
    currency: "GBP",
    underlying_asset_name: "ACME Corp",
    underlying_asset_type: "stock",
  });
  parseGrantId(unapprovedMessage);

  const sayeMessage = await recordEquityGrant({
    scheme_type: "saye",
    units: 1500,
    strike_pence: 800,
    grant_date: monthsAgo(20, 1),
    currency: "GBP",
    underlying_asset_name: "ACME Corp",
    underlying_asset_type: "stock",
  });
  const sayeId = parseGrantId(sayeMessage);
  await recordVestingEvent({
    grant_id: sayeId,
    vest_date: monthsAgo(2, 1),
    units_vested: 1500,
    market_price_pence: 1120,
  });
}

function parseGrantId(message: string): number {
  const match = message.match(/Grant ID:\s*(\d+)/);
  if (!match) {
    throw new Error(`Could not parse grant ID from message: ${message}`);
  }
  return parseInt(match[1]!, 10);
}

function parseMortgageId(message: string): number {
  const match = message.match(/Mortgage ID:\s*(\d+)/);
  if (!match) {
    throw new Error(`Could not parse mortgage ID from message: ${message}`);
  }
  return parseInt(match[1]!, 10);
}

export async function seedData(): Promise<string> {
  resetDb();
  clearDocumentsDir();

  await seedAccounts();
  await seedPensions();
  await seedMortgage();
  await seedAssets();
  await seedEquity();

  return [
    "Seeded the database with realistic test data.",
    "Accounts: Barclays Current (12 months, includes overdraft), Nationwide Savings, Vanguard ISA, Monzo Joint (stale, 8 months old).",
    "Pensions: Aviva Workplace Pension (current), Old Employer SIPP (stale, 14 months old).",
    "Mortgage: Nationwide on 12 Acacia Avenue with 5 monthly snapshots. Property held as asset with separate price ticks.",
    "Assets: ETH, BTC, Vanguard FTSE All-World ETF, AAPL (USD), Premium Bonds — each with a holding and a price tick.",
    "Equity: RSU partially vested, EMI options partially vested, unapproved options unvested, SAYE fully vested. All linked to ACME Corp asset with a current price.",
  ].join(" ");
}
