import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DOCUMENTS_DIR } from "./db.js";

export function writeManualDocument(
  db: Database.Database,
  payload: object,
): number {
  const recorded_at = new Date().toISOString();
  const fullPayload = { ...payload, recorded_at };
  const json = JSON.stringify(fullPayload, null, 2);
  const safeTimestamp = recorded_at.replace(/:/g, "-");
  const filename = `manual_${safeTimestamp}.json`;
  const filePath = path.join(DOCUMENTS_DIR, filename);
  const contentHash = crypto.createHash("sha256").update(json).digest("hex");

  const docResult = db
    .prepare(
      "INSERT INTO documents (source_type, file_path, content_hash) VALUES ('manual', ?, ?)",
    )
    .run(filePath, contentHash);

  fs.writeFileSync(filePath, json, "utf-8");

  return Number(docResult.lastInsertRowid);
}

export function ensureAccount(
  db: Database.Database,
  name: string,
  type: string,
  currency: string,
): number {
  const existing = db
    .prepare("SELECT id FROM accounts WHERE name = ? AND type = ?")
    .get(name, type) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare("INSERT INTO accounts (name, type, currency) VALUES (?, ?, ?)")
    .run(name, type, currency);
  return Number(result.lastInsertRowid);
}

export function ensureAsset(
  db: Database.Database,
  name: string,
  asset_type: string,
  base_currency: string,
): number {
  const existing = db
    .prepare("SELECT id FROM assets WHERE name = ? AND asset_type = ?")
    .get(name, asset_type) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare(
      "INSERT INTO assets (name, asset_type, base_currency) VALUES (?, ?, ?)",
    )
    .run(name, asset_type, base_currency);
  return Number(result.lastInsertRowid);
}
