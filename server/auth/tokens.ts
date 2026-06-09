import { SignJWT, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getDb } from "../db.js";
import { getKeys } from "./keys.js";
import {
  publicOrigin,
  mcpResource,
  authorizedSubject,
  accessTokenTtl,
  refreshTokenTtl,
} from "./config.js";
import { sha256, nowSec, randomToken } from "./util.js";

type RefreshRow = {
  token_hash: string;
  client_id: string;
  subject: string;
  scope: string | null;
  resource: string | null;
  expires_at: number;
  revoked: number;
};

export async function mintAccessToken(
  clientId: string,
  scope: string | undefined,
  resource: string | undefined,
): Promise<{ token: string; expiresIn: number }> {
  const { privateKey, kid } = await getKeys();
  const ttl = accessTokenTtl();
  const token = await new SignJWT({ client_id: clientId, scope })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setIssuedAt()
    .setIssuer(publicOrigin())
    .setAudience(resource ?? mcpResource())
    .setSubject(authorizedSubject())
    .setExpirationTime(`${ttl}s`)
    .sign(privateKey);
  return { token, expiresIn: ttl };
}

export async function verifyAccessToken(token: string): Promise<AuthInfo> {
  const { publicKey } = await getKeys();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: publicOrigin(),
    audience: mcpResource(),
  });
  if (payload.sub !== authorizedSubject()) {
    throw new Error("token subject is not the authorized user");
  }
  const scope = typeof payload.scope === "string" ? payload.scope : "";
  return {
    token,
    clientId: typeof payload.client_id === "string" ? payload.client_id : "",
    scopes: scope ? scope.split(" ") : [],
    expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
    resource: new URL(mcpResource()),
  };
}

export function issueRefreshToken(
  clientId: string,
  subject: string,
  scope: string | undefined,
  resource: string | undefined,
): string {
  const raw = randomToken();
  getDb()
    .prepare(
      `INSERT INTO oauth_refresh_token
       (token_hash, client_id, subject, scope, resource, expires_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      sha256(raw),
      clientId,
      subject,
      scope ?? null,
      resource ?? null,
      nowSec() + refreshTokenTtl(),
    );
  return raw;
}

export function rotateRefreshToken(
  raw: string,
  clientId: string,
): { refreshToken: string; subject: string; scope?: string; resource?: string } {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM oauth_refresh_token WHERE token_hash = ?")
    .get(sha256(raw)) as RefreshRow | undefined;
  if (
    !row ||
    row.revoked === 1 ||
    row.client_id !== clientId ||
    row.expires_at < nowSec()
  ) {
    throw new Error("invalid_grant: refresh token is not valid");
  }
  const next = randomToken();
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE oauth_refresh_token SET revoked = 1, rotated_to = ? WHERE token_hash = ?",
    ).run(sha256(next), row.token_hash);
    db.prepare(
      `INSERT INTO oauth_refresh_token
       (token_hash, client_id, subject, scope, resource, expires_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      sha256(next),
      clientId,
      row.subject,
      row.scope,
      row.resource,
      nowSec() + refreshTokenTtl(),
    );
  });
  tx();
  return {
    refreshToken: next,
    subject: row.subject,
    scope: row.scope ?? undefined,
    resource: row.resource ?? undefined,
  };
}

export function revokeRefreshToken(raw: string): void {
  getDb()
    .prepare("UPDATE oauth_refresh_token SET revoked = 1 WHERE token_hash = ?")
    .run(sha256(raw));
}
