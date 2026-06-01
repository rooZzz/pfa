# Schema Catalog

This document is injected into every Haiku text-to-SQL call alongside the DDL. It describes table semantics, column conventions, and UK tax context so that generated SQL is correct without fine-tuning.

When generating SQL, always target DuckDB syntax. Tables are in the `pfa` schema (attached SQLite file). Prefix all table names with `pfa.` (e.g. `pfa.account_balances`).

**Superseded rows.** Editable event and snapshot tables (`account_balances`, `pension_values`, `mortgage_balance`, `holdings`, `person_profile`, `transactions`, `income_events`, `equity_vesting_event`, `asset_prices`, `equity_grant`) carry a `superseded_by` column. A non-null value means the row was corrected or retracted and is retained for audit only — it is NOT current truth. Always add `AND superseded_by IS NULL` to every query against these tables so corrected and removed facts never appear in an answer.

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

**Pattern: Snapshot.** Records an observed account balance at a point in time. A new observation (the balance changed) is a new row with a later `valid_from`; the old row stays current truth for its own window. A correction (the row was recorded wrong) inserts a superseding row at the original `valid_from` and marks the wrong row `superseded_by`. Gaps between observations are filled using LOCF (last observation carried forward) at query time.

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
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

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
| `type` | TEXT | One of: `current`, `savings`, `isa`, `pension`, `mortgage`. A connector models each Monzo pot as its own account row (`savings`, or `isa` for a cash ISA pot). |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |
| `provider` | TEXT | Connector that owns this account (e.g. `monzo`). NULL for manually entered accounts. |
| `external_id` | TEXT | The provider's own identifier for this account or pot. NULL for manual accounts. Unique per `(provider, external_id)`; lets a sync match an existing account instead of duplicating it. |

---

## Table: `pfa.assets`

**Pattern: Reference.** Defines a non-account asset (crypto, investments, property). Rows are inserted once.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. Referenced as `asset_id` in `holdings`, `asset_prices`, and `equity_grant`. |
| `name` | TEXT | Human-readable name (e.g. "ETH", "Vanguard FTSE All-World", "12 Acacia Avenue"). |
| `asset_type` | TEXT | Free-form type descriptor (e.g. "crypto", "etf", "stock", "property"). |
| `base_currency` | TEXT | The native currency of the asset (e.g. "ETH", "USD", "GBP"). |
| `price_source` | TEXT | Strategy hint for where to fetch prices. Default `manual`. Future values: `coingecko`, `zoopla`, `web_search`. |
| `ticker` | TEXT | Trading symbol for the asset (e.g. "ACME"), or null. Shown as the identifier for upcoming equity vests. |

---

## Table: `pfa.holdings`

**Pattern: Snapshot.** Records how many units of an asset are held at a point in time. Inventory only — no price information. Use LOCF to fill gaps.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `asset_id` | INTEGER | FK to `assets.id`. |
| `quantity` | INTEGER | Units held. For whole shares use units directly. For fractional shares use units × 10000. For property use 1. |
| `valid_from` | DATE | Date the holding became effective. |
| `valid_to` | DATE | NULL = current row. Set when holding changes. |
| `recorded_at` | TIMESTAMP | When written. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

**To value a holding:** join with `asset_prices` on `asset_id` for the latest price on or before the query date, then multiply `quantity × unit_price_pence`.

---

## Table: `pfa.asset_prices`

**Pattern: Event (price tick).** Records a per-unit price observation for an asset. Prices are immutable once recorded — add a new row when the price changes. One row per price observation, not one row per asset.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `asset_id` | INTEGER | FK to `assets.id`. |
| `unit_price_pence` | INTEGER | Price per unit in pence, in the currency of this row. Never a float. |
| `currency` | TEXT | Currency of the unit price. Usually the asset's `base_currency` for crypto/stocks; GBP for properties. |
| `as_of` | TIMESTAMP | When this price was observed. TIMESTAMP (not DATE) to support intraday crypto prices. |
| `source` | TEXT | Where the price came from: `manual`, `coingecko`, `zoopla`, `web_search`, etc. |
| `recorded_at` | TIMESTAMP | When this row was written. |
| `source_id` | INTEGER | FK to `documents.id`. NULL for connector-fetched prices that have no uploaded document. |
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

**To get the latest price for an asset:**

