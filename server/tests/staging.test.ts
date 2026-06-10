import { describe, expect, it } from "vitest";
import { clearReview, getReview, stageReview } from "../core/staging.js";
import type { StagedIncomeEvent } from "../core/staging.js";

const SAMPLE: StagedIncomeEvent = {
  file_bytes: Buffer.from("mock-pdf-content"),
  filename: "test-payslip.pdf",
  mime_type: "application/pdf",
  content_hash: "abc123",
  currency: "GBP",
  pay_date: "2026-05-22",
  tax_year: "2026/27",
  gross_pence: 974521,
  taxable_pence: 988965,
  net_pence: 540832,
  paye_pence: 332767,
  ni_employee_pence: 36240,
  pension_employee_pence: 106016,
  pension_employer_pence: 106015,
  tax_code: "1257L",
  payload: { line_items: [] },
};

describe("staging buffer", () => {
  it("stageReview returns a non-empty string ID", () => {
    const id = stageReview(SAMPLE);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    clearReview(id);
  });

  it("stageReview returns a unique ID on each call", () => {
    const id1 = stageReview(SAMPLE);
    const id2 = stageReview(SAMPLE);
    expect(id1).not.toBe(id2);
    clearReview(id1);
    clearReview(id2);
  });

  it("getReview returns the staged entry by ID", () => {
    const id = stageReview(SAMPLE);
    const entry = getReview(id);
    expect(entry).toEqual(SAMPLE);
    clearReview(id);
  });

  it("getReview returns undefined for an unknown ID", () => {
    expect(getReview("not-a-real-id")).toBeUndefined();
  });

  it("clearReview removes the entry", () => {
    const id = stageReview(SAMPLE);
    clearReview(id);
    expect(getReview(id)).toBeUndefined();
  });

  it("clearReview is a no-op for an unknown ID", () => {
    expect(() => clearReview("ghost-id")).not.toThrow();
  });
});
