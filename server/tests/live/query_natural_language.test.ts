import { beforeAll, describe, expect, it } from "vitest";
import { initDb, getDb } from "../../db.js";
import { ingestManualEntry } from "../../tools/ingest_manual_entry.js";
import { generateSql, queryNaturalLanguage } from "../../tools/query_natural_language.js";
import { sqlTranslationFixtures } from "./fixtures/sql-translations.js";

function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "")
    .toLowerCase();
}

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

describe("SQL translation golden records", () => {
  for (const fixture of sqlTranslationFixtures) {
    it(fixture.description, async () => {
      const actual = await generateSql(fixture.question);
      expect(normalizeSql(actual)).toBe(normalizeSql(fixture.expectedSql));
    });
  }
});

describe("end-to-end execution", () => {
  it("returns the correct balance value and surfaces recorded_at", async () => {
    const result = await queryNaturalLanguage(
      "what is the current balance for account 1?",
    );
    expect(result).toContain("250000");
    expect(result).toMatch(/recorded_at/i);
  });
});
