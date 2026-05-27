import { describe, expect, it } from "vitest";
import { ingestDocument } from "../tools/ingest_document.js";

const VALID_PDF_BASE64 = Buffer.from("%PDF-1.4 minimal").toString("base64");

describe("ingestDocument — boundary validation", () => {
  it("rejects an unsupported mime_type", async () => {
    await expect(
      ingestDocument({
        file_base64: VALID_PDF_BASE64,
        filename: "test.pdf",
        mime_type: "text/plain",
        document_type: "payslip",
      }),
    ).rejects.toThrow(/Unsupported mime_type/);
  });

  it("rejects an unknown document_type", async () => {
    await expect(
      ingestDocument({
        file_base64: VALID_PDF_BASE64,
        filename: "test.pdf",
        mime_type: "application/pdf",
        document_type: "bank_statement",
      }),
    ).rejects.toThrow(/Unsupported document_type/);
  });

  it("rejects an empty base64 payload", async () => {
    await expect(
      ingestDocument({
        file_base64: "",
        filename: "test.pdf",
        mime_type: "application/pdf",
        document_type: "payslip",
      }),
    ).rejects.toThrow(/empty buffer/);
  });

  it("rejects a file exceeding 20 MB", async () => {
    const oversized = Buffer.alloc(21 * 1024 * 1024, 0x41);
    await expect(
      ingestDocument({
        file_base64: oversized.toString("base64"),
        filename: "big.pdf",
        mime_type: "application/pdf",
        document_type: "payslip",
      }),
    ).rejects.toThrow(/File too large/);
  });

  it("error message for oversized file includes the actual size", async () => {
    const oversized = Buffer.alloc(21 * 1024 * 1024, 0x41);
    const error = await ingestDocument({
      file_base64: oversized.toString("base64"),
      filename: "big.pdf",
      mime_type: "application/pdf",
      document_type: "payslip",
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/21\.0 MB/);
  });
});
