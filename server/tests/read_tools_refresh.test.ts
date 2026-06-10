import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveConnectorCredentials } from "../connectors/state.js";
import { getDb, initDb } from "../db.js";
import type { DataClass, EnsureFreshDeps } from "../freshness.js";
import type { NetWorthResult } from "../net_worth/types.js";
import { resetDuck } from "../query.js";
import { getNetWorthTool } from "../tools/get_net_worth.js";

afterEach(() => {
  resetDuck();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM account_balances;
    DELETE FROM accounts;
    DELETE FROM asset_prices;
    DELETE FROM holdings;
    DELETE FROM assets;
    DELETE FROM connector_state;
  `);
});

async function connectStaleMonzo(): Promise<void> {
  await saveConnectorCredentials("monzo", {
    client_id: "cid",
    client_secret: "secret",
    access_token: "tok",
    refresh_token: "refresh",
    expires_at: null,
  });
  getDb()
    .prepare(
      "UPDATE connector_state SET last_synced_at = '2026-01-01T00:00:00.000Z' WHERE provider = 'monzo'",
    )
    .run();
}

function spyDeps(calls: DataClass[]): EnsureFreshDeps {
  return {
    runMonzo: async () => {
      calls.push("monzo");
    },
    runEthereum: async () => {
      calls.push("ethereum");
    },
    runPrices: async () => {
      calls.push("prices");
      return [];
    },
  };
}

describe("get_net_worth auto-refresh wiring", () => {
  it("invokes no runner when auto_refresh is false", async () => {
    await connectStaleMonzo();
    const calls: DataClass[] = [];
    await getNetWorthTool({ as_of: "2026-06-08", auto_refresh: false }, spyDeps(calls));
    expect(calls).toEqual([]);
  });

  it("takes the ensureFresh path by default", async () => {
    await connectStaleMonzo();
    const calls: DataClass[] = [];
    await getNetWorthTool({ as_of: "2026-06-08" }, spyDeps(calls));
    expect(calls).toEqual(["monzo"]);
  });

  it("still returns a result when a runner throws", async () => {
    await connectStaleMonzo();
    const result = await getNetWorthTool(
      { as_of: "2026-06-08" },
      {
        runMonzo: async () => {
          throw new Error("connector down");
        },
      },
    );
    const parsed = JSON.parse(result) as NetWorthResult;
    expect(parsed.as_of).toBe("2026-06-08");
    expect(Array.isArray(parsed.realised)).toBe(true);
  });

  it("returns a well-formed freshness block", async () => {
    await connectStaleMonzo();
    const result = await getNetWorthTool(
      { as_of: "2026-06-08", auto_refresh: false },
      {},
    );
    const parsed = JSON.parse(result) as NetWorthResult;
    expect(parsed.freshness.map((f) => f.class)).toEqual(["monzo", "prices", "ethereum"]);
    const monzo = parsed.freshness.find((f) => f.class === "monzo")!;
    expect(monzo.connected).toBe(true);
    expect(monzo.ttl_seconds).toBe(86_400);
    expect(monzo.is_stale).toBe(true);
  });
});
