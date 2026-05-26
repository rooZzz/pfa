# POC Plan

Architecture validation spike — four stages. Don't proceed to the next stage without the current one's exit criteria passing.

## Stage 1: Architecture validation
**Status**: passed (2026-05-26)

Clone `modelcontextprotocol/ext-apps`. Install the `map-server` example into Claude Desktop via stdio. Confirm the interactive map renders inline in chat.

**Exit criteria:** UI resource renders, tool calls round-trip from the iframe.

## Stage 2: Hello-world server
**Status**: passed (2026-05-26)

Strip down to a minimal custom server: one tool returning a greeting, one UI resource displaying it with a button that calls a second tool. Bidirectional communication confirmed.

**Exit criteria:** Custom `ui://` resource renders, button click triggers second tool call, result updates UI.

## Stage 3: Persistent data round-trip
**Status**: implemented — pending live verification in Claude Desktop (criterion 4: text-to-SQL via Haiku)

Validate the dual-engine persistence architecture and both table patterns end-to-end. Not about building the full schema — about proving the core mechanics before Stage 4 adds real ingestion. See `docs/architecture.md` for the full design this stage is validating.

### Minimal schema

```sql
CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  source_type  TEXT NOT NULL CHECK (source_type IN ('upload', 'manual', 'connector')),
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ingested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes        TEXT
);

CREATE TABLE transactions (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL,
  occurred_at  TIMESTAMP NOT NULL,
  recorded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount_pence INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  description  TEXT,
  source_id    INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE account_balances (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL,
  balance_pence INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'GBP',
  valid_from    DATE NOT NULL,
  valid_to      DATE,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_id     INTEGER NOT NULL REFERENCES documents(id)
);

CREATE TABLE tax_periods (
  tax_year  TEXT PRIMARY KEY,
  starts_on DATE NOT NULL,
  ends_on   DATE NOT NULL
);
```

### Tools to implement

| Tool | What it does |
|---|---|
| `ingest_manual_entry` | Generates JSON file, writes `documents` row, writes event or snapshot row |
| `query_natural_language` | Calls Haiku with DDL + schema catalog, executes returned SQL via DuckDB against the SQLite file |

### Exit criteria

1. Data persists across Claude Desktop restarts (SQLite confirmed).
2. DuckDB reads the same `.sqlite` file and produces correct aggregate results (dual-engine confirmed).
3. LOCF query on `account_balances` with a deliberate gap returns the last known value, not null (snapshot pattern confirmed).
4. `query_natural_language("what is my current account balance?")` returns the correct value via Haiku-generated SQL (text-to-SQL pipeline end-to-end).
5. Insert with no `source_id` is rejected at the DB constraint level — not application logic (audit trail enforced).
6. Two `account_balances` rows with different `valid_from` dates; query for a date between them returns the earlier value (LOCF confirmed).
7. A `ui://data` resource renders the stored rows and reflects the current DB state — MCP server to UI round-trip confirmed with real persisted data.

## Stage 4: Real schema and ingestion (only if 1–3 pass)
**Status**: not started

- Full schema: `accounts`, `transactions`, `holdings`, `prices`, `liabilities`, `documents`, `entities`
- `ingest_document` tool calling Haiku 4.5 vision on one UK payslip
- `ui://review` resource for staged-row confirmation
- One real account, manually entered, one statement ingested

**Exit criteria:** End-to-end flow works for one document, one account, with data auditable back to source file.

---

## Verified assumptions (as of 2026-05-26)
- Claude Desktop supports local stdio MCP servers (well documented)
- MCP Apps UI resources render in Claude Desktop (free tier, web and desktop)
- MCP Apps spec is transport-agnostic; official `ext-apps` repo ships stdio-installable examples explicitly for Claude Desktop
- Haiku 4.5 supports vision and structured tool output at ~£0.005–0.01 per parsed page

## Known risks
- MCP Apps spec is **Draft** (created 2025-11-21). Expect minor breaking changes. **Mitigation**: pin SDK versions.
- No HMR inside Claude's iframe sandbox. UI iteration requires rebuild. Acceptable for personal use.
- CSP defaults are strict; external fonts/CDNs must be declared in `_meta.ui.csp`.
- Vision parsing accuracy on UK payslips unverified. **Mitigation**: human review queue is non-negotiable.
- Server lifecycle bound to Claude Desktop. Snapshot/cron jobs must live in a separate process (launchd/systemd), not the MCP server.
