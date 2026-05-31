import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";
import { stageReview } from "../staging.js";
import { confirmStagedRows } from "../tools/confirm_staged_rows.js";

const FILE_BYTES = Buffer.from("mock-pdf-content");

function makeStagedEntry(overrides: Partial<Parameters<typeof stageReview>[0]> = {}) {
  return {
    file_bytes: FILE_BYTES,
    filename: "test-payslip.pdf",
    mime_type: "application/pdf",
    content_hash: "test-hash-default",
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
    tax_code: "1257L",
    payload: {
      line_items: [
        { description: "Basic Salary", section: "payment", amount_pence: 974521 },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  initDb();
  getDb().exec(`
    DELETE FROM income_events;
    DELETE FROM account_balances;
    DELETE FROM transactions;
    DELETE FROM documents;
  `);
});

describe("confirmStagedRows", () => {
  it("writes a documents row with source_type='upload'", async () => {
    const reviewId = stageReview(makeStagedEntry({ content_hash: "test-hash-001" }));

    await confirmStagedRows({ review_id: reviewId });

    const doc = getDb()
      .prepare("SELECT source_type, content_hash FROM documents LIMIT 1")
      .get() as { source_type: string; content_hash: string };

    expect(doc.source_type).toBe("upload");
    expect(doc.content_hash).toBe("test-hash-001");
  });

  it("writes an income_events row linked to the document via source_id", async () => {
    const reviewId = stageReview(makeStagedEntry({ content_hash: "test-hash-002" }));

    await confirmStagedRows({ review_id: reviewId });

    const db = getDb();
    const row = db
      .prepare(
        `
        SELECT ie.gross_pence, ie.net_pence, ie.paye_pence,
               ie.pension_employee_pence, ie.tax_code,
               ie.source_id, d.id AS doc_id
        FROM income_events ie
        JOIN documents d ON d.id = ie.source_id
        LIMIT 1
      `,
      )
      .get() as Record<string, unknown>;

    expect(row.gross_pence).toBe(974521);
    expect(row.net_pence).toBe(540832);
    expect(row.paye_pence).toBe(332767);
    expect(row.pension_employee_pence).toBe(106016);
    expect(row.tax_code).toBe("1257L");
    expect(row.source_id).toBe(row.doc_id);
  });

  it("stores payload JSON with line-item sections in income_events", async () => {
    const payload = {
      line_items: [
        { description: "Basic Salary", section: "payment", amount_pence: 974521 },
        { description: "Student Loan", section: "deduction", amount_pence: 12000 },
      ],
    };
    const reviewId = stageReview(
      makeStagedEntry({ content_hash: "test-hash-005", payload }),
    );

    await confirmStagedRows({ review_id: reviewId });

    const row = getDb().prepare("SELECT payload FROM income_events LIMIT 1").get() as {
      payload: string;
    };

    expect(JSON.parse(row.payload)).toEqual(payload);
  });

  it("writes the file bytes to DOCUMENTS_DIR", async () => {
    const reviewId = stageReview(makeStagedEntry({ content_hash: "test-hash-004" }));

    await confirmStagedRows({ review_id: reviewId });

    const doc = getDb().prepare("SELECT file_path FROM documents LIMIT 1").get() as {
      file_path: string;
    };

    expect(fs.existsSync(doc.file_path)).toBe(true);
    expect(fs.readFileSync(doc.file_path)).toEqual(FILE_BYTES);
  });

  it("clears the staging buffer after confirmation", async () => {
    const { getReview } = await import("../staging.js");

    const reviewId = stageReview(
      makeStagedEntry({ content_hash: "test-hash-003", gross_pence: 500000 }),
    );

    await confirmStagedRows({ review_id: reviewId });

    expect(getReview(reviewId)).toBeUndefined();
  });

  it("throws loudly when review_id is not found", async () => {
    await expect(confirmStagedRows({ review_id: "nonexistent-id" })).rejects.toThrow(
      /No staged review found/,
    );
  });

  it("upserts the tax_year into tax_periods so the FK constraint is satisfied", async () => {
    const reviewId = stageReview(
      makeStagedEntry({ content_hash: "test-hash-006", tax_year: "2026/27" }),
    );

    await confirmStagedRows({ review_id: reviewId });

    const row = getDb()
      .prepare(
        "SELECT tax_year, starts_on, ends_on FROM tax_periods WHERE tax_year = '2026/27'",
      )
      .get() as { tax_year: string; starts_on: string; ends_on: string };

    expect(row.tax_year).toBe("2026/27");
    expect(row.starts_on).toBe("2026-04-06");
    expect(row.ends_on).toBe("2027-04-05");
  });

  it("does not fail when tax_year is null", async () => {
    const reviewId = stageReview(
      makeStagedEntry({ content_hash: "test-hash-007", tax_year: null }),
    );
    await expect(confirmStagedRows({ review_id: reviewId })).resolves.toMatch(
      /confirmed/,
    );
  });
});
