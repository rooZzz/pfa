import fs from "node:fs";
import path from "node:path";
import { DOCUMENTS_DIR, getDb } from "../db.js";
import { clearReview, getReview } from "../staging.js";

export async function confirmStagedRows(input: {
  review_id: string;
}): Promise<string> {
  const staged = getReview(input.review_id);
  if (!staged) {
    throw new Error(
      `No staged review found for review_id: ${input.review_id}. It may have already been confirmed or the server was restarted.`,
    );
  }

  const ext = path.extname(staged.source_file_path);
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const destFilename = `upload_${timestamp}${ext}`;
  const destPath = path.join(DOCUMENTS_DIR, destFilename);

  const db = getDb();

  const insertDoc = db.prepare(`
    INSERT INTO documents (source_type, file_path, content_hash)
    VALUES ('upload', ?, ?)
  `);

  const insertIncomeEvent = db.prepare(`
    INSERT INTO income_events (
      pay_date, tax_year, gross_pence, taxable_pence, net_pence,
      paye_pence, ni_employee_pence, pension_employee_pence,
      pension_employer_pence, currency, occurred_at, source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const doInsert = db.transaction(() => {
    const docResult = insertDoc.run(destPath, staged.content_hash);
    const sourceId = docResult.lastInsertRowid;
    insertIncomeEvent.run(
      staged.pay_date,
      staged.tax_year,
      staged.gross_pence,
      staged.taxable_pence ?? null,
      staged.net_pence,
      staged.paye_pence,
      staged.ni_employee_pence,
      staged.pension_employee_pence,
      staged.pension_employer_pence ?? null,
      staged.currency,
      new Date(staged.pay_date + "T00:00:00.000Z").toISOString(),
      sourceId,
    );
    fs.copyFileSync(staged.source_file_path, destPath);
    return sourceId;
  });

  const sourceId = doInsert();
  clearReview(input.review_id);

  return [
    `Payslip confirmed and saved.`,
    `Pay date: ${staged.pay_date}.`,
    `Document ID: ${sourceId}, file: ${destFilename}.`,
  ].join(" ");
}