```sql
SELECT DISTINCT ON (asset_id)
  asset_id,
  unit_price_pence,
  currency,
  as_of,
  source
FROM pfa.asset_prices
WHERE as_of <= TIMESTAMP '2026-05-01 23:59:59'
ORDER BY asset_id, as_of DESC
```

**To value a holding:** `quantity × unit_price_pence` gives the value in `currency`. If `currency = 'GBP'` this is the GBP value directly. Non-GBP prices require FX conversion (not yet implemented — all seed data uses GBP-equivalent prices).

---

## Table: `pfa.mortgages`

**Pattern: Reference.** Defines a mortgage. Rows are inserted once.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. Referenced as `mortgage_id` in `mortgage_balance`. |
| `lender` | TEXT | Lender name (e.g. "Nationwide"). |
| `property` | TEXT | Property address or identifier. Must match the `name` of the corresponding `assets` row (asset_type = 'property') for property valuation to work. |
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
| `tax_code` | TEXT | PAYE tax code from the payslip header (e.g. `1257L`, `0T`, `BR`). Event-locked per payslip — never updated. NULL if not shown. Trend changes over time by ordering on `pay_date`. |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |
| `occurred_at` | TIMESTAMP | Midnight UTC on `pay_date`. |
| `recorded_at` | TIMESTAMP | UTC timestamp when the row was written to the database. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |
| `payload` | TEXT | JSON object holding descriptive payslip line items (`{"line_items": [{"description": "...", "section": "payment"\|"deduction", "amount_pence": N}]}`). Each line carries its `section` — which side of the payslip it sits on. Present when ingested via the upload widget. **Do not use `payload` as a source for arithmetic or aggregation** — use the typed spine columns above. The payload is for display and auditability only. |
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted payslip, retained for audit only. Always filter `superseded_by IS NULL`. |

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
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

---

## Table: `pfa.mortgage_balance`

**Pattern: Snapshot.** Observed mortgage state at a point in time. Records the liability (outstanding balance) only. The property asset value is tracked separately via `holdings` + `asset_prices` against the matching `assets` row.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `mortgage_id` | INTEGER | FK to `mortgages.id`. |
| `outstanding_pence` | INTEGER | Outstanding balance in pence. |
| `interest_rate_bps` | INTEGER | Current interest rate in basis points (e.g. 4.5% = 450). Integer to avoid floats. |
| `currency` | TEXT | Default `GBP`. |
| `valid_from` | DATE | Observation date. |
| `valid_to` | DATE | NULL = current row. |
| `recorded_at` | TIMESTAMP | When written. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

**Property equity:** To compute equity, join the mortgage's `outstanding_pence` with the latest `asset_prices.unit_price_pence` for the property asset (matched by `mortgages.property = assets.name` where `assets.asset_type = 'property'`). Equity = property value − outstanding.

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
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

---

## Table: `pfa.equity_grant`

**Pattern: Reference.** Defines one equity award. One row per grant. Never updated.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. Referenced as `grant_id` in `equity_vesting_event`. |
| `scheme_type` | TEXT | One of: `rsu`, `emi`, `unapproved`, `saye`. |
| `units` | INTEGER | Total units granted. |
| `strike_pence` | INTEGER | Exercise price per unit in pence. NULL for RSUs. Event-locked tax fact — never updated. |
| `grant_date` | DATE | Date the award was granted. |
| `currency` | TEXT | ISO 4217 code. Default `GBP`. |
| `asset_id` | INTEGER | FK to `assets.id`. The underlying share. Used to look up current price in `asset_prices` for unvested-unit valuation. NULL if not linked. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |
| `payload` | TEXT | JSON for scheme-specific terms. **Do not use for arithmetic** — payload is for display only. |
| `superseded_by` | INTEGER | NULL = current truth. Non-null = retracted grant (and its vesting events), retained for audit only. Always filter `superseded_by IS NULL`. |

**Net worth note.** The vesting schedule is recorded as `equity_vesting_event` rows — one per tranche, past or future. A tranche with `vest_date <= as_of` is realised; one with `vest_date > as_of` is an upcoming (contingent) vest. Upcoming vests are valued at the current share price via `equity_grant.asset_id` → `asset_prices`: RSUs at `units × price`, options at `units × max(price − strike_pence, 0)`. Units with no recorded tranche (`units − SUM(equity_vesting_event.units_vested) > 0`) are surfaced as unscheduled.

---

