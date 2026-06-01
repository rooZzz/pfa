import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { resetDb } from "../db.js";
import { getCashflow } from "../cashflow/index.js";
import { getNetWorth } from "../net_worth/index.js";
import { confirmGoal, confirmGoalSchema } from "./confirm_goal.js";
import { confirmStagedRows } from "./confirm_staged_rows.js";
import { connectMonzo, connectMonzoSchema } from "./connect_monzo.js";
import { syncMonzo } from "./sync_monzo.js";
import { getBriefingTool, getBriefingSchema } from "./get_briefing.js";
import { ingestDocument } from "./ingest_document.js";
import { proposeGoal, proposeGoalSchema } from "./propose_goal.js";
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
import { recordTransaction, recordTransactionSchema } from "./record_transaction.js";
import { recordVestingEvent, recordVestingEventSchema } from "./record_vesting_event.js";
import { refreshAssetPrice, refreshAssetPriceSchema } from "./refresh_asset_price.js";
import { seedData } from "./seed_data.js";

export const UPLOAD_URI = "ui://pfa/upload.html";
export const NET_WORTH_URI = "ui://pfa/net_worth.html";
export const CASHFLOW_URI = "ui://pfa/cashflow.html";
export const CONNECTORS_URI = "ui://pfa/connectors.html";

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
  annotations?: ToolAnnotations;
};

