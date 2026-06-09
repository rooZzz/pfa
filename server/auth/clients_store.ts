import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { getDb } from "../db.js";
import { nowSec, randomToken } from "./util.js";

type ClientRow = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: string | null;
  grant_types: string | null;
  response_types: string | null;
  scope: string | null;
  created_at: number;
};

function rowToClient(row: ClientRow): OAuthClientInformationFull {
  return {
    client_id: row.client_id,
    client_name: row.client_name ?? undefined,
    redirect_uris: JSON.parse(row.redirect_uris),
    token_endpoint_auth_method: row.token_endpoint_auth_method ?? undefined,
    grant_types: row.grant_types ? JSON.parse(row.grant_types) : undefined,
    response_types: row.response_types ? JSON.parse(row.response_types) : undefined,
    scope: row.scope ?? undefined,
    client_id_issued_at: row.created_at,
  } as OAuthClientInformationFull;
}

export const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = getDb()
      .prepare("SELECT * FROM oauth_client WHERE client_id = ? AND disabled = 0")
      .get(clientId) as ClientRow | undefined;
    return row ? rowToClient(row) : undefined;
  },
  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const clientId = randomToken();
    const created = nowSec();
    getDb()
      .prepare(
        `INSERT INTO oauth_client
         (client_id, client_name, redirect_uris, token_endpoint_auth_method,
          grant_types, response_types, scope, created_at, disabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        clientId,
        client.client_name ?? null,
        JSON.stringify(client.redirect_uris ?? []),
        client.token_endpoint_auth_method ?? "none",
        client.grant_types ? JSON.stringify(client.grant_types) : null,
        client.response_types ? JSON.stringify(client.response_types) : null,
        client.scope ?? null,
        created,
      );
    return {
      ...client,
      client_id: clientId,
      client_id_issued_at: created,
    } as OAuthClientInformationFull;
  },
};
