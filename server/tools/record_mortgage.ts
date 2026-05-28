import { z } from "zod";
import { getKysely } from "../db.js";
import { writeManualDocument } from "../references.js";

export const recordMortgageSchema = {
  lender: z.string().describe("Lender name, e.g. 'Nationwide'."),
  property: z
    .string()
    .describe("Property address or identifier, e.g. '12 Acacia Avenue'."),
  original_amount_pence: z
    .number()
    .int()
    .describe(
      "Original loan amount in pence (integer). Never updated after registration.",
    ),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
};

export async function recordMortgage(input: {
  lender: string;
  property: string;
  original_amount_pence: number;
  currency: string;
}): Promise<string> {
  const { sourceId, mortgageId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "mortgage",
        lender: input.lender,
        property: input.property,
        original_amount_pence: input.original_amount_pence,
        currency: input.currency,
      });

      const row = await trx
        .insertInto("mortgages")
        .values({
          lender: input.lender,
          property: input.property,
          original_amount_pence: input.original_amount_pence,
          currency: input.currency,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return { sourceId, mortgageId: Number(row.id) };
    });

  return [
    `Registered mortgage: ${input.lender} — ${input.property}.`,
    `Original amount: ${input.original_amount_pence} ${input.currency}.`,
    `Mortgage ID: ${mortgageId}, document ID: ${sourceId}.`,
    `Use mortgage ID ${mortgageId} when recording balance snapshots.`,
  ].join(" ");
}
