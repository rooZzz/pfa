# Architecture — Personal Finance App

**Status:** Design-complete, pre-implementation. Governs Stage 3 POC and all subsequent stages.

---

## What this is

A local-first, AI-native personal finance app for a single user (UK tax context). Three capabilities:

1. **Net worth** — accounts, assets, mortgages, pensions; point-in-time and trended.
2. **Cashflow and budgeting** — PAYE, NI, pension contributions, ISA allowances.
3. **Insight and Q&A** — natural language queries answered from real data.

**The app is a local MCP server over Streamable HTTP, bound to localhost.** It is built as though it could be served remotely but only runs on `127.0.0.1`. Claude Desktop is the harness: it provides chat, tool orchestration, and renders interactive UI resources (`ui://`) in sandboxed iframes via the MCP Apps extension. Desktop connects through the `mcp-remote` stdio-to-HTTP bridge (it does not reliably accept a raw `url` entry). No public exposure (localhost-only bind). All data stays on disk.

---

## Interaction model

**Claude Desktop is the exclusive user interface.** The user never interacts with the MCP server directly, never edits a config file to add a connector, and never runs a CLI tool. Every interaction — uploading a document, adding an API key, entering a value manually, asking a question — flows through Claude Desktop.

Three modes:

**Conversation (chat)** — The default mode. The user types in Claude Desktop's chat interface. Claude invokes tools directly from the conversation: "My pension pot is £42,000 as of today's statement" calls `ingest_manual_entry`. "What's my net worth?" calls `query_natural_language`. No form required.

**UI resources** — For interactions that benefit from dedicated UI. Rendered as sandboxed iframes via MCP Apps:

| Resource | Purpose |
|---|---|
| `ui://upload` | Drag and drop documents (PDFs, screenshots). Displays ingestion queue and parse progress. |
| `ui://connectors` | Add, configure, and disable API connectors. Handles OAuth flows and API key entry. |
| `ui://review` | Confirm or reject rows staged from document parsing before they write to the store. |
| `ui://net_worth` | Net worth dashboard — trended, point-in-time. |
| `ui://cashflow` | Cashflow and budget dashboard. |

Presentation across these surfaces follows a single design language — "Instrument": a warm, scientific readout in a token-backed CSS system with self-hosted fonts and shared React primitives, full light and dark. See [docs/design-language.md](design-language.md); the system lives in `server/src/styles/` and `server/src/components.tsx`.

**Background processes** — Connector runners (Monzo, Ethereum wallet) run as launchd daemons independent of Claude Desktop. Their *setup* — credentials, schedule, enable/disable — happens through `ui://connectors`. Once configured they run autonomously, writing to SQLite directly. The user never touches them again unless reconfiguring.

---

## Tech stack

| Component | Technology | Why |
|---|---|---|
| MCP server | Node.js + `@modelcontextprotocol/sdk` | Matches the ext-apps reference implementation; Streamable HTTP transport on localhost; Desktop bridges in via `mcp-remote` |
| Write store | SQLite via `better-sqlite3` | Local-first, ACID, single file, zero ops. The only sensible choice. |
| Analytical read | DuckDB via `duckdb` npm + SQLite extension | Reads the `.sqlite` file directly — no ETL, no sync. Columnar execution for window functions and complex joins. |
| Document parsing | Haiku 4.5 (vision) | Fast, cheap, accurate enough on payslips and statements at ~£0.005–0.01/page. |
| Natural language queries | Haiku 4.5 (text-to-SQL) | Generates SQL from natural language against schema catalog + DDL. DuckDB executes it. |
| UI resources | MCP Apps (`ui://` resources) | Rendered in Claude Desktop's sandboxed iframe. No separate frontend. |
| Background connectors | Separate OS process (launchd on Mac) | MCP server lifecycle is bound to Claude Desktop. Periodic API syncs must run independently. |

---

## Architecture diagram

```mermaid
flowchart TD
    USER(["User"])

    subgraph CD["Claude Desktop — exclusive interaction surface"]
        CHAT["Chat\nmanual entry · Q&A · conversation"]
        subgraph UI["MCP Apps UI resources"]
            UPLOAD["ui://upload\ndrag and drop documents"]
            CONNECTORS["ui://connectors\nadd / configure API connectors"]
            REVIEW["ui://review\nstaged-row confirmation"]
            NW["ui://net_worth"]
            CF["ui://cashflow"]
        end
    end

    subgraph MCP["MCP Server — Streamable HTTP (localhost)"]
        IT["ingest_document"]
        ME["record_* manual entry tools\nbalance · pension · mortgage · asset · grant · vesting"]
        SC["setup_connector"]
        QT["query_natural_language"]
        CT["confirm_staged_rows"]
        NWT["get_net_worth"]
        STAGE[("staging buffer\nunconfirmed rows")]
        CAT[["schema_catalog.md + DDL\ninjected into every Haiku call"]]
    end

    subgraph BGP["Background process — launchd"]
        CONN["Connector runners\nMonzo · Ethereum · ..."]
    end

    subgraph HAIKU["Haiku 4.5 — Anthropic API"]
        VIS["Vision\ndocument parsing"]
        T2S["Text to SQL\nquery generation"]
    end

    subgraph PERSIST["Persistence — single .sqlite file on disk"]
        subgraph WRITE["SQLite — write store · better-sqlite3 · ACID"]
            DOCS["documents\nsource_type: upload | manual | connector"]
            EV["Events — immutable, append-only\ntransactions · income_events"]
            SN["Snapshots — valid_from · valid_to · recorded_at\naccount_balances · pension_values · mortgage_balance\nholdings · asset_prices · person_profile"]
            RF["Reference\naccounts · assets · mortgages · tax_periods"]
        end
        READ["DuckDB — analytical read layer\nSQLite extension · LOCF · window functions · aggregations"]
    end

    USER --> CD

    UPLOAD -->|"tool call"| IT
    IT -->|parse| VIS
    VIS -->|extracted rows| STAGE
    STAGE -->|renders| REVIEW
    REVIEW -->|user approves| CT
    CT -->|"write · source_id enforced"| DOCS

    CHAT -->|"tool call"| ME
    ME -->|"generates JSON file"| DOCS
    ME -->|"writes snapshot / event"| SN
    ME -->|"writes snapshot / event"| EV

    CHAT -->|"tool call"| NWT
    NWT -.->|"reads via DuckDB"| READ
    NWT -->|net worth data| NW

    CONNECTORS -->|"tool call"| SC
    SC -->|"store credentials"| CONN

    CONN -->|"INSERT OR IGNORE · external_id dedup"| EV
    CONN -->|snapshot| SN
    CONN -->|run record| DOCS

    DOCS -->|source_id| EV
    DOCS -->|source_id| SN

    CHAT -->|"tool call"| QT
    QT --> CAT
    CAT -->|"DDL + catalog + question"| T2S
    T2S -->|SQL| READ
    READ -.->|"reads directly · no ETL"| WRITE
    READ -->|result set| QT
    QT -->|answer| CHAT

    READ -->|net worth data| NW
    READ -->|cashflow data| CF
```

