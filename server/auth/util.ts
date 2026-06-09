import { createHash, randomBytes, randomUUID } from "node:crypto";

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export const randomToken = (): string => randomBytes(32).toString("base64url");

export const randomId = (): string => randomUUID();
