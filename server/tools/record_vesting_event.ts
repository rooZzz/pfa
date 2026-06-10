import { z } from "zod";
import { getKysely } from "../core/db.js";
import { writeManualDocument } from "../core/references.js";

export const recordVestingEventSchema = {
  grant_id: z
    .number()
    .int()
    .positive()
    .describe("The equity_grant ID returned when the grant was recorded."),
  vest_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe(
      "Date the units vest. May be in the future (a scheduled vest or option maturity date) or the past (a realised vest).",
    ),
  units_vested: z
    .number()
    .int()
    .positive()
    .describe("Number of units vesting on this date."),
  market_price_pence: z
    .number()
    .int()
    .optional()
    .describe(
      "Market price per unit at the vest date, for a past realised vest. Omit for a future vest — it is then valued from the latest recorded asset price. " +
        "Must be an integer number of pence — e.g. 2565 for a 2,565p / £25.65 share price. " +
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
  const kysely = getKysely();

  const grant = await kysely
    .selectFrom("equity_grant")
    .select(["id", "scheme_type", "units"])
    .where("id", "=", input.grant_id)
    .executeTakeFirst();

  if (!grant) {
    throw new Error(
      `No equity grant found with ID ${input.grant_id}. Record the grant first using record_equity_grant.`,
    );
  }

  const estimatedValuePence =
    input.market_price_pence != null
      ? input.units_vested * input.market_price_pence
      : null;

  const sourceId = await kysely.transaction().execute(async (trx) => {
    const sourceId = await writeManualDocument(trx, {
      source_type: "manual",
      entry_type: "vesting_event",
      grant_id: input.grant_id,
      vest_date: input.vest_date,
      units_vested: input.units_vested,
      market_price_pence: input.market_price_pence ?? null,
      estimated_value_pence: estimatedValuePence,
    });

    await trx
      .insertInto("equity_vesting_event")
      .values({
        grant_id: input.grant_id,
        vest_date: input.vest_date,
        units_vested: input.units_vested,
        market_price_pence: input.market_price_pence ?? null,
        estimated_value_pence: estimatedValuePence,
        occurred_at: new Date(input.vest_date + "T00:00:00.000Z").toISOString(),
        source_id: sourceId,
      })
      .execute();

    return sourceId;
  });

  const valuePart =
    estimatedValuePence != null ? `, estimated value: ${estimatedValuePence} pence` : "";

  return [
    `Recorded vesting event for grant ${input.grant_id} (${grant.scheme_type.toUpperCase()}).`,
    `${input.units_vested} units vested on ${input.vest_date}${valuePart}.`,
    `Document ID: ${sourceId}.`,
  ].join(" ");
}
