import { z } from "zod";
import { ensureFresh, type EnsureFreshDeps } from "../freshness_refresh.js";
import { getNetWorth } from "../net_worth/index.js";

export const getNetWorthSchema = {
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date to compute net worth as of. Defaults to today.")
    .optional(),
  auto_refresh: z
    .boolean()
    .optional()
    .describe(
      "Refresh stale connector data (bank, prices, on-chain) before computing. Defaults to true; pass false to read last-known values without syncing.",
    ),
};

export async function getNetWorthTool(
  input: { as_of?: string; auto_refresh?: boolean },
  deps?: EnsureFreshDeps,
): Promise<string> {
  if (input.auto_refresh !== false) await ensureFresh(undefined, deps);
  const date = input.as_of ?? new Date().toISOString().split("T")[0]!;
  return JSON.stringify(await getNetWorth(date));
}
