import fs from "node:fs";
import path from "node:path";
import { DOCUMENTS_DIR, getDb } from "../db.js";
import { clearReview, getReview } from "../staging.js";

function taxYearDates(taxYear: string): { starts_on: string; ends_on: string } {
  const startYear = parseInt(taxYear.slice(0, 4), 10);
  return {
    starts_on: `${startYear}-04-06`,
    ends_on: `${startYear + 1}-04-05`,
  };
}

export async function confirmStagedRows(input: {
  review_id: string;
}): Promise<string> {
  const staged = getReview(input.review_id);
  if (!staged) {
    throw new Error(
      `No staged review found for review_id: ${input.review_id}. It may have already been confirmed or the server was restarted.`,
    );
  }

  const ext = path.extname(staged.filename);
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const destFilename = `upload_${timestamp}${ext}`;
  const destPath = path.join(DOCUMENTS_DIR, destFilename);

  const db = getDb();

  const upsertTaxPeriod = db.prepare(`
    INSERT OR IGNORE INTO tax_periods (tax_year, starts_on, ends_on)
    VALUES (?, ?, ?)
  `);

  const insertDoc = db.prepare(`
    INSERT INTO documents (source_type, file_path, content_hash)
    VALUES ('upload', ?, ?)
  `);

  const insertIncomeEvent = db.prepare(`
    INSERT INTO income_events (
      pay_date, tax_year, gross_pence, taxable_pence, net_pence,
      paye_pence, ni_employee_pence, pension_employee_pence,
      pension_employer_pence, currency, occurred_at, source_id, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const doInsert = db.transaction(() => {
    if (staged.tax_year) {
      const { starts_on, ends_on } = taxYearDates(staged.tax_year);
      upsertTaxPeriod.run(staged.tax_year, starts_on, ends_on);
    }
    const docResult = insertDoc.run(destPath, staged.content_hash);
    const txSourceId = docResult.lastInsertRowid;
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
      txSourceId,
      staged.payload != null ? JSON.stringify(staged.payload) : null,
    );
    fs.writeFileSync(destPath, staged.file_bytes);
    return txSourceId;
  });

  const sourceId = doInsert();
  clearReview(input.review_id);

  return [
    `Payslip confirmed and saved.`,
    `Pay date: ${staged.pay_date}.`,
    `Document ID: ${sourceId}, file: ${destFilename}.`,
  ].join(" ");
}
