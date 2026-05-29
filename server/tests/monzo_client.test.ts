import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMonzoClient, type MonzoTransaction } from "../connectors/monzo/client.js";
import { saveConnectorCredentials } from "../connectors/state.js";
import { getDb, initDb } from "../db.js";
import { resetDuck } from "../query.js";

afterEach(() => {
  resetDuck();
});

beforeEach(async () => {
  initDb();
  getDb().exec("DELETE FROM connector_state;");
  await saveConnectorCredentials("monzo", {
    client_id: "cid",
    client_secret: "secret",
    access_token: "tok",
    refresh_token: "refresh",
    expires_at: null,
  });
});

function page(start: number, count: number): MonzoTransaction[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tx_${start + i}`,
    amount: -100,
    currency: "GBP",
    created: "2024-01-01T00:00:00Z",
    description: "x",
  }));
}

describe("createMonzoClient.listTransactions pagination", () => {
  it("walks the since cursor until a short page and returns every transaction", async () => {
    const sinceParams: (string | null)[] = [];
    const fetchImpl = (async (url: string) => {
      const parsed = new URL(url);
      sinceParams.push(parsed.searchParams.get("since"));
      const transactions = sinceParams.length === 1 ? page(0, 100) : page(100, 30);
      return new Response(JSON.stringify({ transactions }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createMonzoClient({ fetchImpl });
    const all = await client.listTransactions({
      accountId: "acc",
      before: "2026-01-01T00:00:00Z",
    });

    expect(all.length).toBe(130);
    expect(sinceParams.length).toBe(2);
    expect(sinceParams[0]).toBeNull();
    expect(sinceParams[1]).toBe("tx_99");
  });

  it("makes a single request when the first page is short", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ transactions: page(0, 12) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createMonzoClient({ fetchImpl });
    const all = await client.listTransactions({ accountId: "acc" });

    expect(all.length).toBe(12);
    expect(calls).toBe(1);
  });
});
