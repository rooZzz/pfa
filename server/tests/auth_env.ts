import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPair, exportPKCS8 } from "jose";

export async function setupAuthEnv(): Promise<{
  privateKey: CryptoKey;
  keyPath: string;
}> {
  const { privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const keyPath = path.join(os.tmpdir(), `pfa-test-key-${process.pid}.pem`);
  fs.writeFileSync(keyPath, pem, { mode: 0o600 });
  process.env.PUBLIC_ORIGIN = "https://pfa.test";
  process.env.RP_ID = "pfa.test";
  process.env.RP_NAME = "pfa";
  process.env.MCP_RESOURCE = "https://pfa.test/mcp";
  process.env.AUTHORIZED_SUBJECT = "owner";
  process.env.ACCESS_TOKEN_TTL = "1800";
  process.env.REFRESH_TOKEN_TTL = "5184000";
  process.env.SIGNING_KEY_PATH = keyPath;
  return { privateKey: privateKey as CryptoKey, keyPath };
}
