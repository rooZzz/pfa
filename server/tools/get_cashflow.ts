import { z } from "zod";
import { getCashflow } from "../cashflow/index.js";
import { ensureFresh, type EnsureFreshDeps } from "../freshness.js";

export const getCashflowSchema = {
  tax_year: z
    .string()
    .regex(/^\d{4}\/\d{2}$/, "Expected YYYY/YY e.g. 2025/26")
    .optional()
    .describe("UK tax year to query. Defaults to the year covering today."),
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional()
    .describe(
      "Limit data to this date. Defaults to today (or period end if year is complete).",
    ),
  auto_refresh: z
    .boolean()
    .optional()
    .describe(
      "Refresh stale bank-feed data before computing. Defaults to true; pass false to read last-known values without syncing.",
    ),
};

export async function getCashflowTool(
  input: { tax_year?: string; as_of?: string; auto_refresh?: boolean },
  deps?: EnsureFreshDeps,
): Promise<string> {
  if (input.auto_refresh !== false) await ensureFresh(["monzo"], deps);
  return JSON.stringify(
    await getCashflow({ tax_year: input.tax_year, as_of: input.as_of }),
  );
}