---

## Persistence layer

### Two table patterns

Every table is one of two patterns. Mixing them is a design error.

#### Event tables — immutable, append-only

Things that happened. Financial columns are never updated or deleted. The sole permitted mutation is the `superseded_by` correction marker (see the Edit flow): a wrong or removed row keeps every financial value intact and is excluded from reads, never overwritten.

```sql
occurred_at        TIMESTAMP NOT NULL
recorded_at        TIMESTAMP NOT NULL
source_id          INTEGER NOT NULL REFERENCES documents(id)
external_id        TEXT
```

#### Snapshot tables — temporal observations

Observed values that change over time. Gaps filled at query time via LOCF.

```sql
valid_from         DATE NOT NULL
valid_to           DATE
recorded_at        TIMESTAMP NOT NULL
source_id          INTEGER NOT NULL REFERENCES documents(id)
```

A new observation (the value changed) is a new row with a later `valid_from`; the old row stays valid for its own window. A correction (the row was recorded wrong) inserts a superseding row at the original `valid_from` and sets `superseded_by` on the wrong row. Reads filter `superseded_by IS NULL`, so the superseded row leaves current truth but is preserved — the full history is always recoverable.

#### Flex layer — optional `payload` column

Some tables carry a long tail of attributes that vary per source and resist typing. These get a nullable `payload` JSON column (stored as JSON text, readable by DuckDB) for the unmodelled remainder. The payload is an optional column orthogonal to the event/snapshot/reference patterns — it is not a third pattern. It is added to a table only when that table has a demonstrated long tail, never as a blanket field. Its use is bounded by design rule 7.

### Table taxonomy

| Table | Pattern | What it holds |
|---|---|---|
| `documents` | Reference | Source anchor for every ingested row — file, manual JSON, connector run |
| `transactions` | Event | Every cash movement; linked to account |
| `income_events` | Event | Per-payslip: gross, net, PAYE, NI, pension contribution, employer contribution; variable line items in `payload` |
| `equity_vesting_event` | Event | A vesting tranche — vest date, units, market-at-vest price (event-locked tax fact), estimated value; scheme-specific detail in `payload` |
| `asset_prices` | Event (price tick) | Per-unit price for an asset at a point in time; source-tagged for future connector attribution |
| `account_balances` | Snapshot | Current account, savings balances at observation time |
| `pension_values` | Snapshot | Pot value at statement date |
| `mortgage_balance` | Snapshot | Outstanding balance and current interest rate; no property value (tracked separately via `asset_prices`) |
| `holdings` | Snapshot | Quantity of an asset held — inventory without valuation |
| `person_profile` | Snapshot | Salary, tax code, employer — valid_from/valid_to tracks changes |
| `accounts` | Reference | Account definitions (bank, type, ISA subtype, currency) |
| `assets` | Reference | Asset definitions (name, type, base currency, price_source strategy hint) |
| `mortgages` | Reference | Mortgage definitions (lender, property, original amount) |
| `equity_grant` | Reference | Equity award definition — scheme type, units, strike (event-locked), asset_id link to underlying share, vest schedule; variable terms in `payload` |
| `tax_periods` | Reference | UK tax years — `starts_on` (April 6), `ends_on` (April 5) |

### Three-layer pricing model

Asset pricing separates three concepts that change at different cadences:

| Layer | Table | Cadence | Immutable? |
|---|---|---|---|
| Inventory | `holdings` | Changes on transactions (buy, sell, vest) | No — new row when quantity changes |
| Valuation | `asset_prices` | Changes with the market; source-tagged for future connectors | Append-only — add a new row per tick |
| Event-locked prices | `equity_grant.strike_pence`, `equity_vesting_event.market_price_pence` | Set once at the event; tax fact, never refreshed | Yes |

This means refreshing a price (new `asset_prices` row) never touches holdings or event rows. The `assets.price_source` column is a strategy hint (`manual`, future `coingecko`, `zoopla`) for how to dispatch a price refresh without a schema change.

### Design rules

These are invariants. They hold across all tables, all ingestion types, all stages.

1. **`source_id` is non-negotiable.** Every event and snapshot row carries a FK to `documents`. A row with no source is a schema violation, not a warning. Enforced as a `NOT NULL` constraint, not application logic.

2. **Amounts are integers, currency is explicit.** `amount_pence INTEGER NOT NULL`. Never `REAL`. Every monetary column specifies its unit in the name. Every table with monetary data has `currency TEXT NOT NULL DEFAULT 'GBP'`. Asset prices store `unit_price_pence` in the asset's native currency alongside the `currency` field — FX conversion is a separate concern, not bundled into the price row.

3. **UK tax year is explicit.** The `tax_periods` table is the single source of truth for April 6 → April 5 boundaries. All ISA and PAYE queries anchor to this table. The schema catalog documents this so Haiku never assumes calendar year.

4. **Snapshot staleness is always surfaced.** Every query over snapshot data returns `recorded_at` alongside the value. The UI displays it. "Your pension is £42,000" without a date is a misleading statement.

5. **As-of lookup is a single query contract.** The value for a snapshot at any query date is the most recent observation whose validity range covers it — `valid_from <= as_of AND (valid_to IS NULL OR valid_to > as_of)`, taking the latest `valid_from` per series (`DISTINCT ON (series) ... ORDER BY series, valid_from DESC`). This last-observation-carried-forward (LOCF) semantic lives in one centralised helper (`server/snapshots.ts`), composed by every line query and by the trend points. The application never interpolates or estimates. Unknown = last observed; null = never tracked, distinguished from zero.

