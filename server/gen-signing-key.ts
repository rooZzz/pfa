import { config } from "dotenv";
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { generateKeyPair, exportPKCS8 } from "jose";

config({ override: true, path: path.join(import.meta.dirname, ".env") });

const { signingKeyPath } = await import("./auth/config.js");
const keyPath = signingKeyPath();

if (existsSync(keyPath)) {
  process.stderr.write(
    `Signing key already exists at ${keyPath}; refusing to overwrite.\n`,
  );
  process.exit(1);
}

const { privateKey } = await generateKeyPair("EdDSA", { extractable: true });
const pem = await exportPKCS8(privateKey);
writeFileSync(keyPath, pem, { mode: 0o600 });
process.stdout.write(`Wrote Ed25519 signing key to ${keyPath} (0600).\n`);
