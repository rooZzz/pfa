import { z } from "zod";
import { getKysely } from "../db.js";
import { tryPriceOnCapture } from "../connectors/prices/sync.js";
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
      "Trading symbol for the underlying share, REQUIRED whenever underlying_asset_name is supplied: it is the asset's identity, so an RSU and a SAYE over the same share share one price series. Use the canonical symbol ('EXPN' for Experian), not the exchange-suffixed form. Map the company to its symbol only when confident; if unsure or more than one listing is plausible, ask the user before calling rather than guessing.",
    ),
  monthly_contribution_pence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "SAYE only, REQUIRED for saye: the fixed monthly savings amount in integer pence (e.g. 15000 for £150). Drives the savings floor — at maturity an underwater SAYE returns the full pot of contributions rather than being worth nothing. Omit for rsu, emi, and unapproved.",
    ),
};

export async function recordEquityGrant(
  input: {
    scheme_type: "rsu" | "emi" | "unapproved" | "saye";
    units: number;
    strike_pence?: number;
    grant_date: string;
    currency: string;
    underlying_asset_name?: string;
    underlying_asset_type?: string;
    ticker?: string;
    monthly_contribution_pence?: number;
  },
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (input.underlying_asset_name && !input.ticker?.trim()) {
    throw new Error(
      "A ticker is required when linking an underlying share — it is the asset's identity, shared across every grant over the same share. Supply the trading symbol (e.g. 'EXPN' for Experian).",
    );
  }
  if (input.scheme_type === "saye" && input.monthly_contribution_pence == null) {
    throw new Error(
      "monthly_contribution_pence is required for SAYE grants: it is the fixed monthly savings amount in pence, used to compute the savings floor returned at maturity.",
    );
  }
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
        ticker: input.ticker ?? null,
        monthly_contribution_pence: input.monthly_contribution_pence ?? null,
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
          monthly_contribution_pence: input.monthly_contribution_pence ?? null,
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
    const manualPriceHint =
      "Use record_asset_price to record a price for unvested-unit valuation.";
    let assetLine = `Linked to underlying asset ID: ${assetId} (${input.underlying_asset_name}).`;
    if (fetchImpl) {
      const priced = await tryPriceOnCapture(assetId, fetchImpl);
      assetLine += ` ${priced.note || manualPriceHint}`;
    } else {
      assetLine += ` ${manualPriceHint}`;
    }
    lines.push(assetLine);
  } else {
    lines.push(
      `No underlying asset linked — unvested unit valuation will be unavailable. Re-record with underlying_asset_name to enable mark-to-market.`,
    );
  }
  lines.push(
    `Vest dates are not stored on the grant. Record each one — including future maturity dates — with record_vesting_event using grant ID ${grantId}.`,
  );

  return lines.join(" ");
}
