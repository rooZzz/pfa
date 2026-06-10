# Project Standards

## What this is
A local-first, AI-native personal finance app for a single user (UK tax context). Three capabilities:

1. **Net worth** — accounts, assets, mortgages, pensions; trend over time and projections.
2. **Cashflow and budgeting** — aware of PAYE, NI, pension contributions, ISA allowances.
3. **Insight and recommendations** — Claude as reasoning and Q&A surface, grounded in actual data.

**Architecture**: The app IS an MCP server over Streamable HTTP. Claude Desktop (or any MCP client) is the harness: chat, tool orchestration, UI rendering. It runs as an always-on service on a Mac mini, internet-reachable via an ngrok reserved domain and gated by passwordless passkey auth (OAuth 2.1 + WebAuthn, single-user) on port 4001; an open localhost listener on 4000 serves a co-located Desktop, which bridges via `mcp-remote`. Interactive screens (`ui://pfa/upload.html`, `ui://pfa/net_worth.html`, `ui://pfa/cashflow.html`, `ui://pfa/connectors.html`) ship as MCP Apps UI resources, rendered in sandboxed iframes.

**Data**: All ingested data lands in a canonical SQLite store on disk; sensitive tables (connector tokens, passkeys, OAuth state) live in a separate `0600` `secrets.sqlite` the text-to-SQL path cannot reach. Ingestion is file uploads (PDFs, screenshots), manual entry, and connectors. Every ingested row is auditable back to a source document.

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

### Schema change and rollout
The server is deployed to a live environment with real data on disk. The dev-only conveniences
of patching the database directly and making backwards-breaking changes are gone.
- Schema changes ship as forward-only, additive migrations (`server/migrations/`) that run on
  startup. Never edit an applied migration, never hand-edit the on-disk store, never a breaking
  change to existing data.
- Data is corrected through the `superseded_by`/tombstone path, never an in-place UPDATE/DELETE.

### Design
The `ui://pfa/*` surfaces follow one design language — "Instrument" — captured in [docs/design-language.md](docs/design-language.md). Build new UI from the shared system, not bespoke styles.
- The token system (`server/ui/styles/`) is the single source: oklch colors, type scale, spacing, radii, motion. No hardcoded hex, no inline style objects for anything a token or class covers.
- Compose from the shared primitives in `server/ui/components.tsx` before inventing a new one.
- Figures are mono and tabular (`var(--font-mono)`, `tabular-nums`); pence in, formatted at the edge via `server/ui/format.ts`. Never render a float, never let a number wrap or jitter.
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

## Capabilities
What exists today, grouped by domain. Detail lives in [docs/architecture.md](docs/architecture.md); the rationale for each in [docs/decision-log.md](docs/decision-log.md).

- Store: SQLite write path (Kysely over `better-sqlite3`, schema in `server/core/schema.ts`, migrations in `server/migrations/`) + DuckDB read layer sharing one file; `superseded_by` tombstones on every editable table; LOCF helpers in `server/core/snapshots.ts`.
- Ingest: `ingest_document` (payslip via Haiku vision, staged) + `confirm_staged_rows`; manual entry fanned per series — `record_account_balance`, `record_pension_value`, `record_mortgage`, `record_mortgage_balance`, `record_asset_holding`, `record_asset_price`, `record_equity_grant`, `record_vesting_event`, `record_transaction`, `record_person_profile`.
- Edit: `correct_record` / `retract_record` over the deterministic primitive in `server/core/corrections.ts`; connector-sourced rows refused.
- Connectors (manual sync, deterministic reconciliation): Monzo (`connect_monzo`, `sync_monzo`), Ethereum wallet (`discover_ethereum_wallet`, `connect_ethereum`, `sync_ethereum`), prices (`sync_prices`, `refresh_asset_price` — Yahoo for shares/ETFs, CoinGecko for crypto). Code in `server/connectors/`.
- Read: `get_net_worth`, `get_cashflow`, `query_natural_language` (Haiku text-to-SQL over [docs/schema_catalog.md](docs/schema_catalog.md), executed by an allow-listed DuckDB engine), `refresh_stale_data`.
- Goals: `propose_goal` (Haiku classify), `confirm_goal`, `update_goal`, `archive_goal`, `get_briefing` (full directive set + `earnings`/`tax_position`/`retirement_projection` blocks), `evaluate_scenario` (overlay recompute, empty overlay equals live). Types implemented: `emergency_fund`, `isa_max`, `house_deposit`, `retirement`, `fire`; `debt_payoff` is catalogued but unbuilt. Engines: `server/tax/engine.ts`, projection in `server/metrics/`, catalog in `server/goals/`.
- Tax reference: `tax_constants` table seeded from primary sources, injected via `server/tax/constants.ts`, excluded from text-to-SQL.
- UI: the four `ui://pfa/*` screens on the Instrument system ([docs/design-language.md](docs/design-language.md)); presentation in `server/ui/styles/` and `server/ui/components.tsx`.
- Hosting and auth: `server/auth/` (OAuth 2.1 + WebAuthn), Mac mini ops via [docs/mac-mini-runbook.md](docs/mac-mini-runbook.md), release-triggered deploy in `.github/workflows/deploy.yml`, local auth dev via `npm run dev:auth` ([docs/local-auth.md](docs/local-auth.md)).
- Dev utilities: `reset_schema`, `seed_data`, `npm run dev` (watch build + server).

## Deferred
Open banking aggregators (multi-institution; the direct Monzo connector is built), connector scheduling (launchd/cron — sync is manual for now), recommendations (observations only for now), multi-currency, mobile, prescriptive financial advice.

## Decisions and current state
- Every significant decision gets exactly one entry in [docs/decision-log.md](docs/decision-log.md) — the single canonical log. Do not record decisions here or in architecture.md.
- [docs/architecture.md](docs/architecture.md) describes the current system; [docs/end-state-flows.md](docs/end-state-flows.md) the target; [docs/goal-catalog.md](docs/goal-catalog.md) the authored goal corpus.
- This file changes only when a rule changes or the Capabilities inventory gains or loses a line.
