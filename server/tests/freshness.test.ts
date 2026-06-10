import { beforeEach, describe, expect, it } from "vitest";
import { saveConnectorCredentials } from "../connectors/state.js";
import { getDb, initDb } from "../core/db.js";
import { computeFreshness } from "../core/freshness.js";

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM asset_prices;
    DELETE FROM holdings;
    DELETE FROM assets;
    DELETE FROM connector_state;
  `);
});

async function connectMonzo(lastSyncedAt: string | null): Promise<void> {
  await saveConnectorCredentials("monzo", {
    client_id: "cid",
    client_secret: "secret",
    access_token: "tok",
    refresh_token: "refresh",
    expires_at: null,
  });
  getDb()
    .prepare("UPDATE connector_state SET last_synced_at = ? WHERE provider = 'monzo'")
    .run(lastSyncedAt);
}

function seedAutomatedAsset(asOf: string | null): void {
  getDb()
    .prepare(
      "INSERT INTO assets (name, asset_type, base_currency, price_source, ticker) VALUES (?, 'stock', 'GBP', 'yahoo', ?)",
    )
    .run("Acme", "ACME");
  const assetId = getDb().prepare("SELECT id FROM assets WHERE name = 'Acme'").get() as {
    id: number;
  };
  if (asOf != null) {
    getDb()
      .prepare(
        "INSERT INTO asset_prices (asset_id, unit_price_pence, currency, as_of, source) VALUES (?, 1000, 'GBP', ?, 'yahoo')",
      )
      .run(assetId.id, asOf);
  }
}

describe("computeFreshness — monzo TTL boundary", () => {
  it("is fresh when age equals the TTL exactly", async () => {
    await connectMonzo("2026-06-07T00:00:00.000Z");
    const [monzo] = await computeFreshness(
      ["monzo"],
      new Date("2026-06-08T00:00:00.000Z"),
    );
    expect(monzo!.connected).toBe(true);
    expect(monzo!.age_seconds).toBe(86_400);
    expect(monzo!.is_stale).toBe(false);
  });

  it("is stale one second past the TTL", async () => {
    await connectMonzo("2026-06-07T00:00:00.000Z");
    const [monzo] = await computeFreshness(
      ["monzo"],
      new Date("2026-06-08T00:00:01.000Z"),
    );
    expect(monzo!.age_seconds).toBe(86_401);
    expect(monzo!.is_stale).toBe(true);
  });

  it("is stale when connected with no prior sync", async () => {
    await connectMonzo(null);
    const [monzo] = await computeFreshness(
      ["monzo"],
      new Date("2026-06-08T00:00:00.000Z"),
    );
    expect(monzo!.connected).toBe(true);
    expect(monzo!.last_at).toBeNull();
    expect(monzo!.age_seconds).toBeNull();
    expect(monzo!.is_stale).toBe(true);
  });

  it("is never stale when not connected", async () => {
    const [monzo] = await computeFreshness(
      ["monzo"],
      new Date("2026-06-08T00:00:00.000Z"),
    );
    expect(monzo!.connected).toBe(false);
    expect(monzo!.is_stale).toBe(false);
  });
});

describe("computeFreshness — prices", () => {
  it("is connected and fresh within the 1-hour TTL", async () => {
    seedAutomatedAsset("2026-06-08T11:30:00.000Z");
    const [prices] = await computeFreshness(
      ["prices"],
      new Date("2026-06-08T12:00:00.000Z"),
    );
    expect(prices!.connected).toBe(true);
    expect(prices!.ttl_seconds).toBe(3_600);
    expect(prices!.is_stale).toBe(false);
  });

  it("is stale when the latest tick is older than an hour", async () => {
    seedAutomatedAsset("2026-06-08T10:00:00.000Z");
    const [prices] = await computeFreshness(
      ["prices"],
      new Date("2026-06-08T12:00:00.000Z"),
    );
    expect(prices!.is_stale).toBe(true);
  });

  it("is connected but stale when an automated asset has no price yet", async () => {
    seedAutomatedAsset(null);
    const [prices] = await computeFreshness(
      ["prices"],
      new Date("2026-06-08T12:00:00.000Z"),
    );
    expect(prices!.connected).toBe(true);
    expect(prices!.last_at).toBeNull();
    expect(prices!.is_stale).toBe(true);
  });

  it("is not connected when no automated-priced asset exists", async () => {
    const [prices] = await computeFreshness(
      ["prices"],
      new Date("2026-06-08T12:00:00.000Z"),
    );
    expect(prices!.connected).toBe(false);
    expect(prices!.is_stale).toBe(false);
  });
});

describe("computeFreshness — defaults to all three classes", () => {
  it("returns one entry per class in order", async () => {
    const result = await computeFreshness();
    expect(result.map((r) => r.class)).toEqual(["monzo", "prices", "ethereum"]);
  });
});
