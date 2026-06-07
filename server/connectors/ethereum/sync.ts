import type { Transaction } from "kysely";
import { getKysely } from "../../db.js";
import { CRYPTO_QUANTITY_SCALE, ensureAsset } from "../../references.js";
import type { DatabaseSchema } from "../../schema.js";
import { tryPriceOnCapture } from "../prices/sync.js";
import { writeConnectorDocument } from "../references.js";
import { createEtherscanClient, type EtherscanClient } from "./client.js";
import { etherscanApiKey } from "./config.js";
import { EthereumConnectorError } from "./errors.js";
import { toScaledQuantity } from "./normalize.js";
import { ETHEREUM_PROVIDER, readEthereumState, type EthereumSelection } from "./state.js";

export type EthereumSyncResult = {
  address: string;
  assets_synced: number;
  priced: number;
};

async function ensureSelectionAsset(
  trx: Transaction<DatabaseSchema>,
  selection: EthereumSelection,
): Promise<number> {
  const assetId = await ensureAsset(
    trx,
    selection.symbol,
    "crypto",
    selection.symbol,
    selection.symbol,
    selection.contract_address
      ? { contract_address: selection.contract_address }
      : undefined,
  );
  await trx
    .updateTable("assets")
    .set({ quantity_scale: CRYPTO_QUANTITY_SCALE })
    .where("id", "=", assetId)
    .where("quantity_scale", "!=", CRYPTO_QUANTITY_SCALE)
    .execute();
  return assetId;
}

async function upsertHoldingSnapshot(
  trx: Transaction<DatabaseSchema>,
  assetId: number,
  quantity: number,
  syncDate: string,
  sourceId: number,
): Promise<void> {
  const existing = await trx
    .selectFrom("holdings")
    .select("id")
    .where("asset_id", "=", assetId)
    .where("valid_from", "=", syncDate)
    .where("valid_to", "is", null)
    .where("superseded_by", "is", null)
    .executeTakeFirst();

  if (existing) {
    await trx
      .updateTable("holdings")
      .set({ quantity, source_id: sourceId, recorded_at: new Date().toISOString() })
      .where("id", "=", existing.id)
      .execute();
    return;
  }

  await trx
    .insertInto("holdings")
    .values({ asset_id: assetId, quantity, valid_from: syncDate, source_id: sourceId })
    .execute();
}

async function fetchRawBalance(
  client: EtherscanClient,
  address: string,
  selection: EthereumSelection,
): Promise<string> {
  if (selection.kind === "native") {
    return client.getEthBalance(address);
  }
  if (!selection.contract_address) {
    throw new EthereumConnectorError(
      `Token ${selection.symbol} has no contract address to sync.`,
    );
  }
  return client.getTokenBalance(address, selection.contract_address);
}

export async function runEthereumSync(opts: {
  client?: EtherscanClient;
  fetchImpl?: typeof fetch;
}): Promise<EthereumSyncResult> {
  const state = await readEthereumState();
  if (!state) {
    throw new EthereumConnectorError(
      "Ethereum is not connected. Open the Connectors widget and add a wallet first.",
    );
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const client =
    opts.client ?? createEtherscanClient({ apiKey: etherscanApiKey(), fetchImpl });
  const syncDate = new Date().toISOString().slice(0, 10);

  const quantities = new Map<EthereumSelection, number>();
  for (const selection of state.selections) {
    const raw = await fetchRawBalance(client, state.address, selection);
    quantities.set(selection, toScaledQuantity(raw, selection.decimals));
  }

  const assetIds: number[] = [];
  await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeConnectorDocument(trx, ETHEREUM_PROVIDER, {
        run: "sync",
        synced_at: new Date().toISOString(),
        address: state.address,
        assets: state.selections.map((s) => ({
          symbol: s.symbol,
          contract_address: s.contract_address,
          quantity: quantities.get(s),
        })),
      });

      for (const selection of state.selections) {
        const assetId = await ensureSelectionAsset(trx, selection);
        await upsertHoldingSnapshot(
          trx,
          assetId,
          quantities.get(selection)!,
          syncDate,
          sourceId,
        );
        assetIds.push(assetId);
      }
    });

  let priced = 0;
  for (const assetId of assetIds) {
    const result = await tryPriceOnCapture(assetId, fetchImpl);
    if (result.priced) priced++;
  }

  return { address: state.address, assets_synced: assetIds.length, priced };
}

export async function tombstoneDeselected(removed: EthereumSelection[]): Promise<number> {
  if (removed.length === 0) return 0;
  const syncDate = new Date().toISOString().slice(0, 10);

  await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeConnectorDocument(trx, ETHEREUM_PROVIDER, {
        run: "deselect",
        synced_at: new Date().toISOString(),
        assets: removed.map((s) => ({
          symbol: s.symbol,
          contract_address: s.contract_address,
        })),
      });
      for (const selection of removed) {
        const assetId = await ensureSelectionAsset(trx, selection);
        await upsertHoldingSnapshot(trx, assetId, 0, syncDate, sourceId);
      }
    });

  return removed.length;
}
