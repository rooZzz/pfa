import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { initDb, resetDb } from "./db.js";
import { getNetWorth } from "./net_worth.js";
import { confirmStagedRows } from "./tools/confirm_staged_rows.js";
import { ingestDocument } from "./tools/ingest_document.js";
import { queryNaturalLanguage } from "./tools/query_natural_language.js";
import {
  recordAccountBalance,
  recordAccountBalanceSchema,
} from "./tools/record_account_balance.js";
import {
  recordAssetValue,
  recordAssetValueSchema,
} from "./tools/record_asset_value.js";
import {
  recordEquityGrant,
  recordEquityGrantSchema,
} from "./tools/record_equity_grant.js";
import {
  recordMortgage,
  recordMortgageSchema,
} from "./tools/record_mortgage.js";
import {
  recordMortgageBalance,
  recordMortgageBalanceSchema,
} from "./tools/record_mortgage_balance.js";
import {
  recordPensionValue,
  recordPensionValueSchema,
} from "./tools/record_pension_value.js";
import {
  recordVestingEvent,
  recordVestingEventSchema,
} from "./tools/record_vesting_event.js";
import { seedData } from "./tools/seed_data.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://pfa/mcp-app.html";
const UPLOAD_URI = "ui://pfa/upload.html";
const NET_WORTH_URI = "ui://pfa/net_worth.html";

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
    "record_account_balance",
    "Record a bank or ISA account balance from a manually entered value. Creates the account if it does not exist. Writes an audit JSON file and persists the balance to SQLite.",
    recordAccountBalanceSchema,
    async (input) => {
      const message = await recordAccountBalance(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "record_pension_value",
    "Record the current value of a pension pot. Creates the pension account if it does not exist. Writes an audit JSON file and persists the snapshot to SQLite.",
    recordPensionValueSchema,
    async (input) => {
      const message = await recordPensionValue(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "record_mortgage",
    "Register a mortgage (Reference). Call once to define the mortgage and obtain a mortgage ID. Use the returned ID with record_mortgage_balance to record balance snapshots.",
    recordMortgageSchema,
    async (input) => {
      const message = await recordMortgage(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "record_mortgage_balance",
    "Record a mortgage balance snapshot. Requires a mortgage ID from record_mortgage. Writes an audit JSON file and persists the snapshot to SQLite.",
    recordMortgageBalanceSchema,
    async (input) => {
      const message = await recordMortgageBalance(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "record_asset_value",
    "Record the current value of a non-account asset (crypto, ETF, stock, other). Creates the asset if it does not exist. GBP value is frozen at ingestion — no live FX at query time.",
    recordAssetValueSchema,
    async (input) => {
      const message = await recordAssetValue(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "record_equity_grant",
    "Record an equity grant (RSU, EMI, unapproved option, or SAYE). Returns a grant ID that must be supplied when recording vesting events.",
    recordEquityGrantSchema,
    async (input) => {
      const message = await recordEquityGrant(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "record_vesting_event",
    "Record a vesting event against an existing equity grant. Requires the grant ID returned by record_equity_grant.",
    recordVestingEventSchema,
    async (input) => {
      const message = await recordVestingEvent(input);
      return { content: [{ type: "text", text: message }] };
    },
  );

  server.tool(
    "get_net_worth",
    "Compute net worth at a given date. Returns a structured breakdown of realised assets and liabilities (accounts, pension, property, mortgage, assets) plus contingent unvested equity. Each line carries its observation date and source document. Also returns a 12-month realised trend.",
    {
      as_of: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
        .describe("Date to compute net worth as of. Defaults to today.")
        .optional(),
    },
    async ({ as_of }) => {
      const date = as_of ?? new Date().toISOString().split("T")[0]!;
      const result = await getNetWorth(date);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
    "open_net_worth",
    {
      title: "Net Worth",
      description:
        "Open the net worth dashboard. Shows realised and contingent net worth, per-line staleness and provenance, and a 12-month realised trend.",
      inputSchema: {},
      _meta: { ui: { resourceUri: NET_WORTH_URI } },
    },
    async () => ({
      content: [{ type: "text", text: "Net worth dashboard opened." }],
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
    "reset_schema",
    "Development utility. Drops all tables and recreates them with the current schema. All data is permanently deleted. Does not reseed — call seed_data afterwards if you want representative data.",
    {},
    async () => {
      resetDb();
      return { content: [{ type: "text", text: "Schema reset. All tables dropped and recreated. Database is empty." }] };
    },
  );

  server.tool(
    "seed_data",
    "Development utility. Wipes the database and reseeds it with realistic, representative data including edge cases (overdrafts, stale snapshots, foreign-currency assets, RSU/EMI/SAYE/unapproved grants with mixed vesting states). Destroys existing data.",
    {},
    async () => {
      const message = await seedData();
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

  registerAppResource(
    server,
    NET_WORTH_URI,
    NET_WORTH_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "net_worth.html"), "utf-8");
      return {
        contents: [{ uri: NET_WORTH_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