6. **`external_id` on event rows.** Required for connector-ingested events. Inserts from connectors use `INSERT OR IGNORE` — deduplication is guaranteed at the database level, not application logic.

7. **The flex layer is bounded.** A nullable `payload` JSON column holds the long tail of attributes that vary per source and resist typing. It is governed strictly:
   - Anything aggregated or trended stays in the typed spine — money, dates, currency, counts are never in `payload`. The payload holds descriptive attributes reasoned over qualitatively, never arithmetic.
   - Provenance never moves into `payload`. `source_id`, `recorded_at`, `valid_from` stay typed.
   - The payload is not a primary text-to-SQL target. The schema catalog documents that a table has a payload and what kind of thing it holds — it does not expose payload keys for querying. Payload surfaces in the UI and Claude's reasoning layer.
   - Promotion path: a payload attribute that becomes a recurring query target graduates to a typed spine column. This keeps the spine honest and the catalog bounded.
   - Payload is parser-structured output (typed primitives extracted first, remainder to payload), not free-form user input.
   - Added per table only on demonstrated need. Initially: `income_events`, `equity_grant`, `equity_vesting_event`. Pure-value tables (`account_balances`, `pension_values`, `mortgage_balance`) stay spine-only.

---

## Goal framework

A financial adviser starts from goals, not balances. Goal capture is therefore a first-class flow, elicited before or alongside data. This section defines how a fuzzy spoken goal becomes a set of deterministic, data-bound observations without a high-capability model inventing the financial logic.

### The dividing line

The separation that matters is grounded observation versus synthesised advice — not low-capability model versus high-capability model. Anything that must be correct and auditable is deterministic and owned by the app. Framing, prioritisation, and tradeoff reasoning are owned by the harness. The internal Haiku model stays at the I/O boundary.

| Layer | Owns |
|---|---|
| App — facts (deterministic) | Current truth, coverage, the goal catalog, goal decomposition, metric definitions, the directive engine, and cross-goal contention. |
| App — conditional engine (deterministic) | Conditional truth: the same metric and directive code evaluated against the real data plus a hypothetical overlay. Recomputes the consequence of a hypothesis; never invents the hypothesis. |
| Harness (Sonnet and above) | Conversation, prioritisation, tradeoff reasoning, challenge. Composes the hypothesis (the overlay delta); turns fired directives into advice. |
| Internal Haiku | The I/O boundary only — vision extraction, text-to-SQL, and classifying free text onto a goal type. |

A hypothetical is the real balance sheet plus a delta. The harness composes the delta — unbounded, creative — and the app recomputes consequences over the real balances, which is the one thing the harness must never do by hand (the re-ground rule). The overlay vocabulary is rows the schema already holds (a balance snapshot, a transaction), not an authored catalog of scenario types, so a hypothesis is expressible exactly when it is expressible as those rows; structural hypotheticals outside that vocabulary (a rate change, a scheme change) are left to harness reasoning and flagged as assumption-based.

### Vocabulary

These four terms are disjoint and must stay so.

- **Goal type** — a member of a finite, authored catalog (`fire`, `house_deposit`, ...). What the user wants, normalised.
- **Sub-goal** — a component a goal type deterministically decomposes into.
- **Metric** — a deterministic computation that binds a sub-goal to stored data. Its value may be null when the data does not exist yet.
- **Directive** — a rule that fires when a metric is evaluated against a sub-goal's target ("ISA 60 percent funded, 47 days left").

A goal is intent; a directive is observation. They sit on opposite sides of the grounded-observation line. The catalog of goal types and their decompositions is the authored domain corpus — see `docs/goal-catalog.md`.

Worked example: `fire` (financial independence, retire early) decomposes into `target_number` (target portfolio = annual spend / safe-withdrawal-rate), `bridge_fund` (spending across the years between retiring early and pension access age), and `contribution_gap` (required monthly contribution versus actual). The non-trivial edge is UK pension access age (57 from 2028): retiring before it silently requires an ISA or GIA bridge fund, which the decomposition encodes as a sub-goal.

### The goal pipeline

1. **Classify.** The harness elicits the goal; Haiku maps the user's words onto a goal type from the catalog. Text that maps to nothing is pushed back for clarification — an unmappable goal is inert, since it can attach to no directive.
2. **Needs spec.** For a compound goal type the app returns a structured needs spec: the slots that must be filled before decomposition (for `fire`: target annual spend, safe-withdrawal-rate, current age, target retirement age), each with a default where one is sensible.
3. **Interview.** The harness conducts the follow-up conversation to fill the slots. It is filling deterministic slots the app demanded, not deciding what the goal requires.
4. **Confirm and decompose.** On confirmation the app deterministically decomposes the goal type into its sub-goals, each bound to a metric, and stores the goal with its verbatim utterance.

### Design rules

These are invariants, in the same spirit as the persistence-layer rules.

1. **Decomposition is authored, never generated.** The financial logic that turns a goal type into sub-goals is frozen domain knowledge — identical every run and auditable. No model, Haiku or harness, generates it. A goal that cannot be decomposed deterministically is a signal to author a new goal type, not to invoke a model at runtime.

2. **Metrics bind to definitions, not rows; absence is first-class.** A goal binds to a metric definition that always resolves, even when its current value is null because no data has been captured. An unresolved metric fires a data-gap directive ("house deposit goal set, no savings account linked") which becomes the next capture prompt. Missing data is an observation, not an error.

3. **The briefing is push, not pull.** The app proactively evaluates every directive against current data and goals and hands the harness the complete observation set. The harness never chooses what to query — coverage is the app's responsibility, framing is the harness's. This is what prevents a missed pension gap because the model did not think to look.

4. **The verbatim utterance is provenance.** The user's original words are stored on the goal alongside the structured form, mirroring the source-document rule (persistence design rule 1). It serves audit — "why does this goal exist?" — and gives the harness framing context the catalog discards. It is context, never a data source; directives never fire off prose.

5. **The advice gate holds.** A directive firing is an observation and is permitted today. Ranking options ("overpay versus invest") is advice and stays gated under the observations-only decision. The goal framework sharpens where that line sits; it does not move it.

6. **Domain rule data is app-owned, dated, status-tagged, injected, and never recalled.** UK tax and legal rules that drive directives and advice live in the app as reference data, not in the model's memory. They are injected into the advice and briefing payload for the tax year in scope, the same way `schema_catalog.md` is injected into every text-to-SQL call. The harness applies and frames the rules; it never sources a tax figure from its own training, which is stale and unprovenanced. Market and macro context — "markets are down, buy now" — is the opposite category: a judgment about live external state and a form of market timing. It is out of scope, not reference data.

