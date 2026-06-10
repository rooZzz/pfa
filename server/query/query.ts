import duckdb from "duckdb";
import { DB_PATH } from "../core/db.js";

type Row = Record<string, unknown>;

let duckInit: Promise<duckdb.Database> | null = null;

function runRawOnDb(db: duckdb.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function initDuck(): Promise<duckdb.Database> {
  const instance = new duckdb.Database(":memory:");

  await runRawOnDb(instance, "INSTALL sqlite");
  await runRawOnDb(instance, "LOAD sqlite");
  await runRawOnDb(instance, `ATTACH '${DB_PATH}' AS pfa (TYPE sqlite, READ_ONLY)`);

  return instance;
}

function getDuck(): Promise<duckdb.Database> {
  if (!duckInit) duckInit = initDuck();
  return duckInit;
}

export function resetDuck(): void {
  duckInit = null;
}

export async function runQuery(sql: string, params: unknown[] = []): Promise<Row[]> {
  const db = await getDuck();

  return new Promise((resolve, reject) => {
    db.all(sql, ...params, (err: Error | null, rows: Row[]) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function runExec(sql: string): Promise<void> {
  const db = await getDuck();
  return runRawOnDb(db, sql);
}

export type ReadContext = { schema: string };
export const LIVE_CONTEXT: ReadContext = { schema: "pfa" };

export type OverlayBalance = {
  account_id: number;
  balance_pence: number;
  valid_from: string;
};
export type OverlayTransaction = {
  account_id: number;
  amount_pence: number;
  occurred_at: string;
  category?: string;
  is_internal?: boolean;
};
export type OverlayIncome = {
  pay_date: string;
  gross_pence: number;
  paye_pence?: number;
  ni_employee_pence?: number;
  pension_employee_pence?: number;
  pension_employer_pence?: number;
  tax_code?: string;
};
export type Overlay = {
  balances?: OverlayBalance[];
  transactions?: OverlayTransaction[];
  income_events?: OverlayIncome[];
};

const SCENARIO_SCHEMA = "scen";
const CLONE_TABLES = [
  "accounts",
  "account_balances",
  "transactions",
  "income_events",
  "pension_values",
];

export async function setupScenario(overlay: Overlay): Promise<ReadContext> {
  await runExec(`DROP SCHEMA IF EXISTS ${SCENARIO_SCHEMA} CASCADE`);
  await runExec(`CREATE SCHEMA ${SCENARIO_SCHEMA}`);
  for (const table of CLONE_TABLES) {
    await runExec(
      `CREATE TABLE ${SCENARIO_SCHEMA}.${table} AS SELECT * FROM pfa.${table}`,
    );
  }

  let nextId = 2_000_000_000;
  for (const balance of overlay.balances ?? []) {
    await runQuery(
      `INSERT INTO ${SCENARIO_SCHEMA}.account_balances
         (id, account_id, balance_pence, valid_from, recorded_at)
       VALUES (?, ?, ?, CAST(? AS DATE), CAST(? AS TIMESTAMP))`,
      [
        nextId++,
        balance.account_id,
        balance.balance_pence,
        balance.valid_from,
        balance.valid_from,
      ],
    );
  }
  for (const txn of overlay.transactions ?? []) {
    await runQuery(
      `INSERT INTO ${SCENARIO_SCHEMA}.transactions
         (id, account_id, amount_pence, occurred_at, recorded_at, category, is_internal)
       VALUES (?, ?, ?, CAST(? AS TIMESTAMP), CAST(? AS TIMESTAMP), ?, ?)`,
      [
        nextId++,
        txn.account_id,
        txn.amount_pence,
        txn.occurred_at,
        txn.occurred_at,
        txn.category ?? "other",
        txn.is_internal ? 1 : 0,
      ],
    );
  }
  for (const event of overlay.income_events ?? []) {
    const paye = event.paye_pence ?? 0;
    const ni = event.ni_employee_pence ?? 0;
    const pension = event.pension_employee_pence ?? 0;
    const employerPension = event.pension_employer_pence ?? 0;
    const net = event.gross_pence - paye - ni - pension;
    await runQuery(
      `INSERT INTO ${SCENARIO_SCHEMA}.income_events
         (id, pay_date, gross_pence, net_pence, paye_pence, ni_employee_pence,
          pension_employee_pence, pension_employer_pence, tax_code, occurred_at, recorded_at)
       VALUES (?, CAST(? AS DATE), ?, ?, ?, ?, ?, ?, ?, CAST(? AS TIMESTAMP), CAST(? AS TIMESTAMP))`,
      [
        nextId++,
        event.pay_date,
        event.gross_pence,
        net,
        paye,
        ni,
        pension,
        employerPension,
        event.tax_code ?? null,
        event.pay_date,
        event.pay_date,
      ],
    );
  }

  return { schema: SCENARIO_SCHEMA };
}

export async function teardownScenario(): Promise<void> {
  await runExec(`DROP SCHEMA IF EXISTS ${SCENARIO_SCHEMA} CASCADE`);
}
