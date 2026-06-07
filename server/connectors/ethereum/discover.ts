import type { EtherscanClient } from "./client.js";
import { EthereumConnectorError } from "./errors.js";
import { formatTokenAmount } from "./normalize.js";

export type DiscoveredAsset = {
  kind: "native" | "token";
  symbol: string;
  name: string;
  contract_address: string | null;
  decimals: number;
  raw_balance: string;
  display_balance: string;
};

export type WalletDiscovery = {
  address: string;
  assets: DiscoveredAsset[];
  transfers_capped: boolean;
};

export async function discoverWallet(
  client: EtherscanClient,
  address: string,
): Promise<WalletDiscovery> {
  const ethWei = await client.getEthBalance(address);
  const assets: DiscoveredAsset[] = [
    {
      kind: "native",
      symbol: "ETH",
      name: "Ethereum",
      contract_address: null,
      decimals: 18,
      raw_balance: ethWei,
      display_balance: formatTokenAmount(ethWei, 18),
    },
  ];

  const { tokens, capped } = await client.getTokenTransfers(address);
  for (const token of tokens) {
    const raw = await client.getTokenBalance(address, token.contract_address);
    let balance: bigint;
    try {
      balance = BigInt(raw);
    } catch {
      throw new EthereumConnectorError(
        `Could not parse on-chain balance '${raw}' for ${token.symbol}.`,
      );
    }
    if (balance <= 0n) continue;
    assets.push({
      kind: "token",
      symbol: token.symbol,
      name: token.name,
      contract_address: token.contract_address,
      decimals: token.decimals,
      raw_balance: raw,
      display_balance: formatTokenAmount(raw, token.decimals),
    });
  }

  return { address, assets, transfers_capped: capped };
}
