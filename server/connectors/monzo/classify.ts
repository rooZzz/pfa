import type { AccountType } from "../../schema.js";
import type { MonzoPot, MonzoTransaction } from "./client.js";

export function classifyInternal(
  transaction: MonzoTransaction,
  ownExternalIds: Set<string>,
): boolean {
  if (transaction.scheme === "uk_retail_pot") return true;

  const metadata = transaction.metadata ?? {};
  if (typeof metadata.pot_id === "string") return true;
  if (typeof metadata.pot_account_id === "string") return true;

  const counterpartyAccount = transaction.counterparty?.account_id;
  if (counterpartyAccount && ownExternalIds.has(counterpartyAccount)) return true;

  return false;
}

export function classifyPotType(pot: MonzoPot): AccountType {
  const haystack = `${pot.type ?? ""} ${pot.product ?? ""} ${pot.name}`.toLowerCase();
  return haystack.includes("isa") ? "isa" : "savings";
}

export function normalizeCategory(category?: string): string {
  if (!category) return "general";
  return category;
}