### Domain rule data (tax constants)

Tax and legal constants — allowances, rates, bands, the pension access age — are the sibling of `tax_periods` (persistence design rule 3): app-owned reference data, dated and provenanced. Conceptually a `tax_constants` row carries the constant key, its value (in pence with explicit currency where monetary), a `valid_from`/`valid_to` effective window (the snapshot pattern), a `status` of `enacted` or `announced`, and a source. No DDL yet.

Two properties make it carry forward-looking rule changes without new machinery:

- **Temporal versioning.** Each constant has an effective window. This year's ISA allowance is not next year's; both are rows. An announced-but-future change is simply a row whose `valid_from` is in the future — there is no separate notion of an "announcement".
- **Status.** A constant is `enacted` (in force, royal assent) or `announced` (Budget speech, draft legislation, consultation — subject to change). The status rides through to any directive built on it.

This lets the briefing fire **deadline directives** from pending constants: "ISA allowance drops to X on [date], 73 days away; current headroom Y." That is the same shape as the existing "ISA 60 percent funded, 47 days left" directive — a grounded observation, not a new mechanism. A directive resting on an `announced` (not yet `enacted`) constant must say so — "proposed, subject to legislation" — never stated as settled fact. The "act now" conclusion remains advice, behind the gate.

Updates are **human-curated**. Legislation is never auto-parsed into the canonical table — these are the most safety-critical rows in the system, and one wrong constant poisons every downstream directive. Drafting may be assisted, but a human confirms before the write, the same mandatory-review spine as document ingestion. The table therefore carries a standing maintenance obligation: curated updates on the fiscal cadence, including announced-but-pending changes.

---

## Ingestion pipeline

Three source types. The table taxonomy is identical for all three. The pipeline differs.

### Upload (low trust)

PDF, screenshot, or any document the user drops.

```
Upload → ingest_document tool → Haiku vision → extracted rows → staging buffer
→ ui://review (user confirms) → confirm_staged_rows tool → write to SQLite
```

- `documents.source_type = 'upload'`
- Human confirmation is **mandatory**. Haiku can misparse. The staging/review step is non-negotiable.
- The `documents` row stores the file path, content hash, and ingestion timestamp.

### Manual entry (medium trust)

Values the user types directly into chat. Manual entry is fanned out across one tool per series rather than a single dispatching tool — the LLM picks the right one from the conversation. Each tool ensures its reference row (account/asset/mortgage/grant), writes the audit JSON document, and writes the typed snapshot or event row in one transaction.

| Tool | Writes to |
|---|---|
| `record_account_balance` | `account_balances` (creates `accounts` row if needed) |
| `record_pension_value` | `pension_values` (creates pension `accounts` row if needed) |
| `record_mortgage` | `mortgages` (returns a mortgage ID) |
| `record_mortgage_balance` | `mortgage_balance` (requires existing mortgage) |
| `record_asset_holding` | `holdings` (creates `assets` row if needed) |
| `record_asset_price` | `asset_prices` (creates `assets` row if needed) |
| `refresh_asset_price` | dispatches on `assets.price_source`; manual sources defer to `record_asset_price` |
| `record_equity_grant` | `equity_grant` (returns a grant ID) |
| `record_vesting_event` | `equity_vesting_event` (requires existing grant) |

```
Manual input → record_* tool → writeManualDocument generates JSON → write document row
→ ensure reference row → write event/snapshot row with source_id
```

- `documents.source_type = 'manual'`
- The JSON file captures the raw input exactly as entered — not the processed version. This is the audit trail.
- No staging/confirmation step needed. The user is the source.
- File lives in the same documents directory as uploads. Named `manual_YYYY-MM-DDTHH:MM:SS.json`.

### API connectors (high trust)

Monzo, Ethereum wallet, or any structured data source. **Runs as a background OS process (launchd), not inside the MCP server.**

```
Connector runner → API call → structured data → INSERT OR IGNORE (external_id dedup)
→ write event/snapshot rows → write connector run record to documents
```

- `documents.source_type = 'connector'`
- Auto-write, no confirmation step. Data is structured; confidence is high.
- `external_id` on every event row (Monzo transaction ID, ETH tx hash). Idempotent inserts.
- The MCP server is not involved in writes. It reads the results via DuckDB.
- Connector run record in `documents` includes: connector name, run timestamp, rows written, API response hash.

### The `documents` table as universal source anchor

All three ingestion types write to `documents` first. Every event and snapshot row has `source_id` pointing here.

```sql
CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  source_type  TEXT NOT NULL CHECK (source_type IN ('upload', 'manual', 'connector')),
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ingested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes        TEXT
);
```

This table answers "where did this number come from?" for any row in the database.

---

## Query pipeline

```
User question → Claude Desktop chat → query_natural_language tool
→ schema_catalog.md + DDL → Haiku text-to-SQL → SQL → DuckDB (reads SQLite)
→ result set → tool response → Claude Desktop renders answer
```

### Schema catalog

`schema_catalog.md` is a first-class design artefact, maintained alongside the DDL. It contains:

- One entry per table: purpose, what a row represents, when rows are inserted vs closed
- One entry per non-obvious column: units, sign convention (negative = outflow), temporal semantics
- UK tax year semantics: ISA periods, PAYE year boundary, how to join `tax_periods`
- 5–10 example question/query pairs covering common use cases

This document is injected into every Haiku text-to-SQL call alongside the DDL. Schema naming and catalog quality are the primary levers for query accuracy — well-named schemas with clear catalogs reach ~95% accuracy on the kinds of questions this app handles. No fine-tuning needed.

### Query routing

Not all questions are SQL questions. The schema catalog documents which question types are SQL-answerable:

- **SQL-answerable:** "What was my biggest expense category last quarter?", "How much ISA allowance do I have left?", "What is my current LTV?"
- **Claude Desktop reasoning (not SQL):** "Am I on track for retirement?", "What would happen if I overpaid my mortgage by £500/month?", "Was I on the right tax code last year?" — these require domain logic (PAYE bands, actuarial projection) that lives in Claude's reasoning layer, not SQL. The tool returns raw data; Claude Desktop computes the answer.

