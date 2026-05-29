import type { ConnectorCredentials } from "../state.js";
import { MonzoApiError, MonzoReauthError } from "./errors.js";

export const MONZO_BASE_URL = "https://api.monzo.com";

export type MonzoTokens = Pick<
  ConnectorCredentials,
  "access_token" | "refresh_token" | "expires_at"
>;

async function postToken(
  fetchImpl: typeof fetch,
  body: URLSearchParams,
): Promise<{ access_token: string; refresh_token?: string; expires_at: string | null }> {
  const res = await fetchImpl(`${MONZO_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (res.status === 400 || res.status === 401) {
    throw new MonzoReauthError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MonzoApiError(res.status, text.slice(0, 200));
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : null,
  };
}

export async function refreshMonzoTokens(
  fetchImpl: typeof fetch,
  credentials: ConnectorCredentials,
): Promise<MonzoTokens> {
  const tokens = await postToken(
    fetchImpl,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
    }),
  );
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? credentials.refresh_token,
    expires_at: tokens.expires_at,
  };
}

export async function exchangeMonzoCode(
  fetchImpl: typeof fetch,
  params: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    code: string;
  },
): Promise<MonzoTokens> {
  const tokens = await postToken(
    fetchImpl,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: params.client_id,
      client_secret: params.client_secret,
      redirect_uri: params.redirect_uri,
      code: params.code,
    }),
  );
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    expires_at: tokens.expires_at,
  };
}
