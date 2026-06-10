import { beforeEach, describe, expect, it } from "vitest";
import { EthereumConnectorError } from "../connectors/ethereum/errors.js";
import { MonzoReauthError } from "../connectors/monzo/errors.js";
import type { PriceSyncRow } from "../connectors/prices/sync.js";
import { saveConnectorCredentials } from "../connectors/state.js";
import { getDb, initDb } from "../db.js";
import { ensureFresh, type DataClass, type EnsureFreshDeps } from "../freshness.js";

const NOW = new Date("2026-06-08T12:00:00.000Z");
const STALE_AT = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM asset_prices;
    DELETE FROM holdings;
    DELETE FROM assets;
    DELETE FROM connector_state;
  `);
});

async function connect(provider: string, lastSyncedAt: string | null): Promise<void> {
  await saveConnectorCredentials(provider, {
    client_id: "cid",
    client_secret: "secret",
    access_token: "tok",
    refresh_token: "refresh",
    expires_at: null,
  });
  getDb()
    .prepare("UPDATE connector_state SET last_synced_at = ? WHERE provider = ?")
    .run(lastSyncedAt, provider);
}

function seedStalePriceAsset(): void {
  getDb()
    .prepare(
      "INSERT INTO assets (name, asset_type, base_currency, price_source, ticker) VALUES ('Acme', 'stock', 'GBP', 'yahoo', 'ACME')",
    )
    .run();
  const asset = getDb().prepare("SELECT id FROM assets WHERE name = 'Acme'").get() as {
    id: number;
  };
  getDb()
    .prepare(
      "INSERT INTO asset_prices (asset_id, unit_price_pence, currency, as_of, source) VALUES (?, 1000, 'GBP', ?, 'yahoo')",
    )
    .run(asset.id, STALE_AT);
}

const okRow: PriceSyncRow = {
  asset_id: 1,
  name: "Acme",
  ticker: "ACME",
  status: "ok",
  price_pence: 1000,
};
const errRow: PriceSyncRow = {
  asset_id: 1,
  name: "Acme",
  ticker: "ACME",
  status: "error",
  message: "fetch failed",
};

function spyDeps(
  calls: DataClass[],
  overrides: Partial<EnsureFreshDeps> = {},
): EnsureFreshDeps {
  return {
    now: NOW,
    runMonzo: async () => {
      calls.push("monzo");
    },
    runEthereum: async () => {
      calls.push("ethereum");
    },
    runPrices: async () => {
      calls.push("prices");
      return [okRow];
    },
    ...overrides,
  };
}

describe("ensureFresh", () => {
  it("runs only the connected, stale classes", async () => {
    await connect("monzo", STALE_AT);
    seedStalePriceAsset();
    getDb().prepare("UPDATE asset_prices SET as_of = '2026-06-08T11:59:00.000Z'").run();

    const calls: DataClass[] = [];
    const outcomes = await ensureFresh(undefined, spyDeps(calls));

    expect(calls).toEqual(["monzo"]);
    const byClass = Object.fromEntries(outcomes.map((o) => [o.class, o.action]));
    expect(byClass).toEqual({
      monzo: "refreshed",
      prices: "skipped_fresh",
      ethereum: "not_connected",
    });
  });

  it("never calls a runner for a not-connected class", async () => {
    const calls: DataClass[] = [];
    const outcomes = await ensureFresh(undefined, spyDeps(calls));
    expect(calls).toEqual([]);
    expect(outcomes.every((o) => o.action === "not_connected")).toBe(true);
  });

  it("is fail-soft when the Monzo runner throws a reauth error", async () => {
    await connect("monzo", STALE_AT);
    const outcomes = await ensureFresh(["monzo"], {
      now: NOW,
      runMonzo: async () => {
        throw new MonzoReauthError();
      },
    });
    expect(outcomes[0]!.action).toBe("failed");
    expect(outcomes[0]!.error).toMatch(/Monzo/i);
  });

  it("is fail-soft when the Ethereum runner throws a connector error", async () => {
    await connect("ethereum", STALE_AT);
    const outcomes = await ensureFresh(["ethereum"], {
      now: NOW,
      runEthereum: async () => {
        throw new EthereumConnectorError("wallet unreachable");
      },
    });
    expect(outcomes[0]!.action).toBe("failed");
    expect(outcomes[0]!.error).toMatch(/wallet unreachable/);
  });

  it("reports failed when every price fetch errors", async () => {
    seedStalePriceAsset();
    const outcomes = await ensureFresh(["prices"], {
      now: NOW,
      runPrices: async () => [errRow],
    });
    expect(outcomes[0]!.action).toBe("failed");
  });

  it("reports refreshed when at least one price fetch succeeds", async () => {
    seedStalePriceAsset();
    const outcomes = await ensureFresh(["prices"], {
      now: NOW,
      runPrices: async () => [errRow, okRow],
    });
    expect(outcomes[0]!.action).toBe("refreshed");
  });

  it("runs stale classes sequentially in class order", async () => {
    await connect("monzo", STALE_AT);
    await connect("ethereum", STALE_AT);
    seedStalePriceAsset();

    const calls: DataClass[] = [];
    await ensureFresh(undefined, spyDeps(calls));
    expect(calls).toEqual(["monzo", "prices", "ethereum"]);
  });

  it("does not throw when a runner rejects", async () => {
    await connect("monzo", STALE_AT);
    await expect(
      ensureFresh(["monzo"], {
        now: NOW,
        runMonzo: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toBeDefined();
  });
});
