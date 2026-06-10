import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

import { getDb, getKysely, initDb } from "../core/db.js";
import { type Directive, getBriefing } from "../goals/briefing.js";
import {
  bridgeFund,
  contributionRate,
  currentPensionPot,
  investedAssets,
  projectedPensionPot,
} from "../metrics/index.js";
import { resetDuck } from "../query/query.js";
import { writeManualDocument } from "../core/references.js";
import { confirmGoal } from "../tools/confirm_goal.js";
import { evaluateScenario } from "../tools/evaluate_scenario.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordAssetHolding } from "../tools/record_asset_holding.js";
import { recordAssetPrice } from "../tools/record_asset_price.js";
import { recordPensionValue } from "../tools/record_pension_value.js";
import { recordPersonProfile } from "../tools/record_person_profile.js";

const AS_OF = "2026-04-30";
const DOB = "1976-04-30";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM goals;
    DELETE FROM transactions;
    DELETE FROM account_balances;
    DELETE FROM income_events;
    DELETE FROM pension_values;
    DELETE FROM person_profile;
    DELETE FROM holdings;
    DELETE FROM asset_prices;
    DELETE FROM assets;
    DELETE FROM accounts;
    DELETE FROM documents;
  `);
});

async function seedPot(valuePence: number, validFrom = "2026-04-10") {
  await recordPensionValue({
    account_name: "Nest Pension",
    value_pence: valuePence,
    currency: "GBP",
    valid_from: validFrom,
  });
}

async function insertPayslip(opts: {
  payDate: string;
  gross: number;
  pensionEmployee?: number;
  pensionEmployer?: number;
}) {
  await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "payslip_seed",
        pay_date: opts.payDate,
      });
      const pensionEmployee = opts.pensionEmployee ?? 0;
      await trx
        .insertInto("income_events")
        .values({
          pay_date: opts.payDate,
          gross_pence: opts.gross,
          net_pence: opts.gross - pensionEmployee,
          paye_pence: 0,
          ni_employee_pence: 0,
          pension_employee_pence: pensionEmployee,
          pension_employer_pence: opts.pensionEmployer ?? 0,
          tax_code: "1257L",
          occurred_at: `${opts.payDate}T00:00:00.000Z`,
          source_id: sourceId,
        })
        .execute();
    });
}

function potProgress(directives: Directive[]): Directive | undefined {
  return directives.find((d) => d.sub_goal === "pot_progress" && d.kind === "progress");
}

describe("projectedPensionPot", () => {
  it("compounds a known pot and contribution to the deterministic anchor", async () => {
    await seedPot(10_000_000);
    await insertPayslip({
      payDate: "2026-04-25",
      gross: 300_000,
      pensionEmployee: 50_000,
    });

    const result = await projectedPensionPot(AS_OF, 60, DOB);
    expect(result.resolved).toBe(true);
    expect(result.detail.years).toBe(10);
    expect(result.detail.annual_contribution_pence).toBe(600_000);
    expect(result.value).toBe(20_317_491);
  });

  it("returns the pot unchanged when the target age is already reached", async () => {
    await seedPot(10_000_000);
    await insertPayslip({
      payDate: "2026-04-25",
      gross: 300_000,
      pensionEmployee: 50_000,
    });

    const result = await projectedPensionPot(AS_OF, 40, DOB);
    expect(result.resolved).toBe(true);
    expect(result.detail.years).toBe(0);
    expect(result.value).toBe(10_000_000);
  });

  it("is a data gap when no pension pot is recorded", async () => {
    const result = await projectedPensionPot(AS_OF, 60, DOB);
    expect(result.resolved).toBe(false);
    expect(result.value).toBeNull();
    expect(result.gap_reason).toBeTruthy();
  });

  it("still resolves with no contributions when there are no payslips", async () => {
    await seedPot(10_000_000);
    const result = await projectedPensionPot(AS_OF, 60, DOB);
    expect(result.resolved).toBe(true);
    expect(result.detail.annual_contribution_pence).toBe(0);
    expect(result.detail.contribution_grounded).toBe(0);
    expect(result.value as number).toBeGreaterThan(10_000_000);
  });
});

describe("currentPensionPot", () => {
  it("sums the latest pension pot value", async () => {
    await seedPot(4_200_000);
    const result = await currentPensionPot(AS_OF);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(4_200_000);
  });

  it("is a data gap when no pension account exists", async () => {
    const result = await currentPensionPot(AS_OF);
    expect(result.resolved).toBe(false);
  });
});

describe("investedAssets", () => {
  it("includes pension and ISA, excludes cash", async () => {
    await seedPot(5_000_000);
    await recordAccountBalance({
      account_name: "Vanguard ISA",
      account_type: "isa",
      balance_pence: 3_000_000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 1_000_000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });

    const result = await investedAssets(AS_OF);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(8_000_000);
    expect(result.detail.pension_pence).toBe(5_000_000);
    expect(result.detail.isa_pence).toBe(3_000_000);
  });

  it("is a data gap when only cash exists", async () => {
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 1_000_000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    const result = await investedAssets(AS_OF);
    expect(result.resolved).toBe(false);
  });

  it("includes non-property holdings (GIA, crypto)", async () => {
    await recordAssetHolding({
      asset_name: "Acme GIA",
      asset_type: "other",
      base_currency: "GBP",
      quantity: 10,
      valid_from: "2026-01-01",
    });
    await recordAssetPrice({
      asset_name: "Acme GIA",
      asset_type: "other",
      base_currency: "GBP",
      unit_price_pence: 200_000,
      currency: "GBP",
      as_of: "2026-01-01",
      source: "manual",
    });

    const result = await investedAssets(AS_OF);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(2_000_000);
    expect(result.detail.holdings_pence).toBe(2_000_000);
  });
});

describe("contributionRate", () => {
  it("annualises employee and employer contributions across payslips", async () => {
    const payDates = [
      "2026-04-28",
      "2026-05-28",
      "2026-06-28",
      "2026-07-28",
      "2026-08-28",
      "2026-09-28",
      "2026-10-28",
      "2026-11-28",
      "2026-12-28",
      "2027-01-28",
      "2027-02-28",
      "2027-03-28",
    ];
    for (const payDate of payDates) {
      await insertPayslip({
        payDate,
        gross: 400_000,
        pensionEmployee: 50_000,
        pensionEmployer: 25_000,
      });
    }

    const result = await contributionRate("2027-04-05");
    expect(result.resolved).toBe(true);
    expect(result.value).toBe(900_000);
    expect(result.detail.employee_annual_pence).toBe(600_000);
    expect(result.detail.employer_annual_pence).toBe(300_000);
    expect(result.detail.payslip_count).toBe(12);
  });

  it("is a data gap when no payslips exist", async () => {
    const result = await contributionRate(AS_OF);
    expect(result.resolved).toBe(false);
  });
});

describe("bridgeFund", () => {
  it("computes the bridge shortfall when retiring before pension access age", async () => {
    await recordAccountBalance({
      account_name: "Nationwide",
      account_type: "savings",
      balance_pence: 8_000_000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });

    const result = await bridgeFund(AS_OF, 4_000_000, 50);
    expect(result.resolved).toBe(true);
    expect(result.detail.pension_access_age).toBe(55);
    expect(result.detail.bridge_years).toBe(5);
    expect(result.detail.bridge_need_pence).toBe(20_000_000);
    expect(result.value).toBe(12_000_000);
  });

  it("needs no bridge when retiring at or after pension access age", async () => {
    const result = await bridgeFund(AS_OF, 4_000_000, 57);
    expect(result.resolved).toBe(true);
    expect(result.detail.bridge_years).toBe(0);
    expect(result.value).toBe(0);
  });
});

describe("retirement goal briefing", () => {
  it("fires a pot-progress directive against the safe-withdrawal target", async () => {
    await seedPot(10_000_000);
    await confirmGoal({
      goal_type: "retirement",
      raw_utterance: "retire at 60 on 40k a year",
      target_annual_income_pence: 4_000_000,
      retirement_age: 60,
      date_of_birth: DOB,
    });

    const briefing = await getBriefing(AS_OF);
    const progress = potProgress(briefing.directives);
    expect(progress?.data.pot_needed_pence).toBe(100_000_000);
    expect(progress?.data.target_age).toBe(60);
    expect(briefing.retirement_projection.resolved).toBe(true);
    expect(briefing.retirement_projection.assumptions.length).toBeGreaterThan(0);
  });
});

describe("fire goal briefing", () => {
  it("fires a bridge-fund directive with the shortfall", async () => {
    await recordAccountBalance({
      account_name: "Nationwide",
      account_type: "savings",
      balance_pence: 8_000_000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await confirmGoal({
      goal_type: "fire",
      raw_utterance: "be financially independent by 50",
      target_annual_spend_pence: 4_000_000,
      target_retirement_age: 50,
      date_of_birth: DOB,
    });

    const briefing = await getBriefing(AS_OF);
    const bridge = briefing.directives.find((d) => d.sub_goal === "bridge_fund");
    expect(bridge?.kind).toBe("progress");
    expect(bridge?.data.bridge_shortfall_pence).toBe(12_000_000);
    expect(bridge?.data.bridge_years).toBe(5);
  });

  it("funds the FIRE number from invested assets, not the pension alone", async () => {
    await recordAccountBalance({
      account_name: "Vanguard ISA",
      account_type: "isa",
      balance_pence: 25_000_000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 2_000_000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await confirmGoal({
      goal_type: "fire",
      raw_utterance: "financial independence by 50",
      target_annual_spend_pence: 1_000_000,
      target_retirement_age: 50,
      date_of_birth: "1986-04-30",
    });

    const briefing = await getBriefing(AS_OF);
    const progress = potProgress(briefing.directives);
    expect(progress).toBeDefined();
    expect(progress!.data.pot_needed_pence).toBe(25_000_000);
    expect(progress!.data.projected_pot_pence as number).toBeGreaterThan(25_000_000);

    expect(briefing.retirement_projection.invested_assets_pence).toBe(25_000_000);
    expect(briefing.retirement_projection.cash_pence).toBe(2_000_000);
    expect(briefing.retirement_projection.total_drawable_pence).toBe(27_000_000);
  });
});

describe("retirement scenario", () => {
  it("an extra-contribution overlay raises the projected pot and leaves live data untouched", async () => {
    await seedPot(10_000_000);
    await insertPayslip({ payDate: "2026-04-10", gross: 300_000, pensionEmployee: 0 });
    await confirmGoal({
      goal_type: "retirement",
      raw_utterance: "retire at 60 on 40k a year",
      target_annual_income_pence: 4_000_000,
      retirement_age: 60,
      date_of_birth: DOB,
    });

    const before = await getBriefing(AS_OF);
    const projectedBefore = potProgress(before.directives)!.data
      .projected_pot_pence as number;

    const scenario = JSON.parse(
      await evaluateScenario({
        as_of: AS_OF,
        overlay: {
          income_events: [
            {
              pay_date: "2026-04-20",
              gross_pence: 300_000,
              pension_employee_pence: 100_000,
            },
          ],
        },
      }),
    );
    const projectedAfter = scenario.directives.find(
      (d: { sub_goal: string; kind: string }) =>
        d.sub_goal === "pot_progress" && d.kind === "progress",
    ).data.projected_pot_pence as number;

    expect(projectedAfter).toBeGreaterThan(projectedBefore);

    const after = await getBriefing(AS_OF);
    const projectedResidual = potProgress(after.directives)!.data
      .projected_pot_pence as number;
    expect(projectedResidual).toBe(projectedBefore);
  });

  it("an empty overlay is identical to the live briefing with pension data present", async () => {
    await seedPot(10_000_000);
    await recordPersonProfile({
      employer_name: "Acme",
      salary_pence: 6_000_000,
      tax_code: "1257L",
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await insertPayslip({
      payDate: "2026-04-25",
      gross: 500_000,
      pensionEmployee: 50_000,
    });
    await confirmGoal({
      goal_type: "retirement",
      raw_utterance: "retire at 60 on 40k a year",
      target_annual_income_pence: 4_000_000,
      retirement_age: 60,
      date_of_birth: DOB,
    });

    const live = await getBriefing(AS_OF);
    const scenario = JSON.parse(await evaluateScenario({ as_of: AS_OF, overlay: {} }));
    expect(scenario).toEqual(live);
  });
});
