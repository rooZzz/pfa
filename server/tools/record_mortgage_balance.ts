import { z } from "zod";
import { getKysely } from "../db.js";
import { writeManualDocument } from "../references.js";

export const recordMortgageBalanceSchema = {
  mortgage_id: z
    .number()
    .int()
    .positive()
    .describe("The mortgage ID returned by record_mortgage."),
  outstanding_pence: z
    .number()
    .int()
    .describe("Outstanding mortgage balance in pence (integer)."),
  interest_rate_bps: z
    .number()
    .int()
    .describe("Current interest rate in basis points. E.g. 4.5% = 450."),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Observation date, typically the statement date."),
};

export async function recordMortgageBalance(input: {
  mortgage_id: number;
  outstanding_pence: number;
  interest_rate_bps: number;
  currency: string;
  valid_from: string;
}): Promise<string> {
  const kysely = getKysely();

  const mortgage = await kysely
    .selectFrom("mortgages")
    .select(["id", "lender", "property"])
    .where("id", "=", input.mortgage_id)
    .executeTakeFirst();

  if (!mortgage) {
    throw new Error(
      `No mortgage with ID ${input.mortgage_id}. Record the mortgage first using record_mortgage.`,
    );
  }

  const sourceId = await kysely.transaction().execute(async (trx) => {
    const sourceId = await writeManualDocument(trx, {
      source_type: "manual",
      entry_type: "mortgage_balance",
      mortgage_id: input.mortgage_id,
      outstanding_pence: input.outstanding_pence,
      interest_rate_bps: input.interest_rate_bps,
      currency: input.currency,
      valid_from: input.valid_from,
    });

    await trx
      .insertInto("mortgage_balance")
      .values({
        mortgage_id: input.mortgage_id,
        outstanding_pence: input.outstanding_pence,
        interest_rate_bps: input.interest_rate_bps,
        currency: input.currency,
        valid_from: input.valid_from,
        source_id: sourceId,
      })
      .execute();

    return sourceId;
  });

  return [
    `Recorded mortgage balance for ${mortgage.lender} — ${mortgage.property}.`,
    `Outstanding: ${input.outstanding_pence} ${input.currency}, rate: ${input.interest_rate_bps} bps.`,
    `To record the property value, use record_asset_price against the property asset.`,
    `Mortgage ID: ${input.mortgage_id}, document ID: ${sourceId}.`,
  ].join(" ");
}
