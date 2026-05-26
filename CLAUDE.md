# Project Standards

## What this is
A local-first, AI-native personal finance app for a single user (UK tax context). Three capabilities:

1. **Net worth** — accounts, assets, mortgages, pensions; trend over time and projections.
2. **Cashflow and budgeting** — aware of PAYE, NI, pension contributions, ISA allowances.
3. **Insight and recommendations** — Claude as reasoning and Q&A surface, grounded in actual data.

**Architecture**: The app IS a local stdio MCP server. Claude Desktop is the harness (chat, tool orchestration, UI rendering). No separate frontend, no web server, no public exposure. Interactive screens (`ui://review`, `ui://net_worth`, `ui://cashflow`) ship as MCP Apps UI resources, rendered in sandboxed iframes inside Claude Desktop.

**Data**: All ingested data lands in a canonical SQLite store on disk. Ingestion is file uploads (PDFs, screenshots), manual entry, and API connectors later. Every ingested row is auditable back to a source document.

Prioritize correctness and clarity over cleverness. This handles real financial data — mistakes matter.

## Workflow
This project uses four skills that define the standard development loop:

| Skill | Purpose | Input | Output |
|-------|---------|-------|--------|
| `/idea` | Commit to a direction | Vague problem | One clear decision |
| `/refine` | Clean it up | Working code | Simpler code |
| `/test` | Verify behavior | Feature | Passing tests |
| `/research` | Verify assumptions | Claim or direction | Evidence-based verdict |

Use them in order. Don't skip ahead. Don't loop back without finishing the current stage.

## Code standards

### General
- Correct > simple > fast. In that order.
- No speculative abstractions. Three similar things is fine; extract only when the pattern is proven.
- No feature flags, backwards-compat shims, or dead code.
- No comments explaining what code does. Only comment non-obvious WHY.

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
- Don't add features mid-work. Finish what's in scope, then /idea a new one.
- Don't refactor while fixing a bug. Fix first, refine after.
- Don't design for hypothetical future requirements.
- Don't use AI-generated code you don't understand. If it's unclear, ask.

## Current phase
**POC — architecture validation before any real build.** Staged spike (4 stages). Currently: Stage 1.

- Stage 1: Confirm MCP Apps UI resource renders in Claude Desktop (ext-apps map-server example)
- Stage 2: Custom server — one tool, one `ui://` resource, bidirectional comms confirmed
- Stage 3: Persistent data round-trip with `better-sqlite3`
- Stage 4 (only if 1–3 pass): real schema, Haiku 4.5 vision on a UK payslip, `ui://review` confirmation flow

See `.claude/poc-plan.md` for full exit criteria and known risks.

## Deferred until after POC
Open banking connectors, recommendations (observations only for now), multi-currency, mobile, prescriptive financial advice.

## Decision log
Significant architectural decisions live here as they're made.

### 2026-05-26: Architecture — Claude Desktop + local stdio MCP server + MCP Apps
The app is the MCP server. Claude Desktop is the harness. No FastAPI, no web server, no OAuth, no public exposure. Interactive UI ships as `ui://` resources from the MCP server, rendered by the MCP Apps extension in Claude Desktop's sandboxed iframes. Data stays on disk.

### 2026-05-26: Ingestion — human review is non-negotiable
Automated parsing (Haiku 4.5 vision) always goes through staged confirmation (`ui://review`) before writing to the canonical store. No silent writes.

### 2026-05-26: Recommendations — observations only
Start with facts ("ISA 60% funded, 47 days left"). No buy/sell/overpay advice until trust is established through demonstrated accuracy.

<!-- format: ### YYYY-MM-DD: <decision title> -->
