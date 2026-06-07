import { getKysely } from "../../db.js";
import { saveConnectorCredentials } from "../state.js";

export const ETHEREUM_PROVIDER = "ethereum";

export type EthereumSelection = {
  kind: "native" | "token";
  symbol: string;
  name: string;
  contract_address: string | null;
  decimals: number;
};

export type EthereumState = {
  address: string;
  selections: EthereumSelection[];
  last_synced_at: string | null;
};

function parseSelections(cursorsJson: string): EthereumSelection[] {
  try {
    const parsed = JSON.parse(cursorsJson);
    return Array.isArray(parsed) ? (parsed as EthereumSelection[]) : [];
  } catch {
    return [];
  }
}

export async function readEthereumState(): Promise<EthereumState | null> {
  const row = await getKysely()
    .selectFrom("connector_state")
    .selectAll()
    .where("provider", "=", ETHEREUM_PROVIDER)
    .executeTakeFirst();
  if (!row) return null;
  return {
    address: row.client_id,
    selections: parseSelections(row.cursors_json),
    last_synced_at: row.last_synced_at,
  };
}

export async function saveEthereumWallet(address: string): Promise<void> {
  await saveConnectorCredentials(ETHEREUM_PROVIDER, {
    client_id: address,
    client_secret: "",
    access_token: "",
    refresh_token: "",
    expires_at: null,
  });
}

export async function saveEthereumSelections(
  selections: EthereumSelection[],
): Promise<void> {
  await getKysely()
    .updateTable("connector_state")
    .set({
      cursors_json: JSON.stringify(selections),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .where("provider", "=", ETHEREUM_PROVIDER)
    .execute();
}
