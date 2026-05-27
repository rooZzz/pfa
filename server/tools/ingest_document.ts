import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { z } from "zod";
import { stageReview } from "../staging.js";

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const EXTRACTION_SYSTEM_PROMPT = `You extract data from UK payslips. All monetary amounts must be integers in pence (GBP × 100, rounded to the nearest integer).

For tax_year: the UK tax year starts April 6. If not shown explicitly, derive it from the pay date — a date on or after April 6 of year Y is in tax year "Y/YY" (e.g. 2026-05-22 → "2026/27").

For pension_employee_pence: sum all employee pension lines regardless of section — salary sacrifice schemes often appear as negative entries in the Payments section rather than in Deductions.

For line_items: include every individual line from the Payments and Deductions sections (not the summary totals). Amounts are always positive integers in pence regardless of whether the line is a payment or a deduction.

Return null for any field not present on the payslip.`;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_payslip",
  description: "Record the payslip fields extracted from the document.",
  input_schema: {
    type: "object",
    properties: {
      pay_date: {
        type: "string",
        description: "Payment date as YYYY-MM-DD.",
      },
      tax_year: {
        type: ["string", "null"] as unknown as "string",
        description: "UK tax year as YYYY/YY (e.g. 2026/27). Derive from pay_date if not explicitly shown.",
      },
      gross_pence: {
        type: "integer",
        description: "Gross Pay in pence — total earnings before deductions. Use the Gross Pay summary figure, not Taxable Pay.",
      },
      taxable_pence: {
        type: ["integer", "null"] as unknown as "integer",
        description: "Taxable Pay in pence if shown and different from gross_pence. Can exceed gross when Benefits in Kind are included. Null if same as gross or absent.",
      },
      net_pence: {
        type: "integer",
        description: "Net Pay in pence — take-home after all deductions.",
      },
      paye_pence: {
        type: "integer",
        description: "PAYE income tax deducted this period, in pence.",
      },
      ni_employee_pence: {
        type: "integer",
        description: "Employee National Insurance contributions this period, in pence.",
      },
      pension_employee_pence: {
        type: "integer",
        description: "Employee pension contribution this period in pence. Salary sacrifice pension appears as NEGATIVE entries in the Payments section (reducing gross pay) rather than in Deductions — include those. Sum all pension-labelled lines. Do not include SAYE, Share Save, insurance, car, or loan scheme entries.",
      },
      pension_employer_pence: {
        type: ["integer", "null"] as unknown as "integer",
        description: "Employer pension contribution this period in pence, if shown. Null if absent.",
      },
      line_items: {
        type: ["array", "null"] as unknown as "array",
        description: "Every individual line from the Payments and Deductions sections. Amounts are positive integers in pence.",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "Line item label as shown on the payslip." },
            amount_pence: { type: "integer", description: "Amount in pence, always positive." },
          },
          required: ["description", "amount_pence"],
        },
      },
    },
    required: [
      "pay_date",
      "gross_pence",
      "net_pence",
      "paye_pence",
      "ni_employee_pence",
      "pension_employee_pence",
    ],
  },
};

const LineItemSchema = z.object({
  description: z.string(),
  amount_pence: z.number().int(),
});

const ParsedPayslipSchema = z.object({
  pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tax_year: z
    .string()
    .regex(/^\d{4}\/\d{2}$/)
    .nullable(),
  gross_pence: z.number().int(),
  taxable_pence: z.number().int().nullable(),
  net_pence: z.number().int(),
  paye_pence: z.number().int(),
  ni_employee_pence: z.number().int(),
  pension_employee_pence: z.number().int(),
  pension_employer_pence: z.number().int().nullable(),
  line_items: z.array(LineItemSchema).nullable().optional(),
});

export type ParsedPayslip = z.infer<typeof ParsedPayslipSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function parsePayslipVision(
  base64Data: string,
  mimeType: string,
): Promise<ParsedPayslip> {
  const documentBlock: Anthropic.ContentBlockParam =
    mimeType === "application/pdf"
      ? ({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64Data },
        } as Anthropic.ContentBlockParam)
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType as "image/jpeg" | "image/png",
            data: base64Data,
          },
        };

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    temperature: 0,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_payslip" },
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          { type: "text", text: "Extract the payslip data including all line items." },
        ],
      },
    ],
  });

  const toolBlock = response.content.find((c) => c.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Haiku did not return a tool_use block.");
  }

  const result = ParsedPayslipSchema.safeParse(toolBlock.input);
  if (!result.success) {
    throw new Error(
      `Haiku tool response failed validation: ${result.error.message}`,
    );
  }

  return result.data;
}

export async function ingestDocument(input: {
  file_base64: string;
  filename: string;
  mime_type: string;
  document_type: string;
  notes?: string;
}): Promise<string> {
  if (!SUPPORTED_MIME_TYPES.has(input.mime_type)) {
    throw new Error(
      `Unsupported mime_type: ${input.mime_type}. Supported: ${[...SUPPORTED_MIME_TYPES].join(", ")}`,
    );
  }

  if (!["payslip"].includes(input.document_type)) {
    throw new Error(
      `Unsupported document_type: ${input.document_type}. Supported: payslip`,
    );
  }

  const fileBuffer = Buffer.from(input.file_base64, "base64");

  if (fileBuffer.length === 0) {
    throw new Error(
      "file_base64 decoded to an empty buffer. Provide valid base64-encoded file content.",
    );
  }

  if (fileBuffer.length > MAX_FILE_BYTES) {
    throw new Error(
      `File too large: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB. Maximum allowed is 20 MB.`,
    );
  }

  const contentHash = crypto
    .createHash("sha256")
    .update(fileBuffer)
    .digest("hex");

  const extracted = await parsePayslipVision(input.file_base64, input.mime_type);
  const { line_items, ...spine } = extracted;
  const payload = { line_items: line_items ?? [] };

  const reviewId = stageReview({
    file_bytes: fileBuffer,
    filename: input.filename,
    mime_type: input.mime_type,
    content_hash: contentHash,
    currency: "GBP",
    payload,
    ...spine,
  });

  return JSON.stringify(
    {
      review_id: reviewId,
      filename: input.filename,
      parsed: spine,
      payload,
    },
    null,
    2,
  );
}
