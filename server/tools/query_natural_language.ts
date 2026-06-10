import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { getProductSchemaSql, runProductQuery } from "../query/nlq_query.js";

const CATALOG_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "schema_catalog.md",
);

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
  const ddl = getProductSchemaSql();

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
        text: `DDL:\n${ddl}\n\nSchema catalog:\n${catalog}`,
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
    rows = await runProductQuery(sql);
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
