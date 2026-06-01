# Project Standards

## What this is
A local-first, AI-native personal finance app for a single user (UK tax context). Three capabilities:

1. **Net worth** — accounts, assets, mortgages, pensions; trend over time and projections.
2. **Cashflow and budgeting** — aware of PAYE, NI, pension contributions, ISA allowances.
3. **Insight and recommendations** — Claude as reasoning and Q&A surface, grounded in actual data.

**Architecture**: The app IS a local stdio MCP server. Claude Desktop is the harness (chat, tool orchestration, UI rendering). No separate frontend, no web server, no public exposure. Interactive screens (`ui://review`, `ui://net_worth`, `ui://cashflow`) ship as MCP Apps UI resources, rendered in sandboxed iframes inside Claude Desktop.

**Data**: All ingested data lands in a canonical SQLite store on disk. Ingestion is file uploads (PDFs, screenshots), manual entry, and API connectors later. Every ingested row is auditable back to a source document.

Prioritize correctness and clarity over cleverness. This handles real financial data — mistakes matter.

## Rules
- No comments anywhere — in code, config, or responses.
- No emojis anywhere — in code, config, or responses.

## Workflow
This project uses four skills:

| Skill | Purpose | Input | Output |
|-------|---------|-------|--------|
| `/refine` | Clean it up | Working code | Simpler code |
| `/test` | Verify behavior | Feature | Passing tests |
| `/research` | Verify assumptions | Claim or decision | Evidence-based verdict |
| `/explore` | Survey a space | Unfamiliar territory | Landscape map + direction |

## Code standards

### General
- Correct > simple > fast. In that order.
- No speculative abstractions. Three similar things is fine; extract only when the pattern is proven.
- No feature flags, backwards-compat shims, or dead code.
- No comments. See Rules.

### Functions and naming
- Functions do one thing. If the name needs "and", split it.
- Names should be unambiguous without context. Avoid abbreviations.
- Booleans: `is_`, `has_`, `can_` prefixes.

### Error handling
- Validate at system boundaries (user input, file I/O, external APIs). Not internally.
- Fail loudly and early. Silent failures are worse than crashes.
- Error messages should state what went wrong and what the user can do about it.

### Data and finance-specific
- Never store amounts as floats. Use integers (cents) or a decimal type.
- Be explicit about currency. Don't assume.
- Dates and times: always explicit about timezone. UTC for storage.

### Design
The `ui://pfa/*` surfaces follow one design language — "Instrument" — captured in [docs/design-language.md](docs/design-language.md). Build new UI from the shared system, not bespoke styles.
- The token system (`server/src/styles/`) is the single source: oklch colors, type scale, spacing, radii, motion. No hardcoded hex, no inline style objects for anything a token or class covers.
- Compose from the shared primitives in `server/src/components.tsx` before inventing a new one.
- Figures are mono and tabular (`var(--font-mono)`, `tabular-nums`); pence in, formatted at the edge via `server/src/format.ts`. Never render a float, never let a number wrap or jitter.
- One clay accent per view. Money in/out uses the desaturated moss/rust tokens — no traffic-light color, no emoji.
- Light and dark are equals (dark default, follows the host theme). Respect the narrow iframe frame and `prefers-reduced-motion`.

## Testing
- Tests verify behavior, not implementation.
- A test that requires more setup than the code under test is a design smell.
- Deterministic always. No `sleep()`, no time-sensitive assertions without mocking.

