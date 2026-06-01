import { runQuery } from "../query.js";
import { toNum } from "../sql_util.js";
import type { IncomeTotal, LineItem } from "./types.js";

function isLineItem(value: unknown): value is LineItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.description === "string" &&
    (item.section === "payment" || item.section === "deduction") &&
    typeof item.amount_pence === "number" &&
    Number.isInteger(item.amount_pence)
  );
}

export function aggregateLineItems(payloads: string[]): LineItem[] {
  const totals = new Map<string, LineItem>();
  for (const payload of payloads) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const items = (parsed as { line_items?: unknown })?.line_items;
    if (!Array.isArray(items)) continue;
    for (const candidate of items) {
      if (!isLineItem(candidate)) continue;
      const key = `${candidate.section} ${candidate.description}`;
      const existing = totals.get(key);
      if (existing) {
        existing.amount_pence += candidate.amount_pence;
      } else {
        totals.set(key, { ...candidate });
      }
    }
  }
  return [...totals.values()];
}

export async function queryIncome(start: string, end: string): Promise<IncomeTotal> {
  const rows = await runQuery(
    `SELECT
      COALESCE(SUM(net_pence), 0) AS net_pence,
      COALESCE(SUM(gross_pence), 0) AS gross_pence,
      COALESCE(SUM(paye_pence), 0) AS paye_pence,
      COALESCE(SUM(ni_employee_pence), 0) AS ni_employee_pence,
      COALESCE(SUM(pension_employee_pence), 0) AS pension_employee_pence,
      COALESCE(SUM(COALESCE(pension_employer_pence, 0)), 0) AS pension_employer_pence,
      arg_max(tax_code, pay_date) AS tax_code,
      COUNT(*) AS payslip_count
    FROM pfa.income_events
    WHERE CAST(pay_date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
      AND superseded_by IS NULL`,
    [start, end],
  );

  const row = rows[0] ?? {};
  const gross_pence = toNum(row.gross_pence);
  const net_pence = toNum(row.net_pence);
  const paye_pence = toNum(row.paye_pence);
  const ni_employee_pence = toNum(row.ni_employee_pence);
  const other_deductions_pence = Math.max(
    0,
    gross_pence - net_pence - paye_pence - ni_employee_pence,
  );

  const payloadRows = await runQuery(
    `SELECT payload
    FROM pfa.income_events
    WHERE CAST(pay_date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
      AND payload IS NOT NULL
      AND superseded_by IS NULL`,
    [start, end],
  );
  const payloads = payloadRows
    .map((r) => r.payload)
    .filter((p): p is string => typeof p === "string");
  const line_items = aggregateLineItems(payloads);

  return {
    net_pence,
    gross_pence,
    paye_pence,
    ni_employee_pence,
    pension_employee_pence: toNum(row.pension_employee_pence),
    pension_employer_pence: toNum(row.pension_employer_pence),
    other_deductions_pence,
    tax_code: (row.tax_code as string | null) ?? null,
    payslip_count: toNum(row.payslip_count),
    line_items,
  };
}