---

## Use case validation

This table records **design fit** — whether the schema and architecture accommodate the use case — not what is built today. Several rows describe the end-state target; cashflow categorisation, connectors (and their deduplication), multi-currency, and projections are **deferred** (see the decision log and `CLAUDE.md` for current vs deferred scope). Built today: manual entry, payslip ingest with review, natural-language query, and net worth (realised + contingent) with a 12-month trend.

| Use case | Design fit | Notes |
|---|---|---|
| Net worth at a point in time + trend | ✅ | LOCF across snapshot series; DuckDB windowed aggregation |
| Cashflow by category | ✅ | Event table + DuckDB GROUP BY; requires categorisation at ingestion |
| PAYE / tax code correctness | ✅ data / ⚠️ logic | Raw payslip facts from `income_events`; PAYE arithmetic in Claude Desktop |
| Pension pot value + contribution history | ✅ | Snapshots + events on different cadences; pre-built view for growth calc |
| Mortgage balance, equity, LTV | ✅ | Two snapshot series joined at query date |
| ISA allowance (UK tax year) | ✅ | `tax_periods` table; SUM of deposits since `starts_on` |
| Salary history + correction | ✅ | `valid_from`/`valid_to` on `person_profile`; close + insert on correction |
| Late / backfill ingestion | ✅ | `valid_from` = statement date, `recorded_at` = today; retroactive correction by design |
| Historical correction without data loss | ✅ | Close old row, insert corrected row; old row preserved |
| LLM natural language query | ✅ | Schema catalog + DuckDB execution; schema naming is the accuracy lever |
| Crypto P&L | ✅ | `holdings` quantity snapshots × `asset_prices` ticks + acquisition events; staleness must be surfaced |
| Progressive data entry (sparse early data) | ✅ | LOCF returns last known value; null = never tracked, distinguished from zero |
| Multi-currency assets | ✅ | Store original + GBP equivalent at observation; no live FX at query time |
| Connector deduplication | ✅ | `external_id` + `INSERT OR IGNORE`; idempotent by design |

---

## Remote hosting, authentication, and operations

The app runs as an always-on service on a Mac mini, reachable over the internet through ngrok and
gated by passwordless passkey auth — while staying local-first (the SQLite stores and all secrets
never leave the box). Provisioning is scripted in `ops/mac-mini/provision.sh`; the operational
how-to is [mac-mini-runbook.md](mac-mini-runbook.md).

### Two listeners, one process

The server binds two loopback listeners. The open `127.0.0.1:4000` (`node:http`, unchanged) serves
a co-located Claude Desktop with no auth. The authenticated `127.0.0.1:4001` (Express) is the only
port ngrok forwards to; everything public goes through it. The same process is the MCP server, the
OAuth 2.1 Authorization Server, and the Resource Server — it signs access tokens with an Ed25519
key and verifies them in process. The per-request MCP handling is shared by both listeners
(`server/mcp_request.ts`).

### Authentication

A client with no token gets `401` + `WWW-Authenticate` pointing at Protected Resource Metadata,
then discovers the Authorization Server, self-registers (Dynamic Client Registration), and runs
OAuth 2.1 auth-code + PKCE. The authorize step renders a plain server-rendered consent page that
runs the WebAuthn passkey ceremony (`@simplewebauthn`, discoverable credential, user-verification
required); the ceremony is bound to the specific authorization request and the page shows the
destination, so a phished link is visible. On success the client exchanges a single-use code for a
signed access JWT (short-lived) plus a rotating, revocable opaque refresh token. The gate is
single-user: every token's `sub` must equal `AUTHORIZED_SUBJECT`. Code lives in `server/auth/`.
Enrolment is a one-time local CLI that prints a single-use link opened at the public origin so the
credential binds to the production RP ID; recovery is re-enrolment (machine access is the root of
trust). The auth pages are intentionally unstyled — the Instrument design system applies to the
`ui://` iframe surfaces, not these server-rendered pages.

### Secrets isolation from the query path

Sensitive tables — `connector_state` (Monzo/Ethereum tokens) and the OAuth/WebAuthn tables — live
in a separate `secrets.sqlite` (`0600`), attached to the single better-sqlite3 writer as schema
`secrets`; SQLite resolves the unqualified names there, so app code is unchanged. No DuckDB read
engine attaches that file. The natural-language (text-to-SQL) path runs a dedicated DuckDB engine
that materialises only an allow-listed set of product tables (`server/nlq_allowlist.ts`,
`server/nlq_query.ts`) and detaches the source, so secrets and `tax_constants` are physically
absent — a model-generated query against them returns a DuckDB Catalog Error, not a policy miss.
Internal/admin reads keep the full read path. This is the enforceable analog of "two SQL users"
given SQLite and embedded DuckDB have no roles/`GRANT`s.

### Operations

Services run as LaunchDaemons under a dedicated `_pfa` user in the system domain — FileVault is on
(encrypting data and secrets at rest), which disables auto-login, so per-user LaunchAgents aren't
viable; daemons start at boot after the one disk unlock. The host disables sleep, restarts after
power loss, keeps NTP on (token expiry needs a correct clock), rotates logs, and snapshots both
SQLite files nightly. Deploys are release-triggered: publishing a GitHub release runs a self-hosted
runner (as `_pfa`) that backs up the data store, syncs the tag, builds, restarts the server daemon
through a narrow `sudoers` entry, health-checks, and rolls back on failure. ngrok provides a stable
reserved domain (also the WebAuthn RP ID) and TLS; auth is enforced in-band, so ngrok is ingress
only. The DNS-rebinding guard in `http.ts` (a `Host` allowlist) accepts the public origin on 4001 —
the permanent fix that retired an earlier `--host-header` proof stopgap.

### Locked decisions

- The public domain is the WebAuthn RP ID; a passkey binds to it, so the domain is fixed before
  enrolment.
- One authorized `sub`; any other identity is refused at the Resource Server.
- The Ed25519 signing key is a `0600` file (not the login Keychain — a LaunchDaemon has no Keychain
  session), generated once on the box, never in git or CI.
- Short access-token TTL (~30 min) plus a longer rotating refresh token; tokens carry
  `aud = MCP_RESOURCE`.
- All runtime secrets stay on the mini; the deploy needs none, so none are injected through CI/CD.

### Deferred

