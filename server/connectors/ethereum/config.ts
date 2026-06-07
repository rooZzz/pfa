import { EthereumConnectorError } from "./errors.js";

export function etherscanApiKey(): string {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (!key) {
    throw new EthereumConnectorError(
      "ETHERSCAN_API_KEY is not set. Add a free Etherscan API key to server/.env (ETHERSCAN_API_KEY=...) and restart.",
    );
  }
  return key;
}
