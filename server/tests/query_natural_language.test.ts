import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { getDb, initDb } from "../core/db.js";
import { resetDuck } from "../query/query.js";
import { queryNaturalLanguage } from "../tools/query_natural_language.js";
import { recordAccountBalance } from "../tools/record_account_balance.js";

function mockHaikuSql(sql: string): void {
  createMock.mockResolvedValue({ content: [{ type: "text", text: sql }] });
}

afterEach(() => {
  resetDuck();
  createMock.mockReset();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM account_balances;
    DELETE FROM documents;
    DELETE FROM accounts;
  `);
});

describe("queryNaturalLanguage", () => {
  it("executes the SQL Haiku generates and returns the rows", async () => {
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 123456,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    mockHaikuSql("SELECT balance_pence FROM pfa.account_balances");

    const output = await queryNaturalLanguage("what is my balance");

    expect(output).toContain("Generated SQL:");
    expect(output).toContain("SELECT balance_pence FROM pfa.account_balances");
    expect(output).toContain("123456");
    expect(output).toContain("Result (1 row)");
  });

  it("strips markdown fences from the generated SQL", async () => {
    mockHaikuSql("```sql\nSELECT 1 AS one\n```");

    const output = await queryNaturalLanguage("anything");

    expect(output).toContain("SELECT 1 AS one");
    expect(output).not.toContain("```");
  });

  it("runs against a read-only attachment so write statements cannot mutate data", async () => {
    await recordAccountBalance({
      account_name: "Barclays",
      account_type: "current",
      balance_pence: 500000,
      currency: "GBP",
      valid_from: "2026-01-01",
    });
    mockHaikuSql("DELETE FROM pfa.account_balances");

    const output = await queryNaturalLanguage("delete everything");

    expect(output).toContain("Query error");
    const remaining = getDb()
      .prepare("SELECT COUNT(*) AS c FROM account_balances")
      .get() as { c: number };
    expect(remaining.c).toBe(1);
  });
});
