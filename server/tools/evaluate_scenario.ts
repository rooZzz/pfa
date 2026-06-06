import { z } from "zod";
import { getBriefing } from "../goals/briefing.js";
import { type Overlay, runQuery, setupScenario, teardownScenario } from "../query.js";
import { toNum } from "../sql_util.js";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const evaluateScenarioSchema = {
  as_of: dateString
    .optional()
    .describe("Date to evaluate the scenario as of. Defaults to today."),
  overlay: z
    .object({
      balances: z
        .array(
          z.object({
            account_id: z.number().int(),
            balance_pence: z.number().int(),
            valid_from: dateString,
          }),
        )
        .optional()
        .describe(
          "Hypothetical account balance snapshots. Each wins as the latest balance for its account from valid_from.",
        ),
      transactions: z
        .array(
          z.object({
            account_id: z.number().int(),
            amount_pence: z
              .number()
              .int()
              .describe("Positive for a credit, negative for a debit."),
            occurred_at: dateString,
            category: z.string().optional(),
            is_internal: z.boolean().optional(),
          }),
        )
        .optional()
        .describe("Hypothetical transactions (credits or debits)."),
      income_events: z
        .array(
          z.object({
            pay_date: dateString,
            gross_pence: z.number().int(),
            paye_pence: z.number().int().optional(),
            ni_employee_pence: z.number().int().optional(),
            pension_employee_pence: z.number().int().optional(),
            tax_code: z.string().optional(),
          }),
        )
        .optional()
        .describe(
          "Hypothetical payroll income (a bonus or one-off). Flows through earnings and the tax position.",
        ),
    })
    .describe(
      "Hypothetical rows layered over the real data. A real event is expressed as the rows it produces: a bonus into the ISA is both a positive transaction to the ISA account and a balance bump.",
    ),
};

async function assertAccountsExist(overlay: Overlay): Promise<void> {
  const ids = new Set<number>();
  for (const balance of overlay.balances ?? []) ids.add(balance.account_id);
  for (const txn of overlay.transactions ?? []) ids.add(txn.account_id);
  if (ids.size === 0) return;

  const idList = [...ids];
  const placeholders = idList.map(() => "?").join(", ");
  const rows = await runQuery(
    `SELECT id FROM pfa.accounts WHERE id IN (${placeholders})`,
    idList,
  );
  const found = new Set(rows.map((r) => toNum(r.id)));
  const missing = idList.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Unknown account_id(s) in overlay: ${missing.join(", ")}. Reference existing accounts only.`,
    );
  }
}

export async function evaluateScenario(input: {
  as_of?: string;
  overlay: Overlay;
}): Promise<string> {
  const asOf = input.as_of ?? new Date().toISOString().split("T")[0]!;
  await assertAccountsExist(input.overlay);

  try {
    const ctx = await setupScenario(input.overlay);
    const briefing = await getBriefing(asOf, ctx);
    return JSON.stringify(briefing);
  } finally {
    await teardownScenario();
  }
}
