import {
  readConnectorState,
  saveRefreshedTokens,
  type ConnectorState,
} from "../state.js";
import { MonzoApiError, MonzoRateLimitError, MonzoReauthError } from "./errors.js";
import { MONZO_BASE_URL, refreshMonzoTokens } from "./tokens.js";

const REFRESH_SKEW_MS = 60_000;

export type MonzoAccount = {
  id: string;
  description: string;
  type: string;
  closed?: boolean;
  created?: string;
};

export type MonzoBalance = {
  balance: number;
  total_balance: number;
  currency: string;
};

export type MonzoPot = {
  id: string;
  name: string;
  balance: number;
  currency: string;
  deleted: boolean;
  type?: string;
  product?: string;
};

export type MonzoTransaction = {
  id: string;
  amount: number;
  currency: string;
  created: string;
  description: string | null;
  category?: string;
  scheme?: string;
  merchant?: { name?: string } | null;
  metadata?: Record<string, unknown>;
  counterparty?: { account_id?: string } | null;
};

export type MonzoClient = {
  listAccounts(): Promise<MonzoAccount[]>;
  getBalance(accountId: string): Promise<MonzoBalance>;
  listPots(currentAccountId: string): Promise<MonzoPot[]>;
  listTransactions(opts: {
    accountId: string;
    since?: string;
    before?: string;
  }): Promise<MonzoTransaction[]>;
};

export function createMonzoClient(opts: {
  provider?: string;
  fetchImpl?: typeof fetch;
}): MonzoClient {
  const provider = opts.provider ?? "monzo";
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function loadState(): Promise<ConnectorState> {
    const state = await readConnectorState(provider);
    if (!state) {
      throw new MonzoReauthError(
        "Monzo is not connected. Open the Connectors widget and run Connect first.",
      );
    }
    return state;
  }

  async function refresh(state: ConnectorState): Promise<string> {
    if (!state.refresh_token || !state.client_id || !state.client_secret) {
      throw new MonzoReauthError(
        "The Monzo access token has expired and no refresh token is stored. Open the Connectors widget and run Connect again with a fresh token.",
      );
    }
    const tokens = await refreshMonzoTokens(fetchImpl, state);
    await saveRefreshedTokens(provider, tokens);
    return tokens.access_token;
  }

  async function currentAccessToken(): Promise<string> {
    const state = await loadState();
    if (state.expires_at && Date.parse(state.expires_at) - Date.now() < REFRESH_SKEW_MS) {
      return refresh(state);
    }
    return state.access_token;
  }

  async function request<T>(path: string): Promise<T> {
    let accessToken = await currentAccessToken();
    let refreshed = false;

    while (true) {
      const res = await fetchImpl(`${MONZO_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        accessToken = await refresh(await loadState());
        continue;
      }
      if (res.status === 401) throw new MonzoReauthError();
      if (res.status === 429) {
        throw new MonzoRateLimitError(res.headers.get("Retry-After"));
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new MonzoApiError(res.status, text.slice(0, 200));
      }
      return (await res.json()) as T;
    }
  }

  return {
    async listAccounts() {
      const json = await request<{ accounts: MonzoAccount[] }>("/accounts");
      return json.accounts;
    },
    async getBalance(accountId) {
      const params = new URLSearchParams({ account_id: accountId });
      return request<MonzoBalance>(`/balance?${params.toString()}`);
    },
    async listPots(currentAccountId) {
      const params = new URLSearchParams({ current_account_id: currentAccountId });
      const json = await request<{ pots: MonzoPot[] }>(`/pots?${params.toString()}`);
      return json.pots;
    },
    async listTransactions({ accountId, since, before }) {
      const PAGE_LIMIT = 100;
      const all: MonzoTransaction[] = [];
      let cursor = since;
      while (true) {
        const params = new URLSearchParams({
          account_id: accountId,
          limit: String(PAGE_LIMIT),
        });
        params.append("expand[]", "merchant");
        if (cursor) params.set("since", cursor);
        if (before) params.set("before", before);
        const json = await request<{ transactions: MonzoTransaction[] }>(
          `/transactions?${params.toString()}`,
        );
        const page = json.transactions;
        all.push(...page);
        if (page.length < PAGE_LIMIT) break;
        cursor = page[page.length - 1]!.id;
      }
      return all;
    },
  };
}
