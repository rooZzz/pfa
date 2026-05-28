import type Database from "better-sqlite3";

const PERIODS: Array<{ tax_year: string; starts_on: string; ends_on: string }> = [
  { tax_year: "2020/21", starts_on: "2020-04-06", ends_on: "2021-04-05" },
  { tax_year: "2021/22", starts_on: "2021-04-06", ends_on: "2022-04-05" },
  { tax_year: "2022/23", starts_on: "2022-04-06", ends_on: "2023-04-05" },
  { tax_year: "2023/24", starts_on: "2023-04-06", ends_on: "2024-04-05" },
  { tax_year: "2024/25", starts_on: "2024-04-06", ends_on: "2025-04-05" },
  { tax_year: "2025/26", starts_on: "2025-04-06", ends_on: "2026-04-05" },
  { tax_year: "2026/27", starts_on: "2026-04-06", ends_on: "2027-04-05" },
  { tax_year: "2027/28", starts_on: "2027-04-06", ends_on: "2028-04-05" },
  { tax_year: "2028/29", starts_on: "2028-04-06", ends_on: "2029-04-05" },
  { tax_year: "2029/30", starts_on: "2029-04-06", ends_on: "2030-04-05" },
  { tax_year: "2030/31", starts_on: "2030-04-06", ends_on: "2031-04-05" },
];

export function up(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO tax_periods (tax_year, starts_on, ends_on) VALUES (?, ?, ?)",
  );
  for (const { tax_year, starts_on, ends_on } of PERIODS) {
    insert.run(tax_year, starts_on, ends_on);
  }
}

export function down(db: Database.Database): void {
  const placeholders = PERIODS.map(() => "?").join(", ");
  db.prepare(`DELETE FROM tax_periods WHERE tax_year IN (${placeholders})`).run(
    ...PERIODS.map((p) => p.tax_year),
  );
}
