import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { PFA_ICONS } from "./icons.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { resources, tools } from "../tools/registry.js";

const DIST_DIR = path.join(import.meta.dirname, "..", "dist");

const RESOURCE_UI_META = {
  csp: { connectDomains: [], resourceDomains: [] },
  prefersBorder: true,
};

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "pfa", version: "0.1.0", icons: PFA_ICONS },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const tool of tools) {
    if (tool.app || tool.widgetAccessible) {
      const visibility =
        tool.app?.visibility ?? (tool.widgetAccessible ? ["model", "app"] : undefined);
      registerAppTool(
        server,
        tool.name,
        {
          ...(tool.app?.title ? { title: tool.app.title } : {}),
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
          _meta: {
            ui: {
              ...(tool.app?.resourceUri ? { resourceUri: tool.app.resourceUri } : {}),
              ...(visibility ? { visibility } : {}),
            },
            ...(tool.app?.resourceUri
              ? { "openai/outputTemplate": tool.app.resourceUri }
              : {}),
            ...(tool.widgetAccessible ? { "openai/widgetAccessible": true } : {}),
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

  for (const { uri, file } of resources) {
    registerAppResource(
      server,
      uri,
      uri,
      { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: RESOURCE_UI_META } },
      async () => {
        const html = await fs.readFile(path.join(DIST_DIR, file), "utf-8");
        return {
          contents: [
            {
              uri,
              mimeType: RESOURCE_MIME_TYPE,
              text: html,
              _meta: { ui: RESOURCE_UI_META },
            },
          ],
        };
      },
    );
  }

  return server;
}
