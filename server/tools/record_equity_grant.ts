import { z } from "zod";
import { getKysely } from "../db.js";
import { ensureAsset, writeManualDocument } from "../references.js";

export const recordEquityGrantSchema = {
  scheme_type: z
    .enum(["rsu", "emi", "unapproved", "saye"])
    .describe("Equity scheme type: rsu, emi, unapproved, or saye."),
  units: z.number().int().positive().describe("Total units granted."),
  strike_pence: z
    .number()
    .int()
    .optional()
    .describe(
      "Strike / exercise price per unit. Must be an integer number of pence — e.g. 50 for 50p, 1200 for £12.00. " +
        "UK prices are often quoted in pence already (e.g. '1200p'): use that number directly, do NOT multiply by 100. " +
        "Omit for RSUs.",
    ),
  grant_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Grant date."),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
  underlying_asset_name: z
    .string()
    .optional()
    .describe(
      "Name of the underlying share asset, e.g. 'ACME Corp'. Used to link the grant to asset_prices for mark-to-market valuation of unvested units.",
    ),
  underlying_asset_type: z
    .string()
    .optional()
    .describe(
      "Asset type for the underlying share, e.g. 'stock'. Required if underlying_asset_name is provided.",
    ),
  ticker: z
    .string()
    .optional()
    .describe(
      "Ticker / trading symbol for the underlying share, e.g. 'ACME'. Shown as the identifier in the upcoming-vests view.",
    ),
};

export async function recordEquityGrant(input: {
  scheme_type: "rsu" | "emi" | "unapproved" | "saye";
  units: number;
  strike_pence?: number;
  grant_date: string;
  currency: string;
  underlying_asset_name?: string;
  underlying_asset_type?: string;
  ticker?: string;
}): Promise<string> {
  const { sourceId, grantId, assetId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "equity_grant",
        scheme_type: input.scheme_type,
        units: input.units,
        strike_pence: input.strike_pence ?? null,
        grant_date: input.grant_date,
        currency: input.currency,
        underlying_asset_name: input.underlying_asset_name ?? null,
      });

      let assetId: number | null = null;
      if (input.underlying_asset_name) {
        const assetType = input.underlying_asset_type ?? "stock";
        assetId = await ensureAsset(
          trx,
          input.underlying_asset_name,
          assetType,
          input.currency,
          input.ticker,
        );
      }

      const row = await trx
        .insertInto("equity_grant")
        .values({
          scheme_type: input.scheme_type,
          units: input.units,
          strike_pence: input.strike_pence ?? null,
          grant_date: input.grant_date,
          currency: input.currency,
          asset_id: assetId,
          source_id: sourceId,
          payload: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return { sourceId, grantId: Number(row.id), assetId };
    });

  const lines = [
    `Recorded ${input.scheme_type.toUpperCase()} equity grant of ${input.units} units on ${input.grant_date}.`,
    `Grant ID: ${grantId}, document ID: ${sourceId}.`,
  ];
  if (assetId != null) {
    lines.push(
      `Linked to underlying asset ID: ${assetId} (${input.underlying_asset_name}). Use record_asset_price to record a price for unvested-unit valuation.`,
    );
  } else {
    lines.push(
      `No underlying asset linked — unvested unit valuation will be unavailable. Re-record with underlying_asset_name to enable mark-to-market.`,
    );
  }
  lines.push(`Use grant ID ${grantId} when recording vesting events.`);

  return lines.join(" ");
}
