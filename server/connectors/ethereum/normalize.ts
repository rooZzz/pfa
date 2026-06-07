import { CRYPTO_QUANTITY_SCALE } from "../../references.js";
import { EthereumConnectorError } from "./errors.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SCALE_DECIMALS = 8;

export function isValidAddress(address: string): boolean {
  return ADDRESS_PATTERN.test(address.trim());
}

export function assertValidAddress(address: string): string {
  const trimmed = address.trim();
  if (!isValidAddress(trimmed)) {
    throw new EthereumConnectorError(
      `'${address}' is not a valid Ethereum address. Supply a 0x-prefixed 40-character hex address.`,
    );
  }
  return trimmed.toLowerCase();
}

export function assertValidContractAddress(address: string): string {
  const trimmed = address.trim();
  if (!isValidAddress(trimmed)) {
    throw new EthereumConnectorError(
      `'${address}' is not a valid token contract address. Supply a 0x-prefixed 40-character hex address.`,
    );
  }
  return trimmed.toLowerCase();
}

export function toScaledQuantity(rawBalance: string, decimals: number): number {
  let raw: bigint;
  try {
    raw = BigInt(rawBalance);
  } catch {
    throw new EthereumConnectorError(`Could not parse on-chain balance '${rawBalance}'.`);
  }
  const diff = decimals - SCALE_DECIMALS;
  let scaled: bigint;
  if (diff >= 0) {
    const divisor = 10n ** BigInt(diff);
    scaled = (raw + divisor / 2n) / divisor;
  } else {
    scaled = raw * 10n ** BigInt(-diff);
  }
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EthereumConnectorError(
      `On-chain balance ${rawBalance} is too large to represent precisely.`,
    );
  }
  return Number(scaled);
}

export function formatTokenAmount(rawBalance: string, decimals: number): string {
  const scaled = toScaledQuantity(rawBalance, decimals);
  return (scaled / CRYPTO_QUANTITY_SCALE).toLocaleString("en-GB", {
    maximumFractionDigits: 8,
  });
}
