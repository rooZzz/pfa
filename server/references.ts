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

const TICKERED_ASSET_TYPES = new Set(["stock", "etf", "crypto"]);

export const CRYPTO_QUANTITY_SCALE = 100_000_000;

export function normalizeTicker(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.(L|LON|UK)$/, "");
}

export function priceSourceForAssetType(asset_type: string): string {
  if (asset_type === "crypto") return "coingecko";
  if (asset_type === "stock" || asset_type === "etf") return "yahoo";
  return "manual";
}

export function quantityScaleForAssetType(asset_type: string): number {
  return asset_type === "crypto" ? CRYPTO_QUANTITY_SCALE : 1;
}

function normalizeContractAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function ensureAsset(
  trx: Transaction<DatabaseSchema>,
  name: string,
  asset_type: string,
  base_currency: string,
  ticker?: string,
  opts?: { contract_address?: string },
): Promise<number> {
  const normalized = ticker ? normalizeTicker(ticker) : null;
  const contract = opts?.contract_address
    ? normalizeContractAddress(opts.contract_address)
    : null;

  if (contract) {
    const byContract = await trx
      .selectFrom("assets")
      .select(["id"])
      .where("contract_address", "=", contract)
      .executeTakeFirst();
    if (byContract) return Number(byContract.id);
  } else if (normalized) {
    const byTicker = await trx
      .selectFrom("assets")
      .select(["id"])
      .where("ticker", "=", normalized)
      .executeTakeFirst();
    if (byTicker) return Number(byTicker.id);
  } else {
    const byName = await trx
      .selectFrom("assets")
      .select(["id"])
      .where("name", "=", name)
      .where("asset_type", "=", asset_type)
      .executeTakeFirst();
    if (byName) return Number(byName.id);
  }

  const row = await trx
    .insertInto("assets")
    .values({
      name,
      asset_type,
      base_currency,
      ticker: normalized,
      price_source: priceSourceForAssetType(asset_type),
      quantity_scale: quantityScaleForAssetType(asset_type),
      contract_address: contract,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return Number(row.id);
}

export function requiresTicker(asset_type: string): boolean {
  return TICKERED_ASSET_TYPES.has(asset_type);
}
