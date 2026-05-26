import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { initDb } from "./db.js";
import { ingestManualEntry, ingestManualEntrySchema } from "./tools/ingest_manual_entry.js";
import { queryNaturalLanguage } from "./tools/query_natural_language.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://pfa/mcp-app.html";

export function createServer(): McpServer {
  initDb();

  const server = new McpServer({
    name: "pfa",
    version: "0.1.0",
  });

  registerAppTool(
    server,
    "greet",
    {
      title: "Greet",
      description: "Greet the user and open the PFA interface.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => ({
      content: [{ type: "text", text: "Hello from pfa" }],
    }),
  );

  server.tool(
    "ping",
    "Ping the server. Returns a timestamped pong.",
    {},
    async () => ({
      content: [{ type: "text", text: `pong at ${new Date().toISOString()}` }],
    }),
  );

  server.tool(
    "ingest_manual_entry",
    "Record an account balance from a manually entered value. Writes an audit JSON file and persists the balance to SQLite.",
    ingestManualEntrySchema,
    async (input) => {
      const message = await ingestManualEntry(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "query_natural_language",
    "Answer a question about your finances. Generates SQL via Haiku and executes it against the local database.",
    { question: z.string().describe("The financial question to answer in plain English.") },
    async ({ question }) => {
      const result = await queryNaturalLanguage(question);
      return { content: [{ type: "text", text: result }] };
    },
  );

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
