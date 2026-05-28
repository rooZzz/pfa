import fs from "node:fs";
import path from "node:path";
import { DOCUMENTS_DIR, resetDb } from "../db.js";
import { recordAccountBalance } from "./record_account_balance.js";
import { recordAssetValue } from "./record_asset_value.js";
import { recordEquityGrant } from "./record_equity_grant.js";
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
  const mortgageHistory: Array<[number, number, number, number]> = [
    [11, 28500000, 52000000, 425],
    [8, 28200000, 52500000, 425],
    [5, 27900000, 53000000, 475],
    [2, 27600000, 53500000, 475],
    [0, 27410000, 54000000, 475],
  ];
  for (const [ago, outstanding, propertyValue, rateBps] of mortgageHistory) {
    await recordMortgageBalance({
      lender: "Nationwide",
      property: "12 Acacia Avenue",
      outstanding_pence: outstanding,
      interest_rate_bps: rateBps,
      property_value_pence: propertyValue,
      currency: "GBP",
      valid_from: monthsAgo(ago, 1),
    });
  }
}

async function seedAssets(): Promise<void> {
  await recordAssetValue({
    asset_name: "ETH",
    asset_type: "crypto",
    quantity: 42500,
    original_currency: "ETH",
    gbp_equivalent_pence: 1180000,
    valid_from: monthsAgo(0, 25),
  });

  await recordAssetValue({
    asset_name: "BTC",
    asset_type: "crypto",
    quantity: 1250,
    original_currency: "BTC",
    gbp_equivalent_pence: 845000,
    valid_from: monthsAgo(0, 25),
  });

  await recordAssetValue({
    asset_name: "Vanguard FTSE All-World",
    asset_type: "etf",
    quantity: 320,
    original_currency: "GBP",
    gbp_equivalent_pence: 3520000,
    valid_from: monthsAgo(1, 12),
  });

  await recordAssetValue({
    asset_name: "AAPL",
    asset_type: "stock",
    quantity: 45,
    original_currency: "USD",
    gbp_equivalent_pence: 685000,
    valid_from: monthsAgo(2, 8),
  });

  await recordAssetValue({
    asset_name: "Series I Premium Bonds",
    asset_type: "other",
    quantity: 1,
    original_currency: "GBP",
    gbp_equivalent_pence: 5000000,
    valid_from: monthsAgo(9, 1),
  });
}

async function seedEquity(): Promise<void> {
  const rsuMessage = await recordEquityGrant({
    scheme_type: "rsu",
    units: 4000,
    grant_date: monthsAgo(24, 1),
    currency: "GBP",
    current_price_pence: 4250,
  });
  const rsuId = parseGrantId(rsuMessage);
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
    current_price_pence: 1850,
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
    current_price_pence: 1450,
  });
  parseGrantId(unapprovedMessage);

  const sayeMessage = await recordEquityGrant({
    scheme_type: "saye",
    units: 1500,
    strike_pence: 800,
    grant_date: monthsAgo(20, 1),
    currency: "GBP",
    current_price_pence: 1120,
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
    "Mortgage: Nationwide on 12 Acacia Avenue with 5 monthly snapshots.",
    "Assets: ETH, BTC, Vanguard FTSE All-World ETF, AAPL (USD), Premium Bonds (stale).",
    "Equity: RSU partially vested, EMI options partially vested, unapproved options unvested, SAYE fully vested.",
  ].join(" ");
}
