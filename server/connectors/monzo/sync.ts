import type { Transaction } from "kysely";
import { getKysely } from "../../db.js";
import type { DatabaseSchema } from "../../schema.js";
import { ensureConnectorAccount, writeConnectorDocument } from "../references.js";
import { readConnectorState, saveSyncState } from "../state.js";
import { classifyInternal, classifyPotType, normalizeCategory } from "./classify.js";
import {
  createMonzoClient,
  type MonzoAccount,
  type MonzoBalance,
  type MonzoClient,
  type MonzoPot,
  type MonzoTransaction,
} from "./client.js";
import { MonzoReauthError } from "./errors.js";

const PROVIDER = "monzo";
const DAY_MS = 86_400_000;
const INCREMENTAL_WINDOW_DAYS = 89;
const HISTORY_FLOOR = "2010-01-01T00:00:00Z";

export type MonzoSyncResult = {
  backfill: boolean;
  accounts: number;
  pots: number;
  transactions_seen: number;
  transactions_inserted: number;
  earliest_occurred_at: string | null;
};

async function upsertBalanceSnapshot(
  trx: Transaction<DatabaseSchema>,
  accountId: number,
  balancePence: number,
  currency: string,
  syncDate: string,
  sourceId: number,
): Promise<void> {
  const existing = await trx
    .selectFrom("account_balances")
    .select("id")
    .where("account_id", "=", accountId)
    .where("valid_from", "=", syncDate)
    .where("valid_to", "is", null)
    .executeTakeFirst();

  if (existing) {
    await trx
      .updateTable("account_balances")
      .set({
        balance_pence: balancePence,
        currency,
        source_id: sourceId,
        recorded_at: new Date().toISOString(),
      })
      .where("id", "=", existing.id)
      .execute();
    return;
  }

  await trx
    .insertInto("account_balances")
    .values({
      account_id: accountId,
      balance_pence: balancePence,
      currency,
      valid_from: syncDate,
      source_id: sourceId,
    })
    .execute();
}

export async function runMonzoSync(opts: {
  backfill: boolean;
  client?: MonzoClient;
}): Promise<MonzoSyncResult> {
  const state = await readConnectorState(PROVIDER);
  if (!state) {
    throw new MonzoReauthError(
      "Monzo is not connected. Open the Connectors widget and run Connect first.",
    );
  }

  const client = opts.client ?? createMonzoClient({ provider: PROVIDER });

  const now = new Date();
  const before = now.toISOString();
  const incrementalSince = new Date(
    now.getTime() - INCREMENTAL_WINDOW_DAYS * DAY_MS,
  ).toISOString();
  const syncDate = before.slice(0, 10);

  const accounts = (await client.listAccounts()).filter(
    (account) =>
      !account.closed &&
      (account.type === "uk_retail" || account.type === "uk_retail_joint"),
  );

  const perAccount: {
    account: MonzoAccount;
    balance: MonzoBalance;
    pots: MonzoPot[];
    transactions: MonzoTransaction[];
  }[] = [];
  for (const account of accounts) {
    const balance = await client.getBalance(account.id);
    const pots = await client.listPots(account.id);
    const cursor = state.cursors[account.id];
    const since = opts.backfill
      ? (account.created ?? HISTORY_FLOOR)
      : (cursor ?? incrementalSince);
    const transactions = await client.listTransactions({
      accountId: account.id,
      since,
      before,
    });
    perAccount.push({ account, balance, pots, transactions });
  }

  const ownExternalIds = new Set<string>();
  let earliest: string | null = null;
  for (const { account, pots, transactions } of perAccount) {
    ownExternalIds.add(account.id);
    for (const pot of pots) ownExternalIds.add(pot.id);
    for (const transaction of transactions) {
      if (!earliest || transaction.created < earliest) earliest = transaction.created;
    }
  }

  const cursors = { ...state.cursors };
  let seen = 0;
  let inserted = 0;

  await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeConnectorDocument(trx, PROVIDER, {
        run: "sync",
        backfill: opts.backfill,
        synced_at: before,
        accounts: perAccount.map((entry) => ({
          external_id: entry.account.id,
          type: entry.account.type,
          transactions: entry.transactions.length,
          pots: entry.pots.length,
        })),
      });

      for (const { account, balance, pots, transactions } of perAccount) {
        const accountRowId = await ensureConnectorAccount(trx, {
          provider: PROVIDER,
          external_id: account.id,
          name: account.type === "uk_retail_joint" ? "Monzo Joint" : "Monzo Current",
          type: "current",
          currency: balance.currency,
        });

        for (const transaction of transactions) {
          seen++;
          const result = await trx
            .insertInto("transactions")
            .values({
              account_id: accountRowId,
              occurred_at: transaction.created,
              amount_pence: transaction.amount,
              currency: transaction.currency,
              description: transaction.merchant?.name ?? transaction.description ?? null,
              category: normalizeCategory(transaction.category),
              is_internal: classifyInternal(transaction, ownExternalIds) ? 1 : 0,
              external_id: transaction.id,
              source_id: sourceId,
            })
            .onConflict((oc) => oc.column("external_id").doNothing())
            .executeTakeFirst();
          if ((result.numInsertedOrUpdatedRows ?? 0n) > 0n) inserted++;
        }

        await upsertBalanceSnapshot(
          trx,
          accountRowId,
          balance.balance,
          balance.currency,
          syncDate,
          sourceId,
        );

        for (const pot of pots) {
          const potRowId = await ensureConnectorAccount(trx, {
            provider: PROVIDER,
            external_id: pot.id,
            name: pot.name,
            type: classifyPotType(pot),
            currency: pot.currency,
          });
          await upsertBalanceSnapshot(
            trx,
            potRowId,
            pot.deleted ? 0 : pot.balance,
            pot.currency,
            syncDate,
            sourceId,
          );
        }

        const latest = transactions.reduce(
          (max, transaction) => (transaction.created > max ? transaction.created : max),
          cursors[account.id] ?? "",
        );
        if (latest) cursors[account.id] = latest;
      }

      await saveSyncState(trx, PROVIDER, cursors, before);
    });

  return {
    backfill: opts.backfill,
    accounts: perAccount.length,
    pots: perAccount.reduce((total, entry) => total + entry.pots.length, 0),
    transactions_seen: seen,
    transactions_inserted: inserted,
    earliest_occurred_at: earliest,
  };
}
