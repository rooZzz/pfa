import { z } from "zod";
import { getKysely } from "../db.js";
import { ensureAccount, writeManualDocument } from "../references.js";

export const recordTransactionSchema = {
  account_name: z.string().describe("Human-readable account name, e.g. 'Barclays Current'."),
  account_type: z
    .enum(["current", "savings", "isa"])
    .describe("Account type: current, savings, or isa."),
  amount_pence: z
    .number()
    .int()
    .describe(
      "Amount in pence. Positive = money in (credit). Negative = money out (debit). Never a float.",
    ),
  category: z
    .string()
    .default("general")
    .describe(
      "Spending category. Use Monzo vocabulary: general, eating_out, expenses, transport, cash, bills, entertainment, shopping, holidays, groceries. Use 'income' for non-salary inflows such as freelance payments or interest. Do not use 'income' for payslip salary — salary is recorded via payslip ingestion, not this tool.",
    ),
  description: z.string().optional().describe("Free-text description, e.g. merchant name."),
  occurred_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date the transaction occurred, typically the statement date."),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
};

export async function recordTransaction(input: {
  account_name: string;
  account_type: "current" | "savings" | "isa";
  amount_pence: number;
  category: string;
  description?: string;
  occurred_at: string;
  currency: string;
}): Promise<string> {
  const { sourceId, transactionId } = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "transaction",
        account_name: input.account_name,
        account_type: input.account_type,
        amount_pence: input.amount_pence,
        category: input.category,
        description: input.description ?? null,
        occurred_at: input.occurred_at,
        currency: input.currency,
      });

      const accountId = await ensureAccount(
        trx,
        input.account_name,
        input.account_type,
        input.currency,
      );

      const row = await trx
        .insertInto("transactions")
        .values({
          account_id: accountId,
          occurred_at: input.occurred_at,
          amount_pence: input.amount_pence,
          currency: input.currency,
          description: input.description ?? null,
          category: input.category,
          source_id: sourceId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return { sourceId, transactionId: Number(row.id) };
    });

  const direction = input.amount_pence >= 0 ? "inflow" : "outflow";
  const absAmount = Math.abs(input.amount_pence);
  return [
    `Recorded ${direction} transaction for ${input.account_name}.`,
    `Amount: ${absAmount} ${input.currency} ${input.amount_pence >= 0 ? "in" : "out"} (${input.category}) on ${input.occurred_at}.`,
    `Transaction ID: ${transactionId}, document ID: ${sourceId}.`,
  ].join(" ");
}
