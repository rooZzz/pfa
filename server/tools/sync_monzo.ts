import { runMonzoSync } from "../connectors/monzo/sync.js";

export async function syncMonzo(): Promise<string> {
  const result = await runMonzoSync({ backfill: false });
  return [
    `Synced Monzo: ${result.transactions_inserted} new transaction(s) of ${result.transactions_seen} seen`,
    `across ${result.accounts} account(s) and ${result.pots} pot(s).`,
    "Balances updated to today.",
  ].join(" ");
}
