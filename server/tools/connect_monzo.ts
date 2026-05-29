import { z } from "zod";
import { createMonzoClient } from "../connectors/monzo/client.js";
import { runMonzoSync } from "../connectors/monzo/sync.js";
import { saveConnectorCredentials } from "../connectors/state.js";

export const connectMonzoSchema = {
  access_token: z
    .string()
    .describe("Monzo access token. A playground token alone is enough for a first sync."),
  client_id: z
    .string()
    .optional()
    .describe("Monzo OAuth client ID. Required only for automatic token renewal."),
  client_secret: z
    .string()
    .optional()
    .describe("Monzo OAuth client secret. Required only for automatic token renewal."),
  refresh_token: z
    .string()
    .optional()
    .describe(
      "Monzo refresh token. Supply it to auto-renew; without it, re-run Connect when the token expires.",
    ),
};

export async function connectMonzo(input: {
  access_token: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
}): Promise<string> {
  await saveConnectorCredentials("monzo", {
    client_id: input.client_id ?? "",
    client_secret: input.client_secret ?? "",
    access_token: input.access_token,
    refresh_token: input.refresh_token ?? "",
    expires_at: null,
  });

  const client = createMonzoClient({ provider: "monzo" });
  const accounts = await client.listAccounts();
  const result = await runMonzoSync({ backfill: true, client });

  const renewalNote = input.refresh_token
    ? "The access token will renew automatically; Monzo still requires full re-authorization every 90 days."
    : "No refresh token supplied, so when the access token expires (a few hours) syncs will fail until you run Connect again with a fresh token.";

  const fromNote = result.earliest_occurred_at
    ? ` from ${result.earliest_occurred_at.slice(0, 10)}`
    : "";

  return [
    `Connected Monzo. Discovered ${accounts.length} account(s).`,
    `Backfilled ${result.transactions_inserted} transaction(s)${fromNote} across ${result.accounts} account(s) and ${result.pots} pot(s).`,
    renewalNote,
  ].join(" ");
}
