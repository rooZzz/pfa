import { z } from "zod";
import { getKysely } from "../core/db.js";
import { ensureAccount, writeManualDocument } from "../core/references.js";

export const recordAccountBalanceSchema = {
  account_name: z
    .string()
    .describe("Human-readable account name, e.g. 'Barclays Current'."),
  account_type: z
    .enum(["current", "savings", "isa"])
    .describe("Account type: current, savings, or isa."),
  balance_pence: z.number().int().describe("Balance in pence (integer). No decimals."),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Observation date, typically the statement date."),
};

export async function recordAccountBalance(input: {
  account_name: string;
  account_type: "current" | "savings" | "isa";
  balance_pence: number;
  currency: string;
  valid_from: string;
}): Promise<string> {
  const { sourceId, accountId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "account_balance",
        account_name: input.account_name,
        account_type: input.account_type,
        balance_pence: input.balance_pence,
        currency: input.currency,
        valid_from: input.valid_from,
      });

      const accountId = await ensureAccount(
        trx,
        input.account_name,
        input.account_type,
        input.currency,
      );

      await trx
        .insertInto("account_balances")
        .values({
          account_id: accountId,
          balance_pence: input.balance_pence,
          currency: input.currency,
          valid_from: input.valid_from,
          source_id: sourceId,
        })
        .execute();

      return { sourceId, accountId };
    });

  return [
    `Recorded balance for ${input.account_name} (${input.account_type}).`,
    `Balance: ${input.balance_pence} ${input.currency} as of ${input.valid_from}.`,
    `Account ID: ${accountId}, document ID: ${sourceId}.`,
  ].join(" ");
}
