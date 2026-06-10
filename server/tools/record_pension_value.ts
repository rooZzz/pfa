import { z } from "zod";
import { getKysely } from "../core/db.js";
import { ensureAccount, writeManualDocument } from "../core/references.js";

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
  const { sourceId, accountId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "pension_value",
        account_name: input.account_name,
        value_pence: input.value_pence,
        currency: input.currency,
        valid_from: input.valid_from,
      });

      const accountId = await ensureAccount(
        trx,
        input.account_name,
        "pension",
        input.currency,
      );

      await trx
        .insertInto("pension_values")
        .values({
          account_id: accountId,
          value_pence: input.value_pence,
          currency: input.currency,
          valid_from: input.valid_from,
          source_id: sourceId,
        })
        .execute();

      return { sourceId, accountId };
    });

  return [
    `Recorded pension value for ${input.account_name}.`,
    `Value: ${input.value_pence} ${input.currency} as of ${input.valid_from}.`,
    `Account ID: ${accountId}, document ID: ${sourceId}.`,
  ].join(" ");
}
