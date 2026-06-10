import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Transaction } from "kysely";
import { DOCUMENTS_DIR } from "../core/db.js";
import type { AccountType, DatabaseSchema } from "../core/schema.js";

export async function writeConnectorDocument(
  trx: Transaction<DatabaseSchema>,
  provider: string,
  payload: object,
): Promise<number> {
  const recorded_at = new Date().toISOString();
  const fullPayload = { source_type: "connector", provider, ...payload, recorded_at };
  const json = JSON.stringify(fullPayload, null, 2);
  const safeTimestamp = recorded_at.replace(/:/g, "-");
  const filename = `connector_${provider}_${safeTimestamp}.json`;
  const filePath = path.join(DOCUMENTS_DIR, filename);
  const contentHash = crypto.createHash("sha256").update(json).digest("hex");

  const row = await trx
    .insertInto("documents")
    .values({ source_type: "connector", file_path: filePath, content_hash: contentHash })
    .returning("id")
    .executeTakeFirstOrThrow();

  fs.writeFileSync(filePath, json, "utf-8");

  return Number(row.id);
}

export async function ensureConnectorAccount(
  trx: Transaction<DatabaseSchema>,
  params: {
    provider: string;
    external_id: string;
    name: string;
    type: AccountType;
    currency: string;
  },
): Promise<number> {
  const existing = await trx
    .selectFrom("accounts")
    .select(["id", "name", "type"])
    .where("provider", "=", params.provider)
    .where("external_id", "=", params.external_id)
    .executeTakeFirst();

  if (existing) {
    if (existing.name !== params.name || existing.type !== params.type) {
      await trx
        .updateTable("accounts")
        .set({ name: params.name, type: params.type })
        .where("id", "=", existing.id)
        .execute();
    }
    return Number(existing.id);
  }

  const row = await trx
    .insertInto("accounts")
    .values({
      name: params.name,
      type: params.type,
      currency: params.currency,
      provider: params.provider,
      external_id: params.external_id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return Number(row.id);
}
