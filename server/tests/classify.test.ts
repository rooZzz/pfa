import { describe, expect, it } from "vitest";
import type { MonzoPot, MonzoTransaction } from "../connectors/monzo/client.js";
import {
  classifyInternal,
  classifyPotType,
  normalizeCategory,
} from "../connectors/monzo/classify.js";

function tx(overrides: Partial<MonzoTransaction>): MonzoTransaction {
  return {
    id: "tx",
    amount: -100,
    currency: "GBP",
    created: "2026-02-01T00:00:00Z",
    description: "x",
    ...overrides,
  };
}

describe("normalizeCategory", () => {
  it("keeps Monzo built-in category slugs", () => {
    expect(normalizeCategory("groceries")).toBe("groceries");
  });
  it("keeps custom category ids as-is so they stay distinct", () => {
    expect(normalizeCategory("category_0000AEuRWJc3WyTop3thDN")).toBe(
      "category_0000AEuRWJc3WyTop3thDN",
    );
  });
  it("defaults missing category to 'general'", () => {
    expect(normalizeCategory(undefined)).toBe("general");
    expect(normalizeCategory("")).toBe("general");
  });
});

describe("classifyInternal", () => {
  const own = new Set(["acc_a", "pot_b"]);
  it("flags pot transfers via scheme", () => {
    expect(classifyInternal(tx({ scheme: "uk_retail_pot" }), own)).toBe(true);
  });
  it("flags pot transfers via metadata pot_id", () => {
    expect(classifyInternal(tx({ metadata: { pot_id: "pot_b" } }), own)).toBe(true);
  });
  it("flags transfers to a known own account", () => {
    expect(classifyInternal(tx({ counterparty: { account_id: "acc_a" } }), own)).toBe(
      true,
    );
  });
  it("does not flag ordinary spend or external counterparties", () => {
    expect(classifyInternal(tx({ category: "groceries" }), own)).toBe(false);
    expect(
      classifyInternal(tx({ counterparty: { account_id: "acc_external" } }), own),
    ).toBe(false);
  });
});

describe("classifyPotType", () => {
  function pot(overrides: Partial<MonzoPot>): MonzoPot {
    return {
      id: "p",
      name: "Pot",
      balance: 0,
      currency: "GBP",
      deleted: false,
      ...overrides,
    };
  }
  it("maps cash ISA pots to the isa account type", () => {
    expect(classifyPotType(pot({ type: "cash_isa" }))).toBe("isa");
    expect(classifyPotType(pot({ name: "My ISA" }))).toBe("isa");
  });
  it("maps everything else to savings", () => {
    expect(classifyPotType(pot({ name: "Rainy Day", type: "flexible_savings" }))).toBe(
      "savings",
    );
  });
});
