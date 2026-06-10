import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb, SECRETS_PATH } from "../core/db.js";
import { runProductQuery } from "../query/nlq_query.js";
import { runQuery, resetDuck } from "../query/query.js";

beforeEach(() => {
  initDb();
  resetDuck();
  getDb().exec("DELETE FROM accounts; DELETE FROM connector_state;");
});

describe("NLQ engine boundary", () => {
  it("queries an allow-listed product table", async () => {
    getDb()
      .prepare(
        "INSERT INTO accounts (name, type, currency) VALUES ('Test', 'current', 'GBP')",
      )
      .run();
    const rows = await runProductQuery("SELECT name FROM pfa.accounts");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Test");
  });

  it("cannot reach secret tables — Catalog Error, however the SQL is written", async () => {
    await expect(runProductQuery("SELECT * FROM pfa.connector_state")).rejects.toThrow();
    await expect(
      runProductQuery("SELECT * FROM pfa.oauth_refresh_token"),
    ).rejects.toThrow();
    await expect(runProductQuery("SELECT * FROM connector_state")).rejects.toThrow();
    await expect(
      runProductQuery("SELECT * FROM secrets.connector_state"),
    ).rejects.toThrow();
  });

  it("cannot reach non-allow-listed reference data (tax_constants)", async () => {
    await expect(runProductQuery("SELECT * FROM pfa.tax_constants")).rejects.toThrow();
  });

  it("creates the secrets file owner-only (0600)", () => {
    expect(fs.statSync(SECRETS_PATH).mode & 0o777).toBe(0o600);
  });

  it("keeps secret tables reachable by the app handle, resolved to the secrets file", () => {
    getDb()
      .prepare(
        `INSERT INTO connector_state (provider, client_id, client_secret, access_token, refresh_token)
         VALUES ('test', 'c', 's', 'tok', 'r')`,
      )
      .run();
    const row = getDb()
      .prepare("SELECT access_token FROM connector_state WHERE provider = 'test'")
      .get() as { access_token: string } | undefined;
    expect(row?.access_token).toBe("tok");

    const inMain = getDb()
      .prepare("SELECT name FROM main.sqlite_master WHERE name = 'connector_state'")
      .get();
    const inSecrets = getDb()
      .prepare("SELECT name FROM secrets.sqlite_master WHERE name = 'connector_state'")
      .get();
    expect(inMain).toBeUndefined();
    expect(inSecrets).toBeTruthy();
  });

  it("internal full read path still sees product tables", async () => {
    getDb()
      .prepare(
        "INSERT INTO accounts (name, type, currency) VALUES ('Int', 'current', 'GBP')",
      )
      .run();
    const rows = await runQuery("SELECT COUNT(*) AS n FROM pfa.accounts");
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(1);
  });
});
