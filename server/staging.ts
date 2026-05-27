import crypto from "node:crypto";

export interface StagedIncomeEvent {
  source_file_path: string;
  content_hash: string;
  currency: string;
  pay_date: string;
  tax_year: string | null;
  gross_pence: number;
  taxable_pence: number | null;
  net_pence: number;
  paye_pence: number;
  ni_employee_pence: number;
  pension_employee_pence: number;
  pension_employer_pence: number | null;
}

const buffer = new Map<string, StagedIncomeEvent>();

export function stageReview(entry: StagedIncomeEvent): string {
  const id = crypto.randomUUID();
  buffer.set(id, entry);
  return id;
}

export function getReview(id: string): StagedIncomeEvent | undefined {
  return buffer.get(id);
}

export function clearReview(id: string): void {
  buffer.delete(id);
}
