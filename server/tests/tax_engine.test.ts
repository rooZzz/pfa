import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

import { getDb, getKysely, initDb } from "../core/db.js";
import { getBriefing } from "../goals/briefing.js";
import { resetDuck } from "../query/query.js";
import { writeManualDocument } from "../core/references.js";
import { taxPosition } from "../tax/engine.js";
import { evaluateScenario } from "../tools/evaluate_scenario.js";
import { recordPersonProfile } from "../tools/record_person_profile.js";

const ASOF = "2026-07-06";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM person_profile;
    DELETE FROM income_events;
    DELETE FROM equity_vesting_event;
    DELETE FROM equity_grant;
    DELETE FROM asset_prices;
    DELETE FROM assets;
    DELETE FROM documents;
  `);
});

async function setSalary(pence: number) {
  await recordPersonProfile({
    employer_name: "ACME",
    salary_pence: pence,
    tax_code: "1257L",
    currency: "GBP",
    valid_from: "2026-04-06",
  });
}

async function insertPayslip(payDate: string, gross: number, pension = 0) {
  await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "payslip_seed",
        pay_date: payDate,
      });
      await trx
        .insertInto("income_events")
        .values({
          pay_date: payDate,
          gross_pence: gross,
          net_pence: gross - pension,
          paye_pence: 0,
          ni_employee_pence: 0,
          pension_employee_pence: pension,
          occurred_at: `${payDate}T00:00:00.000Z`,
          source_id: sourceId,
        })
        .execute();
    });
}

async function seedVest(scheme: "rsu" | "saye", units: number, pricePence: number) {
  await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "equity_seed",
        scheme,
      });
      const asset = await trx
        .insertInto("assets")
        .values({ name: `${scheme} asset`, asset_type: "stock", base_currency: "GBP" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("asset_prices")
        .values({
          asset_id: Number(asset.id),
          unit_price_pence: pricePence,
          currency: "GBP",
          as_of: "2026-05-01T00:00:00.000Z",
          source: "manual",
          source_id: sourceId,
        })
        .execute();
      const grant = await trx
        .insertInto("equity_grant")
        .values({
          scheme_type: scheme,
          units,
          grant_date: "2025-01-01",
          currency: "GBP",
          asset_id: Number(asset.id),
          source_id: sourceId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("equity_vesting_event")
        .values({
          grant_id: Number(grant.id),
          vest_date: "2026-09-01",
          units_vested: units,
          occurred_at: "2026-09-01T00:00:00.000Z",
          source_id: sourceId,
        })
        .execute();
    });
}

describe("taxPosition", () => {
  it("computes income tax, NI and marginal rate for a £130k salary", async () => {
    await setSalary(13_000_000);
    const tp = await taxPosition(ASOF);
    expect(tp.resolved).toBe(true);
    expect(tp.basis).toBe("salary_profile");
    expect(tp.projected_annual_income_pence).toBe(13_000_000);
    expect(tp.personal_allowance_pence).toBe(0);
    expect(tp.marginal_rate_bps).toBe(4500);
    expect(tp.estimated_income_tax_pence).toBe(4_470_300);
    expect(tp.estimated_employee_ni_pence).toBe(461_060);
    expect(tp.in_personal_allowance_taper).toBe(false);
    expect(tp.pension_allowance_tapered).toBe(false);
  });

  it("flags the ~60% personal-allowance taper band", async () => {
    await setSalary(11_000_000);
    const tp = await taxPosition(ASOF);
    expect(tp.in_personal_allowance_taper).toBe(true);
    expect(tp.marginal_rate_bps).toBe(6000);
    expect(tp.personal_allowance_pence).toBe(757_000);
  });

  it("tapers the pension annual allowance above £260k adjusted income", async () => {
    await setSalary(30_000_000);
    const tp = await taxPosition(ASOF);
    expect(tp.pension_allowance_tapered).toBe(true);
    expect(tp.pension_annual_allowance_pence).toBe(4_000_000);
  });

  it("taxes the pension-reduced (net-pay) base and lets pension pull income into the taper band", async () => {
    await setSalary(13_000_000);
    await insertPayslip("2026-04-30", 1_083_333, 83_333);
    await insertPayslip("2026-05-31", 1_083_333, 83_333);
    await insertPayslip("2026-06-30", 1_083_334, 83_334);
    const tp = await taxPosition(ASOF);
    expect(tp.projected_annual_income_pence).toBe(13_000_000);
    expect(tp.adjusted_net_income_pence).toBe(12_000_000);
    expect(tp.in_personal_allowance_taper).toBe(true);
    expect(tp.marginal_rate_bps).toBe(6000);
    expect(tp.estimated_income_tax_pence).toBe(3_943_200);
  });

  it("is unresolved with a gap reason when there is no salary or payslip data", async () => {
    const tp = await taxPosition(ASOF);
    expect(tp.resolved).toBe(false);
    expect(tp.gap_reason).toMatch(/no salary profile or payslips/i);
  });

  it("counts an RSU vest as income and excludes a SAYE vest", async () => {
    await setSalary(9_000_000);
    await seedVest("rsu", 100, 40_000);
    await seedVest("saye", 100, 40_000);
    const tp = await taxPosition(ASOF);
    expect(tp.equity_income_pence).toBe(4_000_000);
    expect(tp.projected_annual_income_pence).toBe(13_000_000);
    expect(tp.assumptions.some((a) => /non-rsu/i.test(a))).toBe(true);
  });
});

describe("tax position under scenario", () => {
  it("a bonus income overlay raises the projection and shifts the marginal rate", async () => {
    await setSalary(9_000_000);
    await insertPayslip("2026-04-30", 750_000);
    await insertPayslip("2026-05-31", 750_000);
    await insertPayslip("2026-06-30", 750_000);

    const live = await getBriefing(ASOF);
    expect(live.tax_position.projected_annual_income_pence).toBe(9_000_000);
    expect(live.tax_position.marginal_rate_bps).toBe(4000);

    const scenario = JSON.parse(
      await evaluateScenario({
        as_of: ASOF,
        overlay: { income_events: [{ pay_date: "2026-06-30", gross_pence: 5_000_000 }] },
      }),
    );
    expect(scenario.tax_position.projected_annual_income_pence).toBe(14_000_000);
    expect(scenario.tax_position.marginal_rate_bps).toBe(4500);

    const after = await getBriefing(ASOF);
    expect(after.tax_position.projected_annual_income_pence).toBe(9_000_000);
  });

  it("an empty overlay reproduces the live tax position", async () => {
    await setSalary(13_000_000);
    const live = await getBriefing(ASOF);
    const scenario = JSON.parse(await evaluateScenario({ as_of: ASOF, overlay: {} }));
    expect(scenario.tax_position).toEqual(live.tax_position);
  });
});
