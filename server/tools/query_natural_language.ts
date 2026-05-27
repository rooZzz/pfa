import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { runQuery } from "../query.js";

const CATALOG_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "schema_catalog.md",
);

const DDL = `
CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  source_type  TEXT NOT NULL CHECK (source_type IN ('upload', 'manual', 'connector')),
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ingested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes        TEXT
);

CREATE TABLE accounts (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('current', 'savings', 'isa', 'pension', 'mortgage')),
  currency TEXT NOT NULL DEFAULT 'GBP'
);

CREATE TABLE assets (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  asset_type    TEXT NOT NULL,
  base_currency TEXT NOT NULL
);

CREATE TABLE mortgages (
  id                    INTEGER PRIMARY KEY,
  lender                TEXT NOT NULL,
  property              TEXT NOT NULL,
  original_amount_pence INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'GBP'
);

CREATE TABLE transactions (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL,
  occurred_at  TIMESTAMP NOT NULL,
  recorded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount_pence INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  description  TEXT,
  source_id    INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE income_events (
  id                     INTEGER PRIMARY KEY,
  pay_date               DATE NOT NULL,
  tax_year               TEXT REFERENCES tax_periods(tax_year),
  gross_pence            INTEGER NOT NULL,
  taxable_pence          INTEGER,
  net_pence              INTEGER NOT NULL,
  paye_pence             INTEGER NOT NULL,
  ni_employee_pence      INTEGER NOT NULL,
  pension_employee_pence INTEGER NOT NULL,
  pension_employer_pence INTEGER,
  currency               TEXT NOT NULL DEFAULT 'GBP',
  occurred_at            TIMESTAMP NOT NULL,
  recorded_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id              INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE account_balances (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL,
  balance_pence INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'GBP',
  valid_from    DATE NOT NULL,
  valid_to      DATE,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id     INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE pension_values (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  value_pence INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'GBP',
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id   INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE mortgage_balance (
  id                   INTEGER PRIMARY KEY,
  mortgage_id          INTEGER NOT NULL REFERENCES mortgages(id),
  outstanding_pence    INTEGER NOT NULL,
  interest_rate_bps    INTEGER NOT NULL,
  property_value_pence INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'GBP',
  valid_from           DATE NOT NULL,
  valid_to             DATE,
  recorded_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id            INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE asset_values (
  id                   INTEGER PRIMARY KEY,
  asset_id             INTEGER NOT NULL REFERENCES assets(id),
  quantity             INTEGER NOT NULL,
  original_currency    TEXT NOT NULL,
  gbp_equivalent_pence INTEGER NOT NULL,
  valid_from           DATE NOT NULL,
  valid_to             DATE,
  recorded_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id            INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE person_profile (
  id            INTEGER PRIMARY KEY,
  employer_name TEXT NOT NULL,
  tax_code      TEXT NOT NULL,
  salary_pence  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'GBP',
  valid_from    DATE NOT NULL,
  valid_to      DATE,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id     INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE tax_periods (
  tax_year  TEXT PRIMARY KEY,
  starts_on DATE NOT NULL,
  ends_on   DATE NOT NULL
);
`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function readCatalog(): string {
  return fs.readFileSync(CATALOG_PATH, "utf-8");
}

function extractSql(text: string): string {
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

export async function generateSql(question: string): Promise<string> {
  const catalog = readCatalog();

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    temperature: 0,
    system: [
      {
        type: "text",
        text: "You are a SQL generator for a personal finance database. Given a schema and catalog, return a single valid DuckDB SQL query that answers the user's question. Return only the SQL — no explanation, no markdown prose outside the query itself.",
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `DDL:\n${DDL}\n\nSchema catalog:\n${catalog}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: question,
      },
    ],
  });

  const rawText =
    response.content.length > 0 && response.content[0].type === "text"
      ? response.content[0].text
      : "";

  return extractSql(rawText);
}

export async function queryNaturalLanguage(question: string): Promise<string> {
  const sql = await generateSql(question);

  let rows: Record<string, unknown>[];
  try {
    rows = await runQuery(sql);
  } catch (err) {
    return [
      `Generated SQL:\n${sql}`,
      ``,
      `Query error: ${err instanceof Error ? err.message : String(err)}`,
    ].join("\n");
  }

  const serialized = JSON.stringify(
    rows,
    (_, v) => (typeof v === "bigint" ? Number(v) : v),
    2,
  );

  return [
    `Generated SQL:\n${sql}`,
    ``,
    `Result (${rows.length} row${rows.length === 1 ? "" : "s"}):`,
    serialized,
  ].join("\n");
}
