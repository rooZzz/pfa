import http from "node:http";
import { loadEnv } from "./core/env.js";
import { initDb } from "./core/db.js";
import { handleMcpRequest } from "./mcp/mcp_request.js";
import { serveWidgetAsset } from "./mcp/widget_assets.js";
import { authConfigured } from "./auth/config.js";
import { startAuthServer } from "./auth/app.js";

loadEnv();

const PORT = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(
    `Invalid PORT "${process.env.PORT}". Set PORT to an integer between 1 and 65535.`,
  );
}
const HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

initDb();

function isAllowedRequest(req: http.IncomingMessage): boolean {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) {
    return false;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
    return false;
  }
  return true;
}

function sendJsonRpcError(
  res: http.ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (res.headersSent) {
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (url.pathname.startsWith("/widgets/")) {
    serveWidgetAsset(url.pathname, req, res);
    return;
  }
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }

  if (!isAllowedRequest(req)) {
    sendJsonRpcError(res, 403, -32000, "Forbidden: host or origin not allowed");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST", "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed (stateless mode)" },
        id: null,
      }),
    );
    return;
  }

  try {
    await handleMcpRequest(req, res);
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`pfa MCP request error: ${detail}\n`);
    sendJsonRpcError(res, 500, -32603, "Internal server error");
  }
});

httpServer.listen(PORT, HOST, () => {
  process.stderr.write(`pfa MCP HTTP server on http://${HOST}:${PORT}/mcp\n`);
});

if (authConfigured()) {
  startAuthServer();
} else {
  process.stderr.write(
    "pfa auth server not started (PUBLIC_ORIGIN unset); open port only\n",
  );
}

function shutdown(): void {
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
