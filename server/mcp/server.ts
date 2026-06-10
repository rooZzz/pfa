import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PFA_ICONS } from "./icons.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { widgetAssetOrigin, widgetHtml } from "./widget_assets.js";
import { resources, tools, type ToolDescriptor } from "../tools/registry.js";

function loggedHandler(tool: ToolDescriptor): ToolDescriptor["handler"] {
  return async (input) => {
    process.stderr.write(`pfa tool ${tool.name}\n`);
    return tool.handler(input);
  };
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "pfa", version: "0.1.0", icons: PFA_ICONS },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const assetOrigin = widgetAssetOrigin();
  const sharedResourceMeta = {
    ui: {
      csp: { connectDomains: [], resourceDomains: [assetOrigin] },
      prefersBorder: true,
    },
    "openai/widgetCSP": { connect_domains: [], resource_domains: [assetOrigin] },
    "openai/widgetPrefersBorder": true,
  };

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
        loggedHandler(tool),
      );
    } else {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        },
        loggedHandler(tool),
      );
    }
  }

  for (const { uri, file, description } of resources) {
    const screen = file.replace(/\.html$/, "");
    const resourceMeta = {
      ...sharedResourceMeta,
      "openai/widgetDescription": description,
    };
    registerAppResource(
      server,
      uri,
      uri,
      { mimeType: RESOURCE_MIME_TYPE, _meta: resourceMeta },
      async () => ({
        contents: [
          {
            uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: widgetHtml(screen, assetOrigin),
            _meta: resourceMeta,
          },
        ],
      }),
    );
  }

  return server;
}
