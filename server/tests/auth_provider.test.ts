import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { setupAuthEnv } from "./auth_env.js";
import { getDb, initDb } from "../db.js";
import { clientsStore } from "../auth/clients_store.js";
import { provider, finalizePendingAuthorization } from "../auth/provider.js";
import { nowSec, randomId } from "../auth/util.js";

beforeAll(async () => {
  await setupAuthEnv();
});

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM pending_authorization;
    DELETE FROM oauth_authorization_code;
    DELETE FROM oauth_refresh_token;
    DELETE FROM oauth_client;
  `);
});

async function registerClient(): Promise<OAuthClientInformationFull> {
  return clientsStore.registerClient!({
    redirect_uris: ["https://app.test/cb"],
    token_endpoint_auth_method: "none",
  } as Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">);
}

function stagePending(clientId: string, challenge: string): string {
  const id = randomId();
  getDb()
    .prepare(
      `INSERT INTO pending_authorization
       (id, client_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, state, expires_at)
       VALUES (?, ?, 'https://app.test/cb', ?, 'S256', 'mcp', NULL, 'xyz', ?)`,
    )
    .run(id, clientId, challenge, nowSec() + 600);
  return id;
}

describe("dynamic client registration", () => {
  it("registers and retrieves a client", async () => {
    const client = await registerClient();
    expect(client.client_id).toBeTruthy();
    const fetched = await clientsStore.getClient(client.client_id);
    expect(fetched?.redirect_uris).toEqual(["https://app.test/cb"]);
  });
});

describe("authorization code exchange", () => {
  it("issues a code, exposes its PKCE challenge, and exchanges once", async () => {
    const client = await registerClient();
    const pendingId = stagePending(client.client_id, "challenge-abc");
    const { code, state } = finalizePendingAuthorization(pendingId);
    expect(state).toBe("xyz");

    expect(await provider.challengeForAuthorizationCode(client, code)).toBe(
      "challenge-abc",
    );

    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      "verifier",
      "https://app.test/cb",
    );
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    await expect(
      provider.exchangeAuthorizationCode(client, code, "verifier", "https://app.test/cb"),
    ).rejects.toThrow();
  });

  it("rejects a redirect_uri mismatch", async () => {
    const client = await registerClient();
    const { code } = finalizePendingAuthorization(stagePending(client.client_id, "c"));
    await expect(
      provider.exchangeAuthorizationCode(client, code, "v", "https://evil.test/cb"),
    ).rejects.toThrow();
  });

  it("rejects an expired code via the PKCE challenge lookup", async () => {
    const client = await registerClient();
    getDb()
      .prepare(
        `INSERT INTO oauth_authorization_code
         (code_hash, client_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, subject, expires_at, used)
         VALUES (?, ?, 'https://app.test/cb', 'c', 'S256', NULL, NULL, 'owner', ?, 0)`,
      )
      .run("deadbeef", client.client_id, nowSec() - 5);
    await expect(
      provider.challengeForAuthorizationCode(client, "anything"),
    ).rejects.toThrow();
  });
});

describe("refresh grant", () => {
  it("rotates the refresh token and refuses reuse", async () => {
    const client = await registerClient();
    const { code } = finalizePendingAuthorization(stagePending(client.client_id, "c"));
    const first = await provider.exchangeAuthorizationCode(
      client,
      code,
      "v",
      "https://app.test/cb",
    );
    const refreshed = await provider.exchangeRefreshToken(client, first.refresh_token!);
    expect(refreshed.access_token).toBeTruthy();
    await expect(
      provider.exchangeRefreshToken(client, first.refresh_token!),
    ).rejects.toThrow();
  });
});
