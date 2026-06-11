import path from "node:path";
import { createServer } from "vite";
import type { Plugin } from "vite";
import { serveWidgetAsset, widgetHtml } from "../mcp/widget_assets.js";

const PORT = Number(process.env.PORT ?? process.env.PREVIEW_PORT ?? 4300);
const SCREENS = new Set(["net_worth", "cashflow", "upload", "connectors"]);

const widgetRoutes: Plugin = {
  name: "pfa-widget-routes",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname.startsWith("/widgets/")) {
        serveWidgetAsset(pathname, req, res);
        return;
      }
      const match = /^\/screen\/([a-z_]+)$/.exec(pathname);
      if (match && SCREENS.has(match[1]!)) {
        res
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(widgetHtml(match[1]!, `http://localhost:${PORT}`));
        return;
      }
      next();
    });
  },
};

const server = await createServer({
  configFile: false,
  root: path.join(import.meta.dirname, "..", "preview"),
  plugins: [widgetRoutes],
  server: { port: PORT, strictPort: true },
});

await server.listen();
server.printUrls();
