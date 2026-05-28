import fs from "node:fs";
import path from "node:path";
import { DOCUMENTS_DIR, getKysely } from "../db.js";
import { clearReview, getReview } from "../staging.js";

function taxYearDates(taxYear: string): { starts_on: string; ends_on: string } {
  const startYear = parseInt(taxYear.slice(0, 4), 10);
  return {
    starts_on: `${startYear}-04-06`,
    ends_on: `${startYear + 1}-04-05`,
  };
}

export async function confirmStagedRows(input: { review_id: string }): Promise<string> {
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

  const sourceId = await getKysely()
    .transaction()
    .execute(async (trx) => {
      if (staged.tax_year) {
        const { starts_on, ends_on } = taxYearDates(staged.tax_year);
        await trx
          .insertInto("tax_periods")
          .values({ tax_year: staged.tax_year, starts_on, ends_on })
          .onConflict((oc) => oc.column("tax_year").doNothing())
          .execute();
      }

      const doc = await trx
        .insertInto("documents")
        .values({
          source_type: "upload",
          file_path: destPath,
          content_hash: staged.content_hash,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const txSourceId = Number(doc.id);

      await trx
        .insertInto("income_events")
        .values({
          pay_date: staged.pay_date,
          tax_year: staged.tax_year ?? null,
          gross_pence: staged.gross_pence,
          taxable_pence: staged.taxable_pence ?? null,
          net_pence: staged.net_pence,
          paye_pence: staged.paye_pence,
          ni_employee_pence: staged.ni_employee_pence,
          pension_employee_pence: staged.pension_employee_pence,
          pension_employer_pence: staged.pension_employer_pence ?? null,
          currency: staged.currency,
          occurred_at: new Date(staged.pay_date + "T00:00:00.000Z").toISOString(),
          source_id: txSourceId,
          payload: staged.payload != null ? JSON.stringify(staged.payload) : null,
        })
        .execute();

      fs.writeFileSync(destPath, staged.file_bytes);
      return txSourceId;
    });
  clearReview(input.review_id);

  return [
    `Payslip confirmed and saved.`,
    `Pay date: ${staged.pay_date}.`,
    `Document ID: ${sourceId}, file: ${destFilename}.`,
  ].join(" ");
}
