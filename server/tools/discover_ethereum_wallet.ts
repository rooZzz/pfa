import { z } from "zod";
import { createEtherscanClient } from "../connectors/ethereum/client.js";
import { etherscanApiKey } from "../connectors/ethereum/config.js";
import { discoverWallet } from "../connectors/ethereum/discover.js";
import { assertValidAddress } from "../connectors/ethereum/normalize.js";

export const discoverEthereumWalletSchema = {
  address: z.string().describe("The Ethereum wallet address (0x...)."),
};

export async function discoverEthereumWallet(
  input: { address: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const address = assertValidAddress(input.address);
  const client = createEtherscanClient({ apiKey: etherscanApiKey(), fetchImpl });
  const discovery = await discoverWallet(client, address);
  return JSON.stringify(discovery);
}
