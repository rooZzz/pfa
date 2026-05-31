import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { getNetWorth } from "../net_worth/index.js";
import { resetDuck } from "../query.js";
import { seedData } from "../tools/seed_data.js";

beforeEach(() => {
  initDb();
});

afterEach(() => {
  resetDuck();
});

function count(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

describe("seedData", () => {
  it("returns a summary and populates every core series", async () => {
    const summary = await seedData();

    expect(summary).toContain("Seeded the database");
    expect(count("accounts")).toBeGreaterThan(0);
    expect(count("account_balances")).toBeGreaterThan(0);
    expect(count("pension_values")).toBeGreaterThan(0);
    expect(count("mortgage_balance")).toBeGreaterThan(0);
    expect(count("holdings")).toBeGreaterThan(0);
    expect(count("asset_prices")).toBeGreaterThan(0);
    expect(count("equity_grant")).toBeGreaterThan(0);
  });

  it("anchors every seeded row to a source document", async () => {
    await seedData();
    expect(count("documents")).toBeGreaterThan(0);
  });

  it("produces a net worth picture that computes without error", async () => {
    await seedData();

    const result = await getNetWorth("2026-05-28");

    expect(result.realised.length).toBeGreaterThan(0);
    expect(result.contingent.length).toBeGreaterThan(0);
    expect(result.trend).toHaveLength(12);
  });

  it("seeds upcoming vests across multiple months, all future-dated with a ticker", async () => {
    await seedData();

    const result = await getNetWorth("2026-05-28");

    for (const vest of result.contingent) {
      expect(vest.vest_date > "2026-05-28").toBe(true);
      expect(vest.ticker).toBe("ACME");
    }
    const months = new Set(result.contingent.map((v) => v.vest_date.slice(0, 7)));
    expect(months.size).toBeGreaterThan(1);
    expect(result.contingent_total_pence).toBeGreaterThan(0);
  });
});
