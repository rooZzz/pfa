import http from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAuthEnv } from "./auth_env.js";
import { initDb } from "../db.js";

const PORT = 45711;
let server: Server;

beforeAll(async () => {
  await setupAuthEnv();
  process.env.AUTH_PORT = String(PORT);
  initDb();
  const { buildAuthApp } = await import("../auth/app.js");
  const app = buildAuthApp();
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, "127.0.0.1", () => resolve());
  });
});

afterAll(() => {
  server?.close();
});

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path, method, headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("auth app surface", () => {
  it("serves an unauthenticated health check", async () => {
    const res = await request("GET", "/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("rejects a foreign Host header (DNS-rebinding guard)", async () => {
    const res = await request("GET", "/health", { host: "evil.example" });
    expect(res.status).toBe(403);
  });

  it("returns 401 with a WWW-Authenticate challenge on unauthenticated /mcp", async () => {
    const res = await request("POST", "/mcp", { "content-type": "application/json" });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeTruthy();
  });

  it("publishes authorization server metadata at the public origin", async () => {
    const res = await request("GET", "/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).issuer).toBe("https://pfa.test/");
  });

  it("publishes a JWKS with one signing key", async () => {
    const res = await request("GET", "/.well-known/jwks.json");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).keys).toHaveLength(1);
  });
});
