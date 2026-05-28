import duckdb from "duckdb";
import { DB_PATH } from "./db.js";

type Row = Record<string, unknown>;

let duck: duckdb.Database | null = null;

function runRawOnDb(db: duckdb.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function getDuck(): Promise<duckdb.Database> {
  if (duck) return duck;

  const instance = new duckdb.Database(":memory:");

  await runRawOnDb(instance, "INSTALL sqlite");
  await runRawOnDb(instance, "LOAD sqlite");
  await runRawOnDb(instance, `ATTACH '${DB_PATH}' AS pfa (TYPE sqlite, READ_ONLY)`);

  duck = instance;
  return duck;
}

export function resetDuck(): void {
  duck = null;
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
