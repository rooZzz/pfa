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
import { confirmStagedRows } from "./tools/confirm_staged_rows.js";
import { ingestDocument } from "./tools/ingest_document.js";
import { ingestManualEntry, ingestManualEntrySchema } from "./tools/ingest_manual_entry.js";
import { queryNaturalLanguage } from "./tools/query_natural_language.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://pfa/mcp-app.html";
const REVIEW_URI = "ui://pfa/review.html";

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

  registerAppTool(
    server,
    "ingest_document",
    {
      title: "Ingest Document",
      description:
        "Parse a UK payslip or financial document via Haiku 4.5 vision. Extracts structured data and opens the review screen for confirmation before writing to the store.",
      inputSchema: {
        file_path: z
          .string()
          .describe("Absolute path to the document file on disk (PDF, JPEG, or PNG)."),
        notes: z.string().optional().describe("Optional annotation for the document."),
      },
      _meta: { ui: { resourceUri: REVIEW_URI, visibility: ["model"] } },
    },
    async (input) => {
      const result = await ingestDocument(input);
      return { content: [{ type: "text", text: result }] };
    },
  );

  registerAppTool(
    server,
    "confirm_staged_rows",
    {
      title: "Confirm Staged Rows",
      description:
        "Write staged rows from a document review session to the canonical store. Only callable from the review UI.",
      inputSchema: {
        review_id: z.string().describe("The review session ID returned by ingest_document."),
      },
      _meta: { ui: { resourceUri: REVIEW_URI, visibility: ["app"] } },
    },
    async (input) => {
      const message = await confirmStagedRows(input);
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

  registerAppResource(
    server,
    REVIEW_URI,
    REVIEW_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "review.html"), "utf-8");
      return {
        contents: [{ uri: REVIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