## Validation
- Before reporting work complete or opening a PR, run `npm run verify` in `server/`. This is the single source of truth for the gate set — `typecheck`, `lint`, `format:check` (Prettier), `test` in order — and [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the same `npm run verify`, so local and CI verdicts cannot diverge.
- CI fails the PR if any gate fails — formatting included. Do not validate by running `tsc`/`eslint`/`vitest` individually; the Prettier `format:check` is the one easy to miss. Fix formatting with `npm run format`.

## What not to do
- Don't add features mid-work. Finish what's in scope first.
- Don't refactor while fixing a bug. Fix first, refine after.
- Don't design for hypothetical future requirements.
- Don't use AI-generated code you don't understand. If it's unclear, ask.

## Current state
Working end-to-end on a thin slice. What exists today:

- Local stdio MCP server in `server/` registering tools and `ui://` resources for Claude Desktop.
- SQLite write store via `better-sqlite3` and DuckDB read layer via the SQLite extension, sharing one `.sqlite` file on disk.
- Schema in [server/db.ts](server/db.ts): `documents`, `accounts` (with `provider`/`external_id`), `assets` (with `price_source`), `mortgages`, `transactions` (with `external_id`/`is_internal`), `income_events` (with `payload`), `account_balances`, `pension_values`, `mortgage_balance`, `holdings`, `asset_prices`, `person_profile`, `tax_periods`, `equity_grant` (with `asset_id`), `equity_vesting_event`, `goals`, `connector_state` (non-financial; OAuth tokens + sync cursors, excluded from the text-to-SQL catalog), `tax_constants` (UK tax/legal constants — dated, status-tagged reference data, injected via the `server/tax_constants.ts` accessor, excluded from the text-to-SQL catalog).
- Ingest tools:
  - `ingest_document` — base64 file in → Haiku 4.5 vision → staging buffer. Payslip only.
  - `confirm_staged_rows` — writes a staged payslip to `income_events` with `source_id` enforced.
  - `record_account_balance`, `record_pension_value`, `record_mortgage_balance`, `record_asset_holding`, `record_asset_price`, `refresh_asset_price`, `record_equity_grant`, `record_vesting_event` — manual-entry tools, one per series. Asset entry is a holding + price pair. `refresh_asset_price` dispatches on `assets.price_source` (skeleton for future connectors).
  - `query_natural_language` — Haiku text-to-SQL against [docs/schema_catalog.md](docs/schema_catalog.md), executed by DuckDB.
- Monzo connector (high-trust ingestion, manual sync): `open_connectors` opens `ui://pfa/connectors.html`; `connect_monzo` (`app`-visibility only, never model-visible) stores credentials entered in the widget and runs a full-history backfill; `sync_monzo` pulls incrementally. Local `npm run monzo:auth` loopback helper mints OAuth tokens for the user to paste into the widget. Each Monzo account and pot becomes an `accounts` row keyed by `(provider, external_id)`; pots map to `savings`/`isa`. Transactions dedupe on `external_id`; internal transfers tagged `is_internal` at ingest. Reconciliation is deterministic ([server/connectors/](server/connectors/)). Monzo investments/pensions are not exposed by the API and stay on manual entry.
- Edit (Flow 2): `correct_record` and `retract_record` tools (both `destructiveHint`), backed by the deterministic primitive in [server/corrections.ts](server/corrections.ts). A *correction* (the row was recorded wrong) inserts a superseding row at the original effective date and marks the wrong row `superseded_by`; a *retraction* (no version of the fact applies) sets `superseded_by` to the row's own id — a logical tombstone retained for audit, never a hard delete. A *new version* (the value changed) stays an ordinary `record_*` insert, not an edit. Migration `0009_superseded_by` adds the nullable marker to every editable event/snapshot table; the LOCF helpers in `server/snapshots.ts` and every aggregate filter `superseded_by IS NULL`, and the text-to-SQL catalog instruction enforces it on the NL path. Connector-sourced rows are refused; equity grants are retract-and-recreate (cascading to dependent vesting events).
- Net worth: `get_net_worth` tool plus `ui://pfa/net_worth.html` dashboard.
- Cashflow: `get_cashflow` tool plus `ui://pfa/cashflow.html` dashboard. Income amounts come from `transactions` (bank feed) counted once; payslips are the tax decomposition (gross/PAYE/NI/pension), not an additive income line. The salary card renders a gross-to-net waterfall (denominator A: earnings) that meets the bank feed (denominator B: cash) at net pay; post-tax deductions show as a waterfall leg, never as bank spending; employer pension is total-reward context. Payslip capture includes `tax_code` and per-`line_item` `section` (payment/deduction).
- Goals (thin slice, Flow 8 + seed of Flow 6): `propose_goal` (Haiku classifies free text onto a goal type, returns the needs spec, no write), `confirm_goal` (deterministic write of the goal with its verbatim utterance and an audit document), `get_briefing` (pushes the full set of grounded directives across active goals — progress, deadlines, data gaps). Implemented goal types: `emergency_fund`, `isa_max`. Authored decomposition and the goal catalog live in `server/goals/`; metric computations in `server/metrics/`. The ISA annual allowance resolves from the `tax_constants` reference table via `server/tax_constants.ts`, and the briefing injects the full `tax_constants` bundle plus a cash-ISA-2027 deadline directive for `isa_max` goals.
- Dev utilities: `reset_schema` and `seed_data` tools.
- UI resources: `ui://pfa/upload.html`, `ui://pfa/net_worth.html`, `ui://pfa/cashflow.html`, `ui://pfa/connectors.html`. All four ship the "Instrument" design system (token-backed CSS, shared React primitives, self-hosted fonts, light/dark) per [docs/design-language.md](docs/design-language.md); presentation lives in `server/src/styles/` and `server/src/components.tsx`, separate from the data wiring.

The end-state target lives in [docs/end-state-flows.md](docs/end-state-flows.md); the architecture in [docs/architecture.md](docs/architecture.md).

## Deferred
Open banking aggregators (multi-institution; the direct Monzo connector is built), connector scheduling (launchd/cron — sync is manual for now), recommendations (observations only for now), multi-currency, mobile, prescriptive financial advice.

## Decision log
Significant architectural decisions live here as they're made.

### 2026-05-26: Architecture — Claude Desktop + local stdio MCP server + MCP Apps
The app is the MCP server. Claude Desktop is the harness. No FastAPI, no web server, no OAuth, no public exposure. Interactive UI ships as `ui://` resources from the MCP server, rendered by the MCP Apps extension in Claude Desktop's sandboxed iframes. Data stays on disk.

### 2026-05-26: Ingestion — human review is non-negotiable
Automated parsing (Haiku 4.5 vision) always goes through staged confirmation (`ui://review`) before writing to the canonical store. No silent writes.

### 2026-05-26: Recommendations — observations only
Start with facts ("ISA 60% funded, 47 days left"). No buy/sell/overpay advice until trust is established through demonstrated accuracy.

### 2026-05-28: Asset pricing — split inventory from valuation; event-locked prices kept on event rows
`holdings` (quantity snapshot) + `asset_prices` (per-unit price tick, source-tagged) replace `asset_values`. Property value moves from `mortgage_balance.property_value_pence` to `asset_prices` against a `property` asset. Equity grant current price moves from payload JSON to `asset_prices` via `equity_grant.asset_id`. Strike and market-at-vest remain on their event rows as immutable tax facts. `assets.price_source` is a strategy hint for future connectors — no connectors built yet.

### 2026-05-29: Goals — goals-first, deterministic decomposition, push briefing
A financial adviser starts from goals, so goal capture is a first-class flow elicited before or alongside data. The dividing line is grounded observation vs. synthesised advice, not model capability: the app owns truth, the goal catalog, decomposition, metric definitions, and the directive engine; the harness (Sonnet and above) owns framing and tradeoffs; Haiku only classifies free text onto a goal type. A fuzzy goal becomes structured via classify (Haiku) then needs spec then interview (harness) then deterministic decomposition (app) into sub-goals bound to metrics. Decomposition is authored and frozen, never model-generated — an undecomposable goal means a new goal type must be authored, not a model invoked. Metrics bind to definitions that may resolve to null; a null fires a data-gap directive that becomes the next capture prompt. The briefing pushes the complete observation set rather than the harness pulling a subset. The verbatim utterance is stored as provenance and framing context, never a data source. The advice gate is unchanged — a directive firing is an observation; ranking options is advice. Design captured in the Goal framework section of [docs/architecture.md](docs/architecture.md), the flows in [docs/end-state-flows.md](docs/end-state-flows.md), and the authored corpus in [docs/goal-catalog.md](docs/goal-catalog.md). No schema or code yet.

### 2026-05-29: Tax rules — app-owned `tax_constants`, injected, never recalled
UK tax and legal constants (allowances, rates, bands, pension access age) are app-owned reference data, the sibling of `tax_periods`: dated (`valid_from`/`valid_to`), status-tagged (`enacted` vs `announced`), provenanced. They are injected into the advice and briefing payload for the tax year in scope, the same way `schema_catalog.md` is injected into text-to-SQL calls. The harness applies and frames the rules but never sources a tax figure from its own training, which is stale and unprovenanced. A future-effective row is an announced change — no separate announcement concept. Deadline directives fire from pending constants and carry their certainty ("proposed, subject to legislation"); the "act now" conclusion stays advice, behind the gate. Updates are human-curated on the fiscal cadence including announced-but-pending changes — legislation is never auto-parsed into the canonical table, mirroring the mandatory-review ingestion rule. Market direction and timing ("markets are down, buy now") is a judgment about live state, not reference data, and is out of scope. Captured in the Domain rule data section of [docs/architecture.md](docs/architecture.md). No schema or code yet.

### 2026-05-29: Monzo connector — pulled forward, manual sync, deterministic reconciliation
Connectors were deferred, but a continuous real-transaction source is what net worth, cashflow, and the goal metrics needed to be tested on true data, so the Monzo connector was built. Scoped to what the Monzo developer API exposes — current + joint accounts, pots, balances, transactions — not investments or pensions (no API; manual entry). v1 is a manually-invoked `sync_monzo`, not a launchd/cron daemon, preserving the single-writer invariant and turning Monzo's 90-day re-auth into a visible re-connect rather than a silent stall. Each account and pot is an `accounts` row keyed by `(provider, external_id)`; pots map to `savings`/`isa` so they flow into net worth and `liquid_savings` unchanged; the pot-excluding account balance plus separate pot series avoids double-counting. Transactions dedupe on `external_id` (INSERT OR IGNORE); deleted pots get a zero-balance tombstone, never a delete. Reconciliation is deterministic code — no model in the sync path. Credentials enter only via the `ui://connectors` widget calling an `app`-visibility-only `connect_monzo` (never through chat); a local `npm run monzo:auth` loopback helper mints OAuth tokens (prints only, never writes the DB) for pasting into the widget, keeping widget→tool→server the sole ingestion boundary so the design survives a future remote-hosted server. Captured in [docs/architecture.md](docs/architecture.md) and `server/connectors/`.

### 2026-05-29: Internal transfers tagged at ingest, excluded from spend
A movement between the user's own accounts or pots (pot funding, current→ISA, current→joint) is neither consumption nor income. The connector tags it `is_internal = 1` deterministically at ingest. The three spend aggregations (average monthly outgoings, cashflow by category, monthly trend) exclude it; the ISA-allowance metric deliberately does not, since a current→ISA transfer is a genuine contribution. The classifier is isolated for refinement against live data.

### 2026-05-29: Cashflow income — bank feed is the amount truth, payslip is the tax decomposition
Once the bank feed exists, money in/out comes from `transactions` (salary credit, rent, other income — each a credit counted once). Payslip `income_events` stops being an additive cashflow line and becomes the tax decomposition of the salary credit (gross, PAYE, NI, employee/employer pension) plus the tax-year/allowance logic. Summing payslip net with transaction inflows double-counts salary. Assumes the salary-receiving account is connected (confirmed: salary always lands in Monzo); a payslip with no matching credit is a data-gap directive, not a silent fallback. Salary-vs-other-income labelling (by employer payer) is a deferred enhancement on a now-correct total. Captured in Flow 5 of [docs/end-state-flows.md](docs/end-state-flows.md) and the decision log in [docs/architecture.md](docs/architecture.md).

### 2026-05-30: `tax_constants` built — status and valid_from orthogonal, valid_to inclusive
The `tax_constants` reference table ([server/migrations/0006_tax_constants.ts](server/migrations/0006_tax_constants.ts)) is live, seeded from gov.uk/legislation.gov.uk primary sources, with the accessor in [server/tax_constants.ts](server/tax_constants.ts) (`resolveConstant`, `upcomingChange`, `taxConstantsForDate`). Two refinements to the original design. (1) `status` and `valid_from` are orthogonal: `status` records legislative certainty (`enacted` = Royal Assent, `announced` = Budget/draft), `valid_from`/`valid_to` records when the value is in effect — so a row can be `enacted` yet future-effective (cash-ISA £12k from 2027, NMPA 57 from 2028). The temporal window handles future-effect; `status` independently carries certainty, and a directive appends "(proposed, subject to legislation)" only when `status === 'announced'`. (2) `valid_to` is inclusive (the last day the value applies, e.g. `2023-04-05`), matching `tax_periods` (`ends_on` April 5), NOT the exclusive convention in `server/snapshots.ts`. As-of resolution is `valid_from <= asOf AND (valid_to IS NULL OR valid_to >= asOf)`, latest `valid_from` per key — a deliberate divergence kept in the accessor, not the snapshot LOCF helper. Frozen thresholds are a single open-ended `enacted` row with the freeze policy as prose in `note`/`source` (no successor row, since a freeze postpones an uprating rather than introducing a known future value). Like `connector_state`, the table is injected via the accessor and excluded from the text-to-SQL catalog.

### 2026-05-30: Design language — "Instrument" adopted across the UI resources
The four `ui://pfa/*` screens, previously styled with per-file inline `React.CSSProperties` objects and hardcoded hex, were re-skinned onto one resolved design direction — "Instrument": a warm, scientific instrument (precise, calm, warm) in a token-backed CSS system with full light and dark. The presentation layer was replaced without touching data wiring or the MCP contract: `useApp`/`callServerTool`, result parsing, and the upload/connectors flow state machines are unchanged. The system is a set of oklch tokens and component classes in `server/src/styles/` plus typed React primitives in `server/src/components.tsx` (Icon, Btn, Stat, Badge, Meter, Sparkline, MiniBars, CompositionBar), with money formatting consolidated into `server/src/format.ts` (was duplicated three times). Fonts (Newsreader, Hanken Grotesk, IBM Plex Mono) are self-hosted woff2 base64-inlined by `vite-plugin-singlefile` — no CDN, preserving local-first with zero render-time network. Dark is the default and follows the host `prefers-color-scheme`. Two figures are intentionally not invented from absent data: the net-worth ISA-allowance meter (no ISA fields in `NetWorthResult` yet) is omitted rather than fabricated, and the connectors connected-state renders the tools' existing prose result rather than synthetic stat tiles (a structured `connect_monzo`/`sync_monzo` return is the deferred follow-up). Principles and the implementation map live in [docs/design-language.md](docs/design-language.md).

### 2026-05-31: Payslips — two-denominator model, gross-to-net waterfall in cashflow
Every pound is shown once per denominator, each view explicit about which it uses. Denominator A is gross earnings (the payslip's domain): the waterfall Gross − pre-tax − PAYE − NI − post-tax = Net. Denominator B is cash in the account (the bank feed): net credit + other credits − spending − savings. They meet only at net pay = salary credit. Post-tax outgoings are outflows of earnings, shown as a waterfall leg in A, never as bank spending categories in B (they are deducted before the money lands and never become a spendable credit). Pension is deferred-not-spent, visually distinct from tax (gone); employer pension is total-reward context, never added to income totals. Surface is split by question: the current-period waterfall lives in cashflow; longitudinal trends (gross over time, tax-code timeline, YTD PAYE/NI) are deferred to a standalone earnings surface. Two capture gaps are closed to unblock this — `tax_code` is promoted to the `income_events` spine ([server/migrations/0007_payslip_tax_code.ts](server/migrations/0007_payslip_tax_code.ts)), and each payslip `line_item` gains a `section` (payment vs deduction) to resolve salary-sacrifice ordering deterministically; no fuzzy category enum yet, and `line_items` stay in `payload` (no migration for them). An unexplained gross-to-net gap surfaces as a labelled "other deductions" leg, never hidden. Net-pay ⇄ salary-credit reconciliation as a data-gap directive remains asserted-not-built and is a follow-on. Captured in Flow 5 of [docs/end-state-flows.md](docs/end-state-flows.md) and the decision log in [docs/architecture.md](docs/architecture.md).

### 2026-06-01: Edit/correction/removal built — `superseded_by` marker, unified tool pair, logical removal
Flow 2 is built. The feature defends one distinction: a *new version* of a fact (the value changed in the real world) is an ordinary `record_*` insert with a later effective date, old row untouched; a *correction* (the row was recorded wrong, a correct version exists) inserts a superseding row at the original effective date and marks the wrong row `superseded_by`; a *removal* (no version of the fact applies) sets `superseded_by` to the row's own id with no successor. The model's test is "did the value change, or was it recorded wrong?". Decisions: removal is logical-only (tombstone retained on disk for audit, never a hard delete); supersession is a nullable `superseded_by` marker (migration [server/migrations/0009_superseded_by.ts](server/migrations/0009_superseded_by.ts) on all ten editable event/snapshot tables), which narrows the event-immutability invariant to "financial columns immutable; the marker is the one permitted mutation"; a unified tool pair `correct_record`/`retract_record` (not per-series), each a thin wrapper over the deterministic primitive in [server/corrections.ts](server/corrections.ts) — never LLM-generated mutation SQL; equity grants are retract-and-recreate, retracting a grant cascading to its dependent vesting events. Guards: connector-sourced rows (`documents.source_type = 'connector'`) are refused, as is editing an already-superseded row. Every aggregate and the LOCF helpers in `server/snapshots.ts` filter `superseded_by IS NULL`; the text-to-SQL catalog carries a global instruction to do the same on the NL path (best-effort, like the advice gate). The model locates the target via `query_natural_language` and confirms the exact row with the user before calling — ambiguity asks, never guesses. Captured in Flow 2 of [docs/end-state-flows.md](docs/end-state-flows.md) and the decision log in [docs/architecture.md](docs/architecture.md).

### 2026-06-01: Ticker as asset identity, automated price freshness, SAYE savings floor
Assets fragmented because `ensureAsset` deduped on `(name, asset_type)` — the same Experian holding captured as "Experian" / "Experian plc" / "EXPN" across sessions became separate assets, each with its own price series, so a SAYE and an RSU over the same share carried different prices. Fix: ticker is the asset's identity. `ensureAsset` ([server/references.ts](server/references.ts)) now dedupes on a normalized ticker (uppercased, `.L`/`.LON`/`.UK` stripped) when supplied, falling back to name+type only for tickerless types (property, other); it also sets `price_source` by asset type on creation (`crypto`→`coingecko`, `stock`/`etf`→`yahoo`, else `manual`). Ticker is mandated for stock/ETF/crypto across `record_asset_holding`/`record_asset_price`/`record_equity_grant` (validated at the boundary, fail-loud). Pre-existing duplicate assets are reconciled by a one-off direct edit of the on-disk SQLite store — a single-user local DB does not warrant a shipped reconciliation tool.

Who supplies the ticker: the harness maps the company to a ticker from its own knowledge (a documented, bounded exception to the "never source a fact from training" rule), instructed via tool-parameter text to ask the user before calling when it cannot map confidently or more than one listing is plausible. The bound is a visible cross-check, not a resolve tool: every fetch returns the source instrument name, surfaced by `sync_prices`/`refresh_asset_price` (`EXPN → "Experian plc"`), so a wrong listing shows rather than silently mark-to-markets the wrong security.

Price freshness: deterministic connectors in [server/connectors/prices/](server/connectors/prices/) — Yahoo (unofficial chart endpoint, keyless, LSE `${TICKER}.L`, GBp/GBP/FX→GBP-pence) for shares/ETFs, CoinGecko (keyless `/simple/price`, GBP-native) for crypto, both pluggable on `fetchImpl`. `refresh_asset_price` dispatches on `price_source`; `sync_prices` appends a timestamped tick per non-manual asset and reports per-asset success/staleness/failure. Manual-invoke, hourly at most — no daemon, mirroring the Monzo connector. Yahoo is unofficial and ToS-grey: isolated behind the fetch layer so swapping to a keyed source (Finnhub/Twelve Data) is one file. `GBp` (pence) vs `GBP` (pounds) differ only by case — checked before uppercasing so pence quotes are not ×100'd.

SAYE: an underwater SAYE is not worthless — the saver gets the full pot of contributions back, so it was being undervalued by the entire savings amount (and shown as £0 underwater). `equity_grant` gains `monthly_contribution_pence` (migration [server/migrations/0010_saye_monthly_contribution.ts](server/migrations/0010_saye_monthly_contribution.ts), required for SAYE capture); `projectedValuePence` ([server/net_worth/lines/contingent.ts](server/net_worth/lines/contingent.ts)) is now scheme-aware: SAYE = `savings_pot + units × max(price − strike, 0)` where `savings_pot = monthly × months(grant, vest)`; RSU and other options unchanged (no cash returned underwater). The unvested view's "valued at today's price" was a lie — the figure is the latest captured price (LOCF), often weeks stale — corrected to "latest captured price", with a `savings floor` badge on underwater SAYE and a local `TickerChip` monogram (real logos deferred; the host iframe renders offline).
