import { z } from "zod";
import { resetDb } from "../db.js";
import { getNetWorth } from "../net_worth/index.js";
import { confirmStagedRows } from "./confirm_staged_rows.js";
import { ingestDocument } from "./ingest_document.js";
import { queryNaturalLanguage } from "./query_natural_language.js";
import {
  recordAccountBalance,
  recordAccountBalanceSchema,
} from "./record_account_balance.js";
import { recordAssetHolding, recordAssetHoldingSchema } from "./record_asset_holding.js";
import { recordAssetPrice, recordAssetPriceSchema } from "./record_asset_price.js";
import { recordEquityGrant, recordEquityGrantSchema } from "./record_equity_grant.js";
import { recordMortgage, recordMortgageSchema } from "./record_mortgage.js";
import {
  recordMortgageBalance,
  recordMortgageBalanceSchema,
} from "./record_mortgage_balance.js";
import { recordPensionValue, recordPensionValueSchema } from "./record_pension_value.js";
import { recordVestingEvent, recordVestingEventSchema } from "./record_vesting_event.js";
import { refreshAssetPrice, refreshAssetPriceSchema } from "./refresh_asset_price.js";
import { seedData } from "./seed_data.js";

export const RESOURCE_URI = "ui://pfa/mcp-app.html";
export const UPLOAD_URI = "ui://pfa/upload.html";
export const NET_WORTH_URI = "ui://pfa/net_worth.html";

export type ToolResult = { content: { type: "text"; text: string }[] };

export type AppMeta = {
  title: string;
  resourceUri?: string;
  visibility?: ("model" | "app")[];
};

export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
  app?: AppMeta;
};

