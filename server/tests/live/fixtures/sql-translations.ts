export interface SqlTranslationFixture {
  question: string;
  expectedSql: string;
  description: string;
}

export const sqlTranslationFixtures: SqlTranslationFixture[] = [
  {
    description: "current balance — latest open snapshot row",
    question: "what is the current balance for account 1?",
    expectedSql: `
      SELECT
        balance_pence,
        currency,
        valid_from,
        recorded_at
      FROM pfa.account_balances
      WHERE account_id = 1
        AND valid_to IS NULL
      ORDER BY valid_from DESC
      LIMIT 1
    `,
  },
  {
    description: "historical balance — LOCF for a specific date",
    question: "what was the balance for account 1 on 2026-02-01?",
    expectedSql: `
      SELECT
        balance_pence,
        currency,
        valid_from,
        recorded_at
      FROM pfa.account_balances
      WHERE account_id = 1
        AND valid_from <= DATE '2026-02-01'
        AND (valid_to IS NULL OR valid_to > DATE '2026-02-01')
      ORDER BY valid_from DESC
      LIMIT 1
    `,
  },
  {
    description: "all observations — full history in chronological order",
    question: "show me all balance observations for account 1 in chronological order",
    expectedSql: `
      SELECT
        valid_from,
        balance_pence,
        currency,
        recorded_at
      FROM pfa.account_balances
      WHERE account_id = 1
      ORDER BY valid_from ASC
    `,
  },
  {
    description: "aggregate count — total records for account",
    question: "what is the total number of balance records for account 1?",
    expectedSql: `
      SELECT COUNT(*) AS total_balance_records
      FROM pfa.account_balances
      WHERE account_id = 1
    `,
  },
];
