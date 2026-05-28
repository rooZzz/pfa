import { z } from "zod";
import { getDb } from "../db.js";
import { ensureAccount, writeManualDocument } from "../references.js";

export const recordPensionValueSchema = {
  account_name: z.string().describe("Name of the pension pot, e.g. 'Nest Pension'."),
  value_pence: z.number().int().describe("Pot value in pence (integer)."),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Statement date."),
};

export async function recordPensionValue(input: {
  account_name: string;
  value_pence: number;
  currency: string;
  valid_from: string;
}): Promise<string> {
  const db = getDb();

  const doInsert = db.transaction(() => {
    const sourceId = writeManualDocument(db, {
      source_type: "manual",
      entry_type: "pension_value",
      account_name: input.account_name,
      value_pence: input.value_pence,
      currency: input.currency,
      valid_from: input.valid_from,
    });

    const accountId = ensureAccount(db, input.account_name, "pension", input.currency);

    db.prepare(
      `INSERT INTO pension_values (account_id, value_pence, currency, valid_from, source_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(accountId, input.value_pence, input.currency, input.valid_from, sourceId);

    return { sourceId, accountId };
  });

  const { sourceId, accountId } = doInsert();

  return [
    `Recorded pension value for ${input.account_name}.`,
    `Value: ${input.value_pence} ${input.currency} as of ${input.valid_from}.`,
    `Account ID: ${accountId}, document ID: ${sourceId}.`,
  ].join(" ");
}
