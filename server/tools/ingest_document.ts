import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stageReview } from "../staging.js";

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

const EXTRACTION_SYSTEM_PROMPT = `You extract data from UK payslips. All monetary amounts must be integers in pence (GBP × 100, rounded to the nearest integer).

For tax_year: the UK tax year starts April 6. If not shown explicitly, derive it from the pay date — a date on or after April 6 of year Y is in tax year "Y/YY" (e.g. 2026-05-22 → "2026/27").

For pension_employee_pence: sum all employee pension lines regardless of section — salary sacrifice schemes often appear as negative entries in the Payments section rather than in Deductions.

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
});

export type ParsedPayslip = z.infer<typeof ParsedPayslipSchema>;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = SUPPORTED_EXTENSIONS[ext];
  if (!mimeType) {
    throw new Error(
      `Unsupported file type: ${ext}. Supported types: ${Object.keys(SUPPORTED_EXTENSIONS).join(", ")}`,
    );
  }
  return mimeType;
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
    max_tokens: 1024,
    temperature: 0,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_payslip" },
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          { type: "text", text: "Extract the payslip data." },
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
  file_path: string;
  notes?: string;
}): Promise<string> {
  if (!fs.existsSync(input.file_path)) {
    throw new Error(
      `File not found: ${input.file_path}. Provide an absolute path to a file on disk.`,
    );
  }

  const mimeType = detectMimeType(input.file_path);
  const fileBuffer = fs.readFileSync(input.file_path);
  const base64Data = fileBuffer.toString("base64");
  const contentHash = crypto
    .createHash("sha256")
    .update(fileBuffer)
    .digest("hex");

  const parsed = await parsePayslipVision(base64Data, mimeType);

  const reviewId = stageReview({
    source_file_path: input.file_path,
    content_hash: contentHash,
    currency: "GBP",
    ...parsed,
  });

  const result = {
    review_id: reviewId,
    source_file: path.basename(input.file_path),
    parsed,
  };

  return JSON.stringify(result, null, 2);
}
