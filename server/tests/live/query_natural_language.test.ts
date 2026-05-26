import { beforeAll, describe, expect, it } from "vitest";
import { initDb, getDb } from "../../db.js";
import { ingestManualEntry } from "../../tools/ingest_manual_entry.js";
import { queryNaturalLanguage } from "../../tools/query_natural_language.js";

beforeAll(async () => {
  initDb();
  const db = getDb();
  db.exec(
    "DELETE FROM account_balances; DELETE FROM transactions; DELETE FROM documents;",
  );
  await ingestManualEntry({
    account_id: 1,
    balance_pence: 250000,
    currency: "GBP",
    valid_from: "2026-01-01",
  });
});

describe("query_natural_language", () => {
  it("generates valid SQL and returns the correct balance", async () => {
    const result = await queryNaturalLanguage(
      "what is the current balance for account 1?",
    );

    expect(result).toContain("Generated SQL:");
    expect(result).toMatch(/SELECT/i);
    expect(result).toMatch(/account_balances/i);
    expect(result).toContain("250000");
  });

  it("surfaces recorded_at in the result", async () => {
    const result = await queryNaturalLanguage(
      "show me the balance and when it was recorded for account 1",
    );

    expect(result).toMatch(/recorded_at/i);
  });
});
