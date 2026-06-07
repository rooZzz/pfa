import type { EtherscanClient } from "../connectors/ethereum/client.js";
import { runEthereumSync } from "../connectors/ethereum/sync.js";

export async function syncEthereum(
  opts: { client?: EtherscanClient; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const result = await runEthereumSync(opts);
  return [
    `Synced Ethereum wallet ${result.address.slice(0, 6)}…${result.address.slice(-4)}:`,
    `${result.assets_synced} holding(s) updated to today, priced ${result.priced} via CoinGecko.`,
  ].join(" ");
}
