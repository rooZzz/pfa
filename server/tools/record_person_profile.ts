import { z } from "zod";
import { getKysely } from "../db.js";
import { writeManualDocument } from "../references.js";

export const recordPersonProfileSchema = {
  employer_name: z.string().describe("Current employer name."),
  salary_pence: z
    .number()
    .int()
    .positive()
    .describe("Annual base salary in pence (integer). No decimals."),
  tax_code: z.string().describe("Current PAYE tax code, e.g. '1257L'."),
  currency: z.string().default("GBP").describe("ISO 4217 currency code."),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .describe("Date this profile takes effect, e.g. the salary review date."),
};

export async function recordPersonProfile(input: {
  employer_name: string;
  salary_pence: number;
  tax_code: string;
  currency: string;
  valid_from: string;
}): Promise<string> {
  const sourceId = await getKysely()
    .transaction()
    .execute(async (trx) => {
      const sourceId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "person_profile",
        employer_name: input.employer_name,
        salary_pence: input.salary_pence,
        tax_code: input.tax_code,
        currency: input.currency,
        valid_from: input.valid_from,
      });

      await trx
        .insertInto("person_profile")
        .values({
          employer_name: input.employer_name,
          salary_pence: input.salary_pence,
          tax_code: input.tax_code,
          currency: input.currency,
          valid_from: input.valid_from,
          source_id: sourceId,
        })
        .execute();

      return sourceId;
    });

  return [
    `Recorded profile for ${input.employer_name}.`,
    `Salary: ${input.salary_pence} ${input.currency}, tax code ${input.tax_code}, effective ${input.valid_from}.`,
    `Document ID: ${sourceId}.`,
  ].join(" ");
}
