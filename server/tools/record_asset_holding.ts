import { z } from "zod";
import { getKysely } from "../core/db.js";
import { tryPriceOnCapture } from "../connectors/prices/sync.js";
import {
  ensureAsset,
  quantityScaleForAssetType,
  requiresTicker,
  writeManualDocument,
} from "../core/references.js";

export const recordAssetHoldingSchema = {
  asset_name: z.string().describe("Asset name, e.g. 'ETH', 'Vanguard FTSE All-World'."),
  asset_type: z
    .string()
    .describe("Asset type, e.g. 'crypto', 'etf', 'stock', 'property', 'other'."),
  base_currency: z
    .string()
    .describe("Native currency of the asset, e.g. 'ETH', 'USD', 'GBP'."),
  ticker: z
    .string()
    .optional()
    .describe(
      "Trading symbol, REQUIRED for stock, etf, and crypto: it is the asset's identity, so the same holding always lands on one asset with one price series. Use the canonical symbol — 'EXPN' for Experian, 'BTC' for Bitcoin — not the exchange-suffixed form. Map the company or coin to its symbol only when you are confident; if you cannot, or more than one listing is plausible (e.g. a London listing vs a US ADR), ask the user for the symbol before calling rather than guessing. Omit only for property and other.",
    ),
  quantity: z
    .number()
    .positive()
    .describe(
      "The natural quantity held, in the asset's own units: e.g. 1.5 for 1.5 ETH, 320 for 320 shares, 1 for property. Crypto may be fractional and is recorded to 8 decimal places; stocks, ETFs, property, and other are recorded as whole units. Do not pre-scale to sub-units — pass the real amount.",
    ),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date the holding became effective."),
};

export async function recordAssetHolding(
  input: {
    asset_name: string;
    asset_type: string;
    base_currency: string;
    ticker?: string;
    quantity: number;
    valid_from: string;
  },
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (requiresTicker(input.asset_type) && !input.ticker?.trim()) {
    throw new Error(
      `A ticker is required for ${input.asset_type} assets — it is the asset's identity. Supply the trading symbol (e.g. 'EXPN' for Experian) so the holding links to one canonical asset.`,
    );
  }

  const scale = quantityScaleForAssetType(input.asset_type);
  if (scale === 1 && !Number.isInteger(input.quantity)) {
    throw new Error(
      `Fractional quantities are not supported for ${input.asset_type} holdings; record a whole number of units.`,
    );
  }
  const scaledQuantity = Math.round(input.quantity * scale);
  if (scaledQuantity <= 0 || scaledQuantity > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Quantity ${input.quantity} is outside the supported range for a ${input.asset_type} holding.`,
    );
  }

  const { sourceId, assetId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "asset_holding",
        asset_name: input.asset_name,
        asset_type: input.asset_type,
        base_currency: input.base_currency,
        ticker: input.ticker ?? null,
        quantity: input.quantity,
        valid_from: input.valid_from,
      });

      const assetId = await ensureAsset(
        trx,
        input.asset_name,
        input.asset_type,
        input.base_currency,
        input.ticker,
      );

      await trx
        .insertInto("holdings")
        .values({
          asset_id: assetId,
          quantity: scaledQuantity,
          valid_from: input.valid_from,
          source_id: sourceId,
        })
        .execute();

      return { sourceId, assetId };
    });

  const lines = [
    `Recorded holding for ${input.asset_name} (${input.asset_type}): quantity ${input.quantity} as of ${input.valid_from}.`,
    `Asset ID: ${assetId}, document ID: ${sourceId}.`,
  ];
  const manualPriceHint =
    "Use record_asset_price to record the per-unit price for valuation.";
  if (fetchImpl) {
    const priced = await tryPriceOnCapture(assetId, fetchImpl);
    lines.push(priced.note || manualPriceHint);
  } else {
    lines.push(manualPriceHint);
  }
  return lines.join(" ");
}
