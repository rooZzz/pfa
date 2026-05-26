# POC Plan

Architecture validation spike — four stages. Don't proceed to the next stage without the current one's exit criteria passing.

## Stage 1: Architecture validation
**Status**: passed (2026-05-26)

Clone `modelcontextprotocol/ext-apps`. Install the `map-server` example into Claude Desktop via stdio. Confirm the interactive map renders inline in chat.

**Exit criteria:** UI resource renders, tool calls round-trip from the iframe.

## Stage 2: Hello-world server
**Status**: not started

Strip down to a minimal custom server: one tool returning a greeting, one UI resource displaying it with a button that calls a second tool. Bidirectional communication confirmed.

**Exit criteria:** Custom `ui://` resource renders, button click triggers second tool call, result updates UI.

## Stage 3: Persistent data round-trip
**Status**: not started

Add `better-sqlite3`. One table (`transactions`), one tool to insert, one tool to read, one UI resource displaying rows as a table.

**Exit criteria:** Data persists across Claude Desktop restarts, UI table reflects DB state.

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
