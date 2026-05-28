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
- Schema in [server/db.ts](server/db.ts): `documents`, `accounts`, `assets` (with `price_source`), `mortgages`, `transactions`, `income_events` (with `payload`), `account_balances`, `pension_values`, `mortgage_balance`, `holdings`, `asset_prices`, `person_profile`, `tax_periods`, `equity_grant` (with `asset_id`), `equity_vesting_event`.
- Ingest tools:
  - `ingest_document` — base64 file in → Haiku 4.5 vision → staging buffer. Payslip only.
  - `confirm_staged_rows` — writes a staged payslip to `income_events` with `source_id` enforced.
  - `record_account_balance`, `record_pension_value`, `record_mortgage_balance`, `record_asset_holding`, `record_asset_price`, `refresh_asset_price`, `record_equity_grant`, `record_vesting_event` — manual-entry tools, one per series. Asset entry is a holding + price pair. `refresh_asset_price` dispatches on `assets.price_source` (skeleton for future connectors).
  - `query_natural_language` — Haiku text-to-SQL against [docs/schema_catalog.md](docs/schema_catalog.md), executed by DuckDB.
- Net worth: `get_net_worth` tool plus `ui://pfa/net_worth.html` dashboard.
- Dev utilities: `reset_schema` and `seed_data` tools.
- UI resources: `ui://pfa/mcp-app.html`, `ui://pfa/upload.html`, `ui://pfa/net_worth.html`.

The end-state target lives in [docs/end-state-flows.md](docs/end-state-flows.md); the architecture in [docs/architecture.md](docs/architecture.md).

## Deferred
Open banking connectors, recommendations (observations only for now), multi-currency, mobile, prescriptive financial advice.

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
