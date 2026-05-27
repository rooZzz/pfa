# Schema Catalog

This document is injected into every Haiku text-to-SQL call alongside the DDL. It describes table semantics, column conventions, and UK tax context so that generated SQL is correct without fine-tuning.

When generating SQL, always target DuckDB syntax. Tables are in the `pfa` schema (attached SQLite file). Prefix all table names with `pfa.` (e.g. `pfa.account_balances`).

---

## Table: `pfa.documents`

Every ingested row in this database traces back to a row in `documents`. It is the universal source anchor.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. Referenced as `source_id` in every event and snapshot table. |
| `source_type` | TEXT | One of: `upload` (user-uploaded file), `manual` (user typed value into chat), `connector` (automated API sync). |
| `file_path` | TEXT | Absolute path to the source file on disk. For manual entries this is a system-generated JSON file. |
| `content_hash` | TEXT | SHA-256 of the file content. Deduplication and integrity check. |
| `ingested_at` | TIMESTAMP | UTC timestamp when the row was recorded. |
| `notes` | TEXT | Optional free-text annotation. |

---

## Table: `pfa.account_balances`

**Pattern: Snapshot.** Records an observed account balance at a point in time. Rows are never updated. Corrections close the old row (`valid_to = today`) and insert a new corrected row. Gaps between observations are filled using LOCF (last observation carried forward) at query time.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `account_id` | INTEGER | References the account. No FK in Stage 3 — just a numeric identifier. |
| `balance_pence` | INTEGER | Balance in the smallest currency unit (pence for GBP). Never a float. |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |
| `valid_from` | DATE | The date this observation is valid from (typically the statement date or the date the user entered the value). |
| `valid_to` | DATE | NULL means this is the current open row. Set when a correction supersedes this row. |
| `recorded_at` | TIMESTAMP | UTC timestamp when this row was written to the database. Different from `valid_from` for backfilled entries. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. Every balance row is traceable to a source. |

**LOCF gap-fill pattern.** To get the balance for a given account on a given date, use the most recent `valid_from` that is on or before the query date:

```sql
SELECT
  account_id,
  balance_pence,
  currency,
  valid_from,
  recorded_at
FROM pfa.account_balances
WHERE account_id = ?
  AND valid_from <= ?
  AND (valid_to IS NULL OR valid_to > ?)
ORDER BY valid_from DESC
LIMIT 1
```

For the current balance (today), omit the date filter and just get the row with the latest `valid_from` where `valid_to IS NULL`.

---

## Table: `pfa.accounts`

**Pattern: Reference.** Defines an account — a named, typed financial account. Rows are inserted once and rarely change.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. Referenced as `account_id` in `account_balances`, `pension_values`. |
| `name` | TEXT | Human-readable account name (e.g. "Barclays Current", "Nest Pension"). |
| `type` | TEXT | One of: `current`, `savings`, `isa`, `pension`, `mortgage`. |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |

---

## Table: `pfa.assets`

**Pattern: Reference.** Defines a non-account asset (crypto, investments). Rows are inserted once.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. Referenced as `asset_id` in `asset_values`. |
| `name` | TEXT | Human-readable name (e.g. "ETH", "Vanguard FTSE All-World"). |
| `asset_type` | TEXT | Free-form type descriptor (e.g. "crypto", "etf", "stock"). |
| `base_currency` | TEXT | The native currency of the asset (e.g. "ETH", "USD", "GBP"). |

---

## Table: `pfa.mortgages`

**Pattern: Reference.** Defines a mortgage. Rows are inserted once.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. Referenced as `mortgage_id` in `mortgage_balance`. |
| `lender` | TEXT | Lender name (e.g. "Nationwide"). |
| `property` | TEXT | Property address or identifier. |
| `original_amount_pence` | INTEGER | Original loan amount in pence. Never updated — use `mortgage_balance` for current outstanding. |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |

---

## Table: `pfa.income_events`