function defineTool<S extends z.ZodRawShape>(descriptor: {
  name: string;
  description: string;
  inputSchema: S;
  handler: (input: z.infer<ReturnType<typeof z.object<S>>>) => Promise<ToolResult>;
  app?: AppMeta;
}): ToolDescriptor {
  return descriptor as unknown as ToolDescriptor;
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export const tools: ToolDescriptor[] = [
  defineTool({
    name: "greet",
    description: "Greet the user and open the PFA interface.",
    inputSchema: {},
    app: { title: "Greet", resourceUri: RESOURCE_URI },
    handler: async () => text("Hello from pfa"),
  }),
  defineTool({
    name: "ping",
    description: "Ping the server. Returns a timestamped pong.",
    inputSchema: {},
    handler: async () => text(`pong at ${new Date().toISOString()}`),
  }),
  defineTool({
    name: "record_account_balance",
    description:
      "Record a bank or ISA account balance from a manually entered value. Creates the account if it does not exist. Writes an audit JSON file and persists the balance to SQLite.",
    inputSchema: recordAccountBalanceSchema,
    handler: async (input) => text(await recordAccountBalance(input)),
  }),
  defineTool({
    name: "record_pension_value",
    description:
      "Record the current value of a pension pot. Creates the pension account if it does not exist. Writes an audit JSON file and persists the snapshot to SQLite.",
    inputSchema: recordPensionValueSchema,
    handler: async (input) => text(await recordPensionValue(input)),
  }),
  defineTool({
    name: "record_mortgage",
    description:
      "Register a mortgage (Reference). Call once to define the mortgage and obtain a mortgage ID. Use the returned ID with record_mortgage_balance to record balance snapshots.",
    inputSchema: recordMortgageSchema,
    handler: async (input) => text(await recordMortgage(input)),
  }),
  defineTool({
    name: "record_mortgage_balance",
    description:
      "Record a mortgage balance snapshot. Requires a mortgage ID from record_mortgage. Writes an audit JSON file and persists the snapshot to SQLite.",
    inputSchema: recordMortgageBalanceSchema,
    handler: async (input) => text(await recordMortgageBalance(input)),
  }),
  defineTool({
    name: "record_asset_holding",
    description:
      "Record the quantity held for an asset (crypto, ETF, stock, property, other). Creates the asset if it does not exist. Quantity is inventory — record a separate price with record_asset_price for valuation.",
    inputSchema: recordAssetHoldingSchema,
    handler: async (input) => text(await recordAssetHolding(input)),
  }),
  defineTool({
    name: "record_asset_price",
    description:
      "Record a per-unit price observation for an asset. Used for valuation of holdings and unvested equity. Creates the asset if it does not exist. Call this whenever the price changes — holdings stay unchanged.",
    inputSchema: recordAssetPriceSchema,
    handler: async (input) => text(await recordAssetPrice(input)),
  }),
  defineTool({
    name: "refresh_asset_price",
    description:
      "Refresh the price for an asset according to its price_source. For manual assets, returns instructions to call record_asset_price. Connector sources are not yet implemented.",
    inputSchema: refreshAssetPriceSchema,
    handler: async (input) => text(await refreshAssetPrice(input)),
  }),
  defineTool({
    name: "record_equity_grant",
    description:
      "Record an equity grant (RSU, EMI, unapproved option, or SAYE). Returns a grant ID that must be supplied when recording vesting events.",
    inputSchema: recordEquityGrantSchema,
    handler: async (input) => text(await recordEquityGrant(input)),
  }),
  defineTool({
    name: "record_vesting_event",
    description:
      "Record a vesting event against an existing equity grant. Requires the grant ID returned by record_equity_grant.",
    inputSchema: recordVestingEventSchema,
    handler: async (input) => text(await recordVestingEvent(input)),
  }),
  defineTool({
    name: "get_net_worth",
    description:
      "Compute net worth at a given date. Returns a structured breakdown of realised assets and liabilities (accounts, pension, property, mortgage, assets) plus contingent unvested equity. Each line carries its observation date and source document. Also returns a 12-month realised trend.",
    inputSchema: {
      as_of: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
        .describe("Date to compute net worth as of. Defaults to today.")
        .optional(),
    },
    handler: async ({ as_of }) => {
      const date = as_of ?? new Date().toISOString().split("T")[0]!;
      return text(JSON.stringify(await getNetWorth(date)));
    },
  }),
  defineTool({
    name: "open_upload",
    description:
      "Open the document upload widget. The user drops a payslip (PDF or image) into the widget to start the ingestion and review flow.",
    inputSchema: {},
    app: { title: "Upload Document", resourceUri: UPLOAD_URI },
    handler: async () => text("Upload widget opened."),
  }),
  defineTool({
    name: "open_net_worth",
    description:
      "Open the net worth dashboard. Shows realised and contingent net worth, per-line staleness and provenance, and a 12-month realised trend.",
    inputSchema: {},
    app: { title: "Net Worth", resourceUri: NET_WORTH_URI },
    handler: async () => text("Net worth dashboard opened."),
  }),
  defineTool({
    name: "ingest_document",
    description:
      "Parse a document from base64-encoded content via Haiku 4.5 vision. Called from the upload widget — not model-visible.",
    inputSchema: {
      file_base64: z.string().describe("Base64-encoded file content."),
      filename: z.string().describe("Original filename with extension."),
      mime_type: z.string().describe("MIME type of the file (e.g. application/pdf)."),
      document_type: z.string().describe("Document type. Supported: payslip."),
      notes: z.string().optional().describe("Optional annotation for the document."),
    },
    app: { title: "Ingest Document", visibility: ["app"] },
    handler: async (input) => text(await ingestDocument(input)),
  }),
  defineTool({
    name: "confirm_staged_rows",
    description:
      "Write staged rows from a document review session to the canonical store. Called from the upload widget.",
    inputSchema: {
      review_id: z
        .string()
        .describe("The review session ID returned by ingest_document."),
    },
    app: { title: "Confirm Staged Rows", resourceUri: UPLOAD_URI, visibility: ["app"] },
    handler: async (input) => text(await confirmStagedRows(input)),
  }),
  defineTool({
    name: "reset_schema",
    description:
      "Development utility. Drops all tables and recreates them with the current schema. All data is permanently deleted. Does not reseed — call seed_data afterwards if you want representative data.",
    inputSchema: {},
    handler: async () => {
      resetDb();
      return text("Schema reset. All tables dropped and recreated. Database is empty.");
    },
  }),
  defineTool({
    name: "seed_data",
    description:
      "Development utility. Wipes the database and reseeds it with realistic, representative data including edge cases (overdrafts, stale snapshots, foreign-currency assets, RSU/EMI/SAYE/unapproved grants with mixed vesting states). Destroys existing data.",
    inputSchema: {},
    handler: async () => text(await seedData()),
  }),
  defineTool({
    name: "query_natural_language",
    description:
      "Answer a question about your finances. Generates SQL via Haiku and executes it against the local database.",
    inputSchema: {
      question: z.string().describe("The financial question to answer in plain English."),
    },
    handler: async ({ question }) => text(await queryNaturalLanguage(question)),
  }),
];

export const resources: { uri: string; file: string }[] = [
  { uri: RESOURCE_URI, file: "mcp-app.html" },
  { uri: UPLOAD_URI, file: "upload.html" },
  { uri: NET_WORTH_URI, file: "net_worth.html" },
];
