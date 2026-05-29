import { beforeAll, describe, expect, it } from "vitest";
import { createMonzoClient } from "../../connectors/monzo/client.js";
import { saveConnectorCredentials } from "../../connectors/state.js";
import { initDb } from "../../db.js";

const credentials = {
  client_id: process.env.MONZO_CLIENT_ID ?? "",
  client_secret: process.env.MONZO_CLIENT_SECRET ?? "",
  access_token: process.env.MONZO_ACCESS_TOKEN ?? "",
  refresh_token: process.env.MONZO_REFRESH_TOKEN ?? "",
};

const hasCredentials = Object.values(credentials).every((value) => value !== "");

describe.skipIf(!hasCredentials)("Monzo client (live)", () => {
  beforeAll(async () => {
    initDb();
    await saveConnectorCredentials("monzo", { ...credentials, expires_at: null });
  });

  it("lists the authenticated user's accounts", async () => {
    const client = createMonzoClient({ provider: "monzo" });
    const accounts = await client.listAccounts();
    expect(accounts.length).toBeGreaterThan(0);
  }, 30000);
});
