import type {
  MonzoAccount,
  MonzoBalance,
  MonzoClient,
  MonzoPot,
  MonzoTransaction,
} from "../../connectors/monzo/client.js";

export const ACCOUNTS: MonzoAccount[] = [
  { id: "acc_personal", description: "Monzo Current", type: "uk_retail" },
  { id: "acc_joint", description: "Monzo Joint", type: "uk_retail_joint" },
];

export const BALANCES: Record<string, MonzoBalance> = {
  acc_personal: { balance: 150000, total_balance: 350000, currency: "GBP" },
  acc_joint: { balance: 80000, total_balance: 80000, currency: "GBP" },
};

export const POTS: Record<string, MonzoPot[]> = {
  acc_personal: [
    {
      id: "pot_savings",
      name: "Rainy Day",
      balance: 120000,
      currency: "GBP",
      deleted: false,
      type: "flexible_savings",
    },
    {
      id: "pot_isa",
      name: "Cash ISA",
      balance: 80000,
      currency: "GBP",
      deleted: false,
      type: "cash_isa",
    },
    { id: "pot_old", name: "Old Holiday", balance: 0, currency: "GBP", deleted: true },
  ],
  acc_joint: [],
};

export const TRANSACTIONS: Record<string, MonzoTransaction[]> = {
  acc_personal: [
    {
      id: "tx_groceries",
      amount: -4500,
      currency: "GBP",
      created: "2026-02-10T09:00:00Z",
      description: "Tesco",
      category: "groceries",
      merchant: { name: "Tesco" },
    },
    {
      id: "tx_salary",
      amount: 250000,
      currency: "GBP",
      created: "2026-02-01T00:00:00Z",
      description: "ACME PAY",
      category: "income",
    },
    {
      id: "tx_pot_transfer",
      amount: -120000,
      currency: "GBP",
      created: "2026-02-02T00:00:00Z",
      description: "pot deposit",
      scheme: "uk_retail_pot",
      metadata: { pot_id: "pot_savings" },
    },
    {
      id: "tx_to_joint",
      amount: -20000,
      currency: "GBP",
      created: "2026-02-03T00:00:00Z",
      description: "to joint",
      counterparty: { account_id: "acc_joint" },
    },
    {
      id: "tx_isa_contribution",
      amount: -80000,
      currency: "GBP",
      created: "2026-02-04T00:00:00Z",
      description: "ISA top up",
      scheme: "uk_retail_pot",
      metadata: { pot_id: "pot_isa" },
    },
  ],
  acc_joint: [
    {
      id: "tx_joint_dinner",
      amount: -6000,
      currency: "GBP",
      created: "2026-02-12T19:00:00Z",
      description: "Dinner",
      category: "eating_out",
      merchant: { name: "Pizza Place" },
    },
  ],
};

export function makeFakeClient(data?: {
  accounts?: MonzoAccount[];
  balances?: Record<string, MonzoBalance>;
  pots?: Record<string, MonzoPot[]>;
  transactions?: Record<string, MonzoTransaction[]>;
}): MonzoClient {
  const accounts = data?.accounts ?? ACCOUNTS;
  const balances = data?.balances ?? BALANCES;
  const pots = data?.pots ?? POTS;
  const transactions = data?.transactions ?? TRANSACTIONS;
  return {
    listAccounts: async () => accounts,
    getBalance: async (accountId) => balances[accountId]!,
    listPots: async (accountId) => pots[accountId] ?? [],
    listTransactions: async ({ accountId }) => transactions[accountId] ?? [],
  };
}
