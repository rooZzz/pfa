import express from "express";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { provider } from "./provider.js";
import { authRoutes } from "./routes.js";
import { handleMcpRequest } from "../mcp/mcp_request.js";
import { serveWidgetAsset } from "../mcp/widget_assets.js";
import { publicOrigin, mcpResource, authPort, publicOriginHost } from "./config.js";

export function buildAuthApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  const allowedHosts = new Set([
    publicOriginHost(),
    `127.0.0.1:${authPort()}`,
    `localhost:${authPort()}`,
  ]);
  app.use((req, res, next) => {
    if (!allowedHosts.has(req.headers.host ?? "")) {
      res.status(403).json({ error: "forbidden_host" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.use("/widgets", (req, res) => {
    serveWidgetAsset(`/widgets${req.path}`, req, res);
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(publicOrigin()),
      baseUrl: new URL(publicOrigin()),
      resourceServerUrl: new URL(mcpResource()),
      resourceName: "pfa",
    }),
  );

  app.use(authRoutes());

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
    new URL(mcpResource()),
  );
  app.post(
    "/mcp",
    requireBearerAuth({ verifier: provider, resourceMetadataUrl }),
    async (req, res) => {
      try {
        await handleMcpRequest(req, res);
      } catch (error) {
        const detail =
          error instanceof Error ? (error.stack ?? error.message) : String(error);
        process.stderr.write(`pfa MCP (auth) request error: ${detail}\n`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    },
  );

  return app;
}

export function startAuthServer(): void {
  const app = buildAuthApp();
  const port = authPort();
  app.listen(port, "127.0.0.1", () => {
    process.stderr.write(
      `pfa auth server on http://127.0.0.1:${port} (public origin ${publicOrigin()})\n`,
    );
  });
}