**Pattern: Event.** Immutable record of one payslip. One row per pay period. Never updated or deleted.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `pay_date` | DATE | The payment date from the payslip (not the period end date). |
| `tax_year` | TEXT | UK tax year (e.g. `2026/27`), if shown on the payslip. FK to `tax_periods`. NULL if absent. |
| `gross_pence` | INTEGER | Gross Pay in pence — total earnings before deductions. Not the same as Taxable Pay. |
| `taxable_pence` | INTEGER | Taxable Pay in pence, if different from `gross_pence`. Can exceed `gross_pence` when Benefits in Kind (BIK) are included. NULL if equal to gross or not shown. |
| `net_pence` | INTEGER | Net Pay in pence — take-home after all deductions. |
| `paye_pence` | INTEGER | PAYE income tax deducted this period, in pence. |
| `ni_employee_pence` | INTEGER | Employee National Insurance contribution this period, in pence. |
| `pension_employee_pence` | INTEGER | Total employee pension contribution this period, in pence. Includes salary sacrifice (SMART/AVC) regardless of which payslip section they appear in. |
| `pension_employer_pence` | INTEGER | Employer pension contribution this period, in pence. NULL if not shown. |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |
| `occurred_at` | TIMESTAMP | Midnight UTC on `pay_date`. |
| `recorded_at` | TIMESTAMP | UTC timestamp when the row was written to the database. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |

**Sign convention:** all amounts are positive integers. Deductions are stored as their absolute value — do not negate.

---

## Table: `pfa.pension_values`

**Pattern: Snapshot.** Observed pension pot value at a point in time. Use LOCF to fill gaps.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `account_id` | INTEGER | FK to `accounts.id` (must be type `pension`). |
| `value_pence` | INTEGER | Pot value in pence at observation date. |
| `currency` | TEXT | Default `GBP`. |
| `valid_from` | DATE | Statement date. |
| `valid_to` | DATE | NULL = current row. Set when superseded. |
| `recorded_at` | TIMESTAMP | When this row was written. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |

---

## Table: `pfa.mortgage_balance`

**Pattern: Snapshot.** Observed mortgage state at a point in time.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `mortgage_id` | INTEGER | FK to `mortgages.id`. |
| `outstanding_pence` | INTEGER | Outstanding balance in pence. |
| `interest_rate_bps` | INTEGER | Current interest rate in basis points (e.g. 4.5% = 450). Integer to avoid floats. |
| `property_value_pence` | INTEGER | Estimated property value in pence at observation date. |
| `currency` | TEXT | Default `GBP`. |
| `valid_from` | DATE | Observation date. |
| `valid_to` | DATE | NULL = current row. |
| `recorded_at` | TIMESTAMP | When written. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |

**LTV query:** `outstanding_pence * 100 / property_value_pence` gives LTV as a percentage (integer arithmetic).

---

## Table: `pfa.asset_values`

**Pattern: Snapshot.** Observed value of a non-account asset.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `asset_id` | INTEGER | FK to `assets.id`. |
| `quantity` | INTEGER | Quantity in the asset's smallest unit (e.g. satoshis for BTC, shares × 10000 for fractional). |
| `original_currency` | TEXT | Native currency of the asset. |
| `gbp_equivalent_pence` | INTEGER | GBP equivalent at observation time. Never recomputed — stored at ingestion. |
| `valid_from` | DATE | Observation date. |
| `valid_to` | DATE | NULL = current row. |
| `recorded_at` | TIMESTAMP | When written. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |

---

## Table: `pfa.person_profile`

**Pattern: Snapshot.** Employment details valid over a date range. Close and reinsert on changes.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `employer_name` | TEXT | Employer name. |
| `tax_code` | TEXT | PAYE tax code (e.g. `1257L`, `0T`). |
| `salary_pence` | INTEGER | Annual gross salary in pence. |
| `currency` | TEXT | Default `GBP`. |
| `valid_from` | DATE | Date this profile became effective. |
| `valid_to` | DATE | NULL = current profile. Set on change. |
| `recorded_at` | TIMESTAMP | When written. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |

---

## Table: `pfa.transactions`

**Pattern: Event.** Immutable record of a cash movement. Never updated or deleted.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `account_id` | INTEGER | The account this cash movement belongs to. |
| `occurred_at` | TIMESTAMP | When the transaction actually happened (statement date/time). |
| `recorded_at` | TIMESTAMP | When the row was written to this database. |
| `amount_pence` | INTEGER | Amount in pence. Positive = inflow (credit). Negative = outflow (debit). |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |
| `description` | TEXT | Free-text description from the source (e.g. merchant name). |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |

---

## Table: `pfa.tax_periods`

Reference table for UK tax years. All ISA and PAYE queries must anchor to this table. Never assume calendar year.

| Column | Type | Meaning |
|---|---|---|
| `tax_year` | TEXT | Primary key. Format: `YYYY/YY` e.g. `2025/26`. |
| `starts_on` | DATE | April 6 of the first year. E.g. `2025-04-06`. |
| `ends_on` | DATE | April 5 of the second year. E.g. `2026-04-05`. |

**UK tax year rule:** The tax year starts on April 6 and ends on April 5 of the following year. A date like `2026-01-15` falls in the `2025/26` tax year. Never use `YEAR()` or calendar year boundaries for tax calculations — always join to `tax_periods`.

---

## Example queries

### 1. Current balance for account 1

```sql
SELECT
  balance_pence,
  currency,
  valid_from,
  recorded_at
FROM pfa.account_balances
WHERE account_id = 1
  AND valid_to IS NULL
ORDER BY valid_from DESC
LIMIT 1
```

### 2. Balance for account 1 on a specific date (LOCF)

```sql
SELECT
  balance_pence,
  currency,
  valid_from,
  recorded_at
FROM pfa.account_balances
WHERE account_id = 1
  AND valid_from <= DATE '2026-02-01'
  AND (valid_to IS NULL OR valid_to > DATE '2026-02-01')
ORDER BY valid_from DESC
LIMIT 1
```

### 3. All account balances (latest per account)

```sql
SELECT DISTINCT ON (account_id)
  account_id,
  balance_pence,
  currency,
  valid_from,
  recorded_at
FROM pfa.account_balances
WHERE valid_to IS NULL
ORDER BY account_id, valid_from DESC
```

### 4. Total credits to account 1 this calendar month

```sql
SELECT SUM(amount_pence) AS total_credits_pence
FROM pfa.transactions
WHERE account_id = 1
  AND amount_pence > 0
  AND occurred_at >= DATE_TRUNC('month', CURRENT_DATE)
```

### 5. All balance observations for account 1 in chronological order

```sql
SELECT
  valid_from,
  balance_pence,
  currency,
  recorded_at
FROM pfa.account_balances
WHERE account_id = 1
ORDER BY valid_from ASC
```

### 6. Most recent payslip (gross, net, PAYE, pension)

```sql
SELECT
  pay_date,
  gross_pence,
  net_pence,
  paye_pence,
  ni_employee_pence,
  pension_employee_pence,
  pension_employer_pence,
  recorded_at
FROM pfa.income_events
ORDER BY pay_date DESC
LIMIT 1
```

### 7. Total PAYE paid in the current tax year

```sql
SELECT
  SUM(ie.paye_pence) AS total_paye_pence,
  tp.tax_year
FROM pfa.income_events ie
JOIN pfa.tax_periods tp
  ON ie.pay_date BETWEEN tp.starts_on AND tp.ends_on
WHERE tp.starts_on <= CURRENT_DATE
  AND tp.ends_on >= CURRENT_DATE
GROUP BY tp.tax_year
```

### 8. Net pay trend — last 6 payslips

```sql
SELECT
  pay_date,
  gross_pence,
  net_pence,
  paye_pence,
  recorded_at
FROM pfa.income_events
ORDER BY pay_date DESC
LIMIT 6
```