function defineTool<S extends z.ZodRawShape>(descriptor: {
  name: string;
  description: string;
  inputSchema: S;
  handler: (input: z.infer<ReturnType<typeof z.object<S>>>) => Promise<ToolResult>;
  app?: AppMeta;
  annotations?: ToolAnnotations;
}): ToolDescriptor {
  return descriptor as unknown as ToolDescriptor;
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export const tools: ToolDescriptor[] = [
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
      "Record a mortgage. Returns a mortgage ID that must be supplied when recording balance snapshots with record_mortgage_balance.",
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
      "Record an equity grant (RSU, EMI, unapproved option, or SAYE). Records only what was granted — units, strike, grant date — not when it vests. Returns a grant ID; record each vest date (including future maturity dates) separately with record_vesting_event using that ID.",
    inputSchema: recordEquityGrantSchema,
    handler: async (input) => text(await recordEquityGrant(input)),
  }),
  defineTool({
    name: "record_transaction",
    description:
      "Record a single cash transaction manually. Positive amount = money in (credit), negative = money out (debit). Use for non-salary inflows and all outflows. Do not use for payslip salary — that is recorded via payslip ingestion.",
    inputSchema: recordTransactionSchema,
    handler: async (input) => text(await recordTransaction(input)),
  }),
  defineTool({
    name: "record_vesting_event",
    description:
      "Record a vesting tranche for an existing equity grant — either a future scheduled vest or a past realised one. Requires the grant ID returned by record_equity_grant. For a future vest (e.g. an option maturity date), supply vest_date and units_vested and omit market_price_pence; it then appears as an upcoming vest valued from the latest asset price. For a past vest, also supply market_price_pence (the price at vest). Schedule each known future vest date this way — grants do not store their own maturity dates.",
    inputSchema: recordVestingEventSchema,
    handler: async (input) => text(await recordVestingEvent(input)),
  }),
  defineTool({
    name: "get_cashflow",
    description:
      "Display cashflow figures for a UK tax year: income, transactions by category, net cashflow, monthly trend. Use to show the user their numbers — not as a basis for recommendations. Defaults to today's tax year; supply tax_year (YYYY/YY) to target a specific year.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      tax_year: z
        .string()
        .regex(/^\d{4}\/\d{2}$/, "Expected YYYY/YY e.g. 2025/26")
        .optional()
        .describe("UK tax year to query. Defaults to the year covering today."),
      as_of: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
        .optional()
        .describe(
          "Limit data to this date. Defaults to today (or period end if year is complete).",
        ),
    },
    handler: async ({ tax_year, as_of }) =>
      text(JSON.stringify(await getCashflow({ tax_year, as_of }))),
  }),
  defineTool({
    name: "open_cashflow",
    description:
      "Open the cashflow dashboard. Shows income from payslips, spending by category, net cashflow, and a monthly trend — all anchored to the current UK tax year.",
    inputSchema: {},
    app: { title: "Cashflow", resourceUri: CASHFLOW_URI },
    annotations: { readOnlyHint: true },
    handler: async () => text("Cashflow dashboard opened."),
  }),
  defineTool({
    name: "get_net_worth",
    description:
      "Display net worth at a given date: realised assets and liabilities (accounts, pension, property, mortgage) plus contingent unvested equity, each with its observation date. Use to show the user their numbers — not as a basis for recommendations. Also returns a 12-month realised trend.",
    annotations: { readOnlyHint: true },
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
    app: { title: "Upload", resourceUri: UPLOAD_URI },
    annotations: { readOnlyHint: true },
    handler: async () => text("Upload widget opened."),
  }),
  defineTool({
    name: "open_net_worth",
    description:
      "Open the net worth dashboard. Shows realised and contingent net worth, per-line staleness and provenance, and a 12-month realised trend.",
    inputSchema: {},
    app: { title: "Net Worth", resourceUri: NET_WORTH_URI },
    annotations: { readOnlyHint: true },
    handler: async () => text("Net worth dashboard opened."),
  }),
  defineTool({
    name: "open_connectors",
    description:
      "Open the connectors widget to set up a data connector. Use this when the user wants to connect Monzo so they can enter their credentials securely in the widget rather than in chat.",
    inputSchema: {},
    app: { title: "Connectors", resourceUri: CONNECTORS_URI },
    annotations: { readOnlyHint: true },
    handler: async () => text("Connector setup opened."),
  }),
  defineTool({
    name: "connect_monzo",
    description:
      "Save Monzo credentials and run an initial full-history backfill. Called from the connectors widget — not model-visible. Credentials are never passed through chat.",
    inputSchema: connectMonzoSchema,
    app: { title: "Connect Monzo", resourceUri: CONNECTORS_URI, visibility: ["app"] },
    handler: async (input) => text(await connectMonzo(input)),
  }),
  defineTool({
    name: "sync_monzo",
    description:
      "Sync the latest Monzo transactions, balances, and pots into the canonical store. Idempotent — re-running does not duplicate transactions. Requires Monzo to be connected first.",
    inputSchema: {},
    handler: async () => text(await syncMonzo()),
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
    annotations: { destructiveHint: true },
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
    annotations: { destructiveHint: true },
    handler: async () => text(await seedData()),
  }),
  defineTool({
    name: "query_natural_language",
    description:
      'Answer a factual question about the user\'s financial data. Generates SQL via Haiku and executes it against the local database. Returns facts only — not a route to advice or recommendations. Ask in plain language, the way a non-technical person would: name the concept you want ("total income in May", "exclude internal transfers"), never how it is stored. Do not reference columns, flags, value prefixes, or category names, and do not assume the data model — the query layer maps concepts to the schema, and over-specifying it produces wrong answers.',
    inputSchema: {
      question: z.string().describe("The financial question to answer in plain English."),
    },
    annotations: { readOnlyHint: true },
    handler: async ({ question }) => text(await queryNaturalLanguage(question)),
  }),
  defineTool({
    name: "propose_goal",
    description:
      "Classify a user's free-text financial goal onto a goal type and return what is needed to record it. Does not write anything. Pass the user's words verbatim. Follow up with confirm_goal once the needs_spec slots are filled.",
    inputSchema: proposeGoalSchema,
    annotations: { readOnlyHint: true },
    handler: async (input) => text(await proposeGoal(input)),
  }),
  defineTool({
    name: "confirm_goal",
    description:
      "Record a financial goal after its needs_spec slots are filled. Supported goal types: emergency_fund (target_months), isa_max (tax_year). Stores the goal with its verbatim utterance and an audit document. Deterministic — no advice.",
    inputSchema: confirmGoalSchema,
    handler: async (input) => text(await confirmGoal(input)),
  }),
  defineTool({
    name: "get_briefing",
    description:
      "Return the grounded basis for any 'how am I doing / what should I focus on' question: the complete set of observations across all active goals — progress, deadlines, and data gaps. Facts only, never ranked options or advice. Call this before synthesising any financial guidance. Defaults to today.",
    inputSchema: getBriefingSchema,
    annotations: { readOnlyHint: true },
    handler: async (input) => text(await getBriefingTool(input)),
  }),
];

export const resources: { uri: string; file: string }[] = [
  { uri: UPLOAD_URI, file: "upload.html" },
  { uri: NET_WORTH_URI, file: "net_worth.html" },
  { uri: CASHFLOW_URI, file: "cashflow.html" },
  { uri: CONNECTORS_URI, file: "connectors.html" },
];
