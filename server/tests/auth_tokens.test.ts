import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { setupAuthEnv } from "./auth_env.js";
import { getDb, initDb } from "../db.js";
import {
  mintAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../auth/tokens.js";

let privateKey: CryptoKey;

beforeAll(async () => {
  ({ privateKey } = await setupAuthEnv());
});

beforeEach(() => {
  initDb();
  getDb().exec("DELETE FROM oauth_refresh_token;");
});

function sign(opts: {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
}): Promise<string> {
  const jwt = new SignJWT({ client_id: "c" })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setIssuer(opts.iss ?? "https://pfa.test")
    .setAudience(opts.aud ?? "https://pfa.test/mcp")
    .setSubject(opts.sub ?? "owner")
    .setExpirationTime(opts.exp ?? "1800s");
  return jwt.sign(privateKey);
}

describe("access token verification", () => {
  it("mints and verifies a valid token", async () => {
    const { token } = await mintAccessToken("client-1", "mcp");
    const info = await verifyAccessToken(token);
    expect(info.clientId).toBe("client-1");
    expect(info.scopes).toContain("mcp");
  });

  it("rejects a token for the wrong subject", async () => {
    await expect(verifyAccessToken(await sign({ sub: "intruder" }))).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    await expect(verifyAccessToken(await sign({ exp: past }))).rejects.toThrow();
  });

  it("rejects a wrong audience", async () => {
    await expect(
      verifyAccessToken(await sign({ aud: "https://evil/mcp" })),
    ).rejects.toThrow();
  });

  it("rejects a wrong issuer", async () => {
    await expect(
      verifyAccessToken(await sign({ iss: "https://evil" })),
    ).rejects.toThrow();
  });

  it("rejects a tampered or garbage token", async () => {
    const { token } = await mintAccessToken("c", undefined);
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
    await expect(verifyAccessToken("not.a.jwt")).rejects.toThrow();
  });
});

describe("refresh token rotation", () => {
  it("rotates and invalidates the prior refresh token", () => {
    const r1 = issueRefreshToken("c", "owner", "mcp", undefined);
    const { refreshToken: r2 } = rotateRefreshToken(r1, "c");
    expect(r2).not.toBe(r1);
    expect(() => rotateRefreshToken(r1, "c")).toThrow();
    expect(rotateRefreshToken(r2, "c").refreshToken).toBeTruthy();
  });

  it("rejects rotation for the wrong client and after revoke", () => {
    const r = issueRefreshToken("c", "owner", undefined, undefined);
    expect(() => rotateRefreshToken(r, "other")).toThrow();
    revokeRefreshToken(r);
    expect(() => rotateRefreshToken(r, "c")).toThrow();
  });
});
