import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DOCUMENTS_DIR, getDb } from "../db.js";

export const ingestManualEntrySchema = {
  account_id: z.number().int().positive(),
  balance_pence: z.number().int(),
  currency: z.string().default("GBP"),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  description: z.string().optional(),
};

export async function ingestManualEntry(input: {
  account_id: number;
  balance_pence: number;
  currency: string;
  valid_from: string;
  description?: string;
}): Promise<string> {
  const recorded_at = new Date().toISOString();

  const payload = {
    source_type: "manual",
    account_id: input.account_id,
    balance_pence: input.balance_pence,
    currency: input.currency,
    valid_from: input.valid_from,
    description: input.description ?? null,
    recorded_at,
  };

  const json = JSON.stringify(payload, null, 2);
  const safeTimestamp = recorded_at.replace(/:/g, "-");
  const filename = `manual_${safeTimestamp}.json`;
  const filePath = path.join(DOCUMENTS_DIR, filename);

  const contentHash = crypto.createHash("sha256").update(json).digest("hex");

  const db = getDb();

  const insertDoc = db.prepare(`
    INSERT INTO documents (source_type, file_path, content_hash)
    VALUES ('manual', ?, ?)
  `);

  const insertBalance = db.prepare(`
    INSERT INTO account_balances (account_id, balance_pence, currency, valid_from, source_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const doInsert = db.transaction(() => {
    const docResult = insertDoc.run(filePath, contentHash);
    const sourceId = docResult.lastInsertRowid;
    insertBalance.run(
      input.account_id,
      input.balance_pence,
      input.currency,
      input.valid_from,
      sourceId,
    );
    fs.writeFileSync(filePath, json, "utf-8");
    return sourceId;
  });

  const sourceId = doInsert();

  return [
    `Recorded balance for account ${input.account_id}.`,
    `Balance: ${input.balance_pence} ${input.currency} as of ${input.valid_from}.`,
    `Document ID: ${sourceId}, file: ${filename}.`,
  ].join(" ");
}
