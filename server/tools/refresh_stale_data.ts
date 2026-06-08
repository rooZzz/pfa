import { z } from "zod";
import type { DataClass } from "../freshness.js";
import { ensureFresh } from "../freshness_refresh.js";

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
