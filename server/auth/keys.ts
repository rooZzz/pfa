import { readFileSync } from "node:fs";
import { importPKCS8, importJWK, exportJWK, calculateJwkThumbprint } from "jose";
import { signingKeyPath } from "./config.js";

async function loadKeys() {
  const pem = readFileSync(signingKeyPath(), "utf8");
  const privateKey = await importPKCS8(pem, "EdDSA", { extractable: true });
  const full = await exportJWK(privateKey);
  const publicJwk = { kty: full.kty, crv: full.crv, x: full.x };
  const publicKey = await importJWK(publicJwk, "EdDSA");
  const kid = await calculateJwkThumbprint(publicJwk);
  return { privateKey, publicKey, kid, publicJwk };
}

let cache: Awaited<ReturnType<typeof loadKeys>> | null = null;

export async function getKeys(): Promise<Awaited<ReturnType<typeof loadKeys>>> {
  if (!cache) {
    cache = await loadKeys();
  }
  return cache;
}

export async function jwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const { publicJwk, kid } = await getKeys();
  return { keys: [{ ...publicJwk, kid, use: "sig", alg: "EdDSA" }] };
}
