import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Transaction } from "kysely";
import { DOCUMENTS_DIR } from "./db.js";
import type { AccountType, DatabaseSchema } from "./schema.js";

export async function writeManualDocument(
  trx: Transaction<DatabaseSchema>,
  payload: object,
): Promise<number> {
  const recorded_at = new Date().toISOString();
  const fullPayload = { ...payload, recorded_at };
  const json = JSON.stringify(fullPayload, null, 2);
  const safeTimestamp = recorded_at.replace(/:/g, "-");
  const filename = `manual_${safeTimestamp}.json`;
  const filePath = path.join(DOCUMENTS_DIR, filename);
  const contentHash = crypto.createHash("sha256").update(json).digest("hex");

  const row = await trx
    .insertInto("documents")
    .values({
      source_type: "manual",
      file_path: filePath,
      content_hash: contentHash,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  fs.writeFileSync(filePath, json, "utf-8");

  return Number(row.id);
}

export async function ensureAccount(
  trx: Transaction<DatabaseSchema>,
  name: string,
  type: AccountType,
  currency: string,
): Promise<number> {
  const existing = await trx
    .selectFrom("accounts")
    .select("id")
    .where("name", "=", name)
    .where("type", "=", type)
    .executeTakeFirst();
  if (existing) return Number(existing.id);

  const row = await trx
    .insertInto("accounts")
    .values({ name, type, currency })
    .returning("id")
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

export async function ensureAsset(
  trx: Transaction<DatabaseSchema>,
  name: string,
  asset_type: string,
  base_currency: string,
): Promise<number> {
  const existing = await trx
    .selectFrom("assets")
    .select("id")
    .where("name", "=", name)
    .where("asset_type", "=", asset_type)
    .executeTakeFirst();
  if (existing) return Number(existing.id);

  const row = await trx
    .insertInto("assets")
    .values({ name, asset_type, base_currency })
    .returning("id")
    .executeTakeFirstOrThrow();
  return Number(row.id);
}
