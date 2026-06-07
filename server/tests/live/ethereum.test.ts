import { beforeAll, describe, expect, it } from "vitest";
import { createEtherscanClient } from "../../connectors/ethereum/client.js";
import {
  discoverWallet,
  type WalletDiscovery,
} from "../../connectors/ethereum/discover.js";
import {
  saveEthereumSelections,
  saveEthereumWallet,
} from "../../connectors/ethereum/state.js";
import { runEthereumSync } from "../../connectors/ethereum/sync.js";
import { getDb, initDb } from "../../db.js";
import { getNetWorth } from "../../net_worth/index.js";

const WALLET = "0x2B1b257aAC301F5cdfB7bE88Bb84D2207618e56D";
const apiKey = process.env.ETHERSCAN_API_KEY?.trim() ?? "";
const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!apiKey)("Ethereum connector (live)", () => {
  let discovery: WalletDiscovery;

  beforeAll(async () => {
    initDb();
    getDb().exec(`
      DELETE FROM holdings;
      DELETE FROM asset_prices;
      DELETE FROM assets;
      DELETE FROM documents;
      DELETE FROM connector_state;
    `);
    const client = createEtherscanClient({ apiKey });
    discovery = await discoverWallet(client, WALLET);
  }, 60000);

  it("discovers non-zero ETH and LINK in the wallet", () => {
    const eth = discovery.assets.find((a) => a.symbol === "ETH");
    const link = discovery.assets.find((a) => a.symbol === "LINK");

    expect(eth).toBeDefined();
    expect(BigInt(eth!.raw_balance) > 0n).toBe(true);
    expect(link).toBeDefined();
    expect(BigInt(link!.raw_balance) > 0n).toBe(true);
    expect(link!.contract_address).toBeTruthy();

    console.log(
      `ETH ${eth!.display_balance}, LINK ${link!.display_balance} (${link!.contract_address})`,
    );
  });

  it("imports ETH and LINK and prices them into net worth", async () => {
    const wanted = discovery.assets.filter(
      (a) => a.symbol === "ETH" || a.symbol === "LINK",
    );
    expect(wanted).toHaveLength(2);

    await saveEthereumWallet(WALLET);
    await saveEthereumSelections(
      wanted.map((a) => ({
        kind: a.kind,
        symbol: a.symbol,
        name: a.name,
        contract_address: a.contract_address,
        decimals: a.decimals,
      })),
    );

    const result = await runEthereumSync({});
    expect(result.assets_synced).toBe(2);
    expect(result.priced).toBe(2);

    const netWorth = await getNetWorth(TODAY);
    const ethLine = netWorth.realised.find((l) => l.ticker === "ETH");
    const linkLine = netWorth.realised.find(
      (l) => l.name === "LINK" || l.ticker === "LINK",
    );

    expect(ethLine?.value_pence).toBeGreaterThan(0);
    expect(linkLine?.value_pence).toBeGreaterThan(0);

    console.log(
      `Net worth: ETH £${(ethLine!.value_pence / 100).toFixed(2)}, LINK £${(
        linkLine!.value_pence / 100
      ).toFixed(2)}`,
    );
  }, 30000);
});
