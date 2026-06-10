import path from "node:path";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { generateKeyPair, exportPKCS8 } from "jose";
import { loadEnv } from "../env.js";

loadEnv();

const { signingKeyPath } = await import("../auth/config.js");
const keyPath = signingKeyPath();

if (existsSync(keyPath)) {
  process.stdout.write(
    `Signing key already exists at ${keyPath}; leaving it in place.\n`,
  );
  process.exit(0);
}

mkdirSync(path.dirname(keyPath), { recursive: true });
const { privateKey } = await generateKeyPair("EdDSA", { extractable: true });
const pem = await exportPKCS8(privateKey);
writeFileSync(keyPath, pem, { mode: 0o600 });
process.stdout.write(`Wrote Ed25519 signing key to ${keyPath} (0600).\n`);
