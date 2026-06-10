import type { Transaction } from "kysely";
import { getKysely } from "../core/db.js";
import type { DatabaseSchema } from "../core/schema.js";

export type ConnectorCredentials = {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
};

export type ConnectorState = ConnectorCredentials & {
  cursors: Record<string, string>;
  last_synced_at: string | null;
};

export async function readConnectorState(
  provider: string,
): Promise<ConnectorState | null> {
  const row = await getKysely()
    .selectFrom("connector_state")
    .selectAll()
    .where("provider", "=", provider)
    .executeTakeFirst();
  if (!row) return null;
  return {
    client_id: row.client_id,
    client_secret: row.client_secret,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expires_at: row.expires_at,
    cursors: JSON.parse(row.cursors_json) as Record<string, string>,
    last_synced_at: row.last_synced_at,
  };
}

export async function saveConnectorCredentials(
  provider: string,
  credentials: ConnectorCredentials,
): Promise<void> {
  await getKysely()
    .insertInto("connector_state")
    .values({ provider, ...credentials })
    .onConflict((oc) =>
      oc.column("provider").doUpdateSet({
        ...credentials,
        updated_at: new Date().toISOString(),
      }),
    )
    .execute();
}

export async function saveRefreshedTokens(
  provider: string,
  tokens: Pick<ConnectorCredentials, "access_token" | "refresh_token" | "expires_at">,
): Promise<void> {
  await getKysely()
    .updateTable("connector_state")
    .set({ ...tokens, updated_at: new Date().toISOString() })
    .where("provider", "=", provider)
    .execute();
}

export async function saveSyncState(
  trx: Transaction<DatabaseSchema>,
  provider: string,
  cursors: Record<string, string>,
  lastSyncedAt: string,
): Promise<void> {
  await trx
    .updateTable("connector_state")
    .set({
      cursors_json: JSON.stringify(cursors),
      last_synced_at: lastSyncedAt,
      updated_at: new Date().toISOString(),
    })
    .where("provider", "=", provider)
    .execute();
}
