import { EtherscanApiError } from "./errors.js";

const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";
const MAINNET_CHAIN_ID = "1";
const TOKENTX_PAGE_LIMIT = 10000;
const DEFAULT_MIN_INTERVAL_MS = 500;

let throttleGate: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

async function throttle(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const previous = throttleGate;
  let release!: () => void;
  throttleGate = new Promise((resolve) => (release = resolve));
  await previous;
  const wait = minIntervalMs - (Date.now() - lastRequestStartedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestStartedAt = Date.now();
  release();
}

export type TokenMeta = {
  contract_address: string;
  symbol: string;
  name: string;
  decimals: number;
};

export type TokenTransfersResult = {
  tokens: TokenMeta[];
  capped: boolean;
};

export type EtherscanClient = {
  getEthBalance(address: string): Promise<string>;
  getTokenTransfers(address: string): Promise<TokenTransfersResult>;
  getTokenBalance(address: string, contractAddress: string): Promise<string>;
};

type EtherscanResponse = {
  status: string;
  message: string;
  result: unknown;
};

type RawTransfer = {
  contractAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimal?: string;
};

function parseTokenDecimals(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 18;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 36 ? value : 18;
}

export function createEtherscanClient(opts: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
}): EtherscanClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  async function request(params: Record<string, string>): Promise<EtherscanResponse> {
    const query = new URLSearchParams({
      chainid: MAINNET_CHAIN_ID,
      apikey: opts.apiKey,
      ...params,
    });
    await throttle(minIntervalMs);
    const res = await fetchImpl(`${ETHERSCAN_BASE}?${query.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new EtherscanApiError(`request failed (HTTP ${res.status}).`);
    }
    return (await res.json()) as EtherscanResponse;
  }

  return {
    async getEthBalance(address) {
      const json = await request({
        module: "account",
        action: "balance",
        address,
        tag: "latest",
      });
      if (json.status !== "1") {
        throw new EtherscanApiError(
          `could not read ETH balance: ${json.message} (${String(json.result)}).`,
        );
      }
      return String(json.result);
    },

    async getTokenTransfers(address) {
      const json = await request({
        module: "account",
        action: "tokentx",
        address,
        page: "1",
        offset: String(TOKENTX_PAGE_LIMIT),
        sort: "desc",
      });
      if (json.status !== "1") {
        if (
          Array.isArray(json.result) ||
          /no transactions found/i.test(json.message) ||
          /no transactions found/i.test(String(json.result))
        ) {
          return { tokens: [], capped: false };
        }
        throw new EtherscanApiError(
          `could not read token transfers: ${json.message} (${String(json.result)}).`,
        );
      }
      const rows = json.result as RawTransfer[];
      const byContract = new Map<string, TokenMeta>();
      for (const row of rows) {
        const contract = row.contractAddress?.trim().toLowerCase();
        if (!contract) continue;
        if (byContract.has(contract)) continue;
        byContract.set(contract, {
          contract_address: contract,
          symbol: row.tokenSymbol?.trim() || contract.slice(0, 8),
          name: row.tokenName?.trim() || row.tokenSymbol?.trim() || contract,
          decimals: parseTokenDecimals(row.tokenDecimal),
        });
      }
      return {
        tokens: [...byContract.values()],
        capped: rows.length >= TOKENTX_PAGE_LIMIT,
      };
    },

    async getTokenBalance(address, contractAddress) {
      const json = await request({
        module: "account",
        action: "tokenbalance",
        address,
        contractaddress: contractAddress,
        tag: "latest",
      });
      if (json.status !== "1") {
        throw new EtherscanApiError(
          `could not read token balance for ${contractAddress}: ${json.message} (${String(
            json.result,
          )}).`,
        );
      }
      return String(json.result);
    },
  };
}
