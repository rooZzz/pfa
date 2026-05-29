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

## Testing
- Tests verify behavior, not implementation.
- A test that requires more setup than the code under test is a design smell.
- Deterministic always. No `sleep()`, no time-sensitive assertions without mocking.

## What not to do
- Don't add features mid-work. Finish what's in scope first.
- Don't refactor while fixing a bug. Fix first, refine after.
- Don't design for hypothetical future requirements.
- Don't use AI-generated code you don't understand. If it's unclear, ask.

## Current state
Working end-to-end on a thin slice. What exists today:

- Local stdio MCP server in `server/` registering tools and `ui://` resources for Claude Desktop.
- SQLite write store via `better-sqlite3` and DuckDB read layer via the SQLite extension, sharing one `.sqlite` file on disk.
- Schema in [server/db.ts](server/db.ts): `documents`, `accounts` (with `provider`/`external_id`), `assets` (with `price_source`), `mortgages`, `transactions` (with `external_id`/`is_internal`), `income_events` (with `payload`), `account_balances`, `pension_values`, `mortgage_balance`, `holdings`, `asset_prices`, `person_profile`, `tax_periods`, `equity_grant` (with `asset_id`), `equity_vesting_event`, `goals`, `connector_state` (non-financial; OAuth tokens + sync cursors, excluded from the text-to-SQL catalog).
- Ingest tools:
  - `ingest_document` — base64 file in → Haiku 4.5 vision → staging buffer. Payslip only.
  - `confirm_staged_rows` — writes a staged payslip to `income_events` with `source_id` enforced.
  - `record_account_balance`, `record_pension_value`, `record_mortgage_balance`, `record_asset_holding`, `record_asset_price`, `refresh_asset_price`, `record_equity_grant`, `record_vesting_event` — manual-entry tools, one per series. Asset entry is a holding + price pair. `refresh_asset_price` dispatches on `assets.price_source` (skeleton for future connectors).
  - `query_natural_language` — Haiku text-to-SQL against [docs/schema_catalog.md](docs/schema_catalog.md), executed by DuckDB.
- Monzo connector (high-trust ingestion, manual sync): `open_connectors` opens `ui://pfa/connectors.html`; `connect_monzo` (`app`-visibility only, never model-visible) stores credentials entered in the widget and runs a full-history backfill; `sync_monzo` pulls incrementally. Local `npm run monzo:auth` loopback helper mints OAuth tokens for the user to paste into the widget. Each Monzo account and pot becomes an `accounts` row keyed by `(provider, external_id)`; pots map to `savings`/`isa`. Transactions dedupe on `external_id`; internal transfers tagged `is_internal` at ingest. Reconciliation is deterministic ([server/connectors/](server/connectors/)). Monzo investments/pensions are not exposed by the API and stay on manual entry.
- Net worth: `get_net_worth` tool plus `ui://pfa/net_worth.html` dashboard.
- Cashflow: `get_cashflow` tool plus `ui://pfa/cashflow.html` dashboard. Income amounts come from `transactions` (bank feed) counted once; payslips are the tax decomposition (gross/PAYE/NI/pension), not an additive income line.
- Goals (thin slice, Flow 8 + seed of Flow 6): `propose_goal` (Haiku classifies free text onto a goal type, returns the needs spec, no write), `confirm_goal` (deterministic write of the goal with its verbatim utterance and an audit document), `get_briefing` (pushes the full set of grounded directives across active goals — progress, deadlines, data gaps). Implemented goal types: `emergency_fund`, `isa_max`. Authored decomposition and the goal catalog live in `server/goals/`; metric computations in `server/metrics/`. The ISA annual allowance is a hardcoded stopgap pending the `tax_constants` reference.
- Dev utilities: `reset_schema` and `seed_data` tools.
- UI resources: `ui://pfa/upload.html`, `ui://pfa/net_worth.html`, `ui://pfa/cashflow.html`.

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
