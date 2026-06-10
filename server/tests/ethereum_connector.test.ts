import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEtherscanClient,
  type EtherscanClient,
  type TokenMeta,
} from "../connectors/ethereum/client.js";
import { discoverWallet } from "../connectors/ethereum/discover.js";
import { isValidAddress, toScaledQuantity } from "../connectors/ethereum/normalize.js";
import {
  readEthereumState,
  saveEthereumSelections,
  saveEthereumWallet,
} from "../connectors/ethereum/state.js";
import { runEthereumSync } from "../connectors/ethereum/sync.js";
import { getDb, initDb } from "../core/db.js";
import { getNetWorth } from "../net_worth/index.js";
import { resetDuck } from "../query/query.js";
import { connectEthereum } from "../tools/connect_ethereum.js";
import { correctRecordTool } from "../tools/correct_record.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const TODAY = new Date().toISOString().slice(0, 10);

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function fakeClient(opts: {
  ethWei: string;
  tokens?: TokenMeta[];
  balances?: Record<string, string>;
  capped?: boolean;
}): EtherscanClient {
  return {
    async getEthBalance() {
      return opts.ethWei;
    },
    async getTokenTransfers() {
      return { tokens: opts.tokens ?? [], capped: opts.capped ?? false };
    },
    async getTokenBalance(_address, contract) {
      return opts.balances?.[contract] ?? "0";
    },
  };
}

