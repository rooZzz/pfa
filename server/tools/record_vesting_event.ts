import { z } from "zod";
import { getDb } from "../db.js";
import { writeManualDocument } from "../references.js";

export const recordVestingEventSchema = {
  grant_id: z
    .number()
    .int()
    .positive()
    .describe("The equity_grant ID returned when the grant was recorded."),
  vest_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date units vested."),
  units_vested: z.number().int().positive().describe("Number of units that vested."),
  market_price_pence: z
    .number()
    .int()
    .optional()
    .describe(
      "Market price per unit at vesting date. Must be an integer number of pence — e.g. 2565 for a 2,565p / £25.65 share price. " +
      "UK prices are commonly quoted in pence (e.g. '2,565p', '2565p'): use that number directly, do NOT multiply by 100. " +
      "Only convert if the price was given in pounds: £25.65 → 2565.",
    ),
};

export async function recordVestingEvent(input: {
  grant_id: number;
  vest_date: string;
  units_vested: number;
  market_price_pence?: number;
}): Promise<string> {
  const db = getDb();

  const grant = db
    .prepare("SELECT id, scheme_type, units FROM equity_grant WHERE id = ?")
    .get(input.grant_id) as { id: number; scheme_type: string; units: number } | undefined;

  if (!grant) {
    throw new Error(
      `No equity grant found with ID ${input.grant_id}. Record the grant first using record_equity_grant.`,
    );
  }

  const estimatedValuePence =
    input.market_price_pence != null
      ? input.units_vested * input.market_price_pence
      : null;

  const doInsert = db.transaction(() => {
    const sourceId = writeManualDocument(db, {
      source_type: "manual",
      entry_type: "vesting_event",
      grant_id: input.grant_id,
      vest_date: input.vest_date,
      units_vested: input.units_vested,
      market_price_pence: input.market_price_pence ?? null,
      estimated_value_pence: estimatedValuePence,
    });

    db.prepare(
      `INSERT INTO equity_vesting_event
         (grant_id, vest_date, units_vested, market_price_pence, estimated_value_pence, occurred_at, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.grant_id,
      input.vest_date,
      input.units_vested,
      input.market_price_pence ?? null,
      estimatedValuePence,
      new Date(input.vest_date + "T00:00:00.000Z").toISOString(),
      sourceId,
    );

    return sourceId;
  });

  const sourceId = doInsert();

  const valuePart =
    estimatedValuePence != null
      ? `, estimated value: ${estimatedValuePence} pence`
      : "";

  return [
    `Recorded vesting event for grant ${input.grant_id} (${grant.scheme_type.toUpperCase()}).`,
    `${input.units_vested} units vested on ${input.vest_date}${valuePart}.`,
    `Document ID: ${sourceId}.`,
  ].join(" ");
}
