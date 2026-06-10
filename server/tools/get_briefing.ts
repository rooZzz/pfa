import { z } from "zod";
import { ensureFresh, type EnsureFreshDeps } from "../freshness.js";
import { getBriefing } from "../goals/briefing.js";

export const getBriefingSchema = {
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional()
    .describe("Date to evaluate goals as of. Defaults to today."),
  auto_refresh: z
    .boolean()
    .optional()
    .describe(
      "Refresh stale connector data (bank, prices, on-chain) before computing. Defaults to true; pass false to read last-known values without syncing.",
    ),
};

export async function getBriefingTool(
  input: { as_of?: string; auto_refresh?: boolean },
  deps?: EnsureFreshDeps,
): Promise<string> {
  if (input.auto_refresh !== false) await ensureFresh(undefined, deps);
  const asOf = input.as_of ?? new Date().toISOString().split("T")[0]!;
  const briefing = await getBriefing(asOf);
  return JSON.stringify(briefing);
}