## Table: `pfa.equity_vesting_event`

**Pattern: Event.** Immutable record of one vesting tranche. Never updated or deleted.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `grant_id` | INTEGER | FK to `equity_grant.id`. |
| `vest_date` | DATE | Date the tranche vests. May be in the future (a scheduled tranche) or the past (a realised one). |
| `units_vested` | INTEGER | Number of units in this tranche. |
| `market_price_pence` | INTEGER | Market price per unit at vesting in pence. Event-locked tax fact — never refreshed. NULL for future tranches (not yet vested) or if not recorded. |
| `estimated_value_pence` | INTEGER | `units_vested × market_price_pence` at time of recording. NULL if price unknown. |
| `occurred_at` | TIMESTAMP | Midnight UTC on `vest_date`. |
| `recorded_at` | TIMESTAMP | When this row was written. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |
| `payload` | TEXT | JSON for scheme-specific detail (e.g. tax withholding method). **Do not use for arithmetic.** |
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

**Sign convention.** `estimated_value_pence` is the gross estimated proceeds before tax. Tax liability is computed separately (deferred to cashflow flow).

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
| `category` | TEXT | Spending category. Free-text, expected to follow Monzo vocabulary: `general`, `eating_out`, `expenses`, `transport`, `cash`, `bills`, `entertainment`, `shopping`, `holidays`, `groceries`, plus other Monzo built-in slugs (`family`, `gifts`, `savings`, `transfers`). Use `income` for non-salary inflows. Default `general`. Monzo user-defined custom categories arrive as opaque `category_<id>` values and are kept as-is so each stays a distinct bucket; the display layer numbers them ("Custom 1", "Custom 2") since Monzo's API does not expose their names. |
| `external_id` | TEXT | The provider's own transaction identifier (e.g. a Monzo transaction id). NULL for manual rows. Unique; connector syncs use it to avoid inserting the same transaction twice. |
| `is_internal` | INTEGER | `1` if this is a movement between the user's own accounts or pots (e.g. funding a savings pot), `0` otherwise. Default `0`. Internal movements are excluded from spending totals (cashflow outflow, average monthly outgoings) since they are not consumption. They are NOT excluded from ISA contribution totals, where a current-to-ISA transfer is a genuine contribution. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id`. |
| `superseded_by` | INTEGER | NULL = current truth. Non-null = corrected or retracted, retained for audit only. Always filter `superseded_by IS NULL`. |

