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
const UPLOAD_URI = "ui://pfa/upload.html";

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
    "open_upload",
    {
      title: "Upload Document",
      description:
        "Open the document upload widget. The user drops a payslip (PDF or image) into the widget to start the ingestion and review flow.",
      inputSchema: {},
      _meta: { ui: { resourceUri: UPLOAD_URI } },
    },
    async () => ({
      content: [{ type: "text", text: "Upload widget opened." }],
    }),
  );

  registerAppTool(
    server,
    "ingest_document",
    {
      title: "Ingest Document",
      description:
        "Parse a document from base64-encoded content via Haiku 4.5 vision. Called from the upload widget — not model-visible.",
      inputSchema: {
        file_base64: z.string().describe("Base64-encoded file content."),
        filename: z.string().describe("Original filename with extension."),
        mime_type: z.string().describe("MIME type of the file (e.g. application/pdf)."),
        document_type: z.string().describe("Document type. Supported: payslip."),
        notes: z.string().optional().describe("Optional annotation for the document."),
      },
      _meta: { ui: { visibility: ["app"] } },
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
        "Write staged rows from a document review session to the canonical store. Called from the upload widget.",
      inputSchema: {
        review_id: z.string().describe("The review session ID returned by ingest_document."),
      },
      _meta: { ui: { resourceUri: UPLOAD_URI, visibility: ["app"] } },
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
    UPLOAD_URI,
    UPLOAD_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "upload.html"), "utf-8");
      return {
        contents: [{ uri: UPLOAD_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
