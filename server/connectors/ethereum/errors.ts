export class EthereumConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EthereumConnectorError";
  }
}

export class EtherscanApiError extends Error {
  constructor(message: string) {
    super(`Etherscan API error: ${message}`);
    this.name = "EtherscanApiError";
  }
}
