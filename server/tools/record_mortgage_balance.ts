import { z } from "zod";
import { getDb } from "../db.js";
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
  property_value_pence: z
    .number()
    .int()
    .describe("Estimated property value in pence (integer)."),
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
  property_value_pence: number;
  currency: string;
  valid_from: string;
}): Promise<string> {
  const db = getDb();

  const mortgage = db
    .prepare("SELECT id, lender, property FROM mortgages WHERE id = ?")
    .get(input.mortgage_id) as { id: number; lender: string; property: string } | undefined;

  if (!mortgage) {
    throw new Error(
      `No mortgage with ID ${input.mortgage_id}. Record the mortgage first using record_mortgage.`,
    );
  }

  const doInsert = db.transaction(() => {
    const sourceId = writeManualDocument(db, {
      source_type: "manual",
      entry_type: "mortgage_balance",
      mortgage_id: input.mortgage_id,
      outstanding_pence: input.outstanding_pence,
      interest_rate_bps: input.interest_rate_bps,
      property_value_pence: input.property_value_pence,
      currency: input.currency,
      valid_from: input.valid_from,
    });

    db.prepare(
      `INSERT INTO mortgage_balance
         (mortgage_id, outstanding_pence, interest_rate_bps, property_value_pence, currency, valid_from, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.mortgage_id,
      input.outstanding_pence,
      input.interest_rate_bps,
      input.property_value_pence,
      input.currency,
      input.valid_from,
      sourceId,
    );

    return sourceId;
  });

  const sourceId = doInsert();

  const ltv = Math.round((input.outstanding_pence * 100) / input.property_value_pence);
  return [
    `Recorded mortgage balance for ${mortgage.lender} — ${mortgage.property}.`,
    `Outstanding: ${input.outstanding_pence} ${input.currency}, property value: ${input.property_value_pence} ${input.currency}, LTV: ${ltv}%.`,
    `Mortgage ID: ${input.mortgage_id}, document ID: ${sourceId}.`,
  ].join(" ");
}
