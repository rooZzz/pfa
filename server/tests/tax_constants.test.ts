import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initDb } from "../core/db.js";
import { resetDuck } from "../query/query.js";
import {
  resolveConstant,
  taxConstantsForDate,
  upcomingChange,
} from "../tax/constants.js";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
});

describe("resolveConstant", () => {
  it("returns the row in force at the as-of date", async () => {
    const before = await resolveConstant("dividend_rate_ordinary", "2025-06-01");
    expect(before?.value).toBe(875);
    expect(before?.unit).toBe("bps");
    expect(before?.status).toBe("enacted");

    const after = await resolveConstant("dividend_rate_ordinary", "2026-06-01");
    expect(after?.value).toBe(1075);
  });

  it("treats valid_to as inclusive at the exact boundary", async () => {
    const lastDay = await resolveConstant("dividend_rate_ordinary", "2026-04-05");
    expect(lastDay?.value).toBe(875);

    const firstDay = await resolveConstant("dividend_rate_ordinary", "2026-04-06");
    expect(firstDay?.value).toBe(1075);
  });

  it("returns null before any row takes effect", async () => {
    const early = await resolveConstant("cash_isa_allowance", "2026-05-29");
    expect(early).toBeNull();
  });

  it("returns null for a date with no covering row", async () => {
    const old = await resolveConstant("pension_annual_allowance", "2010-01-01");
    expect(old).toBeNull();
  });
});

describe("upcomingChange", () => {
  it("returns the next future-effective row for a key", async () => {
    const next = await upcomingChange("cash_isa_allowance", "2026-05-29");
    expect(next?.valid_from).toBe("2027-04-06");
    expect(next?.value).toBe(1200000);
  });

  it("returns null when nothing is scheduled after the as-of date", async () => {
    const next = await upcomingChange("isa_allowance", "2026-05-29");
    expect(next).toBeNull();
  });
});

describe("taxConstantsForDate", () => {
  it("bundles resolved constants keyed by name and omits not-yet-effective keys", async () => {
    const bundle = await taxConstantsForDate("2026-05-29");
    expect(bundle.isa_allowance?.value).toBe(2000000);
    expect(bundle.dividend_rate_ordinary?.value).toBe(1075);
    expect(bundle.cash_isa_allowance).toBeUndefined();
  });
});
