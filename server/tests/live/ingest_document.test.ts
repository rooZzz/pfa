import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePayslipVision } from "../../tools/ingest_document.js";

const FIXTURE_PATH = path.join(import.meta.dirname, "fixtures", "Payslip_20260522.pdf");

const GOLDEN = {
  pay_date: "2026-05-22",
  tax_year: "2026/27",
  gross_pence: 974521,
  taxable_pence: 988965,
  net_pence: 540832,
  paye_pence: 332767,
  ni_employee_pence: 36240,
  pension_employee_pence: 106016,
  pension_employer_pence: 106015,
};

describe("parsePayslipVision — Experian May 2026 fixture", () => {
  it("extracts all fields from the fixture payslip", async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const base64Data = fileBuffer.toString("base64");

    const result = await parsePayslipVision(base64Data, "application/pdf");

    expect(result.pay_date).toBe(GOLDEN.pay_date);
    expect(result.tax_year).toBe(GOLDEN.tax_year);
    expect(result.gross_pence).toBe(GOLDEN.gross_pence);
    expect(result.taxable_pence).toBe(GOLDEN.taxable_pence);
    expect(result.net_pence).toBe(GOLDEN.net_pence);
    expect(result.paye_pence).toBe(GOLDEN.paye_pence);
    expect(result.ni_employee_pence).toBe(GOLDEN.ni_employee_pence);
    expect(result.pension_employee_pence).toBe(GOLDEN.pension_employee_pence);
    expect(result.pension_employer_pence).toBe(GOLDEN.pension_employer_pence);
  });

  it("extracts a well-formed tax code", async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const base64Data = fileBuffer.toString("base64");

    const result = await parsePayslipVision(base64Data, "application/pdf");

    expect(result.tax_code).toBeTypeOf("string");
    expect(result.tax_code).toMatch(/^[A-Z0-9]+$/);
  });

  it("tags every line item with a payment or deduction section", async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const base64Data = fileBuffer.toString("base64");

    const result = await parsePayslipVision(base64Data, "application/pdf");

    expect(result.line_items?.length).toBeGreaterThan(0);
    for (const item of result.line_items ?? []) {
      expect(["payment", "deduction"]).toContain(item.section);
    }
  });

  it("returns integer pence values (no floats)", async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const base64Data = fileBuffer.toString("base64");

    const result = await parsePayslipVision(base64Data, "application/pdf");

    const monetaryFields = [
      result.gross_pence,
      result.net_pence,
      result.paye_pence,
      result.ni_employee_pence,
      result.pension_employee_pence,
    ] as number[];

    for (const value of monetaryFields) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