Rate-limiting the auth endpoints; an auth audit log; Instrument styling of the login experience (the
offline bootstrap page excepted — not worth the effort); making the `ui://pfa/*` surfaces
mobile-friendly (they render legibly in the Claude mobile app but content is crushed and wrapped); a
dedicated broad integration suite; CORS/security headers and HSTS; signing-key rotation via the JWKS
`kid`; validating the claude.ai hosted web connector (the flow is validated via MCP Inspector, the
Claude Code CLI, and Claude Desktop over `mcp-remote`). Unattended cold-boot recovery is limited by
FileVault — one manual unlock, which a UPS bridges for brief outages.

The served auth origin now carries a dark/light-aware PFA favicon (`server/auth/assets/` — a
theme-aware SVG via `@media (prefers-color-scheme: dark)`, an ICO fallback, an apple-touch-icon),
served at the origin root and linked from every auth page, including a minimal `200` landing page at
`/` (the root previously 404'd). The connector chip icon in Claude is sourced from Google's S2
favicon service (`google.com/s2/favicons?domain=…`), which crawls the public domain rather than
reading the MCP `serverInfo.icons` field (already populated in `server/icons.ts`); the landing page
exists so that crawl finds the favicon. Cache refresh there is on Google's own cadence (often a day
or more) and cannot be forced.

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-09 | Remote hosting + deploy: always-on Mac mini, ngrok ingress, self-hosted runner, release-triggered deploy with backup/rollback | Local-first but internet-reachable; LaunchDaemons under `_pfa` (FileVault forces the system domain). See "Remote hosting, authentication, and operations" + the runbook. |
| 2026-06-09 | Passkey auth: OAuth 2.1 + WebAuthn on a second loopback listener (4001), single-user | Passwordless, request-bound, single `sub`; Ed25519 in a `0600` file; open 4000 unchanged. See the hosting/auth section. |
| 2026-06-09 | Secrets split from the NLQ path: `secrets.sqlite` + a restricted allow-list DuckDB engine | Sensitive tables physically absent from the text-to-SQL engine (Catalog Error, not a policy miss); the enforceable analog of two SQL users. |
| 2026-06-08 | Transport: stdio to Streamable HTTP on localhost; Desktop bridges via `mcp-remote` | Decouples the server from Desktop's lifecycle (restart without relaunching Desktop). Stateless transport, per-request `buildServer()`, `node:http` with a Host/Origin allowlist. UI `ui://` HTML re-read from disk per request so rebuilds need no restart. |
| 2026-05-26 | Architecture: Claude Desktop + local stdio MCP server + MCP Apps | App is the MCP server. No web server, no OAuth, no public exposure. Data stays on disk. |
| 2026-05-26 | Ingestion: human review non-negotiable for document uploads | Haiku vision can misparse. Silent writes to canonical store are not acceptable. |
| 2026-05-26 | Recommendations: observations only | "ISA 60% funded, 47 days left." No buy/sell/overpay advice until trust is established. |
| 2026-05-26 | Write store: SQLite via `better-sqlite3` | Local-first, ACID, single file, zero ops. |
| 2026-05-26 | Read layer: DuckDB via SQLite extension | One file, two engines. No ETL. Columnar reads for LOCF and aggregations. |
| 2026-05-26 | Amounts: integers (pence), never floats | Financial correctness. Rounding errors in floats are unacceptable for tax calculations. |
| 2026-05-26 | UK tax year: explicit `tax_periods` table | All ISA/PAYE queries anchor here. Haiku must never assume calendar year. |
| 2026-05-26 | Source anchor: `documents` table, universal | All ingested rows (upload, manual, connector) carry `source_id`. No orphaned data. |
| 2026-05-26 | Manual entry: system-generated JSON acts as document | No schema change needed. Uniform audit trail across all ingestion types. |
| 2026-05-26 | Connectors: separate OS process (launchd) | MCP server lifecycle is bound to Claude Desktop. Periodic syncs must run independently. |
| 2026-05-26 | Connector deduplication: `external_id` + `INSERT OR IGNORE` | Idempotent at the database level. No application-layer dedup logic. |
| 2026-05-26 | Text-to-SQL accuracy: schema design + catalog, not fine-tuning | Well-named schemas + `schema_catalog.md` reach ~95% accuracy on bounded domains. |
| 2026-05-26 | Staleness: always surface `recorded_at` | Every snapshot-derived value carries its observation date. Never imply live data. |
| 2026-05-27 | Flex layer: bounded `payload` JSON on proven-tail tables | Typed spine for anything aggregated or trended; `payload` for the unmodelled long tail on `income_events` and the equity tables. Not blanket, not a query target, with a promotion path. Derived from the end-state flow refinement in `docs/end-state-flows.md`. See design rule 7. |
| 2026-05-27 | Equity entities: `equity_grant` + `equity_vesting_event` | Typed primitives (scheme type, units, strike, vest dates) plus `payload` for scheme-specific terms. Valuation and vesting-tax methods remain open decisions. |
| 2026-05-28 | Manual entry: fanned per series, not a single dispatching tool | One `record_*` tool per series (`account_balance`, `pension_value`, `mortgage`, `mortgage_balance`, `asset_holding`, `asset_price`, `refresh_asset_price`, `equity_grant`, `vesting_event`). Each owns its own zod schema, ensures its reference row, writes the audit JSON, and inserts the typed row in one transaction. The LLM picks the right one from chat. Shared helpers in `references.ts`. |
| 2026-05-28 | Net worth: dedicated `get_net_worth` tool, not text-to-SQL | Contingent (unvested) equity valuation isn't expressible as a single clean query and must not be confused with realised holdings. A typed module computes the split and is consumed by `ui://pfa/net_worth.html`. |
| 2026-05-28 | Asset pricing: split inventory from valuation; event-locked prices stay on event rows | `holdings` (quantity, changes on transactions) + `asset_prices` (per-unit price ticks, source-tagged) replace the old `asset_values` table which bundled both. Property value moves to `asset_prices` against a `property` asset, removing it from `mortgage_balance`. Equity grant current price moves from `payload` to `asset_prices` via `equity_grant.asset_id`. Strike and market-at-vest remain on their respective event rows as immutable tax facts. `assets.price_source` is a strategy hint for future connectors. |
| 2026-05-28 | Data access: Kysely typed query builder + migrator | Write path (`record_*` tools, `references.ts`) uses Kysely over `better-sqlite3` for typed inserts/selects and transactions. Schema lives once as the Kysely `DatabaseSchema` interface (`server/schema.ts`); a coverage test asserts every table/column appears in `docs/schema_catalog.md`. Versioned migrations (`server/migrations/`) replace the destructive `DDL` + `DROP_ALL` strings; `initDb()` runs `migrateToLatest()` on startup, `resetDb()` is test-only. The DuckDB read path keeps parameterised `sql` (no string interpolation); `runQuery(sql, params)` passes bind parameters. |
| 2026-05-28 | As-of lookup: one centralised LOCF helper | The "latest snapshot covering a date" logic, previously hand-rolled per query, lives once in `server/snapshots.ts` and is composed by every net-worth line query and the trend points. See design rule 5. |
| 2026-05-29 | Goals: goals-first, deterministic decomposition, push briefing | Goal capture is a first-class flow. The dividing line is grounded observation versus synthesised advice, not model capability — the app owns truth, the goal catalog, decomposition, metrics, and the directive engine; the harness owns framing and tradeoffs; Haiku only classifies free text onto a goal type. Goal-type decomposition into sub-goals is authored and frozen, never model-generated. Metrics bind to definitions (absence fires a data-gap directive). The briefing pushes the complete observation set rather than the harness pulling. The verbatim utterance is stored as provenance and framing context, never a data source. The advice gate is unchanged. See the Goal framework section and `docs/goal-catalog.md`. |
| 2026-05-29 | Tax rules: app-owned `tax_constants`, injected, never recalled | UK tax and legal constants are app-owned reference data, the sibling of `tax_periods` — dated (`valid_from`/`valid_to`), status-tagged (`enacted` vs `announced`), provenanced. Injected into the advice and briefing payload for the tax year in scope; the harness applies and frames the rules but never sources a tax figure from its own training. A future-effective row is an announced change; deadline directives fire from pending constants and carry their certainty ("proposed, subject to legislation"), while "act now" stays advice. Updates are human-curated on the fiscal cadence — legislation is never auto-parsed into the canonical table. See the Domain rule data section. Built: `server/migrations/0006_tax_constants.ts` (table + primary-source seed) and `server/tax_constants.ts` (the `resolveConstant`/`upcomingChange`/`taxConstantsForDate` accessor); the briefing injects the bundle and fires a cash-ISA-2027 deadline directive for `isa_max` goals. Refinement: `status` (certainty) and `valid_from`/`valid_to` (effect window) are orthogonal — an `enacted` row can be future-effective — and `valid_to` is inclusive, matching `tax_periods`. |
| 2026-05-29 | Market and macro context: out of scope | Market direction and timing — "markets are down, buy now" — is a judgment about live external state, not reference data. The app never asserts it. Any factual market data is a far-future grounded-connector concern with provenance, never a recommendation; the directional call is market timing and stays out. |
| 2026-05-29 | Advice gate enforcement: behavioural via server instructions and tool metadata, not structural | The goals-first rule, observations-not-advice gate, and push-not-pull briefing contract are enforced via MCP server `instructions` and tool descriptions. These are best-effort nudges — `instructions` is MAY-injected per spec, and tool descriptions shift model behaviour probabilistically. They are not a hard guarantee: a determined user or model can still bypass them, and `query_natural_language` remains an open data path. The only proof of effect is empirical (manual Claude Desktop test per the verification protocol). True enforcement requires handler-side gating or removing model-facing raw-data tools; this is deferred as a larger product decision. |
| 2026-05-29 | Monzo connector pulled forward from Deferred; manual sync, not cron | Connectors were deferred, but a real-transaction source is what every downstream capability needed to be tested on true data, so the Monzo connector was built. Scoped to what the Monzo developer API actually exposes: current + joint accounts, pots, balances, transactions — not investments or pensions (no API), which stay on manual entry. v1 is a manually-invoked `sync_monzo` tool, not a launchd/cron daemon — this keeps the single-writer invariant (no multi-process SQLite contention) and turns Monzo's 90-day re-auth from a silent stall into a visible re-connect. Each Monzo account and pot is modelled as its own `accounts` row keyed by `(provider, external_id)`; pots map to `savings`/`isa` so they flow into net worth and `liquid_savings` unchanged. Transactions dedupe on `external_id` via INSERT OR IGNORE. Reconciliation is deterministic code, no model in the sync path. Credentials enter only through the `ui://connectors` widget calling an `app`-visibility-only `connect_monzo` tool, never through chat; a local `npm run monzo:auth` loopback helper mints OAuth tokens and the user pastes them into the widget, so the widget→tool→server channel stays the sole ingestion boundary and survives a future remote-hosted server. See the connector modules in `server/connectors/`. |
| 2026-05-29 | Internal transfers tagged at ingest, excluded from spend | A movement between the user's own accounts or pots (funding a savings pot, current→ISA, current→joint) is not consumption and not income. The connector tags such transactions `is_internal = 1` deterministically at ingest (pot scheme/metadata, or a counterparty matching a known own account). Spend aggregations — average monthly outgoings and cashflow inflow/outflow — exclude `is_internal = 1`. The ISA-allowance metric does NOT exclude them, because a current→ISA transfer is itself a genuine contribution. The classifier is isolated for refinement against live data. |
| 2026-05-29 | Cashflow income: bank feed is the amount truth, payslip is the tax decomposition | Once the bank feed exists, actual money in/out comes from `transactions` — the salary credit, rent, and other income all land there as credits, each counted exactly once. Payslip `income_events` is no longer an additive cashflow line; it is the tax decomposition of the salary credit (gross, PAYE, NI, employee/employer pension) and drives the tax-year and allowance logic. Summing payslip net with transaction inflows double-counts salary. This assumes the salary-receiving account is connected (confirmed: salary always lands in Monzo); a payslip with no matching credit in a connected account is a data-gap directive, not a silent fallback. Labelling income credits as salary-vs-other (by employer payer) is a deferred enhancement on top of a now-correct total. See Flow 5 in `docs/end-state-flows.md`. |
| 2026-06-01 | Edit/correction/removal built — `superseded_by` marker, unified tool pair, logical removal | Flow 2 is built. Three operations are kept distinct: a *new version* (the value changed) is an ordinary `record_*` insert; a *correction* (the row was recorded wrong) inserts a superseding row at the original effective date and marks the wrong row `superseded_by`; a *removal* (no version applies) sets `superseded_by` with no successor. Migration `0009_superseded_by` adds a nullable `superseded_by` to every editable event and snapshot table, narrowing event-immutability to "financial columns immutable; the marker is the one permitted mutation." Removal is logical only (tombstone retained for audit), never a hard delete. The deterministic primitive lives in `server/corrections.ts`; `correct_record` and `retract_record` (both `destructiveHint`) are the only edit channel — never LLM-generated mutation SQL — and refuse connector-sourced rows. Equity grants are retract-and-recreate (retracting a grant cascades to its vesting events). Every aggregate and the LOCF helpers filter `superseded_by IS NULL`; the text-to-SQL catalog instruction enforces the same on the NL path (best-effort, like the advice gate). See Flow 2 in `docs/end-state-flows.md`. |
| 2026-05-31 | Payslip surfacing: two-denominator model, gross-to-net waterfall in cashflow | Every pound is shown once per denominator, and each view states which it uses. Denominator A is gross earnings (the payslip's domain): the waterfall Gross − pre-tax − PAYE − NI − post-tax = Net. Denominator B is cash in the account (the bank feed): net credit + other credits − spending − savings. They meet only at net pay = salary credit. Post-tax outgoings are outflows of earnings, shown as a waterfall leg in A, never as bank spending categories in B (they never land as a spendable credit). Pension is deferred-not-spent and visually distinct from tax; employer pension is total-reward context, never added to income. Surface is split by question: the current-period waterfall lives in cashflow; longitudinal trends (gross over time, tax-code timeline, YTD PAYE/NI) are deferred to a standalone earnings surface. Two capture gaps unblock this: `tax_code` is promoted to the `income_events` spine (migration `0007`), and each payslip `line_item` gains a `section` (payment vs deduction) to resolve salary-sacrifice ordering deterministically — no fuzzy category enum yet. An unexplained gross-to-net gap surfaces as a labelled "other deductions" leg, never hidden. Net-pay ⇄ salary-credit reconciliation as a data-gap directive remains asserted-not-built and is a follow-on. See Flow 5 in `docs/end-state-flows.md`. |
| 2026-06-01 | Multi-goal contention and a conditional-truth engine for hypotheticals | Goals share one balance sheet; the app stops treating each as if it privately owned the whole. Three moves. (1) A third boundary layer — the conditional engine — sits between app-facts and harness-framing: the same metric and directive code evaluated against the real data plus a hypothetical overlay. A hypothetical is the real balance sheet plus a delta; the harness composes the delta (unbounded), the app recomputes the consequence over real balances (the one thing the harness must never hand-arithmetic, per the re-ground rule). The overlay vocabulary is rows the schema already holds (`account_balance`, `transaction`), not an authored scenario catalog — a real event is expressed as the rows it produces (a bonus into the ISA is both a positive ISA transaction and a balance bump), so expressiveness tracks the schema and structural hypotheticals outside it are left to harness reasoning, flagged as assumption-based. Mechanism: DuckDB read-context carrying a schema prefix (`pfa` live, `scen` for scenarios); the scenario clones the touched tables into `scen` and inserts the overlay; one query-building path, so the live briefing is the evaluator run with an empty overlay — enforced by a test asserting `evaluate_scenario({overlay:{}})` deep-equals `get_briefing()` (`server/query.ts`, `server/tools/evaluate_scenario.ts`). (2) Contention is a grounded observation: each goal type declares the account-type set it claims (default-by-class, no earmark capture yet), and the briefing emits a `contention` directive over accounts two goals share, wording it "shared pool" since default-by-class is coarse; resolving the contention stays advice (`server/goals/resources.ts`). (3) The advice gate is sharpened, not moved: showing each allocation's grounded conditional outcome (the frontier) is observation and permitted; ranking the options or saying "do this one" stays gated. `house_deposit` is promoted to an implemented goal type to give contention a second liquid claimant. Earmarks (a `goal_resource` join table), cross-engine feasibility against the cashflow surplus, and `fire`/`retirement` remain deferred. See the Goal framework section and Flow 8. |
| 2026-06-05 | Tax-position engine — the briefing joins the rulebook to the user's income | The briefing stored the UK rulebook (`tax_constants`) and the user's income (payslips, salary, equity) but never joined them, so any "how much tax / what's my real position" question forced the harness to hand-compute or ask the user (the "higher or basic rate?" failure). A deterministic engine (`server/tax/engine.ts`, `taxPosition(asOf, ctx)`) now applies the seeded constants to actual income and pushes a `tax_position` block into the briefing (a block like `earnings`, not a goal-directive). It computes projected annual income, adjusted net income, marginal rate (including the ~60% personal-allowance taper band £100k–£125,140), an income-tax and employee-NI estimate, and the pension annual-allowance taper above £260k adjusted income. Inputs reuse existing helpers; `tax_constants` (migration `0006`) already seeds every band/threshold/rate, so no constants work — taper *rates* (£1-per-£2) are derived in code from the seeded threshold pairs. Projected income = regular run-rate (salary from the newly-activated `person_profile`, else annualised payslips) + income above that run-rate (a bonus or one-off) + RSU vesting this tax year; **RSU only** is treated as income at vest (EMI/SAYE/unapproved excluded and surfaced in `assumptions[]`). Adjusted net income nets off annualised employee pension contributions so the £100k test is accurate. Partial-year data works because UK PAYE is already a cumulative annual estimate: the run-rate annualises the regular salary and known future events layer on, getting sharper as real payslips land — projected and realized stay separate, labelled fields. `record_person_profile` activates the dormant `person_profile` table (salary/employer/tax_code as a correctable snapshot), making salary first-class. Scenario integration: `income_events` joins the overlay clone set and the `evaluate_scenario` vocabulary, and `earningsContext`/`taxPosition` are threaded with the read-context, so a hypothetical bonus (the rows a real bonus produces) recomputes the position with no hand arithmetic; the empty-overlay invariant still holds. It stays on the observation side of the advice gate — facts and flags, never a recommendation. Deferred: the comp-expectation layer (bonus %, BIK, LTIP policy) and a standing `total_comp` observation; CGT-on-disposals and dividend tax (need disposal/cost-basis capture); scheme-specific equity tax beyond RSU; Scottish rates; the pension threshold-income (£200k) secondary test. See Flow 8. |