function coingeckoFetch(prices: {
  eth?: number;
  tokens?: Record<string, number>;
}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/simple/price?ids=ethereum")) {
      return jsonResponse({
        ethereum: { gbp: prices.eth ?? 0, last_updated_at: 1700000000 },
      });
    }
    const match = url.match(/contract_addresses=([^&]+)/);
    if (match) {
      const contract = decodeURIComponent(match[1]!).toLowerCase();
      return jsonResponse({
        [contract]: { gbp: prices.tokens?.[contract] ?? 0, last_updated_at: 1700000000 },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
}

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM holdings;
    DELETE FROM asset_prices;
    DELETE FROM assets;
    DELETE FROM documents;
    DELETE FROM connector_state;
  `);
});

afterEach(() => {
  resetDuck();
});

describe("normalize", () => {
  it("validates 0x addresses", () => {
    expect(isValidAddress(WALLET)).toBe(true);
    expect(isValidAddress("0x123")).toBe(false);
    expect(isValidAddress("nope")).toBe(false);
  });

  it("scales wei (18 decimals) to 1e8 sub-units", () => {
    expect(toScaledQuantity("1500000000000000000", 18)).toBe(150000000);
    expect(toScaledQuantity("1000000000000000000", 18)).toBe(100000000);
  });

  it("scales a 6-decimal token to 1e8 sub-units", () => {
    expect(toScaledQuantity("1000000", 6)).toBe(100000000);
    expect(toScaledQuantity("2500000000", 6)).toBe(250000000000);
  });
});

describe("Etherscan client", () => {
  it("reads the ETH balance and enumerates distinct token contracts", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("action=balance")) {
        return jsonResponse({ status: "1", message: "OK", result: "42" });
      }
      if (url.includes("action=tokentx")) {
        return jsonResponse({
          status: "1",
          message: "OK",
          result: [
            {
              contractAddress: USDC,
              tokenSymbol: "USDC",
              tokenName: "USD Coin",
              tokenDecimal: "6",
            },
            {
              contractAddress: USDC.toUpperCase(),
              tokenSymbol: "USDC",
              tokenName: "USD Coin",
              tokenDecimal: "6",
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const client = createEtherscanClient({ apiKey: "k", fetchImpl, minIntervalMs: 0 });
    expect(await client.getEthBalance(WALLET)).toBe("42");
    const { tokens } = await client.getTokenTransfers(WALLET);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.symbol).toBe("USDC");
    expect(tokens[0]!.decimals).toBe(6);
  });

  it("falls back to 18 decimals when tokenDecimal is empty or non-numeric", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("action=tokentx")) {
        return jsonResponse({
          status: "1",
          message: "OK",
          result: [
            {
              contractAddress: USDC,
              tokenSymbol: "ODD",
              tokenName: "Odd Token",
              tokenDecimal: "",
            },
            {
              contractAddress: "0xdead000000000000000000000000000000000000",
              tokenSymbol: "JNK",
              tokenName: "Junk Token",
              tokenDecimal: "not-a-number",
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const client = createEtherscanClient({ apiKey: "k", fetchImpl, minIntervalMs: 0 });
    const { tokens } = await client.getTokenTransfers(WALLET);
    expect(tokens.map((t) => t.decimals)).toEqual([18, 18]);
  });

  it("treats 'No transactions found' as an empty token list", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        status: "0",
        message: "No transactions found",
        result: [],
      })) as typeof fetch;
    const client = createEtherscanClient({ apiKey: "k", fetchImpl, minIntervalMs: 0 });
    expect((await client.getTokenTransfers(WALLET)).tokens).toEqual([]);
  });

  it("throws on an API error status", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        status: "0",
        message: "NOTOK",
        result: "Invalid API Key",
      })) as typeof fetch;
    const client = createEtherscanClient({ apiKey: "bad", fetchImpl, minIntervalMs: 0 });
    await expect(client.getEthBalance(WALLET)).rejects.toThrow(/Invalid API Key/);
  });
});

describe("discoverWallet", () => {
  it("lists native ETH and non-zero tokens, dropping zero balances", async () => {
    const client = fakeClient({
      ethWei: "1500000000000000000",
      tokens: [
        { contract_address: USDC, symbol: "USDC", name: "USD Coin", decimals: 6 },
        { contract_address: "0xdead", symbol: "DEAD", name: "Dead", decimals: 18 },
      ],
      balances: { [USDC]: "2500000000", "0xdead": "0" },
    });

    const discovery = await discoverWallet(client, WALLET);
    const symbols = discovery.assets.map((a) => a.symbol);
    expect(symbols).toContain("ETH");
    expect(symbols).toContain("USDC");
    expect(symbols).not.toContain("DEAD");
    expect(discovery.assets[0]!.display_balance).toBe("1.5");
  });
});

describe("runEthereumSync", () => {
  async function connectWallet() {
    await saveEthereumWallet(WALLET);
    await saveEthereumSelections([
      {
        kind: "native",
        symbol: "ETH",
        name: "Ethereum",
        contract_address: null,
        decimals: 18,
      },
      {
        kind: "token",
        symbol: "USDC",
        name: "USD Coin",
        contract_address: USDC,
        decimals: 6,
      },
    ]);
  }

  it("writes connector-owned holdings at the 1e8 scale and prices them", async () => {
    await connectWallet();
    const client = fakeClient({
      ethWei: "1500000000000000000",
      balances: { [USDC]: "2500000000" },
    });
    const fetchImpl = coingeckoFetch({ eth: 2000, tokens: { [USDC]: 0.79 } });

    const result = await runEthereumSync({ client, fetchImpl });
    expect(result.assets_synced).toBe(2);
    expect(result.priced).toBe(2);

    const eth = getDb()
      .prepare(
        "SELECT h.quantity AS q FROM holdings h JOIN assets a ON a.id = h.asset_id WHERE a.ticker = 'ETH'",
      )
      .get() as { q: number };
    expect(eth.q).toBe(150000000);

    const docType = getDb()
      .prepare(
        "SELECT d.source_type AS t FROM holdings h JOIN documents d ON d.id = h.source_id LIMIT 1",
      )
      .get() as { t: string };
    expect(docType.t).toBe("connector");

    const netWorth = await getNetWorth(TODAY);
    const ethLine = netWorth.realised.find((l) => l.ticker === "ETH");
    expect(ethLine?.value_pence).toBe(300000);
    const usdcLine = netWorth.realised.find((l) => l.name === "USDC");
    expect(usdcLine?.value_pence).toBe(197500);
  });

  it("is idempotent on a same-day re-sync", async () => {
    await connectWallet();
    const client = fakeClient({
      ethWei: "1500000000000000000",
      balances: { [USDC]: "2500000000" },
    });
    const fetchImpl = coingeckoFetch({ eth: 2000, tokens: { [USDC]: 0.79 } });

    await runEthereumSync({ client, fetchImpl });
    await runEthereumSync({ client, fetchImpl });

    const count = getDb().prepare("SELECT COUNT(*) AS n FROM holdings").get() as {
      n: number;
    };
    expect(count.n).toBe(2);
  });

  it("refuses local correction of connector-owned holdings", async () => {
    await connectWallet();
    const client = fakeClient({
      ethWei: "1500000000000000000",
      balances: { [USDC]: "0" },
    });
    await runEthereumSync({ client, fetchImpl: coingeckoFetch({ eth: 2000 }) });

    const holding = getDb()
      .prepare(
        "SELECT h.id AS id FROM holdings h JOIN assets a ON a.id = h.asset_id WHERE a.ticker = 'ETH'",
      )
      .get() as { id: number };

    await expect(
      correctRecordTool({
        series: "holding",
        row_id: holding.id,
        corrected_fields: { quantity: 1 },
        reason: "test",
      }),
    ).rejects.toThrow(/connector/i);
  });
});

describe("connectEthereum", () => {
  it("tombstones a deselected token so it leaves net worth", async () => {
    const client = fakeClient({
      ethWei: "1000000000000000000",
      tokens: [{ contract_address: USDC, symbol: "USDC", name: "USD Coin", decimals: 6 }],
      balances: { [USDC]: "2500000000" },
    });
    const fetchImpl = coingeckoFetch({ eth: 2000, tokens: { [USDC]: 0.79 } });

    await connectEthereum(
      {
        address: WALLET,
        selections: [
          {
            kind: "native",
            symbol: "ETH",
            name: "Ethereum",
            contract_address: null,
            decimals: 18,
          },
          {
            kind: "token",
            symbol: "USDC",
            name: "USD Coin",
            contract_address: USDC,
            decimals: 6,
          },
        ],
      },
      { client, fetchImpl },
    );

    let netWorth = await getNetWorth(TODAY);
    expect(netWorth.realised.find((l) => l.name === "USDC")?.value_pence).toBe(197500);

    await connectEthereum(
      {
        address: WALLET,
        selections: [
          {
            kind: "native",
            symbol: "ETH",
            name: "Ethereum",
            contract_address: null,
            decimals: 18,
          },
        ],
      },
      { client, fetchImpl },
    );

    netWorth = await getNetWorth(TODAY);
    expect(netWorth.realised.find((l) => l.name === "USDC")?.value_pence).toBe(0);

    const state = await readEthereumState();
    expect(state?.selections).toHaveLength(1);
  });

  it("rejects a token selection with a malformed contract address", async () => {
    const client = fakeClient({ ethWei: "1000000000000000000" });
    await expect(
      connectEthereum(
        {
          address: WALLET,
          selections: [
            {
              kind: "token",
              symbol: "BAD",
              name: "Bad Token",
              contract_address: "0xnot-an-address",
              decimals: 18,
            },
          ],
        },
        { client, fetchImpl: coingeckoFetch({}) },
      ),
    ).rejects.toThrow(/contract address/i);
  });
});
