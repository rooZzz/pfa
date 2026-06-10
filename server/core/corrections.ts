import { getDb, getKysely } from "./db.js";
import { writeManualDocument } from "./references.js";

type SeriesKind = "snapshot" | "event" | "reference";

type SeriesDescriptor = {
  table: string;
  kind: SeriesKind;
  correctable: string[];
};

const CORRECTABLE_SERIES = {
  account_balance: {
    table: "account_balances",
    kind: "snapshot",
    correctable: ["balance_pence", "currency", "valid_from"],
  },
  pension_value: {
    table: "pension_values",
    kind: "snapshot",
    correctable: ["value_pence", "currency", "valid_from"],
  },
  mortgage_balance: {
    table: "mortgage_balance",
    kind: "snapshot",
    correctable: ["outstanding_pence", "interest_rate_bps", "currency", "valid_from"],
  },
  holding: {
    table: "holdings",
    kind: "snapshot",
    correctable: ["quantity", "valid_from"],
  },
  person_profile: {
    table: "person_profile",
    kind: "snapshot",
    correctable: ["employer_name", "tax_code", "salary_pence", "currency", "valid_from"],
  },
  transaction: {
    table: "transactions",
    kind: "event",
    correctable: ["amount_pence", "category", "description", "occurred_at", "currency"],
  },
  income_event: {
    table: "income_events",
    kind: "event",
    correctable: [
      "gross_pence",
      "taxable_pence",
      "net_pence",
      "paye_pence",
      "ni_employee_pence",
      "pension_employee_pence",
      "pension_employer_pence",
      "tax_code",
      "tax_year",
      "pay_date",
      "currency",
    ],
  },
  vesting_event: {
    table: "equity_vesting_event",
    kind: "event",
    correctable: [
      "units_vested",
      "market_price_pence",
      "estimated_value_pence",
      "vest_date",
    ],
  },
  asset_price: {
    table: "asset_prices",
    kind: "event",
    correctable: ["unit_price_pence", "currency", "as_of", "source"],
  },
} satisfies Record<string, SeriesDescriptor>;

const RETRACTABLE_SERIES = {
  ...CORRECTABLE_SERIES,
  equity_grant: {
    table: "equity_grant",
    kind: "reference",
    correctable: [],
  },
} satisfies Record<string, SeriesDescriptor>;

export type CorrectableSeries = keyof typeof CORRECTABLE_SERIES;
export type RetractableSeries = keyof typeof RETRACTABLE_SERIES;

export const correctableSeriesNames = Object.keys(CORRECTABLE_SERIES) as [
  CorrectableSeries,
  ...CorrectableSeries[],
];
export const retractableSeriesNames = Object.keys(RETRACTABLE_SERIES) as [
  RetractableSeries,
  ...RetractableSeries[],
];

type StoredRow = Record<string, unknown> & {
  id: number;
  source_id: number | null;
  superseded_by: number | null;
};

function fetchRowOrThrow(table: string, rowId: number): StoredRow {
  const row = getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId) as
    | StoredRow
    | undefined;
  if (!row) {
    throw new Error(
      `No ${table} row with id ${rowId}. Locate the exact row to edit before correcting or retracting it.`,
    );
  }
  return row;
}

function assertEditable(table: string, row: StoredRow): void {
  if (row.superseded_by != null) {
    throw new Error(
      `${table} row ${row.id} has already been superseded and cannot be edited again. Edit its successor instead.`,
    );
  }
  if (row.source_id != null) {
    const doc = getDb()
      .prepare(`SELECT source_type FROM documents WHERE id = ?`)
      .get(row.source_id) as { source_type: string } | undefined;
    if (doc?.source_type === "connector") {
      throw new Error(
        `${table} row ${row.id} came from a connector and is owned by the upstream source. Connector data cannot be edited locally; correct it at the source or record a separate manual adjustment.`,
      );
    }
  }
}

