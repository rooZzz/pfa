import { z } from "zod";
import { getBriefing } from "../goals/briefing.js";

export const getBriefingSchema = {
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional()
    .describe("Date to evaluate goals as of. Defaults to today."),
};

export async function getBriefingTool(input: { as_of?: string }): Promise<string> {
  const asOf = input.as_of ?? new Date().toISOString().split("T")[0]!;
  const briefing = await getBriefing(asOf);
  return JSON.stringify(briefing);
}
