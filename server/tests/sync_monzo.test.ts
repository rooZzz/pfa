import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMonzoSync } from "../connectors/monzo/sync.js";
import { saveConnectorCredentials } from "../connectors/state.js";
import { getDb, initDb } from "../db.js";
import { averageMonthlyOutgoings, liquidSavings } from "../metrics/index.js";
import { getNetWorth } from "../net_worth/index.js";
import { resetDuck } from "../query.js";
import { makeFakeClient } from "./fixtures/monzo.js";

const TODAY = new Date().toISOString().slice(0, 10);

afterEach(() => {
  resetDuck();
});

beforeEach(async () => {
  initDb();
  getDb().exec(`
    DELETE FROM transactions;
    DELETE FROM account_balances;
    DELETE FROM accounts;
    DELETE FROM documents;
    DELETE FROM connector_state;
  `);
  await saveConnectorCredentials("monzo", {
    client_id: "cid",
    client_secret: "secret",
    access_token: "tok",
    refresh_token: "refresh",
    expires_at: null,
  });
});

function countOf(table: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
    n: number;
  };
  return row.n;
}

function transactionByExternalId(externalId: string) {
  return getDb()
    .prepare(
      "SELECT amount_pence, is_internal, source_id, category FROM transactions WHERE external_id = ?",
    )
    .get(externalId) as
    | { amount_pence: number; is_internal: number; source_id: number; category: string }
    | undefined;
}

describe("runMonzoSync", () => {
  it("backfills accounts, pots-as-accounts, and transactions", async () => {
    const result = await runMonzoSync({ backfill: true, client: makeFakeClient() });

    expect(result.accounts).toBe(2);
    expect(result.pots).toBe(3);
    expect(result.transactions_seen).toBe(6);
    expect(result.transactions_inserted).toBe(6);

    expect(countOf("transactions")).toBe(6);
    expect(countOf("accounts")).toBe(5);
  });

  it("does not duplicate transactions on re-sync and preserves original source_id", async () => {
    await runMonzoSync({ backfill: true, client: makeFakeClient() });
    const first = transactionByExternalId("tx_groceries");

    const second = await runMonzoSync({ backfill: false, client: makeFakeClient() });

    expect(second.transactions_seen).toBe(6);
    expect(second.transactions_inserted).toBe(0);
    expect(countOf("transactions")).toBe(6);
    const after = transactionByExternalId("tx_groceries");
    expect(after?.source_id).toBe(first?.source_id);
  });

  it("classifies pot transfers and own-account transfers as internal", async () => {
    await runMonzoSync({ backfill: true, client: makeFakeClient() });

    expect(transactionByExternalId("tx_pot_transfer")?.is_internal).toBe(1);
    expect(transactionByExternalId("tx_to_joint")?.is_internal).toBe(1);
    expect(transactionByExternalId("tx_isa_contribution")?.is_internal).toBe(1);
    expect(transactionByExternalId("tx_groceries")?.is_internal).toBe(0);
    expect(transactionByExternalId("tx_salary")?.is_internal).toBe(0);
    expect(transactionByExternalId("tx_joint_dinner")?.is_internal).toBe(0);
  });

  it("records the pot-excluding balance for the account and pots as separate series", async () => {
    await runMonzoSync({ backfill: true, client: makeFakeClient() });

    const balanceFor = (externalId: string) =>
      (
        getDb()
          .prepare(
            `SELECT b.balance_pence AS p
             FROM account_balances b
             JOIN accounts a ON a.id = b.account_id
             WHERE a.external_id = ?`,
          )
          .get(externalId) as { p: number } | undefined
      )?.p;

    expect(balanceFor("acc_personal")).toBe(150000);
    expect(balanceFor("pot_savings")).toBe(120000);
    expect(balanceFor("pot_isa")).toBe(80000);
    expect(
      balanceFor("acc_personal")! + balanceFor("pot_savings")! + balanceFor("pot_isa")!,
    ).toBe(350000);
  });

  it("tombstones a deleted pot with a zero balance, never deleting the row", async () => {
    await runMonzoSync({ backfill: true, client: makeFakeClient() });

    const potOld = getDb()
      .prepare("SELECT id FROM accounts WHERE external_id = 'pot_old'")
      .get() as { id: number } | undefined;
    expect(potOld).toBeDefined();

    const balance = getDb()
      .prepare("SELECT balance_pence AS p FROM account_balances WHERE account_id = ?")
      .get(potOld!.id) as { p: number };
    expect(balance.p).toBe(0);
  });

  it("replaces the same-day open balance row instead of appending", async () => {
    await runMonzoSync({ backfill: true, client: makeFakeClient() });
    await runMonzoSync({ backfill: true, client: makeFakeClient() });

    const personal = getDb()
      .prepare("SELECT id FROM accounts WHERE external_id = 'acc_personal'")
      .get() as { id: number };
    const openRows = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM account_balances WHERE account_id = ? AND valid_from = ? AND valid_to IS NULL",
      )
      .get(personal.id, TODAY) as { n: number };
    expect(openRows.n).toBe(1);
  });

  it("names accounts by type and omits zero-balance accounts from net worth", async () => {
    await runMonzoSync({ backfill: true, client: makeFakeClient() });

    const nameOf = (externalId: string) =>
      (
        getDb()
          .prepare("SELECT name FROM accounts WHERE external_id = ?")
          .get(externalId) as { name: string } | undefined
      )?.name;
    expect(nameOf("acc_personal")).toBe("Monzo Current");
    expect(nameOf("acc_joint")).toBe("Monzo Joint");

    const netWorth = await getNetWorth(TODAY);
    const accountLines = netWorth.realised.filter((line) => line.kind === "account");
    expect(accountLines.every((line) => line.value_pence !== 0)).toBe(true);
    expect(accountLines.some((line) => line.name === "Old Holiday")).toBe(false);
  });

  it("feeds liquid savings and excludes internal transfers from outgoings", async () => {
    await runMonzoSync({ backfill: true, client: makeFakeClient() });

    const liquid = await liquidSavings(TODAY);
    expect(liquid.resolved).toBe(true);
    expect(liquid.value).toBe(430000);

    const outgoings = await averageMonthlyOutgoings(TODAY);
    expect(outgoings.resolved).toBe(true);
    expect(outgoings.value).toBe(10500);
  });
});
