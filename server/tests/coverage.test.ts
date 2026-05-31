import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import {
  buildYearCoverage,
  queryNetWorthCoverage,
  queryPayslipCoverage,
  type CoverageSeries,
} from "../net_worth/coverage.js";
import { resetDuck } from "../query.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";

const FY_START = "2025-04-06";

describe("buildYearCoverage — month layout", () => {
  it("returns 12 months starting at April with correct initials", () => {
    const months = buildYearCoverage("2025-09-15", FY_START, []);
    expect(months).toHaveLength(12);
    expect(months[0]!.initial).toBe("A");
    expect(months[0]!.month).toBe(4);
    expect(months[0]!.year).toBe(2025);
    expect(months[5]!.initial).toBe("S");
    expect(months[11]!.month).toBe(3);
    expect(months[11]!.year).toBe(2026);
  });

  it("marks months after asOf as future with no series", () => {
    const series: CoverageSeries[] = [
      {
        label: "Accounts",
        cadence: "snapshot",
        window_days: 31,
        entities: [["2025-08-10"]],
      },
    ];
    const months = buildYearCoverage("2025-09-15", FY_START, series);
    const october = months[6]!;
    expect(october.month).toBe(10);
    expect(october.state).toBe("future");
    expect(october.series).toEqual([]);
    expect(october.fraction_fresh).toBe(0);
  });
});

describe("buildYearCoverage — snapshot classification", () => {
  const series: CoverageSeries[] = [
    {
      label: "Accounts",
      cadence: "snapshot",
      window_days: 31,
      entities: [["2025-08-10"]],
    },
  ];

  it("a fully fresh past month is complete", () => {
    const august = buildYearCoverage("2025-09-15", FY_START, series)[4]!;
    expect(august.month).toBe(8);
    expect(august.state).toBe("complete");
    expect(august.fraction_fresh).toBe(1);
    expect(august.series[0]).toEqual({ label: "Accounts", state: "fresh", age_days: 21 });
  });

  it("a past month with no observation yet is incomplete and missing", () => {
    const april = buildYearCoverage("2025-09-15", FY_START, series)[0]!;
    expect(april.state).toBe("incomplete");
    expect(april.fraction_fresh).toBe(0);
    expect(april.series[0]!.state).toBe("missing");
    expect(april.series[0]!.age_days).toBeNull();
  });

  it("the asOf month is current and reports staleness past the window", () => {
    const september = buildYearCoverage("2025-09-15", FY_START, series)[5]!;
    expect(september.state).toBe("current");
    expect(september.series[0]).toEqual({
      label: "Accounts",
      state: "stale",
      age_days: 36,
    });
    expect(september.fraction_fresh).toBe(0);
  });

  it("per-series windows keep a slow-moving series fresh mid-cycle", () => {
    const mixed: CoverageSeries[] = [
      {
        label: "Accounts",
        cadence: "snapshot",
        window_days: 31,
        entities: [["2025-06-01"]],
      },
      {
        label: "Pension",
        cadence: "snapshot",
        window_days: 100,
        entities: [["2025-07-01"]],
      },
    ];
    const september = buildYearCoverage("2025-09-15", FY_START, mixed)[5]!;
    expect(september.fraction_fresh).toBe(0.5);
    expect(september.series.find((s) => s.label === "Accounts")!.state).toBe("stale");
    expect(september.series.find((s) => s.label === "Pension")!.state).toBe("fresh");
  });

  it("a snapshot category is only as fresh as its stalest entity", () => {
    const laggard: CoverageSeries[] = [
      {
        label: "Accounts",
        cadence: "snapshot",
        window_days: 31,
        entities: [["2025-09-10"], ["2025-06-01"]],
      },
    ];
    const september = buildYearCoverage("2025-09-15", FY_START, laggard)[5]!;
    expect(september.series[0]!.state).toBe("stale");
    expect(september.series[0]!.age_days).toBe(106);
  });
});

describe("buildYearCoverage — recurring classification", () => {
  const series: CoverageSeries[] = [
    {
      label: "Payslip",
      cadence: "recurring",
      window_days: 0,
      entities: [["2025-04-28", "2025-05-28", "2025-07-28"]],
    },
  ];

  it("a month with a payslip is fresh, a month without is missing", () => {
    const months = buildYearCoverage("2025-09-15", FY_START, series);
    expect(months[0]!.state).toBe("complete");
    expect(months[0]!.series[0]!.state).toBe("fresh");

    const june = months[2]!;
    expect(june.month).toBe(6);
    expect(june.state).toBe("incomplete");
    expect(june.series[0]!.state).toBe("missing");
  });
});

describe("coverage queries — integration", () => {
  afterEach(() => {
    resetDuck();
  });

  beforeEach(() => {
    initDb();
    getDb().exec(`
      DELETE FROM account_balances;
      DELETE FROM pension_values;
      DELETE FROM mortgage_balance;
      DELETE FROM asset_prices;
      DELETE FROM holdings;
      DELETE FROM income_events;
      DELETE FROM documents;
      DELETE FROM accounts;
      DELETE FROM assets;
      DELETE FROM mortgages;
      INSERT OR IGNORE INTO tax_periods (tax_year, starts_on, ends_on)
        VALUES ('2026/27', '2026-04-06', '2027-04-05');
    `);
  });

  it("queryNetWorthCoverage marks a recent account balance fresh in the current month", async () => {
    await recordAccountBalance({
      account_name: "Monzo",
      account_type: "current",
      balance_pence: 250000,
      currency: "GBP",
      valid_from: "2026-05-01",
    });

    const months = await queryNetWorthCoverage("2026-05-15");
    expect(months).toHaveLength(12);
    expect(months[0]!.month).toBe(4);

    const current = months.find((m) => m.state === "current")!;
    expect(current.month).toBe(5);
    const accounts = current.series.find((s) => s.label === "Accounts");
    expect(accounts).toBeDefined();
    expect(accounts!.state).toBe("fresh");
  });

  it("queryPayslipCoverage returns a missing payslip series for reached months when none recorded", async () => {
    const months = await queryPayslipCoverage("2026-05-15", "2026-04-06");
    expect(months).toHaveLength(12);
    const reached = months.filter((m) => m.state !== "future");
    expect(reached.map((m) => m.month)).toEqual([4, 5]);
    for (const m of reached) {
      expect(m.series[0]!.label).toBe("Payslip");
      expect(m.series[0]!.state).toBe("missing");
    }
  });
});
