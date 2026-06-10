import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { getDb, initDb } from "../core/db.js";
import { getBriefing } from "../goals/briefing.js";
import { resetDuck } from "../query/query.js";
import { confirmGoal } from "../tools/confirm_goal.js";
import { proposeGoal } from "../tools/propose_goal.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";
import { recordTransaction } from "../tools/record_transaction.js";

const AS_OF = "2026-03-01";

function mockClassify(goalType: string, confidence = 0.9): void {
  createMock.mockResolvedValue({
    content: [
      {
        type: "tool_use",
        name: "classify_goal",
        input: { goal_type: goalType, confidence },
      },
    ],
  });
}

afterEach(() => {
  resetDuck();
  createMock.mockReset();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM goals;
    DELETE FROM transactions;
    DELETE FROM account_balances;
    DELETE FROM accounts;
    DELETE FROM documents;
  `);
});

async function seedCover() {
  await recordAccountBalance({
    account_name: "Barclays",
    account_type: "current",
    balance_pence: 3500000,
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

describe("proposeGoal", () => {
  it("classifies a supported goal and returns its needs spec", async () => {
    mockClassify("emergency_fund");
    const out = JSON.parse(await proposeGoal({ utterance: "build a rainy day fund" }));
    expect(out.goal_type).toBe("emergency_fund");
    expect(out.supported).toBe(true);
    expect(out.needs_spec.map((s: { name: string }) => s.name)).toContain(
      "target_months",
    );
    expect(out.raw_utterance).toBe("build a rainy day fund");
  });

  it("flags a recognised but unsupported goal type", async () => {
    mockClassify("debt_payoff");
    const out = JSON.parse(await proposeGoal({ utterance: "clear my credit card" }));
    expect(out.goal_type).toBe("debt_payoff");
    expect(out.supported).toBe(false);
  });

  it("classifies retirement and returns its needs spec", async () => {
    mockClassify("retirement");
    const out = JSON.parse(await proposeGoal({ utterance: "retire comfortably at 65" }));
    expect(out.goal_type).toBe("retirement");
    expect(out.supported).toBe(true);
    expect(out.needs_spec.map((s: { name: string }) => s.name)).toContain(
      "date_of_birth",
    );
  });
});

describe("confirmGoal", () => {
  it("writes a goal row with its verbatim utterance and a source document", async () => {
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "I want a few months put aside",
      target_months: 6,
    });

    const row = getDb()
      .prepare("SELECT goal_type, params, raw_utterance, status, source_id FROM goals")
      .get() as {
      goal_type: string;
      params: string;
      raw_utterance: string;
      status: string;
      source_id: number;
    };

    expect(row.goal_type).toBe("emergency_fund");
    expect(JSON.parse(row.params)).toEqual({ target_months: 6 });
    expect(row.raw_utterance).toBe("I want a few months put aside");
    expect(row.status).toBe("active");
    expect(row.source_id).toBeGreaterThan(0);

    const doc = getDb()
      .prepare("SELECT COUNT(*) AS c FROM documents WHERE id = ?")
      .get(row.source_id) as { c: number };
    expect(doc.c).toBe(1);
  });
});

describe("getBriefing", () => {
  it("fires a progress directive when the metric resolves", async () => {
    await seedCover();
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });

    const briefing = await getBriefing(AS_OF);
    const progress = briefing.directives.find((d) => d.sub_goal === "cover_progress");
    expect(progress?.kind).toBe("progress");
    expect(progress?.data.months).toBe(17.5);
  });

  it("fires a data-gap directive when the metric cannot resolve", async () => {
    await confirmGoal({
      goal_type: "emergency_fund",
      raw_utterance: "safety net",
      target_months: 3,
    });

    const briefing = await getBriefing(AS_OF);
    const gap = briefing.directives.find((d) => d.sub_goal === "cover_progress");
    expect(gap?.kind).toBe("data_gap");
  });

  it("fires progress and deadline directives for isa_max", async () => {
    await recordAccountBalance({
      account_name: "Vanguard",
      account_type: "isa",
      balance_pence: 2000000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    await confirmGoal({
      goal_type: "isa_max",
      raw_utterance: "max my ISA",
      tax_year: "2025/26",
    });

    const briefing = await getBriefing(AS_OF);
    const kinds = briefing.directives
      .filter((d) => d.goal_type === "isa_max")
      .map((d) => d.kind);
    expect(kinds).toContain("progress");
    expect(kinds).toContain("deadline");

    const deadline = briefing.directives.find((d) => d.kind === "deadline");
    expect(deadline?.data.days_left).toBe(35);

    const cashIsa = briefing.directives.find(
      (d) => d.data.effective_from === "2027-04-06",
    );
    expect(cashIsa?.kind).toBe("deadline");
    expect(cashIsa?.data.cash_isa_allowance_pence).toBe(1200000);
  });

  it("returns no directives when there are no active goals", async () => {
    const briefing = await getBriefing(AS_OF);
    expect(briefing.directives).toEqual([]);
  });
});
