import { z } from "zod";
import type { EtherscanClient } from "../connectors/ethereum/client.js";
import {
  assertValidAddress,
  assertValidContractAddress,
} from "../connectors/ethereum/normalize.js";
import { runEthereumSync, tombstoneDeselected } from "../connectors/ethereum/sync.js";
import {
  readEthereumState,
  saveEthereumSelections,
  saveEthereumWallet,
  type EthereumSelection,
} from "../connectors/ethereum/state.js";

const selectionSchema = z.object({
  kind: z.enum(["native", "token"]),
  symbol: z.string(),
  name: z.string(),
  contract_address: z.string().nullable().optional(),
  decimals: z.number().int().nonnegative(),
});

export const connectEthereumSchema = {
  address: z.string().describe("The Ethereum wallet address (0x...)."),
  selections: z
    .array(selectionSchema)
    .describe("The assets the user chose to track, from discover_ethereum_wallet."),
};

function normalizeSelection(input: z.infer<typeof selectionSchema>): EthereumSelection {
  const isToken = input.kind === "token" && Boolean(input.contract_address);
  return {
    kind: isToken ? "token" : "native",
    symbol: input.symbol,
    name: input.name,
    contract_address: isToken
      ? assertValidContractAddress(input.contract_address!)
      : null,
    decimals: input.decimals,
  };
}

function selectionKey(selection: EthereumSelection): string {
  return selection.contract_address
    ? `token:${selection.contract_address}`
    : `native:${selection.symbol.toUpperCase()}`;
}

export async function connectEthereum(
  input: {
    address: string;
    selections: z.infer<typeof selectionSchema>[];
  },
  opts: { client?: EtherscanClient; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const address = assertValidAddress(input.address);
  const selections = input.selections.map(normalizeSelection);

  await saveEthereumWallet(address);

  const previous = (await readEthereumState())?.selections ?? [];
  const keptKeys = new Set(selections.map(selectionKey));
  const removed = previous.filter((s) => !keptKeys.has(selectionKey(s)));

  const tombstoned = await tombstoneDeselected(removed);
  await saveEthereumSelections(selections);
  const result = await runEthereumSync(opts);

  const removedNote =
    tombstoned > 0 ? ` Dropped ${tombstoned} previously tracked asset(s).` : "";
  return [
    `Connected Ethereum wallet ${address.slice(0, 6)}…${address.slice(-4)}.`,
    `Tracking ${result.assets_synced} asset(s); priced ${result.priced} via CoinGecko.${removedNote}`,
    "Run sync to refresh balances; use sync_prices to refresh prices.",
  ].join(" ");
}
