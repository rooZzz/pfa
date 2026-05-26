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
