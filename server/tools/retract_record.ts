import { z } from "zod";
import type { RetractableSeries } from "../core/corrections.js";
import { retractableSeriesNames, retractRecord } from "../core/corrections.js";

export const retractRecordSchema = {
  series: z
    .enum(retractableSeriesNames)
    .describe(
      "Which committed series the row to remove belongs to. The editable series plus equity_grant (retracting a grant also retracts its dependent vesting events).",
    ),
  row_id: z
    .number()
    .int()
    .describe(
      "The id of the exact row to remove. Locate it first with query_natural_language and confirm it with the user.",
    ),
  reason: z
    .string()
    .describe(
      "Why this fact should not exist at all, in the user's own words. Stored as audit provenance.",
    ),
};

export async function retractRecordTool(input: {
  series: RetractableSeries;
  row_id: number;
  reason: string;
}): Promise<string> {
  return retractRecord(input);
}
