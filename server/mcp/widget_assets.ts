import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { authConfigured, publicOrigin } from "../auth/config.js";

export const WIDGETS_DIR = path.join(import.meta.dirname, "..", "dist", "widgets");

export function widgetAssetOrigin(): string {
  const override = process.env.WIDGET_ASSET_ORIGIN?.trim();
  if (override) return override;
  if (authConfigured()) return new URL(publicOrigin()).origin;
  return "http://localhost:4000";
}

const assetCache = new Map<string, { js: string; css: string | null }>();

function readAssets(screen: string): { js: string; css: string | null } {
  const cached = assetCache.get(screen);
  if (cached) return cached;
  const dir = path.join(WIDGETS_DIR, screen);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    throw new Error(
      `Widget assets for "${screen}" not found in ${dir}. Run npm run build:ui.`,
    );
  }
  const js = files.find((file) => file.endsWith(".js"));
  if (!js) {
    throw new Error(
      `No built JS for widget "${screen}" in ${dir}. Run npm run build:ui.`,
    );
  }
  const entry = { js, css: files.find((file) => file.endsWith(".css")) ?? null };
  assetCache.set(screen, entry);
  return entry;
}

export function widgetHtml(screen: string, origin: string): string {
  const { js, css } = readAssets(screen);
  const base = `${origin}/widgets/${screen}`;
  const cssLink = css ? `\n    <link rel="stylesheet" href="${base}/${css}" />` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="color-scheme" content="light dark" />
    <title>pfa</title>${cssLink}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${base}/${js}"></script>
  </body>
</html>
`;
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function serveWidgetAsset(pathname: string, res: ServerResponse): void {
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
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}
