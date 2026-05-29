import { describe, expect, it } from "vitest";
import { MonzoReauthError } from "../connectors/monzo/errors.js";
import { exchangeMonzoCode, refreshMonzoTokens } from "../connectors/monzo/tokens.js";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

const creds = {
  client_id: "cid",
  client_secret: "secret",
  access_token: "old-access",
  refresh_token: "old-refresh",
  expires_at: null,
};

describe("exchangeMonzoCode", () => {
  it("returns the access and refresh tokens from a successful exchange", async () => {
    const fetchImpl = fetchReturning(200, {
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    });
    const tokens = await exchangeMonzoCode(fetchImpl, {
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: "http://localhost:51789/callback",
      code: "the-code",
    });
    expect(tokens.access_token).toBe("new-access");
    expect(tokens.refresh_token).toBe("new-refresh");
    expect(tokens.expires_at).not.toBeNull();
  });

  it("throws a re-auth error when Monzo rejects the code", async () => {
    const fetchImpl = fetchReturning(400, { error: "invalid_grant" });
    await expect(
      exchangeMonzoCode(fetchImpl, {
        client_id: "cid",
        client_secret: "secret",
        redirect_uri: "http://localhost:51789/callback",
        code: "bad",
      }),
    ).rejects.toBeInstanceOf(MonzoReauthError);
  });
});

describe("refreshMonzoTokens", () => {
  it("keeps the existing refresh token when the response omits one", async () => {
    const fetchImpl = fetchReturning(200, { access_token: "fresh", expires_in: 3600 });
    const tokens = await refreshMonzoTokens(fetchImpl, creds);
    expect(tokens.access_token).toBe("fresh");
    expect(tokens.refresh_token).toBe("old-refresh");
  });
});
