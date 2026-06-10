import { getDb } from "../core/db.js";
import { sha256, nowSec, randomToken } from "./util.js";

const ENROLLMENT_TTL = 1800;

export function mintEnrollmentToken(): string {
  const raw = randomToken();
  getDb()
    .prepare(
      "INSERT INTO enrollment_token (token_hash, expires_at, used) VALUES (?, ?, 0)",
    )
    .run(sha256(raw), nowSec() + ENROLLMENT_TTL);
  return raw;
}

export function isEnrollmentTokenValid(raw: string): boolean {
  const row = getDb()
    .prepare("SELECT expires_at, used FROM enrollment_token WHERE token_hash = ?")
    .get(sha256(raw)) as { expires_at: number; used: number } | undefined;
  return Boolean(row) && row!.used === 0 && row!.expires_at >= nowSec();
}

export function consumeEnrollmentToken(raw: string): void {
  getDb()
    .prepare("UPDATE enrollment_token SET used = 1 WHERE token_hash = ?")
    .run(sha256(raw));
}
