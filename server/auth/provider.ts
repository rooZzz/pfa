import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getDb } from "../db.js";
import { clientsStore } from "./clients_store.js";
import {
  mintAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyAccessToken,
} from "./tokens.js";
import { publicOrigin, authorizedSubject } from "./config.js";
import { sha256, nowSec, randomToken, randomId } from "./util.js";

const CODE_TTL = 300;
const PENDING_TTL = 600;

type PendingRow = {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  resource: string | null;
  state: string | null;
  expires_at: number;
};

type CodeRow = {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
  subject: string;
  expires_at: number;
  used: number;
};

export function getPendingAuthorization(id: string): PendingRow | undefined {
  return getDb().prepare("SELECT * FROM pending_authorization WHERE id = ?").get(id) as
    | PendingRow
    | undefined;
}

export function finalizePendingAuthorization(id: string): {
  redirectUri: string;
  code: string;
  state?: string;
} {
  const db = getDb();
  const pending = getPendingAuthorization(id);
  if (!pending || pending.expires_at < nowSec()) {
    throw new Error("authorization request not found or expired");
  }
  const code = randomToken();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO oauth_authorization_code
       (code_hash, client_id, redirect_uri, code_challenge, code_challenge_method,
        scope, resource, subject, expires_at, used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      sha256(code),
      pending.client_id,
      pending.redirect_uri,
      pending.code_challenge,
      pending.code_challenge_method,
      pending.scope,
      pending.resource,
      authorizedSubject(),
      nowSec() + CODE_TTL,
    );
    db.prepare("DELETE FROM pending_authorization WHERE id = ?").run(id);
  });
  tx();
  return {
    redirectUri: pending.redirect_uri,
    code,
    state: pending.state ?? undefined,
  };
}

export const provider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const id = randomId();
    getDb()
      .prepare(
        `INSERT INTO pending_authorization
         (id, client_id, redirect_uri, code_challenge, code_challenge_method,
          scope, resource, state, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        client.client_id,
        params.redirectUri,
        params.codeChallenge,
        "S256",
        params.scopes?.join(" ") ?? null,
        params.resource?.href ?? null,
        params.state ?? null,
        nowSec() + PENDING_TTL,
      );
    res.redirect(`${publicOrigin()}/login?req=${encodeURIComponent(id)}`);
  },

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const row = getDb()
      .prepare(
        "SELECT code_challenge, expires_at, used FROM oauth_authorization_code WHERE code_hash = ?",
      )
      .get(sha256(authorizationCode)) as
      | { code_challenge: string; expires_at: number; used: number }
      | undefined;
    if (!row || row.used === 1 || row.expires_at < nowSec()) {
      throw new Error("invalid authorization code");
    }
    return row.code_challenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM oauth_authorization_code WHERE code_hash = ?")
      .get(sha256(authorizationCode)) as CodeRow | undefined;
    if (
      !row ||
      row.used === 1 ||
      row.expires_at < nowSec() ||
      row.client_id !== client.client_id
    ) {
      throw new Error("invalid authorization code");
    }
    if (redirectUri && redirectUri !== row.redirect_uri) {
      throw new Error("redirect_uri mismatch");
    }
    db.prepare("UPDATE oauth_authorization_code SET used = 1 WHERE code_hash = ?").run(
      sha256(authorizationCode),
    );
    const scope = row.scope ?? undefined;
    const { token, expiresIn } = await mintAccessToken(client.client_id, scope);
    const refresh = issueRefreshToken(
      client.client_id,
      row.subject,
      scope,
      row.resource ?? undefined,
    );
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope,
      refresh_token: refresh,
    };
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const rotated = rotateRefreshToken(refreshToken, client.client_id);
    const scope = rotated.scope;
    const { token, expiresIn } = await mintAccessToken(client.client_id, scope);
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope,
      refresh_token: rotated.refreshToken,
    };
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return verifyAccessToken(token);
  },

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    revokeRefreshToken(request.token);
  },
};
