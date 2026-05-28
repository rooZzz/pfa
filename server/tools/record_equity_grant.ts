import { z } from "zod";
import { getDb } from "../db.js";
import { writeManualDocument } from "../references.js";

export const recordEquityGrantSchema = {
  scheme_type: z
    .enum(["rsu", "emi", "unapproved", "saye"])
    .describe("Equity scheme type: rsu, emi, unapproved, or saye."),
  units: z.number().int().positive().describe("Total units granted."),
  strike_pence: z
    .number()
    .int()
    .optional()
    .describe("Strike / exercise price per unit in pence. Omit for RSUs."),
  grant_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Grant date."),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
  current_price_pence: z
    .number()
    .int()
    .optional()
    .describe(
      "Current market price per share in pence, used as placeholder for contingent valuation.",
    ),
};

export async function recordEquityGrant(input: {
  scheme_type: "rsu" | "emi" | "unapproved" | "saye";
  units: number;
  strike_pence?: number;
  grant_date: string;
  currency: string;
  current_price_pence?: number;
}): Promise<string> {
  const db = getDb();

  const grantPayload = {
    current_price_pence: input.current_price_pence ?? null,
  };

  const doInsert = db.transaction(() => {
    const sourceId = writeManualDocument(db, {
      source_type: "manual",
      entry_type: "equity_grant",
      scheme_type: input.scheme_type,
      units: input.units,
      strike_pence: input.strike_pence ?? null,
      grant_date: input.grant_date,
      currency: input.currency,
      current_price_pence: input.current_price_pence ?? null,
    });

    const result = db
      .prepare(
        `INSERT INTO equity_grant (scheme_type, units, strike_pence, grant_date, currency, source_id, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.scheme_type,
        input.units,
        input.strike_pence ?? null,
        input.grant_date,
        input.currency,
        sourceId,
        JSON.stringify(grantPayload),
      );

    return { sourceId, grantId: Number(result.lastInsertRowid) };
  });

  const { sourceId, grantId } = doInsert();

  return [
    `Recorded ${input.scheme_type.toUpperCase()} equity grant of ${input.units} units on ${input.grant_date}.`,
    `Grant ID: ${grantId}, document ID: ${sourceId}.`,
    `Use grant ID ${grantId} when recording vesting events.`,
  ].join(" ");
}
