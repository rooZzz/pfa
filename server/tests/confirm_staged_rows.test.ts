import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { stageReview } from "../staging.js";
import { confirmStagedRows } from "../tools/confirm_staged_rows.js";

let sourceFile: string;

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM income_events;
    DELETE FROM account_balances;
    DELETE FROM transactions;
    DELETE FROM documents;
  `);

  sourceFile = path.join(os.tmpdir(), `pfa-test-payslip-${Date.now()}.pdf`);
  fs.writeFileSync(sourceFile, "mock-pdf-content");
});

afterEach(() => {
  if (fs.existsSync(sourceFile)) {
    fs.unlinkSync(sourceFile);
  }
});

describe("confirmStagedRows", () => {
  it("writes a documents row with source_type='upload'", async () => {
    const reviewId = stageReview({
      source_file_path: sourceFile,
      content_hash: "test-hash-001",
      currency: "GBP",
      pay_date: "2026-05-22",
      tax_year: null,
      gross_pence: 974521,
      taxable_pence: 988965,
      net_pence: 540832,
      paye_pence: 332767,
      ni_employee_pence: 36240,
      pension_employee_pence: 106016,
      pension_employer_pence: 106015,
    });

    await confirmStagedRows({ review_id: reviewId });

    const doc = getDb()
      .prepare("SELECT source_type, content_hash FROM documents LIMIT 1")
      .get() as { source_type: string; content_hash: string };

    expect(doc.source_type).toBe("upload");
    expect(doc.content_hash).toBe("test-hash-001");
  });

  it("writes an income_events row linked to the document via source_id", async () => {
    const reviewId = stageReview({
      source_file_path: sourceFile,
      content_hash: "test-hash-002",
      currency: "GBP",
      pay_date: "2026-05-22",
      tax_year: null,
      gross_pence: 974521,
      taxable_pence: 988965,
      net_pence: 540832,
      paye_pence: 332767,
      ni_employee_pence: 36240,
      pension_employee_pence: 106016,
      pension_employer_pence: 106015,
    });

    await confirmStagedRows({ review_id: reviewId });

    const db = getDb();
    const row = db
      .prepare(`
        SELECT ie.gross_pence, ie.net_pence, ie.paye_pence,
               ie.pension_employee_pence,
               ie.source_id, d.id AS doc_id
        FROM income_events ie
        JOIN documents d ON d.id = ie.source_id
        LIMIT 1
      `)
      .get() as Record<string, unknown>;

    expect(row.gross_pence).toBe(974521);
    expect(row.net_pence).toBe(540832);
    expect(row.paye_pence).toBe(332767);
    expect(row.pension_employee_pence).toBe(106016);
    expect(row.source_id).toBe(row.doc_id);
  });

  it("clears the staging buffer after confirmation", async () => {
    const { getReview } = await import("../staging.js");

    const reviewId = stageReview({
      source_file_path: sourceFile,
      content_hash: "test-hash-003",
      currency: "GBP",
      pay_date: "2026-05-22",
      tax_year: null,
      gross_pence: 500000,
      taxable_pence: null,
      net_pence: 350000,
      paye_pence: 100000,
      ni_employee_pence: 20000,
      pension_employee_pence: 30000,
      pension_employer_pence: null,
    });

    await confirmStagedRows({ review_id: reviewId });

    expect(getReview(reviewId)).toBeUndefined();
  });

  it("throws loudly when review_id is not found", async () => {
    await expect(
      confirmStagedRows({ review_id: "nonexistent-id" }),
    ).rejects.toThrow(/No staged review found/);
  });

  it("copies the source file to DOCUMENTS_DIR", async () => {
    const reviewId = stageReview({
      source_file_path: sourceFile,
      content_hash: "test-hash-004",
      currency: "GBP",
      pay_date: "2026-05-22",
      tax_year: null,
      gross_pence: 500000,
      taxable_pence: null,
      net_pence: 350000,
      paye_pence: 100000,
      ni_employee_pence: 20000,
      pension_employee_pence: 30000,
      pension_employer_pence: null,
    });

    await confirmStagedRows({ review_id: reviewId });

    const doc = getDb()
      .prepare("SELECT file_path FROM documents LIMIT 1")
      .get() as { file_path: string };

    expect(fs.existsSync(doc.file_path)).toBe(true);
  });
});
