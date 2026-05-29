# Plan: `tax_constants` reference table (UK tax/legal constants)

## Context

The app must never source a tax figure from a model's training — it's stale and unprovenanced (architecture decision 2026-05-29, "Tax rules"). Yet today `server/metrics/index.ts:6` hardcodes `ISA_ANNUAL_ALLOWANCE_PENCE = 2_000_000`, a stopgap flagged in CLAUDE.md. The `tax_constants` table is fully designed (the dated, status-tagged sibling of `tax_periods`) but unbuilt — migrations stop at `0005_connector`.

This slice builds the table, seeds it from primary-source research, exposes a deterministic accessor, injects the constants into the briefing payload, swaps the hardcode, and fires deadline directives from future-effective rows. It is the keystone dependency for cashflow allowance logic (Flow 5), richer briefings (Flow 8), and the eventual advice gate (Flow 7).

This research mattered: live sources corrected three things training-recall would have gotten wrong for tax year 2026/27 (current as of 2026-05-29) — dividend rates **rose** (8.75%/33.75% → 10.75%/35.75%), the income-tax/NI threshold freeze was **extended to April 2031**, and a new **£12,000 cash-ISA sub-limit** arrives 6 Apr 2027. All are in the now-enacted [Finance Act 2026](https://www.legislation.gov.uk/ukpga/2026/11/enacted).

**Scope guard.** This builds the table + accessor + injection + the ISA swap + deadline directives. It does NOT rework cashflow PAYE/NI/allowance-consumption arithmetic or add the `fire`/`house_deposit` goal types — those are the next slices this unblocks.

## Modelling decisions

1. **`status` and `valid_from` are orthogonal.** `status` = legislative certainty (`enacted` = Royal Assent, `announced` = Budget/draft). `valid_from` = when it takes effect. A row can be `enacted` yet future-effective (cash-ISA £12k, NMPA 57). This refines the decision-log line "a future-effective row is an announced change" — the temporal window handles the future-effect; `status` independently records certainty. To record in CLAUDE.md.
2. **`valid_to` is inclusive (the last day the value applies, e.g. `2023-04-05`)** — matching `tax_periods` (`ends_on` April 5), NOT the exclusive convention in `server/snapshots.ts`. As-of resolution: `valid_from <= asOf AND (valid_to IS NULL OR valid_to >= asOf)`, latest `valid_from` per key. This is a deliberate divergence from the snapshot LOCF helper; `tax_constants` is a `tax_periods` sibling, so it shares that convention. A new helper, not `snapshots.ts`.
3. **Frozen thresholds: single `enacted` row, `valid_to = NULL`,** with the freeze policy in `source`/`note` (the freeze postpones a future uprating, it does not introduce a known future value — so there is no successor row to seed). The announced 2028–2031 freeze *extension* is recorded as prose in `note`; a curation pass can split it into an `announced` row later if a "freeze ends" deadline directive is wanted. Keeps the seed consistent and honest.
4. **Not a text-to-SQL target.** Like `connector_state`, `tax_constants` is excluded from the schema catalog coverage test — it is injected via the deterministic accessor, never queried by Haiku text-to-SQL (the temporal/status logic is too easy to get wrong in generated SQL).
5. **Money in pence, rates in basis points, ages in years**, integers only (design rule 2). Single `value INTEGER` column discriminated by `unit`; `currency` non-null only for `pence`.
6. **Human-curated, verified.** Every row below traces to a gov.uk/legislation.gov.uk primary source. The user is the curator (mandatory-review spine) — these values are for review before the write.

## Proposed seed constants (for review)

All `enacted`. `valid_to` inclusive; `null` = open-ended. Money = pence (£ x 100), rates = bps (% x 100), ages = years.

### ISA family
| key | value | unit | ccy | valid_from | valid_to | note |
|---|---|---|---|---|---|---|
| `isa_allowance` | 2000000 | pence | GBP | 2017-04-06 | null | £20,000 overall; unchanged since 2017/18 |
| `cash_isa_allowance` | 1200000 | pence | GBP | 2027-04-06 | null | **future-effective**; £12k cash sub-limit within £20k overall (under-65s); over-65s retain £20k. Drives a deadline directive |
| `lisa_allowance` | 400000 | pence | GBP | 2017-04-06 | null | £4,000, within the £20k overall |
| `lisa_bonus_rate` | 2500 | bps | — | 2017-04-06 | null | 25% government bonus |
| `lisa_withdrawal_charge_rate` | 2500 | bps | — | 2021-04-06 | null | 25% unauthorised-withdrawal charge (reverted after COVID 20%) |

### Pension family
| key | value | unit | ccy | valid_from | valid_to | note |
|---|---|---|---|---|---|---|
| `pension_annual_allowance` | 4000000 | pence | GBP | 2016-04-06 | 2023-04-05 | £40,000 (history) |
| `pension_annual_allowance` | 6000000 | pence | GBP | 2023-04-06 | null | £60,000 (current) |
| `pension_mpaa` | 400000 | pence | GBP | 2017-04-06 | 2023-04-05 | £4,000 (history) |
| `pension_mpaa` | 1000000 | pence | GBP | 2023-04-06 | null | £10,000 (current) |
| `pension_taper_threshold` | 26000000 | pence | GBP | 2023-04-06 | null | adjusted income £260,000 |
| `pension_taper_floor` | 20000000 | pence | GBP | 2023-04-06 | null | threshold income £200,000 |
| `pension_min_tapered_allowance` | 1000000 | pence | GBP | 2023-04-06 | null | £10,000 minimum tapered AA |
| `pension_lump_sum_allowance` | 26827500 | pence | GBP | 2024-04-06 | null | LSA £268,275 (LTA abolished) |
| `pension_access_age` | 55 | years | — | 2010-04-06 | 2028-04-05 | NMPA (current) |
| `pension_access_age` | 57 | years | — | 2028-04-06 | null | NMPA rises to 57 (FA 2022 s.10). **Future-effective deadline directive** |
| `state_pension_age` | 66 | years | — | 2020-10-06 | 2028-03-05 | approximation — SPA is date-of-birth driven; see note |
| `state_pension_age` | 67 | years | — | 2028-03-06 | 2046-04-05 | phased 2026–2028 |
| `state_pension_age` | 68 | years | — | 2046-04-06 | null | phased 2044–2046; subject to statutory review |

### Income tax — rUK (England/NI). Thresholds frozen to 5 Apr 2031 (Autumn 2025 Budget; note in `source`)
| key | value | unit | ccy | valid_from | valid_to | note |
|---|---|---|---|---|---|---|
| `personal_allowance` | 1257000 | pence | GBP | 2026-04-06 | null | £12,570; frozen to 2030/31 |
| `personal_allowance_taper_threshold` | 10000000 | pence | GBP | 2026-04-06 | null | taper begins at £100,000 |
| `personal_allowance_zero_at` | 12514000 | pence | GBP | 2026-04-06 | null | PA nil at £125,140 |
| `basic_rate_limit` | 3770000 | pence | GBP | 2026-04-06 | null | band width £37,700 |
| `higher_rate_threshold` | 5027000 | pence | GBP | 2026-04-06 | null | £50,270 (= PA + BRL) |
| `additional_rate_threshold` | 12514000 | pence | GBP | 2026-04-06 | null | £125,140 |
| `income_tax_basic_rate` | 2000 | bps | — | 2026-04-06 | null | 20% |
| `income_tax_higher_rate` | 4000 | bps | — | 2026-04-06 | null | 40% |
| `income_tax_additional_rate` | 4500 | bps | — | 2026-04-06 | null | 45% |

### National Insurance — Class 1 employee/employer (2026/27)
| key | value | unit | ccy | valid_from | valid_to | note |
|---|---|---|---|---|---|---|
| `ni_primary_threshold` | 1257000 | pence | GBP | 2026-04-06 | null | £12,570 |
| `ni_upper_earnings_limit` | 5027000 | pence | GBP | 2026-04-06 | null | £50,270 |
| `ni_employee_main_rate` | 800 | bps | — | 2026-04-06 | null | 8% (PT→UEL) |
| `ni_employee_upper_rate` | 200 | bps | — | 2026-04-06 | null | 2% (above UEL) |
| `ni_secondary_threshold` | 500000 | pence | GBP | 2026-04-06 | null | £5,000 (employer) |
| `ni_employer_rate` | 1500 | bps | — | 2026-04-06 | null | 15% (employer) |

### CGT & dividends
| key | value | unit | ccy | valid_from | valid_to | note |
|---|---|---|---|---|---|---|
| `cgt_annual_exempt_amount` | 1230000 | pence | GBP | 2022-04-06 | 2023-04-05 | £12,300 (history) |
| `cgt_annual_exempt_amount` | 600000 | pence | GBP | 2023-04-06 | 2024-04-05 | £6,000 (history) |
| `cgt_annual_exempt_amount` | 300000 | pence | GBP | 2024-04-06 | null | £3,000 (current, fixed) |
| `cgt_rate_lower` | 1000 | bps | — | 2016-04-06 | 2024-10-29 | 10% (history) |
| `cgt_rate_lower` | 1800 | bps | — | 2024-10-30 | null | 18% (mid-year change) |
| `cgt_rate_higher` | 2000 | bps | — | 2016-04-06 | 2024-10-29 | 20% (history) |
| `cgt_rate_higher` | 2400 | bps | — | 2024-10-30 | null | 24% |
| `cgt_rate_residential_lower` | 1800 | bps | — | 2024-04-06 | null | 18% (residential property) |
| `cgt_rate_residential_higher` | 2400 | bps | — | 2024-04-06 | null | 24% (residential property) |
| `dividend_allowance` | 100000 | pence | GBP | 2023-04-06 | 2024-04-05 | £1,000 (history) |
| `dividend_allowance` | 50000 | pence | GBP | 2024-04-06 | null | £500 (current) |
| `dividend_rate_ordinary` | 875 | bps | — | 2023-04-06 | 2026-04-05 | 8.75% (history) |
| `dividend_rate_ordinary` | 1075 | bps | — | 2026-04-06 | null | 10.75% (raised, FA 2026) |
| `dividend_rate_upper` | 3375 | bps | — | 2023-04-06 | 2026-04-05 | 33.75% (history) |
| `dividend_rate_upper` | 3575 | bps | — | 2026-04-06 | null | 35.75% (raised, FA 2026) |
| `dividend_rate_additional` | 3935 | bps | — | 2023-04-06 | null | 39.35% (unchanged) |

**Caveats to confirm in review:** (a) `state_pension_age` is modelled as a single age threshold but real SPA is derived from date of birth — keep as a reference default only, or drop if it risks misuse. (b) The income-tax/NI freeze *extension* to 2031 is recorded as prose in `note`/`source`, not as a separate `announced` row (decision 3). (c) Scotland diverges on income-tax rates/bands; the user is rUK, so Scottish rates are out of scope.

## Implementation

### 1. Migration `server/migrations/0006_tax_constants.ts`
Mirror the `UP`/`DOWN` string style of `0001_initial.ts` for the table, and the seeded-`INSERT OR IGNORE` loop of `0003_seed_tax_periods.ts` for the rows. Register in `server/migrations/index.ts` `MIGRATIONS` array.

```sql
CREATE TABLE tax_constants (
  id          INTEGER PRIMARY KEY,
  key         TEXT NOT NULL,
  value       INTEGER NOT NULL,
  unit        TEXT NOT NULL CHECK (unit IN ('pence', 'years', 'bps')),
  currency    TEXT,
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  status      TEXT NOT NULL CHECK (status IN ('enacted', 'announced')),
  source      TEXT NOT NULL,
  note        TEXT,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tax_constants_key ON tax_constants(key, valid_from);
```
Seed all rows above. `DOWN` drops the index and table.

### 2. `server/schema.ts`
Add `TaxConstantsTable` interface (matching the DDL; `id`/`recorded_at` are `Generated`) and register `tax_constants` in `DatabaseSchema`.

### 3. `server/tax_constants.ts` (new accessor — sibling of `server/cashflow/index.ts` `resolvePeriod`)
- `resolveConstant(key, asOf)` → `{ key, value, unit, currency, status, source, valid_from } | null`. Uses the inclusive-end LOCF predicate (decision 2) via `runQuery` against `pfa.tax_constants`. Returns `null` when no row covers `asOf` (caller treats as a data gap).
- `upcomingChange(key, asOf)` → the next row for `key` with `valid_from > asOf` (nearest), or `null`. Powers deadline directives.
- `taxConstantsForDate(asOf)` → `Record<key, ResolvedConstant>` bundle for injection into the briefing payload.
- Export a small typed `TAX_CONSTANT_KEYS` union for safety.

### 4. Swap the hardcode — `server/metrics/index.ts`
Remove `ISA_ANNUAL_ALLOWANCE_PENCE`. In `isaAllowanceRemaining(asOf, taxYear)`, `await resolveConstant('isa_allowance', asOf)`; if it resolves use its `value`, else return an unresolved `MetricValue` with `gap_reason` "ISA allowance constant not found for {asOf}". Keep `detail.allowance_pence` populated from the resolved value.

### 5. Briefing injection + deadline directives — `server/goals/briefing.ts`
- Add `tax_constants: Record<string, ResolvedConstant>` to the `Briefing` payload via `taxConstantsForDate(asOf)`.
- Emit a `kind: "deadline"` directive for each watched upcoming change tied to an active goal: for `isa_max` goals call `upcomingChange('cash_isa_allowance', asOf)`; (the `fire` goal — future slice — will watch `pension_access_age`). Message carries the effective date and days-away, and appends "(proposed, subject to legislation)" only when the row's `status === 'announced'`. Reuse the existing `daysBetween` helper.

### 6. Catalog handling
- Add `&& name != 'tax_constants'` to the `userTables()` exclusion in `server/tests/schema_catalog.test.ts`.
- Add a one-line note to `docs/schema_catalog.md` (near the `tax_periods` section) stating `tax_constants` exists but is injected via the accessor, not a text-to-SQL target.

### 7. Tests
- `server/tests/migrations.test.ts`: assert `0006` applies and rolls back; assert seeded row count and a spot-check (`isa_allowance` = 2000000).
- New `server/tests/tax_constants.test.ts`: as-of resolution returns the right row across windows (e.g. dividend ordinary rate = 875 bps at 2025-06-01, 1075 bps at 2026-06-01); `valid_to`-inclusive boundary at the exact change date; `status` returned; `upcomingChange('cash_isa_allowance', '2026-05-29')` returns the 2027-04-06 row; `resolveConstant` of an unknown key/old date returns `null`.
- `server/tests/metrics.test.ts`: assert `isaAllowanceRemaining` reads the seeded constant (allowance reflects 2000000, not a literal in code).
- `server/tests/goals.test.ts`: assert an `isa_max` briefing includes the cash-ISA deadline directive with the 2027-04-06 date.

### 8. Docs
- `CLAUDE.md`: flip "The ISA annual allowance is a hardcoded stopgap pending the `tax_constants` reference" to built; add `tax_constants` to the schema list; add a decision-log note recording modelling decisions 1–2 (status/valid_from orthogonality; inclusive `valid_to`).
- `docs/architecture.md`: change the `tax_constants` decision-log entry from "No schema or code yet" to built, citing `server/migrations/0006_tax_constants.ts` and `server/tax_constants.ts`.

## Verification

1. `cd server && npm run build && npm test` — all suites green, including the new `tax_constants` and migrations tests.
2. Migration round-trip: run `resetDb()` (test-only) / `initDb()`, then query `SELECT count(*) FROM tax_constants` and spot-check `resolveConstant('dividend_rate_ordinary', '2026-05-29')` returns 1075 bps and `resolveConstant(..., '2025-06-01')` returns 875 bps.
3. Hardcode gone: `grep -rn "ISA_ANNUAL_ALLOWANCE_PENCE\|2_000_000" server --include=*.ts` (excluding `dist`/`node_modules`) returns nothing.
4. End-to-end in Claude Desktop: with an active `isa_max` goal, `get_briefing` returns ISA progress plus the cash-ISA-2027 deadline directive, and the payload carries the injected `tax_constants` bundle.

## Sources (primary)
- [Finance Act 2026 (enacted) — legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2026/11/enacted)
- [Change to tax rates for property, savings and dividend income — technical note (gov.uk)](https://www.gov.uk/government/publications/changes-to-tax-rates-for-property-savings-and-dividend-income/change-to-tax-rates-for-property-savings-and-dividend-income-technical-note) — cash-ISA £12k from 2027; dividend rate rise from 2026/27
- [Income Tax PA/BRL and NIC thresholds 6 Apr 2026 → 5 Apr 2028 (gov.uk)](https://www.gov.uk/government/publications/the-personal-allowance-and-basic-rate-limit-for-income-tax-and-certain-national-insurance-contributions-nics-thresholds-from-6-april-2026-to-5-apr/income-tax-personal-allowance-and-the-basic-rate-limit-and-certain-national-insurance-contributions-thresholds-from-6-april-2026-to-5-april-2028)
- [Income Tax rates and Personal Allowances (gov.uk)](https://www.gov.uk/income-tax-rates) · [Rates and thresholds for employers 2026 to 2027 (gov.uk)](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027)
- [Pension schemes rates and allowances (gov.uk)](https://www.gov.uk/government/publications/rates-and-allowances-pension-schemes/pension-schemes-rates) · [Lump sum allowance (gov.uk)](https://www.gov.uk/tax-on-your-private-pension/lump-sum-allowance) · [Finance Act 2022 s.10 — NMPA 57 (legislation.gov.uk)](https://www.legislation.gov.uk/ukpga/2022/3/section/10/enacted) · [State Pension age timetable (gov.uk)](https://www.gov.uk/government/publications/state-pension-age-timetable/state-pension-age-timetable)
- [Capital Gains Tax rates and allowances (gov.uk)](https://www.gov.uk/guidance/capital-gains-tax-rates-and-allowances) · [HMRC CG10245 — CGT rates from 30 Oct 2024](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg10245) · [Income Tax rates and allowances: current and previous (gov.uk)](https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past)
- [ISAs: Overview (gov.uk)](https://www.gov.uk/individual-savings-accounts) · [Lifetime ISA (gov.uk)](https://www.gov.uk/lifetime-isa)
