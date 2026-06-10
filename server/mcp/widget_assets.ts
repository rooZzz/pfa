import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { authConfigured, publicOrigin } from "../auth/config.js";

export const WIDGETS_DIR = path.join(import.meta.dirname, "..", "dist", "widgets");

export function widgetAssetOrigin(): string {
  const override = process.env.WIDGET_ASSET_ORIGIN?.trim();
  if (override) return override;
  if (authConfigured()) return new URL(publicOrigin()).origin;
  return "http://localhost:4000";
}

export function widgetHtml(screen: string, origin: string): string {
  for (const asset of ["app.js", "app.css"]) {
    const assetPath = path.join(WIDGETS_DIR, screen, asset);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Widget asset missing at ${assetPath}. Run npm run build:ui.`);
    }
  }
  const base = `${origin}/widgets/${screen}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="color-scheme" content="light dark" />
    <title>pfa</title>
    <link rel="stylesheet" href="${base}/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${base}/app.js"></script>
  </body>
</html>
`;
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function serveWidgetAsset(
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const relative = decodeURIComponent(pathname.replace(/^\/widgets\//, ""));
  const filePath = path.resolve(WIDGETS_DIR, relative);
  if (filePath !== WIDGETS_DIR && !filePath.startsWith(WIDGETS_DIR + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const lastModified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
    const headers = {
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
      "last-modified": lastModified.toUTCString(),
    };
    const since = req.headers["if-modified-since"];
    if (since && new Date(since).getTime() >= lastModified.getTime()) {
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, {
      ...headers,
      "content-type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}