**Cashflow note.** `transactions` (the bank feed) is the source of truth for actual money in and out, including the salary credit, rent, and any other income — these are all positive `amount_pence` rows. `income_events` (payslips) is the tax decomposition of salary (gross, PAYE, NI, pension) and is NOT an income amount to add: summing `income_events.net_pence` together with transaction inflows double-counts the salary, which already lands as a credit in `transactions`. Use `income_events` for the gross/tax/pension split and tax-year allowance logic, never as a cashflow total. Exclude internal movements (`transactions.is_internal = 1`) from spending and inflow aggregations. Treat the `savings` category as a distinct third stream (savings and investing), separate from spending: money moved to or from savings/investments held outside the connected accounts (e.g. Monzo Investments) is a cash movement but neither consumption nor a net-worth change, so it is reported as its own net figure and excluded from the spending and income totals. Transfers into Monzo savings/ISA pots are internal (`is_internal = 1`, their `description` is the destination pot's `external_id`); they stay in liquid savings and are reported separately as "into pots", never in spending and never in the net. To anchor to a UK tax year, join `transactions.occurred_at` to `tax_periods` using `CAST(occurred_at AS DATE) BETWEEN starts_on AND ends_on`.

**Cashflow by category:**

```sql
SELECT
  category,
  SUM(amount_pence) FILTER (WHERE amount_pence > 0) AS inflow_pence,
  ABS(SUM(amount_pence) FILTER (WHERE amount_pence < 0)) AS outflow_pence,
  COUNT(*) AS count
FROM pfa.transactions t
JOIN pfa.tax_periods tp ON CAST(t.occurred_at AS DATE) BETWEEN tp.starts_on AND tp.ends_on
WHERE tp.tax_year = '2025/26'
GROUP BY category
ORDER BY outflow_pence DESC
```

---

## Table: `pfa.tax_periods`

Reference table for UK tax years. All ISA and PAYE queries must anchor to this table. Never assume calendar year.

| Column | Type | Meaning |
|---|---|---|
| `tax_year` | TEXT | Primary key. Format: `YYYY/YY` e.g. `2025/26`. |
| `starts_on` | DATE | April 6 of the first year. E.g. `2025-04-06`. |
| `ends_on` | DATE | April 5 of the second year. E.g. `2026-04-05`. |

**UK tax year rule:** The tax year starts on April 6 and ends on April 5 of the following year. A date like `2026-01-15` falls in the `2025/26` tax year. Never use `YEAR()` or calendar year boundaries for tax calculations — always join to `tax_periods`.

**Sibling table `pfa.tax_constants`** (UK tax/legal constants: allowances, rates, bands, access ages) exists on disk but is deliberately not a text-to-SQL target. It is injected into the advice and briefing payload via the deterministic accessor in `server/tax_constants.ts` (`resolveConstant`, `taxConstantsForDate`), never queried by generated SQL — its dated, status-tagged temporal logic is too easy to get wrong in generated queries.

---

## Table: `pfa.goals`

**Pattern: Reference.** One row per financial goal the user has set. The structured form of a classified goal type. Decomposition into sub-goals, metric bindings, and directives is authored in code and computed at briefing time — not stored here.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | Primary key. |
| `goal_type` | TEXT | The goal type from the catalog: `emergency_fund`, `isa_max`, `fire`, `house_deposit`, `debt_payoff`, `retirement`. |
| `params` | TEXT | JSON object holding the confirmed slots for the goal type (e.g. `{"target_months": 6}` or `{"tax_year": "2025/26"}`). **Not a source for arithmetic or aggregation** — it holds goal configuration, read by the briefing engine, not the query layer. |
| `raw_utterance` | TEXT | The user's original goal statement, stored verbatim as provenance and harness framing context. Never a data source for directives. |
| `status` | TEXT | `active` or `archived`. Only `active` goals are evaluated in the briefing. |
| `source_id` | INTEGER | NOT NULL. FK to `documents.id` — the audit document capturing the goal as entered. |
| `recorded_at` | TIMESTAMP | UTC timestamp when the goal was recorded. |

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

**IMPORTANT:** An account can have multiple rows in `account_balances` (one per observation). Always deduplicate to one row per `account_id` before aggregating. Never `SUM(balance_pence)` without this subquery — it will double-count.

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

### 4. Current value of all asset holdings

Join the latest holding with the latest price. Only returns assets where both a holding and a price exist.

```sql
WITH latest_holdings AS (
  SELECT DISTINCT ON (asset_id)
    asset_id, quantity
  FROM pfa.holdings
  WHERE valid_to IS NULL
  ORDER BY asset_id, valid_from DESC
),
latest_prices AS (
  SELECT DISTINCT ON (asset_id)
    asset_id, unit_price_pence, currency, as_of, source
  FROM pfa.asset_prices
  ORDER BY asset_id, as_of DESC
)
SELECT
  a.name,
  a.asset_type,
  h.quantity,
  p.unit_price_pence,
  p.currency,
  CAST(h.quantity AS BIGINT) * p.unit_price_pence AS total_value_pence,
  p.as_of AS price_as_of,
  p.source AS price_source
FROM latest_holdings h
JOIN pfa.assets a ON a.id = h.asset_id
JOIN latest_prices p ON p.asset_id = h.asset_id
```

### 5. Current property value and mortgage equity

```sql
WITH prop_price AS (
  SELECT DISTINCT ON (ap.asset_id)
    a.name AS property_name,
    ap.unit_price_pence AS property_value_pence
  FROM pfa.asset_prices ap
  JOIN pfa.assets a ON a.id = ap.asset_id
  WHERE a.asset_type = 'property'
  ORDER BY ap.asset_id, ap.as_of DESC
),
outstanding AS (
  SELECT DISTINCT ON (mb.mortgage_id)
    m.property,
    mb.outstanding_pence
  FROM pfa.mortgage_balance mb
  JOIN pfa.mortgages m ON m.id = mb.mortgage_id
  WHERE mb.valid_to IS NULL
  ORDER BY mb.mortgage_id, mb.valid_from DESC
)
SELECT
  o.property,
  p.property_value_pence,
  o.outstanding_pence,
  p.property_value_pence - o.outstanding_pence AS equity_pence
FROM outstanding o
JOIN prop_price p ON p.property_name = o.property
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
