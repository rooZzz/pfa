import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

import { getDb, getKysely, initDb } from "../db.js";
import { getBriefing } from "../goals/briefing.js";
import { resetDuck } from "../query.js";
import { writeManualDocument } from "../references.js";
import { confirmGoal } from "../tools/confirm_goal.js";
import { evaluateScenario } from "../tools/evaluate_scenario.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordTransaction } from "../tools/record_transaction.js";

const AS_OF = "2026-03-01";

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
    DELETE FROM accounts;
    DELETE FROM documents;
  `);
});

function accountId(name: string): number {
  return (
    getDb().prepare("SELECT id FROM accounts WHERE name = ?").get(name) as {
      id: number;
    }
  ).id;
}

async function seedTwoPools() {
  await recordAccountBalance({
    account_name: "Barclays",
    account_type: "current",
    balance_pence: 3500000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  await recordAccountBalance({
    account_name: "Vanguard",
    account_type: "isa",
    balance_pence: 2000000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
  await recordTransaction({
    account_name: "Barclays",
    account_type: "current",
    amount_pence: -200000,
    category: "bills",
    occurred_at: "2026-02-15",
    currency: "GBP",
  });
}

async function insertPayslip(
  payDate: string,
  gross: number,
  paye: number,
  ni: number,
  taxCode: string,
) {
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
          net_pence: gross - paye - ni,
          paye_pence: paye,
          ni_employee_pence: ni,
          pension_employee_pence: 0,
          tax_code: taxCode,
          occurred_at: `${payDate}T00:00:00.000Z`,
          source_id: sourceId,
        })
        .execute();
    });
}

describe("earnings context", () => {
  it("grounds the tax position from payslips in the tax year", async () => {
    await insertPayslip("2025-12-31", 600000, 120000, 22000, "1257L");
    await insertPayslip("2026-01-31", 600000, 120000, 22000, "1257L");

    const briefing = await getBriefing(AS_OF);
    expect(briefing.earnings.resolved).toBe(true);
    expect(briefing.earnings.tax_code).toBe("1257L");
    expect(briefing.earnings.ytd_gross_pence).toBe(1200000);
    expect(briefing.earnings.payslip_count).toBe(2);
  });

  it("is an explicit data gap when there are no payslips", async () => {
    const briefing = await getBriefing(AS_OF);
    expect(briefing.earnings.resolved).toBe(false);
    expect(briefing.earnings.gap_reason).toMatch(/no payslip data/i);
  });
});

describe("house_deposit goal", () => {
  it("fires progress and deadline directives against the target", async () => {
    await seedTwoPools();
    await confirmGoal({
      goal_type: "house_deposit",
      raw_utterance: "save a deposit",
      target_amount_pence: 8000000,
      target_date: "2027-01-01",
    });

    const briefing = await getBriefing(AS_OF);
    const directives = briefing.directives.filter(
      (d) => d.sub_goal === "deposit_progress",
    );
    const progress = directives.find((d) => d.kind === "progress");
    const deadline = directives.find((d) => d.kind === "deadline");

    expect(progress?.data.saved_pence).toBe(5500000);
    expect(progress?.data.target_pence).toBe(8000000);
    expect(progress?.data.percent).toBe(69);
    expect(deadline?.data.target_date).toBe("2027-01-01");
    expect(Number(deadline?.data.days_left)).toBeGreaterThan(0);
  });
});

describe("contention", () => {
  it("two liquid goals contend over the whole shared pool", async () => {
    await seedTwoPools();
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });
    await confirmGoal({
      goal_type: "house_deposit",
      raw_utterance: "save a deposit",
      target_amount_pence: 8000000,
      target_date: "2027-01-01",
    });

    const briefing = await getBriefing(AS_OF);
    const contention = briefing.directives.filter((d) => d.kind === "contention");
    expect(contention).toHaveLength(1);
    expect(contention[0]!.data.shared_account_count).toBe(2);
    expect(contention[0]!.data.shared_balance_pence).toBe(5500000);
  });

  it("emergency_fund and isa_max contend only over the ISA account", async () => {
    await seedTwoPools();
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });
    await confirmGoal({
      goal_type: "isa_max",
      raw_utterance: "max my ISA",
      tax_year: "2025/26",
    });

    const briefing = await getBriefing(AS_OF);
    const contention = briefing.directives.find((d) => d.kind === "contention");
    expect(contention?.data.shared_account_count).toBe(1);
    expect(contention?.data.shared_balance_pence).toBe(2000000);
    expect(contention?.data.shared_account_ids).toBe(String(accountId("Vanguard")));
  });
});

describe("evaluate_scenario", () => {
  it("with an empty overlay is identical to the live briefing", async () => {
    await seedTwoPools();
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });
    await confirmGoal({
      goal_type: "isa_max",
      raw_utterance: "max my ISA",
      tax_year: "2025/26",
    });

    const live = await getBriefing(AS_OF);
    const scenario = JSON.parse(await evaluateScenario({ as_of: AS_OF, overlay: {} }));
    expect(scenario).toEqual(live);
    expect(live).not.toHaveProperty("freshness");
  });

  it("an ISA bonus overlay shifts the metrics and leaves the live data untouched", async () => {
    await seedTwoPools();
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });
    await confirmGoal({
      goal_type: "isa_max",
      raw_utterance: "max my ISA",
      tax_year: "2025/26",
    });

    const before = await getBriefing(AS_OF);
    const isaBefore = before.directives.find(
      (d) => d.goal_type === "isa_max" && d.kind === "progress",
    )!.data.remaining_pence as number;
    const monthsBefore = before.directives.find((d) => d.sub_goal === "cover_progress")!
      .data.months as number;

    const scenario = JSON.parse(
      await evaluateScenario({
        as_of: AS_OF,
        overlay: {
          balances: [
            {
              account_id: accountId("Barclays"),
              balance_pence: 4300000,
              valid_from: "2026-03-01",
            },
          ],
          transactions: [
            {
              account_id: accountId("Vanguard"),
              amount_pence: 800000,
              occurred_at: "2026-02-01",
            },
          ],
        },
      }),
    );
    const isaAfter = scenario.directives.find(
      (d: { goal_type: string; kind: string }) =>
        d.goal_type === "isa_max" && d.kind === "progress",
    ).data.remaining_pence as number;
    const monthsAfter = scenario.directives.find(
      (d: { sub_goal: string }) => d.sub_goal === "cover_progress",
    ).data.months as number;

    expect(isaAfter).toBe(isaBefore - 800000);
    expect(monthsAfter).toBeGreaterThan(monthsBefore);

    const after = await getBriefing(AS_OF);
    const isaResidual = after.directives.find(
      (d) => d.goal_type === "isa_max" && d.kind === "progress",
    )!.data.remaining_pence as number;
    expect(isaResidual).toBe(isaBefore);
  });
});
