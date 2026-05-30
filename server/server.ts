import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { PFA_ICONS } from "./branding.js";
import { initDb } from "./db.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { resources, tools } from "./tools/registry.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");

export function createServer(): McpServer {
  initDb();

  const server = new McpServer(
    { name: "pfa", version: "0.1.0", icons: PFA_ICONS },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const tool of tools) {
    if (tool.app) {
      registerAppTool(
        server,
        tool.name,
        {
          title: tool.app.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
          _meta: {
            ui: {
              ...(tool.app.resourceUri ? { resourceUri: tool.app.resourceUri } : {}),
              ...(tool.app.visibility ? { visibility: tool.app.visibility } : {}),
            },
          },
        },
        tool.handler,
      );
    } else {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        },
        tool.handler,
      );
    }
  }

  const htmlCache = new Map<string, string>();
  for (const { uri, file } of resources) {
    registerAppResource(server, uri, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
      let html = htmlCache.get(uri);
      if (html === undefined) {
        html = await fs.readFile(path.join(DIST_DIR, file), "utf-8");
        htmlCache.set(uri, html);
      }
      return {
        contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    });
  }

  return server;
}