function insertCorrectedClone(
  table: string,
  original: StoredRow,
  correctedFields: Record<string, number | string>,
  documentId: number,
): number {
  const next: Record<string, unknown> = { ...original, ...correctedFields };
  delete next.id;
  delete next.recorded_at;
  next.source_id = documentId;
  next.superseded_by = null;
  const columns = Object.keys(next);
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((c) => next[c] as never);
  const info = getDb()
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
    .run(...values);
  return Number(info.lastInsertRowid);
}

export async function correctRecord(input: {
  series: CorrectableSeries;
  row_id: number;
  corrected_fields: Record<string, number | string>;
  reason: string;
}): Promise<string> {
  const descriptor = CORRECTABLE_SERIES[input.series];
  if (!descriptor) {
    throw new Error(
      `Unknown series "${input.series}". Correctable series: ${correctableSeriesNames.join(", ")}.`,
    );
  }

  const fieldNames = Object.keys(input.corrected_fields);
  if (fieldNames.length === 0) {
    throw new Error(
      `No corrected fields supplied for ${input.series}. Provide the field(s) that were wrong.`,
    );
  }
  const invalid = fieldNames.filter((f) => !descriptor.correctable.includes(f));
  if (invalid.length > 0) {
    throw new Error(
      `Cannot correct ${invalid.join(", ")} on ${input.series}. Correctable fields: ${descriptor.correctable.join(", ")}.`,
    );
  }

  return getKysely()
    .transaction()
    .execute(async (trx) => {
      const original = fetchRowOrThrow(descriptor.table, input.row_id);
      assertEditable(descriptor.table, original);

      const documentId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "correction",
        series: input.series,
        target_table: descriptor.table,
        target_row_id: input.row_id,
        reason: input.reason,
        corrected_fields: input.corrected_fields,
      });

      const newId = insertCorrectedClone(
        descriptor.table,
        original,
        input.corrected_fields,
        documentId,
      );

      getDb()
        .prepare(`UPDATE ${descriptor.table} SET superseded_by = ? WHERE id = ?`)
        .run(newId, input.row_id);

      return [
        `Corrected ${input.series} row ${input.row_id}.`,
        `Changed ${fieldNames.join(", ")}; superseding row ${newId} now carries the truth.`,
        `The original is retained for audit (document ID: ${documentId}).`,
      ].join(" ");
    });
}

export async function retractRecord(input: {
  series: RetractableSeries;
  row_id: number;
  reason: string;
}): Promise<string> {
  const descriptor = RETRACTABLE_SERIES[input.series];
  if (!descriptor) {
    throw new Error(
      `Unknown series "${input.series}". Retractable series: ${retractableSeriesNames.join(", ")}.`,
    );
  }

  return getKysely()
    .transaction()
    .execute(async (trx) => {
      const target = fetchRowOrThrow(descriptor.table, input.row_id);
      assertEditable(descriptor.table, target);

      const documentId = await writeManualDocument(trx, {
        source_type: "manual",
        entry_type: "retraction",
        series: input.series,
        target_table: descriptor.table,
        target_row_id: input.row_id,
        reason: input.reason,
      });

      getDb()
        .prepare(`UPDATE ${descriptor.table} SET superseded_by = id WHERE id = ?`)
        .run(input.row_id);

      let cascadedVests = 0;
      if (input.series === "equity_grant") {
        const info = getDb()
          .prepare(
            `UPDATE equity_vesting_event SET superseded_by = id WHERE grant_id = ? AND superseded_by IS NULL`,
          )
          .run(input.row_id);
        cascadedVests = info.changes;
      }

      const cascadeNote =
        cascadedVests > 0
          ? ` Also retracted ${cascadedVests} dependent vesting event(s).`
          : "";
      return [
        `Retracted ${input.series} row ${input.row_id}.`,
        `It no longer appears in any total, dashboard, or query.`,
        `The row is retained on disk for audit (document ID: ${documentId}).${cascadeNote}`,
      ].join(" ");
    });
}
