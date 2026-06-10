import { z } from "zod";
import { ensureFresh, type DataClass } from "../core/freshness.js";

export const refreshStaleDataSchema = {
  classes: z
    .array(z.enum(["monzo", "prices", "ethereum"]))
    .optional()
    .describe(
      "Data classes to refresh if past their freshness TTL. Defaults to all connected classes.",
    ),
};

export async function refreshStaleData(input: {
  classes?: DataClass[];
}): Promise<string> {
  return JSON.stringify(await ensureFresh(input.classes));
}
